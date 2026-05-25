/**
 * profile-miner.ts — extract structured profile facts from free-text intake.
 *
 * Sprint 8/8b/8c moved evidence FILES into the ApplicantContext. Files are
 * the strongest signal, but a lot of high-value applicant data lives in
 * NARRATIVE that the user types into the intake forms during Bid/No-Bid,
 * Proposal Draft, or Roster Fast-Track flows — things like:
 *
 *   "We have 11 years of biomedical engineering experience in East Africa,
 *    primarily delivering oxygen plants for WFP, UNDP, and UNICEF country
 *    offices. Our team holds ISO 13485 and we operate from Nairobi."
 *
 * Today that text sits in `work_orders.intake` keyed to one work-order.
 * Next tender → user retypes the same context, or the engine misses it.
 * Sprint 8e closes the loop:
 *
 *   1. After an intake PATCH, scan intake's free-text fields.
 *   2. Run a Haiku call that returns structured facts:
 *        - years_of_experience (number)
 *        - sectors_covered     (string[])
 *        - agencies_worked_with (string[])
 *        - geographic_reach    (string[])
 *        - key_capabilities    (string[])
 *   3. Merge into users.mined_profile_facts (JSONB), preserving existing
 *      values where the new pass is missing fields.
 *   4. buildApplicantContextFromAssessment reads mined_profile_facts and
 *      fills empty ApplicantContext fields — existing wizard-collected
 *      data still wins, mining only fills gaps.
 *
 * Mined facts are CLAIMS not EVIDENCE. The engine's labelling distinguishes
 * `evidence` (from documents) from `inferred` (from user-typed claims).
 * Mining adds to the inferred pool, not the evidence pool — so a claim
 * the user makes in intake doesn't get fraudulently elevated to an
 * "evidenced" requirement match downstream.
 *
 * Cost guards:
 *   - Only fires when intake has at least one free-text field of >= 50 chars.
 *   - Skips URLs, IDs, filenames, timestamps, structured sub-objects.
 *   - Caps total text at 6KB before the LLM call.
 *   - Haiku, max_tokens=500, temperature=0.1.
 *   - Non-throwing — caller logs and continues.
 */

import Anthropic from "@anthropic-ai/sdk";

import { safeParseJSON } from "@/lib/proposal-package/llm";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export const MIN_TEXT_CHARS = 50;
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

/**
 * Persistent shape of users.mined_profile_facts (JSONB). All fields
 * optional — each mining pass may produce a subset, and the merge
 * function preserves prior values for fields the new pass omits.
 */
export interface MinedProfileFacts {
  years_of_experience?: number;
  sectors_covered?: string[];
  agencies_worked_with?: string[];
  geographic_reach?: string[];
  key_capabilities?: string[];
}

/** Empty default — used for fallback parsing and merge identity. */
const EMPTY_FACTS: MinedProfileFacts = {};

// --------------------------------------------------------------------------
// Intake → text extraction (pure)
// --------------------------------------------------------------------------

// Field names whose value is structural metadata, not narrative — never
// included in the mining text blob even if their value is a long string.
const SKIP_KEYS = new Set([
  "vault_url",
  "vault_filename",
  "vault_doc_id",
  "financial_documents_url",
  "financial_documents_filename",
  "tender_file_url",
  "tender_file_name",
  "service_context",
  "service_documents",
  "amendments_url",
  "qa_url",
]);

// Suffixes / patterns that always indicate non-narrative fields. Quick
// belt-and-braces filter alongside SKIP_KEYS.
const SKIP_KEY_PATTERN = /(_url|_filename|_id|_count|_at|_ms|_status|_size)$/i;

/**
 * Extract free-text fields from an intake JSONB. Returns a concatenated
 * blob the miner can feed to Haiku. Skips URLs / filenames / IDs / short
 * strings. Pure — exported for the acceptance test.
 */
export function extractIntakeNarrativeText(
  intake: Record<string, unknown> | null | undefined,
): string {
  if (!intake) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(intake)) {
    if (SKIP_KEYS.has(key)) continue;
    if (SKIP_KEY_PATTERN.test(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length < MIN_TEXT_CHARS) continue;
    parts.push(`${key}:\n${trimmed}`);
  }
  return parts.join("\n\n").slice(0, TEXT_BUDGET);
}

// --------------------------------------------------------------------------
// Mining (LLM)
// --------------------------------------------------------------------------

/**
 * Build the Haiku prompt. Pure — separated from the LLM call so the
 * acceptance test can verify the prompt always asks for the same fields.
 */
export function buildMinerPrompt(text: string): string {
  return `Extract structured applicant profile facts from this free-text narrative the vendor typed into a procurement intake form.

NARRATIVE TEXT:
${text}

Return a JSON object with these exact keys (omit any you cannot confidently extract — do NOT invent):
- "years_of_experience": integer — years of relevant operating experience the vendor mentions
- "sectors_covered": string[] — 1-6 short sector / domain labels (e.g. "biomedical engineering", "water infrastructure", "logistics")
- "agencies_worked_with": string[] — UN agencies, donors, or major clients the vendor names (e.g. "WFP", "UNDP", "UNICEF", "EuropeAid")
- "geographic_reach": string[] — countries / regions of operation the vendor names (e.g. "Kenya", "East Africa", "Sahel")
- "key_capabilities": string[] — 1-8 specific capability labels (e.g. "oxygen plant maintenance", "HDPE pipe supply", "M&E systems")

Rules:
- Output ONLY the JSON object, no prose, no fences.
- Each field is OPTIONAL. Omit a key entirely when the narrative doesn't support it. Empty arrays are fine if you've considered the field but have nothing to add.
- Be conservative — these facts will be merged into the vendor's persistent profile. False positives (inventing claims) are worse than false negatives.
- Use the exact wording the vendor uses where reasonable; lowercase short labels.
- "years_of_experience" should be an integer, not a range or description.`;
}

/**
 * Validate and sanitise the raw LLM output. Pure — testable. Strips
 * non-string array members, drops empty strings, capping at field limits.
 */
export function sanitizeMinedFacts(raw: unknown): MinedProfileFacts {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: MinedProfileFacts = {};

  if (typeof r.years_of_experience === "number" && Number.isFinite(r.years_of_experience) && r.years_of_experience >= 0) {
    out.years_of_experience = Math.floor(r.years_of_experience);
  }

  const cleanStrArray = (key: string, cap: number): string[] | undefined => {
    if (!Array.isArray(r[key])) return undefined;
    const cleaned = (r[key] as unknown[])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && x.length < 80);
    if (cleaned.length === 0) return undefined;
    return Array.from(new Set(cleaned)).slice(0, cap);
  };

  const sectors = cleanStrArray("sectors_covered", 6);
  if (sectors) out.sectors_covered = sectors;
  const agencies = cleanStrArray("agencies_worked_with", 10);
  if (agencies) out.agencies_worked_with = agencies;
  const geo = cleanStrArray("geographic_reach", 10);
  if (geo) out.geographic_reach = geo;
  const caps = cleanStrArray("key_capabilities", 8);
  if (caps) out.key_capabilities = caps;

  return out;
}

/**
 * Public entry point. Returns mined facts (possibly empty) or null when
 * the input is too short to be worth mining or the call fails.
 */
export async function mineProfileFactsFromIntake(
  intake: Record<string, unknown> | null | undefined,
): Promise<MinedProfileFacts | null> {
  const text = extractIntakeNarrativeText(intake);
  if (text.length < MIN_TEXT_CHARS) return null;

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [{ role: "user", content: buildMinerPrompt(text) }],
    });
    const responseText = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    if (!responseText) return null;
    const parsed = safeParseJSON<unknown>(responseText, EMPTY_FACTS, "profile-miner");
    return sanitizeMinedFacts(parsed);
  } catch (err) {
    console.warn("[applicant-evidence:profile_miner:failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// --------------------------------------------------------------------------
// Merge policy (pure)
// --------------------------------------------------------------------------

/**
 * Merge a new mining pass into the user's persistent facts. Policy:
 *
 *   - New value WINS for years_of_experience IF it's higher than the
 *     existing value. (User's experience grows over time; we keep the
 *     larger of the two.)
 *   - Array fields are unioned + deduped, preserving prior entries.
 *
 * Pure — exported for the acceptance test.
 */
export function mergeMinedFacts(
  prior: MinedProfileFacts,
  fresh: MinedProfileFacts,
): MinedProfileFacts {
  const out: MinedProfileFacts = { ...prior };

  if (fresh.years_of_experience != null) {
    const p = prior.years_of_experience ?? 0;
    if (fresh.years_of_experience > p) out.years_of_experience = fresh.years_of_experience;
  }

  const unionArray = (key: keyof MinedProfileFacts): void => {
    const priorArr = (prior[key] as string[] | undefined) ?? [];
    const freshArr = (fresh[key] as string[] | undefined) ?? [];
    if (freshArr.length === 0) return;
    const merged = Array.from(new Set([...priorArr, ...freshArr]));
    (out as Record<string, unknown>)[key] = merged;
  };

  unionArray("sectors_covered");
  unionArray("agencies_worked_with");
  unionArray("geographic_reach");
  unionArray("key_capabilities");

  return out;
}
