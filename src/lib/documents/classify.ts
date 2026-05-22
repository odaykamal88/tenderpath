/**
 * Haiku-backed document classifier.
 *
 * Reads the first ~3 KB of extracted text plus the filename and returns
 * one of nine classes. Used by:
 *   - /api/dashboard/vault/extract — tags the vault row immediately after
 *     extraction so the bid-no-bid analysis prompt can label per-doc.
 *   - bid-no-bid run-time enrichment — when the user pastes a supporting
 *     URL we fetch + classify on demand.
 *
 * Cheap by design: ~3 KB input, 30 output tokens, Haiku. Roughly
 * $0.0002 per doc. The function is idempotent — re-classifying an
 * already-tagged doc is fine, the tagger merges instead of replacing.
 *
 * Failure mode: returns "other" with a console.warn carrying a stable
 * [doc:classify:*] tag. Never throws — the upload + extract pipeline
 * has to keep working even if Anthropic is down.
 */
import Anthropic from "@anthropic-ai/sdk";

export const DOC_CLASSES = [
  "tor", // Terms of Reference, RFP, RFQ, ITB, EOI — the tender call itself
  "eligibility_criteria", // standalone eligibility / qualification document
  "evaluation_criteria", // standalone scoring / evaluation rubric
  "capability_statement", // company brochure, capability deck, qualifications
  "cv", // resume, biographical sketch, key-personnel CV
  "compliance", // certifications, ISO, registration certificates, attestations
  "financial", // audited statements, bank reference, financial returns
  "reference_letter", // client letter, recommendation, past-performance ref
  "other",
] as const;

export type DocClass = (typeof DOC_CLASSES)[number];

const CLASS_GUIDANCE: Record<DocClass, string> = {
  tor: "Terms of Reference, RFP, RFQ, ITB, or EOI — the agency's call describing what they want.",
  eligibility_criteria: "Standalone document listing who is eligible (legal status, experience, country, sector).",
  evaluation_criteria: "Standalone document describing how submissions will be scored (weights, scoring bands).",
  capability_statement: "Company brochure, qualifications statement, or capability deck describing the applicant.",
  cv: "Resume, biographical sketch, or key-personnel profile.",
  compliance: "Certifications, ISO/PCI/QA documents, business registrations, tax clearances, attestations.",
  financial: "Audited statements, balance sheets, bank references, financial returns.",
  reference_letter: "Client letter, performance reference, recommendation, or past-performance attestation.",
  other: "Doesn't fit any of the above — invoice, screenshot, miscellaneous note.",
};

const MODEL = "claude-haiku-4-5-20251001";
const INPUT_CAP = 3_000; // chars of body text included in the prompt
const MAX_OUTPUT_TOKENS = 60;

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  _client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 20_000 });
  return _client;
}

export interface ClassifyArgs {
  fileName: string;
  textExcerpt: string | null;
}

/**
 * Returns one of DOC_CLASSES. Never throws. Defaults to "other" on any
 * failure (missing API key, model error, malformed reply, empty text).
 */
export async function classifyDocument(args: ClassifyArgs): Promise<DocClass> {
  const text = (args.textExcerpt ?? "").trim();
  // No body text → fall back to filename heuristics. The body-tagger
  // already does a thorough filename pass for things like "iso27001.pdf",
  // so here we just punt to "other" and let the merge-tagger refine.
  if (text.length < 80) {
    console.info("[doc:classify:skipped_thin_text]", {
      fileName: args.fileName,
      textLength: text.length,
    });
    return "other";
  }

  const client = getClient();
  if (!client) {
    console.warn("[doc:classify:no_api_key]");
    return "other";
  }

  const truncated = text.slice(0, INPUT_CAP);
  const guidanceLines = (Object.entries(CLASS_GUIDANCE) as [DocClass, string][])
    .map(([cls, hint]) => `- ${cls}: ${hint}`)
    .join("\n");

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: `Classify the following document into EXACTLY ONE of these classes:

${guidanceLines}

Filename: ${args.fileName}

Document body (truncated to ${INPUT_CAP} chars):
"""
${truncated}
"""

Respond with ONLY the class label — one word, lowercase, no punctuation, no explanation. If unsure, respond "other".`,
        },
      ],
    });

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .toLowerCase();

    // Tolerate model padding like "class: tor" or "tor."
    const normalized = raw.replace(/[^a-z_]/g, "");
    const match = DOC_CLASSES.find((c) => normalized === c || normalized.endsWith(c));
    if (match) {
      console.info("[doc:classify:ok]", {
        fileName: args.fileName,
        textLength: text.length,
        class: match,
      });
      return match;
    }

    console.warn("[doc:classify:unrecognized_reply]", {
      fileName: args.fileName,
      replyPrefix: raw.slice(0, 60),
    });
    return "other";
  } catch (err) {
    console.warn("[doc:classify:llm_failed]", {
      fileName: args.fileName,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return "other";
  }
}

/** Convert a DocClass to a vault tag (`class:tor`, `class:cv`, ...). */
export function classToTag(cls: DocClass): string {
  return `class:${cls}`;
}

/**
 * Extract the DocClass back out of a vault tag set. Returns null if no
 * `class:*` tag is present.
 */
export function classFromTags(tags: string[] | null | undefined): DocClass | null {
  if (!tags) return null;
  for (const tag of tags) {
    if (!tag.startsWith("class:")) continue;
    const cls = tag.slice("class:".length) as DocClass;
    if (DOC_CLASSES.includes(cls)) return cls;
  }
  return null;
}

/**
 * Tag-friendly form of a tender title. Lowercase, words separated by
 * dashes, alphanumerics + dashes only, capped at 80 chars. Empty string
 * if the input is empty — the caller should skip the tag in that case.
 */
export function tenderTitleTag(title: string | null | undefined): string {
  if (!title) return "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug ? `tender:${slug}` : "";
}
