/**
 * won-promotion.ts — Sprint 12.
 *
 * When a user marks a pipeline_item as stage='won', auto-promote the tender
 * into their evidence library as a past_performance row. Future proposal-draft
 * engine runs can then surface this win as EVIDENCE (not inferred) when
 * scoring capability_match against new tenders.
 *
 * Why this matters (AGENTS.md):
 *
 *   "Treat applicant evidence as a persistent asset. Every review run
 *    should leave the applicant's evidence library richer than it found it."
 *
 * Sprint 8/8b carried CV / certificate / past_performance evidence FORWARD
 * from one work-order to the next. Sprint 8e mined narrative claims. Sprint
 * 12 closes the outcome side of the loop: when the user actually wins a bid,
 * the win becomes a permanent past_performance entry — no manual data entry,
 * no duplicate evidence upload, no information loss between Won-on-the-
 * dashboard and Cite-it-on-the-next-tender.
 *
 * Storage strategy
 * =================
 *
 * Reuses the existing evidence-library tables (vault_documents +
 * document_extractions) rather than introducing a separate "won_tenders"
 * table. The library query in src/lib/applicant-evidence/query.ts is the
 * single source of truth for "what evidence does this user have on file"
 * and it already handles the structured_extraction JSONB column. A new
 * table would force every existing call site (loadEvidenceLibrary,
 * enrichApplicantContextFromLibrary, findEvidenceFor) to learn a second
 * source. Slot the synthetic row in instead.
 *
 * The synthetic row's file_url is a stable stub of the form:
 *
 *   tenderpath://won/pipeline-item/<id>
 *
 * This satisfies the NOT NULL + UNIQUE (user_id, file_url) constraints on
 * vault_documents / document_extractions without requiring an actual blob
 * upload. The "tenderpath://" scheme makes it obvious in any debugging
 * surface that the row is auto-promoted rather than user-uploaded — and
 * the unique constraint makes the promotion idempotent: re-marking a row
 * 'won' (or re-running the promotion after a refactor) ON CONFLICT DO NOTHING.
 */

import { sql } from "@/lib/db";
import type { PastPerformanceStructured, StructuredExtraction } from "./structured-extractor";

/**
 * Subset of pipeline_items needed for promotion. Mirrors the shape returned
 * by `RETURNING *` on the PATCH route's UPDATE — all the tender details we
 * need live on the pipeline_items row itself (snapshotted at match time),
 * so we don't have to join tenders here.
 */
export interface WonPipelineRow {
  id: number;
  user_id: number;
  tender_id: number | null;
  tender_title: string | null;
  tender_agency: string | null;
  tender_deadline: string | Date | null;
  tender_value: string | null;
  notes: string | null;
}

/**
 * Stable stub URL convention. Exported for the acceptance test + any
 * downstream consumer that wants to detect "is this evidence row a
 * synthetic won-tender promotion?" — `file_url.startsWith(WON_URL_SCHEME)`.
 */
export const WON_URL_SCHEME = "tenderpath://won/pipeline-item/";

export function wonFileUrlFor(pipelineItemId: number): string {
  return `${WON_URL_SCHEME}${pipelineItemId}`;
}

// --------------------------------------------------------------------------
// Pure helpers — exported for the acceptance test.
// --------------------------------------------------------------------------

/**
 * Best-effort numeric parse of a tender_value string. The column is TEXT;
 * real-world values look like "USD 480,000" / "$1.2M" / "EUR 250000" /
 * "150 000 CHF" / null.
 *
 * Scope (deliberately narrow):
 *
 *   - Only USD / $-prefixed values are parsed. Non-USD currencies
 *     (EUR / GBP / CHF / €/£/¥) return undefined — we don't carry FX
 *     rates and inventing a conversion would lie about precision. The
 *     raw value is still preserved in the synthetic past_performance
 *     prose (see buildPromotedEvidence "Value (as displayed)" line),
 *     so the LLM still sees it; we just don't claim a USD amount.
 *
 *   - Comma is ALWAYS treated as a thousands separator. "1,5M" parses
 *     as 15,000,000 (not 1.5M). This is wrong for European decimal
 *     style but right for US thousands style, which dominates in UN
 *     procurement displays. The "1,5M" edge case is rare enough that
 *     a conservative parse beats a magic heuristic.
 *
 *   - Magnitude suffix K = 1_000, M = 1_000_000. "1.2M" → 1_200_000.
 *
 *   - Returns undefined on unparseable / zero / negative input — never
 *     silently coerces to 0.
 */
export function parseAmountUsd(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const text = raw.toUpperCase();
  const hasUsdMarker = /\b(USD|US\$)\b|\$/.test(text);
  const hasOtherCurrency = /\b(EUR|GBP|CHF|CAD|AUD|JPY|CNY)\b|€|£|¥/.test(text);
  if (hasOtherCurrency && !hasUsdMarker) return undefined;
  // Permissive matcher: grab the first contiguous digits-with-separators
  // run + optional K/M suffix. Lets the normalisation pass below decide
  // what each separator means.
  const m = text.match(/([0-9][\d,.]*)\s*([KM]?)/);
  if (!m) return undefined;
  let numStr = m[1];
  const suffix = m[2];
  // Strip ALL commas (treat as thousands). Trust the dot as decimal.
  // Documented limitation: European decimal comma is lost; see scope note.
  numStr = numStr.replace(/,/g, "");
  const base = Number(numStr);
  if (!Number.isFinite(base) || base <= 0) return undefined;
  const multiplier = suffix === "M" ? 1_000_000 : suffix === "K" ? 1_000 : 1;
  const amount = Math.round(base * multiplier);
  return amount > 0 ? amount : undefined;
}

/**
 * Extract a 4-digit year from a tender_deadline. Handles ISO timestamps,
 * "31 Dec 2024", "2024-12-31", and Date objects. Returns undefined when
 * no recognisable year is present — the synthetic past_performance entry
 * is still useful without it; it just lands at the bottom of the year
 * sort in the library.
 */
export function parseYearFromDeadline(
  deadline: string | Date | null | undefined,
): number | undefined {
  if (!deadline) return undefined;
  if (deadline instanceof Date) {
    const y = deadline.getFullYear();
    return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : undefined;
  }
  const m = String(deadline).match(/\b(19|20)\d{2}\b/);
  if (!m) return undefined;
  const y = Number(m[0]);
  return Number.isFinite(y) && y >= 1900 && y <= 2100 ? y : undefined;
}

/**
 * Build the synthetic past_performance evidence payload from a won pipeline
 * row. Pure — exported for the acceptance test.
 *
 * Returns a quadruple:
 *   - name: vault_documents.name (display label)
 *   - fileUrl: stub URL satisfying the NOT NULL constraint
 *   - textContent: prose for the LLM (used as a snippet by findEvidenceFor)
 *   - structured: typed PastPerformanceStructured for structured_extraction
 */
export interface PromotedEvidence {
  name: string;
  fileUrl: string;
  textContent: string;
  structured: StructuredExtraction;
}

const PROMOTION_MODEL_TAG = "won-promotion:sprint-12";

export function buildPromotedEvidence(row: WonPipelineRow): PromotedEvidence {
  const title = row.tender_title?.trim() || `Won opportunity #${row.id}`;
  const agency = row.tender_agency?.trim() || "Unknown agency";
  const year = parseYearFromDeadline(row.tender_deadline);
  const amount = parseAmountUsd(row.tender_value);

  const data: PastPerformanceStructured = {
    client: agency,
    project: title,
  };
  if (typeof amount === "number") data.amount_usd = amount;
  if (typeof year === "number") data.year = year;

  // Prose summary — concise, evidence-flavoured. Will be surfaced via
  // findEvidenceFor's snippet logic when a future tender's requirement
  // matches keywords on (agency, project, sector).
  const lines: string[] = [
    `Awarded contract: ${title}.`,
    `Client: ${agency}.`,
  ];
  if (year) lines.push(`Award year: ${year}.`);
  if (amount) lines.push(`Estimated value: USD ${amount.toLocaleString()}.`);
  if (row.tender_value && !amount) {
    // Preserve the raw value when we couldn't parse a numeric amount —
    // captures non-USD displays for the LLM even though they don't fit
    // PastPerformanceStructured.amount_usd.
    lines.push(`Value (as displayed): ${row.tender_value.trim()}.`);
  }
  if (row.notes && row.notes.trim().length > 0) {
    lines.push(`User notes: ${row.notes.trim().slice(0, 600)}.`);
  }
  lines.push(
    `Auto-promoted by TenderPath when the pipeline_item was marked 'won'. ` +
      `Source: pipeline_items.id=${row.id}${row.tender_id ? `, tenders.id=${row.tender_id}` : ""}.`,
  );

  const structured: StructuredExtraction = {
    type: "past_performance",
    extracted_at: new Date(0).toISOString(), // Deterministic placeholder.
    // Real timestamp is written by promoteWonPipelineItem at INSERT time
    // (the DB's NOW() default on document_extractions.created_at). The pure
    // builder uses epoch-0 here so the function stays deterministic and
    // testable. promoteWonPipelineItem replaces this with the real time.
    model: PROMOTION_MODEL_TAG,
    data,
  };

  return {
    name: `Won bid — ${title}`.slice(0, 255),
    fileUrl: wonFileUrlFor(row.id),
    textContent: lines.join("\n"),
    structured,
  };
}

// --------------------------------------------------------------------------
// DB write — non-throwing, idempotent
// --------------------------------------------------------------------------

export interface PromotionResult {
  /** True when this call actually created the rows. False when the (user_id,
   *  file_url) unique constraint short-circuited (the row was already in
   *  the library from a prior 'won' transition). */
  created: boolean;
  vaultDocumentId: number | null;
  extractionId: number | null;
}

/**
 * Idempotently promote a won pipeline_item into the evidence library.
 *
 * Two INSERTs in one logical step:
 *   1. vault_documents — the metadata row (type='past_performance',
 *      tagged for future filtering, file_url=stub).
 *   2. document_extractions — the prose + structured payload (status =
 *      'extracted' since we synthesised it directly).
 *
 * Idempotency: BOTH inserts use ON CONFLICT DO NOTHING against the
 * (user_id, file_url) unique key. If the user re-marks the same pipeline_item
 * 'won' (or re-marks 'won' → 'lost' → 'won' again), the second promotion
 * is a no-op rather than a duplicate. The returned `created` flag tells the
 * caller which case fired.
 *
 * Non-throwing — failures are logged and surfaced as { created: false,
 * vaultDocumentId: null, extractionId: null }. The PATCH route doesn't fail
 * the user's stage update because of a promotion glitch.
 */
export async function promoteWonPipelineItem(
  row: WonPipelineRow,
): Promise<PromotionResult> {
  try {
    const evidence = buildPromotedEvidence(row);
    const sectorTag = inferSectorTag(row);
    const tags = ["auto-promoted-from-won-tender", "past-performance"];
    if (sectorTag) tags.push(sectorTag);

    // vault_documents — INSERT, returning the id on success or nothing on
    // conflict. We look up the existing row's id when conflict fires so the
    // document_extractions INSERT can still reference it.
    const vdInsert = await sql`
      INSERT INTO vault_documents (user_id, name, type, file_url, tags)
      VALUES (${row.user_id}, ${evidence.name}, 'past_performance', ${evidence.fileUrl}, ${tags})
      ON CONFLICT DO NOTHING
      RETURNING id
    ` as unknown as Array<{ id: number }>;

    let vaultDocumentId: number | null = vdInsert[0]?.id ?? null;
    let created = vdInsert.length > 0;
    if (vaultDocumentId == null) {
      const existing = await sql`
        SELECT id FROM vault_documents
        WHERE user_id = ${row.user_id} AND file_url = ${evidence.fileUrl}
        LIMIT 1
      ` as unknown as Array<{ id: number }>;
      vaultDocumentId = existing[0]?.id ?? null;
    }

    if (vaultDocumentId == null) {
      console.warn("[won-promotion:vault_lookup_failed]", {
        userId: row.user_id,
        pipelineItemId: row.id,
      });
      return { created: false, vaultDocumentId: null, extractionId: null };
    }

    // Replace the deterministic epoch-0 with the real NOW() for the row's
    // structured_extraction.extracted_at JSON payload — buildPromotedEvidence
    // is pure (no Date.now()), so we patch the timestamp here.
    const structuredWithTimestamp = {
      ...evidence.structured,
      extracted_at: new Date().toISOString(),
    };

    const deInsert = await sql`
      INSERT INTO document_extractions (
        user_id, vault_document_id, file_name, file_url,
        status, text_content, char_count, structured_extraction
      ) VALUES (
        ${row.user_id}, ${vaultDocumentId}, ${evidence.name}, ${evidence.fileUrl},
        'extracted', ${evidence.textContent}, ${evidence.textContent.length},
        ${JSON.stringify(structuredWithTimestamp)}::jsonb
      )
      ON CONFLICT (user_id, file_url) DO NOTHING
      RETURNING id
    ` as unknown as Array<{ id: number }>;

    const extractionId = deInsert[0]?.id ?? null;
    if (deInsert.length === 0) created = false; // both already existed

    // Narrow data through the type discriminant for the log line. The
    // structured extraction *is* a PastPerformanceStructured here (we built
    // it that way above), but the StructuredExtraction.data union type
    // doesn't statically narrow without help.
    const ppData =
      structuredWithTimestamp.type === "past_performance"
        ? (structuredWithTimestamp.data as PastPerformanceStructured)
        : null;
    console.log("[won-promotion:applied]", {
      userId: row.user_id,
      pipelineItemId: row.id,
      vaultDocumentId,
      extractionId,
      created,
      hasAmount: typeof ppData?.amount_usd === "number",
      year: ppData?.year ?? null,
    });

    return { created, vaultDocumentId, extractionId };
  } catch (err) {
    console.warn("[won-promotion:failed]", {
      userId: row.user_id,
      pipelineItemId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { created: false, vaultDocumentId: null, extractionId: null };
  }
}

/**
 * Lightweight tag inference from notes/title text. Pure — exported for
 * the acceptance test. Returns one short tag string (e.g. "biomedical",
 * "water", "logistics") when a sector marker is detectable, or null
 * otherwise. NOT used as the sole sector signal (the structured
 * PastPerformanceStructured.sector field is the authoritative slot
 * once we add LLM-derived sector inference); just a search facet.
 */
export function inferSectorTag(row: WonPipelineRow): string | null {
  const haystack = `${row.tender_title ?? ""} ${row.notes ?? ""}`.toLowerCase();
  const tagsByKeyword: Array<{ kw: RegExp; tag: string }> = [
    { kw: /\b(biomedical|oxygen plant|medical (device|equipment)|sterilizer|x-?ray)\b/, tag: "sector-biomedical" },
    { kw: /\b(water|sanitation|wash\b|hdpe|gi pipe|borehole|pump)\b/, tag: "sector-water" },
    { kw: /\b(logistics|fleet|warehouse|transport|freight)\b/, tag: "sector-logistics" },
    { kw: /\b(ict|software|saas|web|mobile app|platform development|telecom)\b/, tag: "sector-ict" },
    { kw: /\b(education|school|curriculum|teacher training|university)\b/, tag: "sector-education" },
    { kw: /\b(agriculture|farming|food security|irrigation|seed)\b/, tag: "sector-agriculture" },
    { kw: /\b(energy|solar|wind|grid|electrification)\b/, tag: "sector-energy" },
    { kw: /\b(construction|civil works|road|bridge|housing)\b/, tag: "sector-construction" },
  ];
  for (const { kw, tag } of tagsByKeyword) {
    if (kw.test(haystack)) return tag;
  }
  return null;
}
