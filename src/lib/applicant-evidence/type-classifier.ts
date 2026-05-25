/**
 * type-classifier.ts — Sprint 8d.
 *
 * The Sprint 10 keyword auto-tagger (auto-tag.ts) does most of the
 * type-inference work: pattern matches on filename + text content,
 * upgrades `vault_documents.type` from `'other'` to a specific evidence
 * type when its rules fire. Conservative-by-design, so false negatives
 * are common — documents with neutral filenames ("scan_2023_05.pdf",
 * "company_doc.pdf") frequently slip through and remain `'other'`.
 *
 * Documents stuck as `'other'` never enrich the ApplicantContext.
 * library-enrichment.ts only consumes a small set of types (cv,
 * certificate, audit, past_performance, capability_statement,
 * registration). Every `'other'` row is a missed enrichment opportunity.
 *
 * This module adds an LLM fallback that runs ONLY when the keyword
 * pass left a row as `'other'`. Haiku reads filename + a 4KB window of
 * text and returns one of:
 *   - high-confidence specific type  → caller upgrades vault_documents.type
 *   - high-confidence "other"        → caller leaves as 'other'
 *   - low-confidence (anything)      → caller leaves as 'other' (safe default)
 *
 * Same architecture as Sprint 8b's structured-extractor: cheap Haiku
 * call, strict JSON output, defensive parsing, idempotent at the call
 * site (caller checks current type before invoking).
 *
 * Cost guards:
 *   - Only fires for rows the keyword pass couldn't classify.
 *   - Skipped when text_content < 300 chars (not enough signal).
 *   - Caps input at 4KB.
 *   - Returns null on any error — caller leaves the row as 'other'.
 */

import Anthropic from "@anthropic-ai/sdk";

import { safeParseJSON } from "@/lib/proposal-package/llm";
import { EVIDENCE_TYPES, type EvidenceType } from "./types";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export const MIN_TEXT_CHARS = 300;
const TEXT_BUDGET = 4_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60_000 });
  }
  return _client;
}

export interface ClassifyInputs {
  fileName: string;
  textContent: string;
}

/**
 * The raw LLM response shape. Exported for testability — the route's
 * acceptance test passes synthetic responses through parseClassifyResponse
 * to verify the decision logic without a real API call.
 */
export interface RawClassifyResponse {
  type: string;
  confidence: string;
  rationale?: string;
}

/**
 * Build the prompt sent to Haiku. Pure — exported so the acceptance
 * test can verify the prompt always lists the same taxonomy + rules.
 */
export function buildClassifyPrompt(input: ClassifyInputs): string {
  const text = input.textContent.trim().slice(0, TEXT_BUDGET);
  return `Classify this document into one of TenderPath's evidence taxonomy types.

DOCUMENT FILENAME: ${input.fileName}

DOCUMENT TEXT (truncated to ~${TEXT_BUDGET} chars):
${text}

Valid types and what they describe:
  - cv: a candidate's CV / resume / professional bio
  - certificate: a certification or accreditation (ISO, EN, BS, similar)
  - audit: an external audit report or auditor's opinion
  - past_performance: a project reference, contract award, completion letter, case study
  - capability_statement: an organisational capability statement / company profile
  - partner_letter: a partner / consortium / letter of intent / collaboration agreement
  - tor_rfp: a tender's terms of reference / RFP / RFQ doc (the BUYER's published doc)
  - financial: financial statements, balance sheet, audited financials, turnover proof
  - registration: registration certificate (UNGM, DUNS, NCAGE, PADOR, etc.)
  - other: cannot confidently classify

Return a JSON object with these exact keys:
- "type": one of the above values
- "confidence": "high" or "low" — "high" ONLY when filename + text strongly indicate the type
- "rationale": one short sentence explaining the choice

Rules:
- Output ONLY the JSON object, no prose, no fences.
- Pick "other" with confidence "high" when the doc clearly does NOT match any specific type.
- If multiple specific types are plausible, return confidence: "low" — the caller will leave the row as 'other' in that case (the conservative default).
- Be strict — a false-positive type assignment can wrongly elevate a "claimed" capability to "evidenced" downstream.`;
}

/**
 * Decide whether to act on the raw LLM response. Pure — testable against
 * synthetic responses. Returns the type to use ONLY when the response
 * is high-confidence AND a specific type (not "other").
 */
export function parseClassifyResponse(raw: RawClassifyResponse): EvidenceType | null {
  if (raw.confidence !== "high") return null;
  if (raw.type === "other") return null;
  if (!(EVIDENCE_TYPES as readonly string[]).includes(raw.type)) return null;
  return raw.type as EvidenceType;
}

/**
 * Public entry point. Returns an EvidenceType when the LLM is confident
 * enough to recommend an upgrade, or null when caller should leave the
 * row as 'other'. Non-throwing.
 */
export async function classifyEvidenceType(input: ClassifyInputs): Promise<EvidenceType | null> {
  const text = (input.textContent ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) return null;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 250,
      temperature: 0.1,
      messages: [{ role: "user", content: buildClassifyPrompt(input) }],
    });
    const responseText = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (!responseText) return null;
    const fallback: RawClassifyResponse = { type: "other", confidence: "low" };
    const parsed = safeParseJSON<RawClassifyResponse>(responseText, fallback, "type-classifier");
    const decided = parseClassifyResponse(parsed);
    if (!decided) {
      console.log("[applicant-evidence:type_classifier:skipped]", {
        fileName: input.fileName,
        rawType: parsed.type,
        rawConfidence: parsed.confidence,
      });
    }
    return decided;
  } catch (err) {
    console.warn("[applicant-evidence:type_classifier:failed]", {
      fileName: input.fileName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
