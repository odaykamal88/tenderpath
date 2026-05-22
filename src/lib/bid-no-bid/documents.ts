/**
 * Document gathering for bid-no-bid grounding.
 *
 * The bid-no-bid analysis used to receive only:
 *   - the raw tender URL as a string
 *   - the pasted "tender_context" textarea
 *   - a yes/no "financial_documents_provided" flag
 *
 * Everything the user uploaded or pasted in the new intake (tender file,
 * supporting docs, supporting URLs) was dropped on the floor. This loader
 * closes that gap: it pulls every relevant document into a structured
 * list that the LLM prompt can cite by name.
 *
 * Sources:
 *   1. vault_documents tagged with the per-tender slug or the bid-no-bid-
 *      tender / bid-no-bid-supporting purpose tags (joined to
 *      document_extractions for the text body)
 *   2. document_extractions rows matched by file_url against the intake
 *      keys (tender_file_url, financial_documents_url, vault_url)
 *   3. supporting_link_urls[] + tender_url — fetched + extracted on-demand
 *      via ensureUrlExtractions, cached for 30 days in document_extractions
 *
 * Output: BidNoBidDocument[] — one row per usable document, ready for
 * formatting into the LLM prompt with the doc's filename, classification,
 * purpose, and full text excerpt.
 */
import { sql } from "@/lib/db";
import { ensureUrlExtractions } from "@/lib/documents/fetch-url";
import {
  type DocClass,
  classFromTags,
  tenderTitleTag,
} from "@/lib/documents/classify";

export type DocPurpose = "tender_main" | "supporting" | "fetched_url";

export interface BidNoBidDocument {
  fileName: string;
  fileUrl: string | null;
  purpose: DocPurpose;
  /** Best-known classification — from vault tags if uploaded, "other" for fetched URLs. */
  docClass: DocClass;
  /** Extracted text (capped at MAX_TEXT_PER_DOC). */
  text: string;
  charCount: number;
  /** Where this doc came from in the intake — for logs and UI surfacing. */
  source: "vault" | "extraction_by_url" | "fetched_url";
}

const MAX_TEXT_PER_DOC = 14_000;
const MAX_DOCS_RETURNED = 12;

type IntakeShape = Record<string, unknown> | null | undefined;

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

interface VaultDocRow {
  id: number;
  name: string;
  file_url: string;
  tags: string[] | null;
  text_content: string | null;
  char_count: number | null;
  status: string | null;
}

/**
 * Load every vault_documents row this user has tagged with one of the
 * purpose tags or the per-tender slug, joined to its latest extraction.
 */
async function loadTaggedVaultDocs(
  userId: number,
  tenderTitle: string | null,
): Promise<VaultDocRow[]> {
  const titleTag = tenderTitleTag(tenderTitle);
  // Pull anything tagged bid-no-bid-* OR matching the tender slug. The GIN
  // index makes && (overlap) cheap.
  const tagsToMatch = ["bid-no-bid-tender", "bid-no-bid-supporting"];
  if (titleTag) tagsToMatch.push(titleTag);
  try {
    const rows = (await sql`
      SELECT
        vd.id,
        vd.name,
        vd.file_url,
        vd.tags,
        de.text_content,
        de.char_count,
        de.status
      FROM vault_documents vd
      LEFT JOIN document_extractions de
        ON de.user_id = vd.user_id
       AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
      WHERE vd.user_id = ${userId}
        AND vd.tags && ${tagsToMatch}::text[]
      ORDER BY vd.created_at DESC
      LIMIT 24
    `) as unknown as VaultDocRow[];
    return rows;
  } catch (err) {
    console.warn("[bnb:docs:vault_lookup_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

interface ExtractionByUrlRow {
  file_name: string;
  file_url: string;
  status: string;
  text_content: string | null;
  char_count: number | null;
}

/**
 * Look up document_extractions for a list of file_url strings. Used to
 * pick up the legacy `vault_url` / `financial_documents_url` paths that
 * may have an extraction but no vault row (the old upload route did this
 * before PR-F connected the two).
 */
async function loadExtractionsByUrls(
  userId: number,
  urls: string[],
): Promise<ExtractionByUrlRow[]> {
  if (urls.length === 0) return [];
  try {
    const rows = (await sql`
      SELECT file_name, file_url, status, text_content, char_count
      FROM document_extractions
      WHERE user_id = ${userId}
        AND file_url = ANY(${urls}::text[])
        AND status = 'extracted'
    `) as unknown as ExtractionByUrlRow[];
    return rows;
  } catch (err) {
    console.warn("[bnb:docs:extraction_lookup_failed]", {
      userId,
      urlCount: urls.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function purposeFromTags(tags: string[] | null): DocPurpose {
  if (!tags) return "supporting";
  if (tags.includes("bid-no-bid-tender")) return "tender_main";
  return "supporting";
}

/**
 * The main entry point. Resolves every document the bid-no-bid analyzer
 * should ground its reasoning in, including server-side URL fetches.
 */
export async function loadBidNoBidDocuments(args: {
  userId: number;
  tenderTitle: string | null;
  tenderUrl: string | null;
  intake: IntakeShape;
}): Promise<BidNoBidDocument[]> {
  const { userId, tenderTitle, tenderUrl, intake } = args;
  const docs: BidNoBidDocument[] = [];
  const seenUrls = new Set<string>();

  // -- Phase 1: pasted URLs need fetching first so document_extractions
  // is populated before the lookup queries run. The helper is cache-aware
  // (returns instantly for URLs already extracted in the last 30 days).
  const pastedSupportingUrls = [
    ...asStringArray(intake?.supporting_link_urls),
    // PR-B singular fallback — older work orders won't have the array yet.
    ...(asString(intake?.supporting_link_url) ? [asString(intake?.supporting_link_url)!] : []),
  ];
  const fetchTargets: string[] = [];
  // Only fetch the tender URL if there's no uploaded tender file — the
  // uploaded file is canonical when present.
  const hasUploadedTender =
    asString(intake?.tender_file_url) !== null || asString(intake?.vault_url) !== null;
  if (tenderUrl && !hasUploadedTender) fetchTargets.push(tenderUrl);
  for (const u of pastedSupportingUrls) {
    if (!fetchTargets.includes(u)) fetchTargets.push(u);
  }

  const fetched = await ensureUrlExtractions({ userId, urls: fetchTargets });

  // -- Phase 2: tagged vault documents (uploads via PR-F-aware extract route)
  const vaultRows = await loadTaggedVaultDocs(userId, tenderTitle);
  for (const row of vaultRows) {
    if (docs.length >= MAX_DOCS_RETURNED) break;
    if (!row.text_content || row.status !== "extracted") continue;
    if (seenUrls.has(row.file_url)) continue;
    seenUrls.add(row.file_url);
    docs.push({
      fileName: row.name,
      fileUrl: row.file_url,
      purpose: purposeFromTags(row.tags),
      docClass: classFromTags(row.tags) ?? "other",
      text: row.text_content.slice(0, MAX_TEXT_PER_DOC),
      charCount: row.char_count ?? row.text_content.length,
      source: "vault",
    });
  }

  // -- Phase 3: legacy paths — document_extractions rows reachable by URL
  // from intake keys but without a tagged vault row. Covers work orders
  // created before the PR-F upload pipeline started writing vault rows.
  const legacyUrls = [
    asString(intake?.vault_url),
    asString(intake?.tender_file_url),
    asString(intake?.financial_documents_url),
  ].filter((u): u is string => u !== null && !seenUrls.has(u));
  if (legacyUrls.length > 0) {
    const legacyRows = await loadExtractionsByUrls(userId, legacyUrls);
    for (const row of legacyRows) {
      if (docs.length >= MAX_DOCS_RETURNED) break;
      if (!row.text_content) continue;
      if (seenUrls.has(row.file_url)) continue;
      seenUrls.add(row.file_url);
      // Heuristic purpose: tender_file_url is the tender main; vault_url
      // could be either (treat as tender_main, that's what proposal /
      // lta-roster intake uploads); financial_documents_url is supporting.
      const purpose: DocPurpose =
        row.file_url === asString(intake?.financial_documents_url) ? "supporting"
        : "tender_main";
      docs.push({
        fileName: row.file_name,
        fileUrl: row.file_url,
        purpose,
        docClass: "other",
        text: row.text_content.slice(0, MAX_TEXT_PER_DOC),
        charCount: row.char_count ?? row.text_content.length,
        source: "extraction_by_url",
      });
    }
  }

  // -- Phase 4: fetched URL extractions — include only successful ones.
  for (const f of fetched) {
    if (docs.length >= MAX_DOCS_RETURNED) break;
    if (f.status !== "extracted" || !f.text) continue;
    if (seenUrls.has(f.url)) continue;
    seenUrls.add(f.url);
    docs.push({
      fileName: f.url, // URL as the "filename" — readable when rendered
      fileUrl: f.url,
      purpose: f.url === tenderUrl ? "tender_main" : "fetched_url",
      docClass: "other",
      text: f.text.slice(0, MAX_TEXT_PER_DOC),
      charCount: f.charCount,
      source: "fetched_url",
    });
  }

  console.info("[bnb:docs:loaded]", {
    userId,
    tenderTitle,
    counts: {
      total: docs.length,
      vault: docs.filter((d) => d.source === "vault").length,
      legacy: docs.filter((d) => d.source === "extraction_by_url").length,
      fetched_url: docs.filter((d) => d.source === "fetched_url").length,
    },
    classes: docs.map((d) => d.docClass),
  });

  return docs;
}

/**
 * Render a structured "applicant documents" section for the Sonnet prompt.
 * Each doc gets a labeled block with filename, classification, purpose,
 * and excerpt. The LLM is asked to cite docs by filename when its findings
 * are evidenced by one.
 */
export function formatDocumentsForPrompt(docs: BidNoBidDocument[]): string {
  if (docs.length === 0) {
    return "No applicant documents were uploaded or pasted for this analysis. Ground reasoning in the company profile and tender text alone.";
  }
  const tender = docs.filter((d) => d.purpose === "tender_main" || d.purpose === "fetched_url");
  const supporting = docs.filter((d) => d.purpose === "supporting");

  const sections: string[] = [];

  if (tender.length > 0) {
    sections.push("TENDER DOCUMENTS (the call itself):");
    for (const d of tender) {
      sections.push(
        [
          `[doc] file: ${d.fileName}`,
          `[doc] class: ${d.docClass}${d.purpose === "fetched_url" ? " (server-side-fetched from URL)" : ""}`,
          `[doc] excerpt:`,
          d.text,
        ].join("\n"),
      );
    }
  }

  if (supporting.length > 0) {
    sections.push("APPLICANT EVIDENCE (capability / financial / compliance / personnel):");
    for (const d of supporting) {
      sections.push(
        [
          `[doc] file: ${d.fileName}`,
          `[doc] class: ${d.docClass}`,
          `[doc] excerpt:`,
          d.text,
        ].join("\n"),
      );
    }
  }

  return sections.join("\n\n");
}

/**
 * Compact summary for telemetry + persisting onto the bid-no-bid output
 * row so the work-order UI can render a "documents we read" panel.
 */
export interface DocumentSummary {
  file_name: string;
  doc_class: DocClass;
  purpose: DocPurpose;
  char_count: number;
  source: BidNoBidDocument["source"];
}

export function summarizeDocs(docs: BidNoBidDocument[]): DocumentSummary[] {
  return docs.map((d) => ({
    file_name: d.fileName,
    doc_class: d.docClass,
    purpose: d.purpose,
    char_count: d.charCount,
    source: d.source,
  }));
}

/**
 * Build an "applicant evidence" block for the company-profile section of
 * the LLM prompt. PR-G addition.
 *
 * Why this exists separately from `formatDocumentsForPrompt`:
 *   - `formatDocumentsForPrompt` emits the docs section, which Sonnet
 *     treats as "tender + uploaded source documents" — heavyweight context.
 *   - This helper emits a quick-skim summary that lives inside the
 *     COMPANY PROFILE block so when Sonnet thinks "what is this vendor
 *     capable of?" the answer is anchored in their uploaded CV / capability
 *     statement / compliance certs, not just the (possibly stale) website
 *     crawl that powered the assessment row.
 *
 * Behavior:
 *   - Skips class:tor / class:eligibility_criteria / class:evaluation_criteria
 *     (those describe the tender, not the applicant).
 *   - Includes class:capability_statement / cv / compliance / financial /
 *     reference_letter / other with a 1.2 KB excerpt — long enough to
 *     pull a specific claim, short enough to leave token budget for the
 *     main analysis.
 *   - When no applicant evidence is uploaded, returns "" so the caller
 *     can decide whether to render the section at all.
 */
export function formatDocumentsAsApplicantEvidence(docs: BidNoBidDocument[]): string {
  const APPLICANT_CLASSES = new Set<DocClass>([
    "capability_statement",
    "cv",
    "compliance",
    "financial",
    "reference_letter",
    "other",
  ]);
  const applicantDocs = docs.filter(
    (d) => d.purpose !== "tender_main" && APPLICANT_CLASSES.has(d.docClass),
  );
  if (applicantDocs.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    "APPLICANT-PROVIDED EVIDENCE (higher trust than the website-derived assessment when the two disagree — these are documents the user uploaded for THIS analysis):",
  );
  for (const d of applicantDocs) {
    lines.push(
      `· [${d.docClass}] ${d.fileName} — ${d.text.slice(0, 1200).replace(/\s+/g, " ").trim()}`,
    );
  }
  return lines.join("\n");
}
