/**
 * Applicant evidence library queries — Sprint 10.
 *
 * Two surfaces:
 *   - loadEvidenceLibrary(userId): everything the user has on file, used
 *     for the dashboard panel and as inline context the proposal-draft
 *     extractor sees when scoring capability_match.
 *   - findEvidenceFor(userId, requirement): targeted lookup for a single
 *     requirement string, returning best-matching items with snippets.
 *
 * Matching is keyword-based v1. We normalise requirement text into a
 * keyword bag, match against (tags ∪ type ∪ filename) and against
 * substrings of text_content. Tag hits weight higher than text hits
 * because tags are curated; text hits weight higher than filename hits
 * because filenames are noisy.
 */
import { sql } from "@/lib/db";
import type { EvidenceLibraryRow, EvidenceMatch } from "./types";

const STOPWORDS = new Set([
  "a","an","and","applicant","applicants","are","as","at","be","before","being","by","each","for","from","have","in","is","it","its","lead","may","must","not","of","on","or","other","required","requirement","requirements","shall","should","sources","stable","sufficient","the","this","to","with",
]);

function normalizeKeywords(text: string): string[] {
  const lc = text.toLowerCase();
  const tokens = lc.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (t.length < 3) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function snippetAround(text: string, keyword: string, span = 280): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) {
    return text.slice(0, span).replace(/\s+/g, " ").trim();
  }
  const half = Math.floor(span / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, idx + keyword.length + half);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return (prefix + text.slice(start, end) + suffix).replace(/\s+/g, " ").trim();
}

/**
 * Pull every evidence row for the user (extracted + non-extracted).
 * Limit + size-cap for safety: the proposal pipeline uses this in a
 * prompt, so we cap text_content reads at ~6KB per doc and at 30 docs.
 */
export async function loadEvidenceLibrary(
  userId: number,
  limit = 30,
): Promise<EvidenceLibraryRow[]> {
  const rows = await sql`
    SELECT
      vd.id AS vault_document_id,
      vd.user_id,
      vd.name AS file_name,
      vd.type,
      vd.tags,
      vd.file_url,
      vd.created_at,
      de.text_content,
      de.char_count,
      de.status AS extraction_status
    FROM vault_documents vd
    LEFT JOIN document_extractions de
      ON de.user_id = vd.user_id
     AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
    WHERE vd.user_id = ${userId}
    ORDER BY vd.created_at DESC
    LIMIT ${limit}
  ` as unknown as Array<{
    vault_document_id: number;
    user_id: number;
    file_name: string;
    type: string;
    tags: string[] | null;
    file_url: string;
    created_at: string;
    text_content: string | null;
    char_count: number | null;
    extraction_status: string | null;
  }>;
  return rows.map((r) => ({
    vault_document_id: r.vault_document_id,
    user_id: r.user_id,
    file_name: r.file_name,
    type: r.type,
    tags: Array.isArray(r.tags) ? r.tags : [],
    file_url: r.file_url,
    text_content: r.text_content ? r.text_content.slice(0, 6000) : null,
    char_count: r.char_count ?? 0,
    extraction_status: r.extraction_status,
    created_at: r.created_at,
  }));
}

/**
 * Targeted match for a single requirement. Caller passes the requirement
 * verbatim (or close); we normalise into keywords and scan against the
 * loaded library. Returns top-N items by score with a context snippet.
 */
export function findEvidenceFor(
  library: EvidenceLibraryRow[],
  requirement: string,
  topN = 3,
): EvidenceMatch[] {
  const keywords = normalizeKeywords(requirement);
  if (keywords.length === 0) return [];

  const scored: EvidenceMatch[] = [];
  for (const row of library) {
    let score = 0;
    let bestKeywordForSnippet: string | null = null;

    // Tag hits (weight 0.4 each, capped at 1.0 to avoid one doc dominating)
    const tagSet = new Set((row.tags ?? []).map((t) => t.toLowerCase()));
    let tagHits = 0;
    for (const kw of keywords) {
      if (tagSet.has(kw)) tagHits += 1;
    }
    score += Math.min(1.0, tagHits * 0.4);

    // Type hit (weight 0.2)
    if (keywords.includes(row.type.toLowerCase())) score += 0.2;

    // Filename hit (weight 0.1 each, capped at 0.3)
    const lcName = (row.file_name ?? "").toLowerCase();
    let nameHits = 0;
    for (const kw of keywords) {
      if (lcName.includes(kw)) nameHits += 1;
    }
    score += Math.min(0.3, nameHits * 0.1);

    // Text hit (weight 0.2 per distinct keyword, capped at 0.6)
    const lcText = (row.text_content ?? "").toLowerCase();
    let textHits = 0;
    for (const kw of keywords) {
      if (lcText.includes(kw)) {
        textHits += 1;
        if (!bestKeywordForSnippet) bestKeywordForSnippet = kw;
      }
    }
    score += Math.min(0.6, textHits * 0.2);

    if (score <= 0) continue;
    const text = row.text_content ?? "";
    const snippet = bestKeywordForSnippet && text
      ? snippetAround(text, bestKeywordForSnippet)
      : text.slice(0, 280).replace(/\s+/g, " ").trim() || `${row.type}: ${row.file_name}`;

    scored.push({
      vault_document_id: row.vault_document_id,
      file_name: row.file_name,
      type: row.type,
      tags: row.tags ?? [],
      snippet,
      char_count: row.char_count,
      score: Number(Math.min(1, score).toFixed(2)),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Render the library as a compact LLM-readable summary for inclusion in
 * the extractTenderRequirements prompt. Caps total size at ~3KB so it
 * does not blow the context budget when paired with a long tender.
 */
export function formatEvidenceLibraryForPrompt(library: EvidenceLibraryRow[]): string {
  if (library.length === 0) return "";
  const extracted = library.filter((r) => r.extraction_status === "extracted" && r.text_content);
  const others = library.filter((r) => !extracted.includes(r));

  const lines: string[] = [];
  lines.push(`APPLICANT EVIDENCE LIBRARY (${library.length} items):`);
  for (const row of [...extracted, ...others].slice(0, 20)) {
    const tagPart = row.tags.length ? ` [${row.tags.slice(0, 6).join(", ")}]` : "";
    const status = row.extraction_status === "extracted" ? "" : ` (${row.extraction_status ?? "not extracted"})`;
    lines.push(`- ${row.type}${tagPart}: ${row.file_name}${status}`);
  }
  // Total budget: ~3000 chars. Trim trailing lines if needed.
  let out = lines.join("\n");
  if (out.length > 3000) out = out.slice(0, 3000) + "\n…";
  return out;
}
