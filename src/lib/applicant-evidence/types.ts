/**
 * Applicant evidence library — Sprint 10.
 *
 * The library is the user's persistent collection of capability proof
 * (CVs, certifications, audits, past performance, capability statements,
 * partner letters). It is keyed by user_id and is independent of any
 * single work-order. The proposal generator queries it to upgrade
 * compliance findings from "claimed" to "evidenced" when matching
 * evidence exists for a given requirement.
 *
 * Storage is split across two existing tables:
 *   - vault_documents: file metadata + type + tags (Sprint 10 adds tags[])
 *   - document_extractions: async-extracted text + status
 *
 * No new table — the schema was already adequate; what was missing was
 * tagging and a query function the proposal pipeline could call.
 */

/**
 * Canonical evidence taxonomy. The DB column is VARCHAR(64) without
 * enforced enumeration so legacy rows like "certification" continue to
 * read; new uploads should pick from this list. Keep additive.
 */
export const EVIDENCE_TYPES = [
  "cv",
  "certificate",
  "audit",
  "past_performance",
  "capability_statement",
  "partner_letter",
  "tor_rfp",
  "financial",
  "registration",
  "other",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/**
 * Result of a library query: a single evidence item plus the snippet of
 * text that matched the requirement. The snippet is what gets surfaced
 * to the LLM as the capability_match.company_evidence citation.
 */
export interface EvidenceMatch {
  vault_document_id: number;
  file_name: string;
  type: string;
  tags: string[];
  /** Highest-relevance snippet (up to ~400 chars) drawn from text_content
   *  around the matched keyword(s), with surrounding context. */
  snippet: string;
  char_count: number;
  /** Score in [0, 1]. Higher = stronger match. */
  score: number;
}

export interface EvidenceLibraryRow {
  vault_document_id: number;
  user_id: number;
  file_name: string;
  type: string;
  tags: string[];
  file_url: string;
  text_content: string | null;
  char_count: number;
  extraction_status: string | null;
  created_at: string;
}
