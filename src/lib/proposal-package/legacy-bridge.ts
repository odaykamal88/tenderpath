/**
 * legacy-bridge.ts — adapt legacy work-order data to the Sprint 1-5 engine.
 *
 * The new scoring engine (extractRubric + runRevisionLoop) was designed
 * against multi-file fixtures with structured manifests, per-notice subdirs,
 * and a typed ApplicantContext. Production work orders have a flatter shape:
 *
 *   - work_orders.intake JSON with uploaded-document blob URLs + tender
 *     context pasted by the applicant
 *   - pipeline_items joined to tenders.description for crawled tender prose
 *   - assessments.ai_analysis with capabilities / certifications detected
 *     from the company website crawl
 *
 * This module bridges the two by producing a TenderInput with a single
 * "solicitation" IngestedDoc (the flattened tender prose) and an
 * ApplicantContext built from the assessment + AI analysis.
 *
 * Sprint 6c: multi-lot detection now runs before the engine. A regex
 * heuristic ("Lot 1" / "Lot A" / "Lot I" markers) short-circuits to
 * single-lot when the tender prose has no such markers (~95% of paid
 * orders today). When markers appear, a Haiku call returns the lot list
 * so the rubric is scored per-lot. This closes the silent-correctness
 * bug where a multi-lot ITB was scored as one merged criteria set.
 *
 * Still lossy: corrigendum supersession + Q&A binding land when the
 * upstream upload pipeline starts producing the multi-doc shape; today
 * the entire tender corpus collapses into one "solicitation" doc.
 */

import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import { sql } from "@/lib/db";
import type {
  DocManifestEntry,
  IngestedDoc,
  TenderInput,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import {
  buildTenderText,
  type AssessmentRow,
  type PipelineRow,
  type WorkOrderRow,
} from "./context";
import { safeParseJSON } from "./llm";
import type { MinedProfileFacts } from "@/lib/applicant-evidence/profile-miner";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60_000 });
  }
  return _client;
}

/** Stable 16-char SHA1 prefix for DocManifestEntry.contentHash. */
function shortHash(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** Sanitize a tender title for use as a docId/filename. */
function safeSlug(text: string, maxLen = 60): string {
  return text
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .toLowerCase() || "tender";
}

export interface DetectedLot {
  lotId: string;
  label: string;
  scope?: string;
}

/**
 * Markers that suggest a multi-lot tender. Conservative on purpose — false
 * positives trigger a useless ~5s Haiku call; false negatives quietly collapse
 * a multi-lot tender to single-lot scoring (the bug we're closing). The regex
 * matches "Lot 1", "Lot-1", "Lot A", "Lot I" but NOT "lot of work".
 */
const LOT_MARKER = /\blot[- ]?(?:\d{1,3}|[IVX]{1,5}\b|[A-Z]\b)/i;

const LOT_DETECTION_PROMPT = `You are a UN procurement lot extractor. Given the tender prose below, identify whether this is a multi-lot tender and return the list of lots.

A LOT is a separately-biddable group of items within ONE tender notice. Multi-lot tenders evaluate per-lot (a vendor may quote on a subset), single-lot tenders evaluate the whole bid as one.

RULES:
- Return [] when the tender is single-lot (one indivisible scope).
- When multi-lot, return ONE entry per lot. Use the tender's own lot identifier as lotId ("1", "2", "A", "I"); fall back to "lot-1" / "lot-2" if the tender doesn't number them.
- Label should be a short human-readable description from the tender (e.g. "HDPE pipes and fittings, Taiz City"). 80 chars max.
- Scope is optional; include only if the tender clearly states a separate scope per lot.

Return JSON: {"lots": [{"lotId": string, "label": string, "scope"?: string}]}
Return {"lots": []} for single-lot tenders — do NOT invent a "main" lot.

TENDER:
`;

interface LotDetectionResponse {
  lots?: Array<{ lotId?: unknown; label?: unknown; scope?: unknown }>;
}

/**
 * Detect lot metadata from tender prose. Heuristic-first: when no "Lot N"
 * markers appear, returns single-lot without calling the LLM (cheap +
 * correct for the dominant case). When markers DO appear, asks Haiku to
 * enumerate. Falls back to single-lot on any LLM failure / parse error so
 * the run never fails on lot detection alone.
 *
 * Returned array is ALWAYS non-empty. Single-lot path returns one entry
 * with lotId="main" — the engine's convention (LotRubric.lotId="main")
 * so downstream code can address a lot without conditional logic.
 */
export async function detectLotMetadata(
  tenderText: string,
  tenderTitle: string,
): Promise<DetectedLot[]> {
  const fallback: DetectedLot[] = [
    { lotId: "main", label: tenderTitle.slice(0, 80) },
  ];

  if (!LOT_MARKER.test(tenderText)) {
    return fallback;
  }

  try {
    const client = getClient();
    const truncated = tenderText.slice(0, 30_000); // bound the prompt
    const completion = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      temperature: 0,
      messages: [
        { role: "user", content: `${LOT_DETECTION_PROMPT}${truncated}` },
      ],
    });
    const textBlock = completion.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      console.warn("[legacy-bridge:lot_detection_no_text_block]", { tenderTitle });
      return fallback;
    }

    const parsed = safeParseJSON<LotDetectionResponse>(
      textBlock.text,
      { lots: [] },
      "legacy-bridge:lot_detection",
    );
    if (!Array.isArray(parsed.lots) || parsed.lots.length === 0) {
      // Markers present but model couldn't enumerate — likely a false-positive
      // marker (e.g. "a lot of work"). Single-lot is the safe fall-back.
      return fallback;
    }

    const cleaned: DetectedLot[] = [];
    for (const lot of parsed.lots) {
      if (typeof lot?.lotId !== "string" || typeof lot?.label !== "string") continue;
      const lotId = lot.lotId.trim().slice(0, 32);
      const label = lot.label.trim().slice(0, 80);
      if (!lotId || !label) continue;
      const scope = typeof lot.scope === "string" ? lot.scope.trim().slice(0, 240) : undefined;
      cleaned.push(scope ? { lotId, label, scope } : { lotId, label });
    }

    if (cleaned.length === 0) return fallback;
    console.log("[legacy-bridge:lot_detection_succeeded]", {
      tenderTitle,
      lotCount: cleaned.length,
      lotIds: cleaned.map((l) => l.lotId),
    });
    return cleaned;
  } catch (err) {
    console.warn("[legacy-bridge:lot_detection_failed]", {
      tenderTitle,
      err: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

// --------------------------------------------------------------------------
// Supplementary tender docs — corrigendum / amendment + Q&A binding (Sprint 9)
// --------------------------------------------------------------------------

/**
 * Intake shape for a single supplementary document the user has uploaded.
 * Parallel to the existing `vault_url` / `vault_filename` / `vault_doc_id`
 * triplet that addresses the main solicitation. Persisted on
 * `work_orders.intake` as keys:
 *
 *   amendment_url, amendment_filename, amendment_doc_id   (corrigendum)
 *   qa_url, qa_filename, qa_doc_id                        (Q&A round)
 *
 * The MVP supports ONE corrigendum + ONE Q&A doc per tender — the dominant
 * case at submission time, and AGENTS.md's "assume one corrigendum exists
 * until proven otherwise" guidance. Multi-amendment support promotes to
 * arrays in a later sprint.
 */
export interface SupplementaryDocRef {
  url?: string | null;
  filename?: string | null;
  vaultDocId?: number | null;
  role: "amendment" | "qa";
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Extract supplementary doc references from an intake JSONB. Pure — testable.
 * Returns a (possibly empty) list of refs the bridge will try to resolve to
 * extracted text. Either `url` or `vaultDocId` must be present for each ref
 * to be returned — a filename without a payload is useless to the engine.
 */
export function extractSupplementaryDocRefs(
  intake: Record<string, unknown> | null | undefined,
): SupplementaryDocRef[] {
  if (!intake) return [];
  const refs: SupplementaryDocRef[] = [];

  const amendmentUrl = asString(intake.amendment_url);
  const amendmentVaultId = asPositiveInt(intake.amendment_doc_id);
  if (amendmentUrl || amendmentVaultId) {
    refs.push({
      url: amendmentUrl,
      filename: asString(intake.amendment_filename),
      vaultDocId: amendmentVaultId,
      role: "amendment",
    });
  }

  const qaUrl = asString(intake.qa_url);
  const qaVaultId = asPositiveInt(intake.qa_doc_id);
  if (qaUrl || qaVaultId) {
    refs.push({
      url: qaUrl,
      filename: asString(intake.qa_filename),
      vaultDocId: qaVaultId,
      role: "qa",
    });
  }

  return refs;
}

/**
 * Shape of the extraction row needed to build a supplementary IngestedDoc.
 * Exported so the acceptance test can feed a hand-crafted row into
 * buildIngestedDocFromExtraction without touching the DB.
 */
export interface SupplementaryExtractionRow {
  file_name: string | null;
  file_url: string | null;
  text_content: string | null;
  char_count: number | null;
  status: string | null;
}

type ExtractionLookupRow = SupplementaryExtractionRow;

/**
 * Pure transformer: turn a (ref, extraction) pair into an IngestedDoc, or
 * null when the extraction isn't usable (missing text, not in "extracted"
 * status). Pure — exported for the acceptance test.
 *
 * Amendments emit `supersedes: ["solicitation"]` so the rubric extractor's
 * prompt surfaces the corrigendum override explicitly. Q&A docs carry no
 * supersedes — the engine reads them under role=qa with the
 * "published clarifications are binding" prompt instruction.
 */
export function buildIngestedDocFromExtraction(
  ref: SupplementaryDocRef,
  extraction: SupplementaryExtractionRow | null,
): IngestedDoc | null {
  if (!extraction || !extraction.text_content || extraction.status !== "extracted") {
    return null;
  }
  const filename = ref.filename ?? extraction.file_name ?? `${ref.role}.txt`;
  const text = extraction.text_content;
  const manifest: DocManifestEntry = {
    docId: ref.role,
    filename,
    contentHash: shortHash(text),
    role: ref.role,
    supersedes: ref.role === "amendment" ? ["solicitation"] : undefined,
  };
  return { manifest, text };
}

/**
 * Resolve a single supplementary doc ref to an extraction row. Tries the
 * direct file_url match first (covers the vault_url legacy path), falls back
 * to the vault_documents join when only a vault_doc_id is present. Returns
 * null on lookup failure — the caller logs and continues without the doc.
 */
async function loadExtractionForRef(
  userId: number,
  ref: SupplementaryDocRef,
): Promise<ExtractionLookupRow | null> {
  try {
    if (ref.url) {
      const rows = await sql`
        SELECT file_name, file_url, text_content, char_count, status
        FROM document_extractions
        WHERE user_id = ${userId} AND file_url = ${ref.url}
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      ` as unknown as ExtractionLookupRow[];
      if (rows[0]) return rows[0];
    }
    if (ref.vaultDocId) {
      const rows = await sql`
        SELECT
          COALESCE(de.file_name, vd.name) AS file_name,
          vd.file_url,
          de.text_content,
          de.char_count,
          de.status
        FROM vault_documents vd
        LEFT JOIN document_extractions de
          ON de.user_id = vd.user_id
         AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
        WHERE vd.user_id = ${userId} AND vd.id = ${ref.vaultDocId}
        ORDER BY de.updated_at DESC NULLS LAST
        LIMIT 1
      ` as unknown as ExtractionLookupRow[];
      if (rows[0]) return rows[0];
    }
    return null;
  } catch (err) {
    console.warn("[legacy-bridge:supp_doc_lookup_failed]", {
      userId,
      role: ref.role,
      url: ref.url,
      vaultDocId: ref.vaultDocId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Build a list of IngestedDocs for the supplementary roles (amendment + qa).
 * Used by buildTenderInputFromLegacy to produce the multi-doc TenderInput
 * that the rubric extractor already knows how to prioritise (rolePriority in
 * rubric-extractor.ts: solicitation > tor > amendment > guidelines > qa).
 *
 * Amendments carry `supersedes: ['solicitation']` so the extractor's
 * supersession-aware prompt knows the amendment text overrides matching
 * points in the base solicitation — exactly the AGENTS.md hard rule:
 * "Mis-scoring against an outdated rubric is a trust-killer; corrigendum-
 * driven changes must be surfaced explicitly."
 *
 * Q&A docs are passed in as their own IngestedDoc rather than parsed into
 * typed QAEntry[] / bindingClarifications. The extractor sees the full Q&A
 * text under role=qa and the prompt instructs it to treat published Q&A as
 * binding. A future sprint may add a Haiku pass that classifies Q&A entries
 * into binding/informational/noise — for now, the model handles it inline.
 */
export async function loadSupplementaryTenderDocs(
  intake: Record<string, unknown> | null | undefined,
  userId: number | null,
): Promise<IngestedDoc[]> {
  if (!userId) return []; // anonymous orders never have a vault library
  const refs = extractSupplementaryDocRefs(intake);
  if (refs.length === 0) return [];

  const out: IngestedDoc[] = [];
  for (const ref of refs) {
    const extraction = await loadExtractionForRef(userId, ref);
    const doc = buildIngestedDocFromExtraction(ref, extraction);
    if (!doc) {
      console.warn("[legacy-bridge:supp_doc_not_extracted]", {
        userId,
        role: ref.role,
        url: ref.url,
        vaultDocId: ref.vaultDocId,
        status: extraction?.status ?? "no_extraction",
      });
      continue;
    }
    out.push(doc);
  }
  return out;
}

/**
 * Build a TenderInput from a legacy work-order row.
 *
 * The base solicitation prose (tender title + agency + pasted context +
 * uploaded main TOR/RFP text via service-context) lands in ONE IngestedDoc
 * with role="solicitation".
 *
 * Sprint 9: if the intake carries corrigendum / amendment or Q&A round
 * uploads (amendment_url + qa_url shape — see SupplementaryDocRef above),
 * each lands as its OWN IngestedDoc with role="amendment" / role="qa". The
 * rubric extractor's rolePriority + supersession-aware prompt then treats
 * them as authoritative overrides of the original solicitation, closing
 * the AGENTS.md hard rule:
 *
 *   "Any proposal review must read the call's corrigenda and Q&A appendix
 *    before scoring against the original guidelines."
 *
 * Multi-lot detection runs inline (Sprint 6c). Single-lot tenders (the
 * dominant case) short-circuit on the regex heuristic and never call the
 * LLM. Multi-lot tenders trigger a Haiku enumeration so the engine scores
 * per-lot instead of merging criteria.
 *
 * Async because of the lot-detection LLM call + supplementary-doc DB
 * lookups. Callers must await.
 */
export async function buildTenderInputFromLegacy(
  workOrder: WorkOrderRow,
  pipelineItem: PipelineRow | null,
): Promise<TenderInput> {
  const tenderText = buildTenderText(workOrder, pipelineItem);
  const tenderTitle =
    pipelineItem?.tender_title ?? workOrder.tender_title ?? `Work Order ${workOrder.id}`;
  // Prefer the pipeline tender_id when available — it stays stable across
  // re-runs of the same matched opportunity. Fall back to the work-order id
  // for paste-in / URL flows.
  const tenderId = pipelineItem?.tender_id
    ? `pipeline-${pipelineItem.tender_id}`
    : `wo-${workOrder.id}`;

  const solicitationManifest: DocManifestEntry = {
    docId: "solicitation",
    filename: `${safeSlug(tenderTitle)}.txt`,
    contentHash: shortHash(tenderText),
    role: "solicitation",
  };

  const solicitationDoc: IngestedDoc = {
    manifest: solicitationManifest,
    text: tenderText,
  };

  const supplementaryDocs = await loadSupplementaryTenderDocs(
    workOrder.intake ?? null,
    workOrder.user_id,
  );

  const lotMetadata = await detectLotMetadata(tenderText, tenderTitle);

  if (supplementaryDocs.length > 0) {
    console.log("[legacy-bridge:supplementary_docs_loaded]", {
      workOrderId: workOrder.id,
      tenderTitle,
      roles: supplementaryDocs.map((d) => d.manifest.role),
    });
  }

  return {
    tenderId,
    // Legacy data doesn't carry an explicit lane flag. Default to procurement
    // since 95%+ of paid orders are UN/IFI procurement; grant lanes will
    // override this via pipeline_items.opportunity_type in a later sprint.
    lane: "procurement",
    methodology: "cumulative",
    lotMetadata,
    docs: [solicitationDoc, ...supplementaryDocs],
  };
}

/**
 * Build an ApplicantContext from the assessment + AI analysis. Fields the
 * engine reads (companyName, sectorsCovered, certifications, geographicReach,
 * capabilityNarrative) are populated from real data where available; the
 * structural array fields (keyPersonnel, pastPerformance) start empty
 * because legacy intake doesn't yet collect them.
 *
 * The engine handles missing fields gracefully — claims tagged with
 * provenance="gap" surface as gaps in B3 rather than crashing the run.
 * Sprint 8 (evidence carry-forward) populates keyPersonnel and
 * pastPerformance from applicant_library uploads, lifting first-pass quality.
 *
 * Sprint 8e: optional `minedFacts` overlays free-text-intake-mined facts
 * onto the result. Policy is GAP-FILL ONLY — assessment-derived data always
 * wins; mined facts only fill empty fields (yearsOfExperience=0, empty
 * sectorsCovered/geographicReach, missing capabilityNarrative). This keeps
 * the engine's "evidence > inferred" hierarchy intact: assessment data is
 * crawled or wizard-collected; mined facts are user CLAIMS from intake.
 */
export function buildApplicantContextFromAssessment(
  assessment: AssessmentRow | null,
  workOrder: WorkOrderRow,
  minedFacts: MinedProfileFacts | null = null,
): ApplicantContext {
  const base: ApplicantContext = assessment
    ? buildFromAssessmentOnly(assessment, workOrder)
    : {
        companyName: workOrder.email?.split("@")[0] ?? `Vendor ${workOrder.id}`,
        countryOfRegistration: "Unknown",
        yearsOfExperience: 0,
        sectorsCovered: [],
        keyPersonnel: [],
        pastPerformance: [],
        certifications: [],
        geographicReach: [],
        capabilityNarrative:
          "No company profile available — the applicant submitted this work order without completing the assessment flow.",
      };

  if (!minedFacts) return base;
  return overlayMinedFacts(base, minedFacts);
}

/** Internal: build the assessment-only branch. Kept separate so the overlay
 *  function has a clean input and the no-assessment branch reuses the same
 *  shape rather than diverging in two places. */
function buildFromAssessmentOnly(
  assessment: AssessmentRow,
  workOrder: WorkOrderRow,
): ApplicantContext {
  const ai = (assessment.ai_analysis ?? {}) as Record<string, unknown>;
  const aiCapabilities = Array.isArray(ai.capabilities)
    ? (ai.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  const aiCerts = Array.isArray(ai.certifications_detected)
    ? (ai.certifications_detected as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const sectorsCovered = [assessment.sector, ...aiCapabilities].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  return {
    companyName: assessment.company_name ?? workOrder.email ?? "Vendor",
    countryOfRegistration:
      Array.isArray(assessment.countries) && assessment.countries.length > 0
        ? assessment.countries[0]
        : "Unknown",
    yearsOfExperience:
      typeof ai.years_of_experience === "number" ? ai.years_of_experience : 0,
    sectorsCovered,
    keyPersonnel: [],
    pastPerformance: [],
    certifications: aiCerts,
    geographicReach: Array.isArray(assessment.countries) ? assessment.countries : [],
    capabilityNarrative: assessment.description ?? undefined,
  };
}

/**
 * Overlay mined intake facts onto a base ApplicantContext with a strict
 * GAP-FILL policy:
 *
 *   - yearsOfExperience: filled only when base is 0 / falsy
 *   - sectorsCovered:    filled only when base is empty; mined sectors AND
 *                        capabilities both contribute (deduped)
 *   - geographicReach:   filled only when base is empty
 *   - capabilityNarrative: filled only when base is missing/empty; synthesised
 *                        from agencies + capabilities + years to give the
 *                        engine SOMETHING to reason against
 *
 * Mined facts are CLAIMS — they never overwrite assessment-derived data. The
 * engine's provenance labelling (`evidence` vs `inferred`) keeps these from
 * being fraudulently elevated to "evidenced" requirement matches downstream.
 *
 * Pure — exported for the acceptance test.
 */
export function overlayMinedFacts(
  base: ApplicantContext,
  mined: MinedProfileFacts,
): ApplicantContext {
  const out: ApplicantContext = { ...base };

  if ((!out.yearsOfExperience || out.yearsOfExperience === 0) && typeof mined.years_of_experience === "number") {
    out.yearsOfExperience = mined.years_of_experience;
  }

  if (out.sectorsCovered.length === 0) {
    const minedSectors = [
      ...(mined.sectors_covered ?? []),
      ...(mined.key_capabilities ?? []),
    ].filter((s) => typeof s === "string" && s.length > 0);
    if (minedSectors.length > 0) {
      out.sectorsCovered = Array.from(new Set(minedSectors));
    }
  }

  if (out.geographicReach.length === 0 && Array.isArray(mined.geographic_reach) && mined.geographic_reach.length > 0) {
    out.geographicReach = Array.from(new Set(mined.geographic_reach));
  }

  const baseNarrative = out.capabilityNarrative?.trim() ?? "";
  if (baseNarrative.length === 0) {
    const synth = synthesizeNarrativeFromMined(mined);
    if (synth) out.capabilityNarrative = synth;
  }

  return out;
}

function synthesizeNarrativeFromMined(mined: MinedProfileFacts): string | null {
  const parts: string[] = [];
  if (typeof mined.years_of_experience === "number" && mined.years_of_experience > 0) {
    parts.push(`${mined.years_of_experience} years of operating experience`);
  }
  if (mined.sectors_covered && mined.sectors_covered.length > 0) {
    parts.push(`active in ${mined.sectors_covered.slice(0, 4).join(", ")}`);
  }
  if (mined.key_capabilities && mined.key_capabilities.length > 0) {
    parts.push(`with capabilities in ${mined.key_capabilities.slice(0, 4).join(", ")}`);
  }
  if (mined.agencies_worked_with && mined.agencies_worked_with.length > 0) {
    parts.push(`engaged previously with ${mined.agencies_worked_with.slice(0, 6).join(", ")}`);
  }
  if (mined.geographic_reach && mined.geographic_reach.length > 0) {
    parts.push(`operating in ${mined.geographic_reach.slice(0, 4).join(", ")}`);
  }
  if (parts.length === 0) return null;
  return `Vendor self-described (intake claims, not verified): ${parts.join("; ")}.`;
}
