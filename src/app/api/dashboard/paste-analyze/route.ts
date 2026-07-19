/* POST /api/dashboard/paste-analyze — free quick bid/no-bid triage.
 *
 * Reads a pasted tender (URL or notice text), grounds it against the user's
 * profile + known readiness gaps, and returns a fast fit verdict + requirements
 * ledger via ONE Haiku call. This is the free first read that powers the Paste
 * flow's free-text path; the paid bid/no-bid service does the full grounded memo
 * (scoring matrix, win themes, …) — this funnels into it, it doesn't replace it.
 * Rate-limited + auth-gated to bound LLM spend. */

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/access";
import { extractDocumentText } from "@/lib/documents/extract";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { loadWorkbenchSource } from "@/lib/assessment/data";
import { canRunBidNoBid, recordBidNoBidUse, bidNoBidLimitResponse } from "@/lib/bid-no-bid-usage";

export const runtime = "nodejs";
export const maxDuration = 45;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PasteVerdict {
  tender: { title: string; agency: string | null };
  fit: number;
  recommend: boolean;
  summary: string;
  on_file: string[];
  gaps: string[];
  asks: string[];
}

function unavailableResponse(status: 502 | 503, reason: string) {
  const caseRef = `BNB-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  console.warn("[paste-analyze:assisted_fallback]", { caseRef, reason, status });
  return NextResponse.json(
    {
      code: "ANALYSIS_UNAVAILABLE",
      case_ref: caseRef,
      error: "The automated read is temporarily unavailable. Your tender can still continue through the guided assisted-review workspace.",
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (!guard.authorized) return guard.response!;
  const limited = enforceRateLimit(req, {
    namespace: "paste-analyze",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    keyParts: [guard.user!.id],
  });
  if (limited) return limited;

  // Freemium cap: free accounts get BID_NO_BID_FREE_MONTHLY instant verdicts per
  // calendar month; Pro (subscribed / admin / in-trial) is unlimited. Checked
  // here, but only RECORDED on a successful verdict below, so a failed read
  // (unreadable PDF, LLM error) never burns a free credit.
  const { allowed, usage } = await canRunBidNoBid(guard.user!);
  if (!allowed) {
    console.log("[paste-analyze:cap_reached]", { userId: guard.user!.id, used: usage.used, limit: usage.limit });
    return NextResponse.json(bidNoBidLimitResponse(usage), { status: 402 });
  }

  let body: { text?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // 1. Resolve the tender text (from a URL we can fetch, or the pasted notice).
  let tenderText = (body.text ?? "").trim();
  const url = (body.url ?? "").trim();
  // Track WHY a URL resolve failed so the 422 can guide instead of stonewalling,
  // and so prod logs distinguish a fetch block from an empty/scanned PDF.
  let failReason: "fetch" | "http" | "pdf_empty" | "pdf_failed" | null = null;
  if (!tenderText && url) {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
      const r = await fetch(u.toString(), {
        headers: {
          // Some portals/CDNs 403 a bare bot UA; present as a normal client.
          "user-agent": "Mozilla/5.0 (compatible; TenderPathBot/1.0; +https://www.tenderpath.me)",
          accept: "application/pdf,text/html,application/xhtml+xml,*/*",
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      if (!r.ok) {
        failReason = "http";
        console.warn("[paste-analyze:fetch_http_error]", { status: r.status, url: u.toString() });
      } else {
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/pdf") || u.pathname.toLowerCase().endsWith(".pdf")) {
          const buf = Buffer.from(await r.arrayBuffer());
          const extracted = await extractDocumentText({
            buffer: buf,
            mimeType: "application/pdf",
            fileName: u.pathname.split("/").pop() || "tender.pdf",
          });
          tenderText = extracted.text;
          if (extracted.status !== "extracted") {
            failReason = extracted.status === "empty" ? "pdf_empty" : "pdf_failed";
            console.warn("[paste-analyze:pdf_extract_failed]", {
              status: extracted.status,
              error: extracted.error,
              chars: extracted.charCount,
              url: u.toString(),
            });
          }
        } else {
          tenderText = stripHtml(await r.text());
        }
      }
    } catch (err) {
      failReason = "fetch";
      console.warn("[paste-analyze:fetch_failed]", { err: err instanceof Error ? err.message : String(err) });
    }
  }
  tenderText = tenderText.slice(0, 16_000);
  if (tenderText.trim().length < 40) {
    const error =
      failReason === "pdf_empty"
        ? "That looks like a scanned PDF with no selectable text. Paste the notice text instead."
        : failReason === "pdf_failed"
          ? "We couldn't read that PDF. Try the tender's web page, or paste the notice text."
          : failReason === "http"
            ? "That link wouldn't open — it may need a login or block automated access. Paste the notice text instead."
            : "We couldn't read that. Paste the notice text, or a link to the tender page.";
    console.warn("[paste-analyze:unreadable]", { failReason, hadUrl: !!url, chars: tenderText.trim().length });
    return NextResponse.json({ error }, { status: 422 });
  }

  // 2. Ground in the applicant's profile + known open gaps (best-effort).
  let profile = "";
  let gapTitles: string[] = [];
  try {
    const src = await loadWorkbenchSource(guard.user!.email);
    if (src) {
      profile = `Company: ${src.report.companyName}\nSector: ${src.report.sector}\nProfile: ${src.report.summary}`;
      gapTitles = src.report.gaps.filter((g) => !g.resolved).map((g) => g.title).slice(0, 8);
    }
  } catch {
    /* degrade — judge on the tender alone */
  }

  // 3. One Haiku triage call.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[paste-analyze:no_api_key]");
    return unavailableResponse(503, "missing_api_key");
  }
  const prompt = `You are a procurement bid/no-bid triage analyst. Decide whether the applicant should bid on this tender. Be grounded — use only what the tender and profile state; never invent requirements.

APPLICANT
${profile || "(profile unavailable — judge on the tender alone)"}

APPLICANT'S KNOWN OPEN READINESS GAPS (reuse this exact wording when one of these applies):
${gapTitles.length ? gapTitles.map((g) => "- " + g).join("\n") : "(none recorded)"}

TENDER
"""
${tenderText}
"""

Return ONLY a JSON object (no prose, no markdown fence) with this exact shape:
{
  "tender": { "title": string, "agency": string | null },
  "fit": number,            // 0-100, how well the applicant fits this tender
  "recommend": boolean,     // true = worth bidding
  "summary": string,        // 2-3 sentences: what the call is, and why bid or not
  "on_file": string[],      // requirements the applicant clearly already meets (from their profile)
  "gaps": string[],         // eligibility/readiness requirements they likely don't meet
  "asks": string[]          // inputs needed FROM the applicant to complete a bid (e.g. "Technical methodology", "Proposed team")
}`;

  let raw = "";
  try {
    const client = new Anthropic({ apiKey });
    const completion = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    raw = completion.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch (err) {
    console.error("[paste-analyze:llm_failed]", { userId: guard.user!.id, err: err instanceof Error ? err.message : String(err) });
    return unavailableResponse(502, "provider_call_failed");
  }

  // 4. Parse defensively.
  try {
    const jsonStr = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const p = JSON.parse(jsonStr) as Record<string, unknown>;
    const arr = (v: unknown, n: number): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, n) : []);
    const t = (p.tender ?? {}) as Record<string, unknown>;
    const verdict: PasteVerdict = {
      tender: { title: String(t.title ?? "Pasted tender"), agency: t.agency ? String(t.agency) : null },
      fit: Math.max(0, Math.min(100, Math.round(Number(p.fit) || 0))),
      recommend: Boolean(p.recommend),
      summary: String(p.summary ?? ""),
      on_file: arr(p.on_file, 6),
      gaps: arr(p.gaps, 6),
      asks: arr(p.asks, 4),
    };
    const usageAfter = await recordBidNoBidUse(guard.user!);
    console.log("[paste-analyze:ok]", { userId: guard.user!.id, fit: verdict.fit, recommend: verdict.recommend, used: usageAfter.used });
    return NextResponse.json({ ...verdict, usage: usageAfter });
  } catch {
    console.error("[paste-analyze:parse_failed]", { userId: guard.user!.id, rawPrefix: raw.slice(0, 200) });
    return unavailableResponse(502, "provider_response_unreadable");
  }
}
