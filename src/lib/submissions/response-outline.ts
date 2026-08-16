import "server-only";

/* response-outline.ts — read the solicitation's OWN list of what the response
 * must contain, and use it as the document's table of contents.
 *
 * Why this exists: the four submission formats fix a document shape in
 * flows.ts before anyone opens the notice. A real solicitation frequently
 * dictates its own shape — "keep your response to no more than 10 pages and
 * address the following:" followed by ten bullets. Against that, a preset
 * cover-letter + capability-statement + eligibility-annex pack is simply the
 * wrong document, and no improvement to the prose inside those sections can
 * answer questions the sections do not have.
 *
 * This extractor is deliberately conservative:
 *   · it returns sections ONLY where the notice enumerates them, each carrying
 *     a verbatim excerpt as evidence — never an invented or "typical" outline;
 *   · finding nothing is a valid, expected result (many notices genuinely do
 *     not prescribe a structure), and the caller falls back to the fixed
 *     format rather than fabricating a shape.
 */

import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "@/lib/proposal-package/llm";
import {
  documentsForPrompt,
  loadRequirementDocuments,
} from "@/lib/tender-workspace/requirements-server";
import { tenderPackFingerprint } from "@/lib/tender-workspace/requirements";
import {
  EMPTY_RESPONSE_OUTLINE,
  type ResponseOutline,
  type ResponseSection,
  type TenderPackState,
} from "@/lib/tender-workspace/types";

const MODEL = "claude-sonnet-4-6";
const MAX_SECTIONS = 24;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 120_000 });
  }
  return _client;
}

function slug(value: string, index: number): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base ? `s${index + 1}-${base}` : `s${index + 1}`;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Keep only sections whose quoted evidence actually appears in the pack. A
 *  section the notice does not ask for is worse than no outline at all: it
 *  invents structure and then invents content to fill it. */
function evidenceBackedSections(
  raw: Array<Record<string, unknown>>,
  haystack: string,
): ResponseSection[] {
  const normalisedHay = haystack.toLowerCase().replace(/\s+/g, " ");
  const out: ResponseSection[] = [];
  for (const [index, item] of raw.entries()) {
    if (out.length >= MAX_SECTIONS) break;
    const title = str(item.title, 160);
    const ask = str(item.ask, 900);
    const evidence = str(item.evidence, 600);
    if (!title || !ask || !evidence) continue;
    // A short distinctive slice of the quote must be present verbatim.
    const probe = evidence.toLowerCase().replace(/\s+/g, " ").slice(0, 60);
    if (probe.length >= 24 && !normalisedHay.includes(probe)) {
      console.warn("[tp:response-outline:section_dropped_unverified]", {
        title: title.slice(0, 80),
      });
      continue;
    }
    out.push({
      id: slug(title, index),
      order: out.length + 1,
      title,
      ask,
      evidence,
      sourceDocumentName: str(item.sourceDocumentName, 200) || "Solicitation",
      required: item.required !== false,
    });
  }
  return out;
}

export interface BuildOutlineArgs {
  userId: number;
  pack: TenderPackState;
  tenderTitle?: string | null;
  agency?: string | null;
}

/**
 * Build the response outline from the owner's tender pack. Returns an outline
 * with `sections: []` when the notice prescribes no structure — that is a
 * legitimate outcome, not a failure, and the caller must treat it as "use the
 * fixed format".
 */
export async function buildResponseOutline(args: BuildOutlineArgs): Promise<ResponseOutline> {
  const fingerprint = tenderPackFingerprint(args.pack);
  const { documents } = await loadRequirementDocuments(args.userId, args.pack);
  const corpus = documentsForPrompt(documents);
  const outline = await extractOutlineFromCorpus(corpus, {
    tenderTitle: args.tenderTitle,
    agency: args.agency,
    logContext: { userId: args.userId, documents: documents.length },
  });
  return { ...outline, packFingerprint: fingerprint };
}

/** The model stage, isolated from storage so it can be exercised directly
 *  against document text. `corpus` is the concatenated solicitation text. */
export async function extractOutlineFromCorpus(
  corpus: string,
  meta: {
    tenderTitle?: string | null;
    agency?: string | null;
    logContext?: Record<string, unknown>;
  } = {},
): Promise<ResponseOutline> {
  const args = { tenderTitle: meta.tenderTitle, agency: meta.agency };
  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    return { ...EMPTY_RESPONSE_OUTLINE, generationStatus: "failed", note: "Model access is not configured." };
  }

  const prompt = `You are a UN procurement analyst. Read the solicitation below and extract THE RESPONSE OUTLINE — the list of sections the respondent's document must contain, in the order the notice gives them.

TENDER: ${str(args.tenderTitle, 300) || "(not stated)"}
AGENCY: ${str(args.agency, 200) || "(not stated)"}

SOLICITATION DOCUMENTS:
${corpus}

WHAT TO EXTRACT
Look for the passage that tells the respondent what to submit — phrases like
"address the following", "your response should include", "the proposal shall
contain", "information requested", "required documents", a numbered list of
questions, or a prescribed table of contents. Each bullet, question or numbered
item there becomes ONE section.

RULES
1. Extract ONLY what the notice actually asks for. Never add a section because
   it is "standard" (no invented cover letters, executive summaries, eligibility
   annexes or declarations unless the notice asks for them).
2. Every section MUST carry "evidence": a VERBATIM quote from the documents
   above, copied exactly, showing where that section is required. A section
   whose quote cannot be found verbatim is discarded.
3. Preserve the notice's own ordering and its own wording in the titles.
4. If the notice prescribes NO structure, return "sections": []. That is a
   correct answer — do not invent an outline to fill the gap.
5. Capture any page or length limit verbatim, and the submission instructions
   (channel, format, deadline, portal) if stated.

Return ONLY valid JSON:
{
  "documentTitle": "<what the notice calls the response, e.g. 'Response to RFI 24626' — or null>",
  "pageLimit": "<verbatim length limit, or null>",
  "submission": "<verbatim submission channel/format/deadline instructions, or null>",
  "sections": [
    {
      "title": "<section heading, in the notice's wording>",
      "ask": "<what the respondent must supply here, specific and complete>",
      "evidence": "<VERBATIM quote from the documents proving this is required>",
      "sourceDocumentName": "<the document name it came from>",
      "required": true
    }
  ]
}`;

  let text: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  } catch (err) {
    console.error("[tp:response-outline:failed]", {
      ...(meta.logContext ?? {}),
      err: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY_RESPONSE_OUTLINE, generationStatus: "failed", note: "The outline could not be read from the pack." };
  }

  const parsed = safeParseJSON<{
    documentTitle?: unknown;
    pageLimit?: unknown;
    submission?: unknown;
    sections?: Array<Record<string, unknown>>;
  }>(text, {}, "response_outline");

  const sections = evidenceBackedSections(parsed.sections ?? [], corpus);

  console.info("[tp:response-outline:built]", {
    ...(meta.logContext ?? {}),
    proposed: (parsed.sections ?? []).length,
    verified: sections.length,
  });

  return {
    generationStatus: sections.length > 0 ? "ready" : "not_started",
    packFingerprint: null,
    generatedAt: new Date().toISOString(),
    documentTitle: str(parsed.documentTitle, 200) || null,
    pageLimit: str(parsed.pageLimit, 200) || null,
    submission: str(parsed.submission, 600) || null,
    sections,
    note: sections.length > 0
      ? null
      : "This notice does not prescribe a response structure, so the standard format applies.",
  };
}
