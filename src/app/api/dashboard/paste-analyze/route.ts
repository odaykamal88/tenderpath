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
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText } from "@/lib/documents/extract";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { loadWorkbenchSource } from "@/lib/assessment/data";

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

export async function POST(req: NextRequest) {
  const guard = await requireDashboardAccess(req);
  if (!guard.authorized) return guard.response!;
  const limited = enforceRateLimit(req, {
    namespace: "paste-analyze",
    limit: 30,
    windowMs: 60 * 60 * 1000,
    keyParts: [guard.user!.id],
  });
  if (limited) return limited;

  let body: { text?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // 1. Resolve the tender text (from a URL we can fetch, or the pasted notice).
  let tenderText = (body.text ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!tenderText && url) {
    try {
      const u = new URL(url);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error("bad protocol");
      const r = await fetch(u.toString(), {
        headers: { "user-agent": "TenderPathBot/1.0 (+https://www.tenderpath.me)" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      if (r.ok) {
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/pdf") || u.pathname.toLowerCase().endsWith(".pdf")) {
          const buf = Buffer.from(await r.arrayBuffer());
          tenderText = (await extractDocumentText({ buffer: buf, mimeType: "application/pdf", fileName: u.pathname.split("/").pop() || "tender.pdf" })).text;
        } else {
          tenderText = stripHtml(await r.text());
        }
      }
    } catch (err) {
      console.warn("[paste-analyze:fetch_failed]", { err: err instanceof Error ? err.message : String(err) });
    }
  }
  tenderText = tenderText.slice(0, 16_000);
  if (tenderText.trim().length < 40) {
    return NextResponse.json(
      { error: "We couldn't read that. Paste the notice text, or a link to the tender page." },
      { status: 422 },
    );
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
    return NextResponse.json({ error: "Analysis service is not configured." }, { status: 503 });
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
    return NextResponse.json({ error: "Couldn't analyse this tender right now. Please try again." }, { status: 502 });
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
    console.log("[paste-analyze:ok]", { userId: guard.user!.id, fit: verdict.fit, recommend: verdict.recommend });
    return NextResponse.json(verdict);
  } catch {
    console.error("[paste-analyze:parse_failed]", { userId: guard.user!.id, rawPrefix: raw.slice(0, 200) });
    return NextResponse.json({ error: "Couldn't read the analysis. Please try again." }, { status: 502 });
  }
}
