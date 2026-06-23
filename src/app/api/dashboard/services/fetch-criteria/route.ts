import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/access";
import { extractDocumentText } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 45;

// Single friendly message for the three "we couldn't get useful criteria out
// of this URL" branches (upstream non-2xx, thin content, empty LLM
// completion). The previous copy exposed technical detail (HTTP status,
// "JS-rendered or behind a login") that didn't help the average vendor —
// they just want to know what to do next. The user explicitly asked
// (2026-05-21) to replace those with this softer line.
const FRIENDLY_NO_CRITERIA =
  "It seems this tender hasn't listed any criteria or ToRs, perhaps check the supplier portal. This will contribute to a more accurate diagnostic";

// Pull eligibility + evaluation criteria out of a tender URL on demand.
//
// Flow:
//   1. Browser sends the tender URL the user pasted.
//   2. We fetch the URL server-side (a quick HTTPS GET, no headless browser
//      yet — JS-rendered portals will return thin shells and we explicitly
//      tell the user to paste the criteria manually).
//   3. PDFs go through the existing extractDocumentText. HTML pages get
//      stripped to text inline.
//   4. Claude Haiku reads the cleaned text and returns the two criteria
//      sections in plain prose. We never invent criteria — the prompt
//      makes that explicit and the model is instructed to say so when
//      criteria are absent.
//
// Caps in place:
//   - 15 s URL fetch timeout (signal: AbortSignal.timeout)
//   - 20 KB cleaned-text payload sent to the LLM (cheap + sufficient)
//   - 2 000 max output tokens (criteria are short)
//
// Errors are reported with stable [criteria:fetch:*] tags + a stage in the
// body so the client can render something specific.
export async function POST(req: NextRequest) {
  // Outer try/catch so anything thrown above the inner try (the auth guard,
  // module-level side effects, etc.) still surfaces as JSON instead of an
  // opaque Vercel 500 — that was the symptom of the "Could not fetch
  // criteria (500)." error the user saw with no diagnostic text body.
  try {
    const guard = await requireAuth(req);
    if (!guard.authorized) return guard.response!;

    let rawUrl: string;
    try {
      const body = await req.json();
      rawUrl = String(body.url ?? "").trim();
      if (!rawUrl) throw new Error("missing url");
    } catch {
      console.warn("[criteria:fetch:bad_request]", { userId: guard.user!.id });
      return NextResponse.json({ error: "url required" }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("bad protocol");
    } catch {
      console.warn("[criteria:fetch:invalid_url]", {
        userId: guard.user!.id,
        urlPrefix: rawUrl.slice(0, 60),
      });
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    let stage = "fetch";
    try {
      stage = "fetch";
      const fetchRes = await fetch(parsed.toString(), {
      headers: {
        "user-agent": "TenderPathBot/1.0 (+https://www.tenderpath.me)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "follow",
    });
    if (!fetchRes.ok) {
      console.warn("[criteria:fetch:non_2xx]", {
        userId: guard.user!.id,
        host: parsed.host,
        status: fetchRes.status,
      });
      return NextResponse.json(
        { error: FRIENDLY_NO_CRITERIA },
        { status: 502 },
      );
    }

    const contentType = (fetchRes.headers.get("content-type") || "").toLowerCase();

    stage = "extract";
    let pageText: string;
    let discoveredAttachments: Array<{ href: string; label: string; ext: string }> = [];
    if (contentType.includes("application/pdf") || parsed.pathname.toLowerCase().endsWith(".pdf")) {
      const buffer = Buffer.from(await fetchRes.arrayBuffer());
      const extraction = await extractDocumentText({
        buffer,
        mimeType: "application/pdf",
        fileName: parsed.pathname.split("/").pop() || "tender.pdf",
      });
      pageText = extraction.text;
    } else {
      const html = await fetchRes.text();
      // PR-I (2026-05-23): scan the HTML for downloadable tender attachments
      // BEFORE stripping markup. The user reported (and the ecobitar.com test
      // confirmed) that tender portal pages often serve a thin overview HTML
      // with the actual TOR / RFP as <a href="/files/tender.pdf"> links at
      // the bottom — fetch-criteria was extracting the overview text and
      // missing the real document. We surface those links to the client so
      // the intake form can offer to attach them.
      discoveredAttachments = discoverAttachments(html, parsed);
      pageText = stripHtml(html);
    }

    pageText = pageText.slice(0, 20_000);
    if (pageText.trim().length < 200) {
      console.warn("[criteria:fetch:thin_content]", {
        userId: guard.user!.id,
        host: parsed.host,
        length: pageText.length,
        attachments_found: discoveredAttachments.length,
      });
      // Even if the page text was thin, if we found PDF/DOC attachments the
      // user can still pull useful context — return them with a friendlier
      // message rather than the generic NO_CRITERIA bail.
      if (discoveredAttachments.length > 0) {
        return NextResponse.json(
          {
            criteria: "",
            attachments: discoveredAttachments,
            note: "This page didn't list criteria directly, but we found documents linked from it. Attach the relevant ones and re-run the fetch.",
            source: { host: parsed.host, contentType },
          },
          { status: 200 },
        );
      }
      return NextResponse.json(
        { error: FRIENDLY_NO_CRITERIA },
        { status: 422 },
      );
    }

    stage = "llm";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.warn("[criteria:fetch:no_api_key]");
      return NextResponse.json(
        { error: "Criteria extraction service is not configured." },
        { status: 503 },
      );
    }

    const client = new Anthropic({ apiKey });
    const completion = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are reading the body of a procurement / tender document. Extract two sections from the text, exactly as written when present:

ELIGIBILITY CRITERIA
- bullet list of the eligibility / qualification requirements bidders must meet (legal status, experience, certifications, country, sector, financial thresholds, etc.)

EVALUATION CRITERIA
- bullet list of how proposals will be scored (criteria + weights or pass/fail, technical vs financial split, scoring bands)

Rules:
- Quote or closely paraphrase only what the document says. Do not invent criteria that aren't there.
- If a section is absent, write the section header and one line: "Not stated in this document."
- Skip preamble, agency boilerplate, contact information.
- Keep the output under 1500 words.

Tender document text:
"""
${pageText}
"""`,
        },
      ],
    });

    const criteria = completion.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!criteria) {
      console.warn("[criteria:fetch:empty_completion]", { userId: guard.user!.id });
      return NextResponse.json(
        { error: FRIENDLY_NO_CRITERIA },
        { status: 422 },
      );
    }

    return NextResponse.json({
      criteria,
      // Always include attachments if any were discovered — the user may
      // want to attach them even when the LLM-extracted criteria text was
      // good, because the actual TOR has more detail than the portal HTML.
      attachments: discoveredAttachments.length ? discoveredAttachments : undefined,
      source: { host: parsed.host, contentType },
    });
    } catch (err) {
      console.error("[criteria:fetch:failed]", {
        userId: guard.user?.id,
        stage,
        host: parsed.host,
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        {
          error: `Could not fetch criteria at ${stage}. ${err instanceof Error ? err.message : "Unknown error"}`,
          stage,
        },
        { status: 500 },
      );
    }
  } catch (err) {
    // Anything that escapes the inner pipeline — auth guard failure, DB
    // hiccup, missing env, unhandled SDK error — lands here and still
    // produces a JSON body so the client can render a useful message
    // instead of "Could not fetch criteria (500)." with no signal.
    console.error("[criteria:fetch:handler_error]", {
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: `Server error processing fetch request: ${err instanceof Error ? err.message : "unknown"}`,
        stage: "handler",
      },
      { status: 500 },
    );
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// PR-I (2026-05-23): scan tender-portal HTML for downloadable attachments.
// We look for anchor tags whose href ends in a known tender doc extension
// (PDF / DOC / DOCX / XLS / XLSX), resolve them against the page URL, and
// return them with a human-friendly label derived from the anchor's visible
// text. Caps at 12 attachments so a runaway result set can't blow up the
// response body.
const TENDER_DOC_EXTS = ["pdf", "doc", "docx", "xls", "xlsx", "rtf"] as const;

function discoverAttachments(
  html: string,
  pageUrl: URL,
): Array<{ href: string; label: string; ext: string }> {
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: Array<{ href: string; label: string; ext: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const rawHref = match[1].trim();
    const rawLabel = match[2];
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, pageUrl);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(resolved.protocol)) continue;
    const pathLower = resolved.pathname.toLowerCase();
    const ext = TENDER_DOC_EXTS.find((e) => pathLower.endsWith(`.${e}`));
    if (!ext) continue;
    const dedupKey = resolved.toString();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    // Label: prefer the anchor's visible text, fall back to the filename.
    const labelText = rawLabel
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const fileName = resolved.pathname.split("/").pop() ?? "";
    const label = labelText && labelText.length >= 3 && labelText.length <= 180
      ? labelText
      : (fileName || `${ext.toUpperCase()} attachment`);
    out.push({ href: resolved.toString(), label, ext });
    if (out.length >= 12) break;
  }
  return out;
}

