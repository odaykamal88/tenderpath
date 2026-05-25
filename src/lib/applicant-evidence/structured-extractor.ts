/**
 * structured-extractor.ts — Sprint 8b.
 *
 * Sprint 8 ships a coarse library → ApplicantContext bridge that derives
 * structured fields from filenames + tags. The downstream engine gets the
 * right SHAPE (correct entry count, provenance flips from `gap` →
 * `applicant_library`) but the per-entry detail is placeholder-grade:
 *
 *   keyPersonnel:    name from filename, role = "Senior staff", years = 0
 *   pastPerformance: project from filename, client = "Unknown client",
 *                    year = 0, amount missing
 *   certifications:  filename or first ISO-looking tag
 *
 * That placeholder data lifts the readiness score but the engine's deeper
 * rubric criteria (does this personnel match the required sector? does
 * this past-performance exceed the required amount? is the cert still
 * valid?) all fail because the inner fields are blank.
 *
 * This module closes that gap. For each extracted document we run a
 * Haiku call that returns the structured fields from the actual text:
 *
 *   cv               → name, role, years_experience, sectors[], country
 *   past_performance → client, project, amount_usd, year, sector, country
 *   certificate      → standard, issuer, valid_until
 *
 * The result is persisted as a single discriminated JSONB column on
 * document_extractions. library-enrichment.ts reads it when present and
 * falls back to the Sprint 8 filename heuristics when not. The calling
 * code in generate-proposal-v2 never changes.
 *
 * Cost / scope guards:
 *   - Only the three high-leverage types above (skip capability_statement,
 *     partner_letter, financial, tor_rfp — they don't map to a single
 *     ApplicantContext entry today).
 *   - Skip if text_content is shorter than 200 chars (likely not informative).
 *   - Truncate text to 6KB before the LLM call (Haiku at 500 max_tokens,
 *     temperature 0.1 — this is a structured-extract task, not a chat).
 *   - Idempotent: caller passes `force = false` to skip re-runs when a
 *     structured payload already exists for the row.
 */

import Anthropic from "@anthropic-ai/sdk";

import { safeParseJSON } from "@/lib/proposal-package/llm";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const MIN_TEXT_CHARS = 200;
const TEXT_BUDGET = 6_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60_000 });
  }
  return _client;
}

// --------------------------------------------------------------------------
// Discriminated structured-extraction shape persisted as JSONB.
//
// Sprint 8b stores ONE object per row. The discriminator is `type`; the
// `data` payload is the type-specific record. `extracted_at` + `model`
// are kept for traceability — Sprint 8c can decide when to re-extract
// (e.g. when the model gets upgraded or when a CV's text changes).
// --------------------------------------------------------------------------

export interface CvStructured {
  name: string;
  role: string;
  years_experience: number;
  sectors?: string[];
  country?: string;
}

export interface PastPerformanceStructured {
  client: string;
  project: string;
  amount_usd?: number;
  year?: number;
  sector?: string;
  country?: string;
}

export interface CertificateStructured {
  standard?: string;
  issuer?: string;
  valid_until?: string;
}

export type StructuredExtractionType = "cv" | "past_performance" | "certificate";

export interface StructuredExtraction {
  type: StructuredExtractionType;
  extracted_at: string;
  model: string;
  data: CvStructured | PastPerformanceStructured | CertificateStructured;
}

// --------------------------------------------------------------------------
// Public entry point. Returns a StructuredExtraction or null when the
// row's type isn't supported / text is too thin / extraction fails.
// Non-throwing: caller logs + skips.
// --------------------------------------------------------------------------

export interface ExtractInputs {
  type: string;
  textContent: string | null;
  fileName: string;
}

export async function extractStructuredFromDocument(
  input: ExtractInputs,
): Promise<StructuredExtraction | null> {
  const normalized = (input.type || "").toLowerCase();
  if (normalized === "cv") {
    return runCvExtraction(input);
  }
  if (normalized === "past_performance") {
    return runPastPerformanceExtraction(input);
  }
  if (normalized === "certificate" || normalized === "audit") {
    return runCertificateExtraction(input);
  }
  return null;
}

// --------------------------------------------------------------------------
// CV extraction — pulls name + senior role + years from a resume.
// --------------------------------------------------------------------------

async function runCvExtraction(input: ExtractInputs): Promise<StructuredExtraction | null> {
  const text = (input.textContent ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) return null;
  const budget = text.slice(0, TEXT_BUDGET);

  const fallback: CvStructured = {
    name: "",
    role: "",
    years_experience: 0,
    sectors: [],
  };

  const prompt = `You are extracting structured fields from a CV / resume document.

FILE: ${input.fileName}

CV TEXT (truncated to ~${TEXT_BUDGET} chars):
${budget}

Return a JSON object with these exact keys:
- "name": string — the candidate's full name as it appears in the CV.
- "role": string — their CURRENT or MOST SENIOR role title (the one they would lead with in a proposal).
- "years_experience": integer — total years of professional experience, conservative if the CV is ambiguous.
- "sectors": string[] — 1-4 short sector / domain labels (e.g. ["health systems", "supply chain"]). Empty array if the CV is generic.
- "country": string — country of primary residence or last work location, "" if unknown.

Rules:
- Output ONLY the JSON object, no prose, no fences.
- "name" must be a real human name from the CV; if you cannot find one, return "".
- "years_experience" must be a number; if you cannot estimate, return 0.
- Be conservative — do not invent fields the CV does not support.`;

  return runExtraction({
    type: "cv",
    prompt,
    fallback,
    tag: "structured-extractor:cv",
  });
}

// --------------------------------------------------------------------------
// Past-performance extraction — pulls client + project + amount + year.
// --------------------------------------------------------------------------

async function runPastPerformanceExtraction(input: ExtractInputs): Promise<StructuredExtraction | null> {
  const text = (input.textContent ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) return null;
  const budget = text.slice(0, TEXT_BUDGET);

  const fallback: PastPerformanceStructured = {
    client: "",
    project: "",
  };

  const prompt = `You are extracting structured fields from a past-performance / project reference document.

FILE: ${input.fileName}

DOCUMENT TEXT (truncated to ~${TEXT_BUDGET} chars):
${budget}

Return a JSON object with these exact keys:
- "client": string — the client / commissioning organisation (e.g. "WFP", "UNDP Kenya", "Ministry of Health Tanzania").
- "project": string — short project title (5-12 words), as it appears or as a concise summary.
- "amount_usd": number — contract value in USD if stated. Convert currency if obvious (e.g. 200,000 EUR ≈ 220000). Omit if unknown.
- "year": integer — year the project STARTED or, failing that, year of the document. Omit if unknown.
- "sector": string — short sector label (e.g. "health systems", "supply chain"). Omit if generic.
- "country": string — country of delivery if stated. Omit if unknown.

Rules:
- Output ONLY the JSON object, no prose, no fences.
- Omit OPTIONAL keys (amount_usd, year, sector, country) if the document does not state them. Do not invent.
- "client" and "project" must be the actual values from the document; if you cannot determine them, return "".`;

  return runExtraction({
    type: "past_performance",
    prompt,
    fallback,
    tag: "structured-extractor:past_performance",
  });
}

// --------------------------------------------------------------------------
// Certificate extraction — pulls standard + issuer + validity.
// --------------------------------------------------------------------------

async function runCertificateExtraction(input: ExtractInputs): Promise<StructuredExtraction | null> {
  const text = (input.textContent ?? "").trim();
  if (text.length < MIN_TEXT_CHARS) return null;
  const budget = text.slice(0, TEXT_BUDGET);

  const fallback: CertificateStructured = {};

  const prompt = `You are extracting structured fields from a certificate / audit-report document.

FILE: ${input.fileName}

DOCUMENT TEXT (truncated to ~${TEXT_BUDGET} chars):
${budget}

Return a JSON object with these exact keys (omit any field you cannot determine):
- "standard": string — the standard / certification name (e.g. "ISO 9001:2015", "ISO 13485", "EN 14065"). Use the exact code if present.
- "issuer": string — the certifying body (e.g. "BSI", "TÜV SÜD", "Lloyd's Register").
- "valid_until": string — expiry date in YYYY-MM-DD if stated; omit if not stated.

Rules:
- Output ONLY the JSON object, no prose, no fences.
- Omit keys whose values cannot be determined. Do not invent.
- Prefer the EXACT standard code over a paraphrase ("ISO 9001:2015" not "quality management cert").`;

  return runExtraction({
    type: "certificate",
    prompt,
    fallback,
    tag: "structured-extractor:certificate",
  });
}

// --------------------------------------------------------------------------
// Shared LLM runner. Centralises the Anthropic call + JSON parsing so the
// three extractors above stay focused on their prompts.
// --------------------------------------------------------------------------

interface RunInputs<T> {
  type: StructuredExtractionType;
  prompt: string;
  fallback: T;
  tag: string;
}

// Generic <T> is unconstrained so the three concrete structured shapes
// (CvStructured / PastPerformanceStructured / CertificateStructured) can
// pass through as fallbacks. The cast to StructuredExtraction["data"]
// goes through `unknown` to widen safely back to the union.
async function runExtraction<T>(
  args: RunInputs<T>,
): Promise<StructuredExtraction | null> {
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 600,
      temperature: 0.1,
      messages: [{ role: "user", content: args.prompt }],
    });
    const text = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (!text) return null;
    const parsed = safeParseJSON<T>(text, args.fallback, args.tag);
    return {
      type: args.type,
      extracted_at: new Date().toISOString(),
      model: HAIKU_MODEL,
      data: parsed as unknown as StructuredExtraction["data"],
    };
  } catch (err) {
    console.warn(`[${args.tag}:failed]`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
