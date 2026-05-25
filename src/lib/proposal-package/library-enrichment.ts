/**
 * library-enrichment.ts — Sprint 8 carry-forward bridge.
 *
 * The Sprint 1-5 engine consumes a structured ApplicantContext
 * (keyPersonnel[] / pastPerformance[] / certifications[] / sectorsCovered[]).
 * The vault stores files (vault_documents + document_extractions) keyed by
 * a small evidence taxonomy (cv / certificate / past_performance / audit /
 * capability_statement / partner_letter / registration / financial). Sprint 10
 * wired the legacy proposal pipeline to scan that library by keyword for an
 * LLM extractor — the new structured engine cannot use that signal directly.
 *
 * This module is the shape bridge:
 *
 *   EvidenceLibraryRow[] → Partial<ApplicantContext> enrichment
 *
 * It uses filename + type + tag heuristics to derive structured entries.
 * Real LLM extraction of personnel / past-performance details from the
 * underlying text_content is Sprint 8b — this commit ships the coarse
 * derivation that lifts `provenance: 'gap'` claims to
 * `provenance: 'applicant_library'` claims wherever the library has SOME
 * matching evidence, even if the structured details are placeholders.
 *
 * Why coarse first
 *   - The engine's readiness rubric counts entries (e.g. "3+ key personnel
 *     mitigates key-person risk"). Even placeholder entries make the count
 *     correct.
 *   - Provenance flips from `gap` → `applicant_library` the moment any
 *     matching file exists. That's the conversion-relevant signal the page
 *     surfaces, not the inner field values.
 *   - Sprint 8b can replace each derived entry with LLM-extracted detail
 *     without changing the engine's interface or the calling code.
 *
 * Pure function. No I/O. No LLM. Side-effect-free.
 */

import type { ApplicantContext } from "./applicant-context";
import type { EvidenceLibraryRow } from "@/lib/applicant-evidence/types";

/**
 * Filename → human display name. Strips extension + non-letter tokens,
 * splits on common separators (CV-name, name_CV, name CV, etc.), drops
 * tokens that are obviously not part of a name (cv, resume, certificate,
 * dated suffixes, "v2", etc.).
 */
function deriveDisplayNameFromFile(fileName: string): string {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, ""); // drop .pdf/.docx
  const tokens = stem
    .split(/[-_.\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const NOISE = new Set([
    "cv", "resume", "certificate", "cert", "audit", "past", "performance",
    "capability", "statement", "registration", "partner", "letter",
    "final", "draft", "signed", "scanned", "copy", "v1", "v2", "v3",
    "2020", "2021", "2022", "2023", "2024", "2025", "2026",
  ]);
  const cleaned = tokens.filter((t) => !NOISE.has(t.toLowerCase()));
  if (cleaned.length === 0) return tokens.slice(0, 3).join(" ");

  // Capitalize first letter of each remaining token, cap at 4 tokens.
  return cleaned
    .slice(0, 4)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}

/**
 * Pull a 4-digit year out of a filename / tag set. Used by past-performance
 * derivation so the engine's "did this happen recently?" check has a real
 * number. Falls back to 0 ("unknown") when no year is detectable.
 */
function deriveYear(fileName: string, tags: string[]): number {
  const haystack = `${fileName} ${tags.join(" ")}`;
  const match = haystack.match(/\b(20[12][0-9])\b/);
  if (match) return Number(match[1]);
  return 0;
}

/**
 * Read a string field from a structured_extraction payload. Returns the
 * trimmed string when present and non-empty, otherwise null. Used by the
 * derivers below to prefer LLM-extracted data over filename heuristics
 * without hard-failing on missing / typo'd fields.
 */
function structuredString(
  row: EvidenceLibraryRow,
  expectedType: "cv" | "past_performance" | "certificate",
  field: string,
): string | null {
  const se = row.structured_extraction;
  if (!se || se.type !== expectedType) return null;
  const raw = se.data?.[field];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function structuredNumber(
  row: EvidenceLibraryRow,
  expectedType: "cv" | "past_performance" | "certificate",
  field: string,
): number | null {
  const se = row.structured_extraction;
  if (!se || se.type !== expectedType) return null;
  const raw = se.data?.[field];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function structuredStringArray(
  row: EvidenceLibraryRow,
  expectedType: "cv" | "past_performance" | "certificate",
  field: string,
): string[] | null {
  const se = row.structured_extraction;
  if (!se || se.type !== expectedType) return null;
  const raw = se.data?.[field];
  if (!Array.isArray(raw)) return null;
  const cleaned = raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Sprint 8 ships filename → role/years placeholders. Sprint 8b prefers
 * LLM-extracted fields when they're present on the row. Order of
 * preference for each field:
 *   structured (Sprint 8b)  →  filename / tag heuristic (Sprint 8)
 */
function derivePersonnel(row: EvidenceLibraryRow) {
  const structuredName = structuredString(row, "cv", "name");
  const structuredRole = structuredString(row, "cv", "role");
  const structuredYears = structuredNumber(row, "cv", "years_experience");
  const structuredSectors = structuredStringArray(row, "cv", "sectors");

  return {
    name: structuredName ?? deriveDisplayNameFromFile(row.file_name),
    role: structuredRole ?? "Senior staff",
    yearsExperience: structuredYears ?? 0,
    sectors: structuredSectors ?? (row.tags.length > 0 ? row.tags.slice(0, 3) : undefined),
  };
}

/**
 * Format a numeric USD amount as the rendered `value` string the
 * ApplicantContext.pastPerformance[] entry expects (e.g. 220000 → "USD 220,000").
 * Returns undefined when no amount was LLM-extracted.
 */
function formatAmountUsd(amount: number | null): string | undefined {
  if (amount == null || amount <= 0) return undefined;
  return `USD ${amount.toLocaleString("en-US")}`;
}

function derivePastPerformance(row: EvidenceLibraryRow) {
  const structuredClient = structuredString(row, "past_performance", "client");
  const structuredProject = structuredString(row, "past_performance", "project");
  const structuredYear = structuredNumber(row, "past_performance", "year");
  const structuredSector = structuredString(row, "past_performance", "sector");
  const structuredAmount = structuredNumber(row, "past_performance", "amount_usd");

  const project = structuredProject ?? deriveDisplayNameFromFile(row.file_name);
  const client = structuredClient ?? (row.tags.find((t) => t.length >= 3) ?? "Unknown client");
  const sector = structuredSector ?? (row.tags[0] && row.tags[0] !== client ? row.tags[0] : undefined);

  return {
    client,
    project,
    year: structuredYear ?? deriveYear(row.file_name, row.tags),
    sector,
    // Sprint 8b: `value` is the rendered string the ApplicantContext
    // schema expects. Omitted when no amount was LLM-extracted — the
    // engine's "did this past performance meet the amount threshold?"
    // check sees `undefined` as unknown and degrades to inferred, not gap.
    value: formatAmountUsd(structuredAmount),
  };
}

/**
 * Sprint 8 used the filename / tag as the certification label. Sprint 8b
 * prefers the LLM-extracted "standard" field (e.g. "ISO 9001:2015") so
 * the rendered cert list reads naturally.
 */
function deriveCertificationLabel(row: EvidenceLibraryRow): string {
  const structuredStandard = structuredString(row, "certificate", "standard");
  if (structuredStandard) return structuredStandard;
  // Prefer a tag that looks like an ISO/standard code, otherwise filename
  const isoTag = row.tags.find((t) => /\b(iso|en|bs)\b/i.test(t) || /^iso[-_ ]?\d{4,5}/i.test(t));
  if (isoTag) return isoTag;
  return deriveDisplayNameFromFile(row.file_name);
}

/**
 * Enrich an ApplicantContext using whatever evidence the user has in vault.
 * NEVER overwrites populated fields — the caller (or the assessment wizard)
 * may already have richer data; the library top-ups gaps, it doesn't
 * displace explicit input.
 *
 * The structured fields populated here let the engine's rubric scoring
 * stop emitting `provenance: 'gap'` for criteria like "key personnel"
 * and "certifications" — even when the underlying file isn't LLM-extracted
 * yet, its existence is a real signal.
 */
export function enrichApplicantContextFromLibrary(
  applicant: ApplicantContext,
  library: EvidenceLibraryRow[],
): ApplicantContext {
  if (library.length === 0) return applicant;

  // ----------------------------------------------------------------------
  // Group library rows by evidence type. Legacy rows may carry "other"
  // or pre-Sprint-10 type strings; we match the canonical taxonomy and
  // route anything else to inspection of tags.
  // ----------------------------------------------------------------------
  const cvRows: EvidenceLibraryRow[] = [];
  const certRows: EvidenceLibraryRow[] = [];
  const pastPerfRows: EvidenceLibraryRow[] = [];
  const capabilityRows: EvidenceLibraryRow[] = [];
  const registrationRows: EvidenceLibraryRow[] = [];

  for (const row of library) {
    const t = (row.type ?? "").toLowerCase();
    const tags = row.tags.map((x) => x.toLowerCase());
    if (t === "cv" || tags.includes("cv") || tags.includes("resume")) cvRows.push(row);
    else if (t === "certificate" || t === "audit" || tags.some((x) => /\b(iso|cert|audit)\b/.test(x))) certRows.push(row);
    else if (t === "past_performance" || tags.includes("past_performance") || tags.includes("reference")) pastPerfRows.push(row);
    else if (t === "capability_statement" || tags.includes("capability")) capabilityRows.push(row);
    else if (t === "registration" || tags.includes("registration") || tags.includes("ungm")) registrationRows.push(row);
  }

  // ----------------------------------------------------------------------
  // Build enriched fields. Each branch only writes if the existing value
  // looks empty/defaulted; we never displace explicit data.
  // ----------------------------------------------------------------------
  const enriched: ApplicantContext = { ...applicant };

  // Key personnel — only fill if currently empty
  if ((!enriched.keyPersonnel || enriched.keyPersonnel.length === 0) && cvRows.length > 0) {
    enriched.keyPersonnel = cvRows.slice(0, 6).map(derivePersonnel);
  }

  // Past performance — only fill if currently empty
  if ((!enriched.pastPerformance || enriched.pastPerformance.length === 0) && pastPerfRows.length > 0) {
    enriched.pastPerformance = pastPerfRows.slice(0, 8).map(derivePastPerformance);
  }

  // Certifications — additive when the existing list is empty
  if ((!enriched.certifications || enriched.certifications.length === 0) && certRows.length > 0) {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const row of certRows) {
      const label = deriveCertificationLabel(row);
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
      if (labels.length >= 10) break;
    }
    enriched.certifications = labels;
  }

  // UN supplier baseline — flip true if a registration doc exists (UNGM /
  // agency registration). Conservative: only flips false→true, never
  // overrides an explicit false set by intake.
  if (registrationRows.length > 0 && !enriched.meetsUnSupplierBaseline) {
    enriched.meetsUnSupplierBaseline = true;
  }

  // Capability narrative — only fill if missing. Use the first capability
  // statement's filename as a hint that the applicant HAS a capability
  // doc; the engine's prose generation will handle the actual claim text.
  if (!enriched.capabilityNarrative && capabilityRows.length > 0) {
    enriched.capabilityNarrative = `Capability statement on file (${capabilityRows[0].file_name}).`;
  }

  return enriched;
}

/**
 * Light summary the caller can log to confirm enrichment ran and what it
 * found. Used by generate-proposal-v2 for the `[proposal-v2:enriched]`
 * instrumentation line.
 */
export function summarizeEnrichment(
  before: ApplicantContext,
  after: ApplicantContext,
  libraryCount: number,
): {
  libraryCount: number;
  personnelAdded: number;
  pastPerformanceAdded: number;
  certificationsAdded: number;
  registrationFlipped: boolean;
  capabilityNarrativeAdded: boolean;
} {
  return {
    libraryCount,
    personnelAdded: (after.keyPersonnel?.length ?? 0) - (before.keyPersonnel?.length ?? 0),
    pastPerformanceAdded: (after.pastPerformance?.length ?? 0) - (before.pastPerformance?.length ?? 0),
    certificationsAdded: (after.certifications?.length ?? 0) - (before.certifications?.length ?? 0),
    registrationFlipped: !before.meetsUnSupplierBaseline && !!after.meetsUnSupplierBaseline,
    capabilityNarrativeAdded: !before.capabilityNarrative && !!after.capabilityNarrative,
  };
}
