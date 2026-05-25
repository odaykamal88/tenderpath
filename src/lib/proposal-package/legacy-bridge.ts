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

/**
 * Build a TenderInput from a legacy work-order row. The tender prose is
 * flattened into ONE IngestedDoc with role="solicitation" — corrigendum /
 * amendment / Q&A binding will lift in a future sprint once the upload
 * pipeline produces per-role files.
 *
 * Multi-lot detection runs inline (Sprint 6c). Single-lot tenders (the
 * dominant case) short-circuit on the regex heuristic and never call
 * the LLM. Multi-lot tenders trigger a Haiku enumeration so the engine
 * scores per-lot instead of merging criteria.
 *
 * Async because of the lot-detection LLM call. Callers must await.
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

  const manifest: DocManifestEntry = {
    docId: "solicitation",
    filename: `${safeSlug(tenderTitle)}.txt`,
    contentHash: shortHash(tenderText),
    role: "solicitation",
  };

  const solicitationDoc: IngestedDoc = {
    manifest,
    text: tenderText,
  };

  const lotMetadata = await detectLotMetadata(tenderText, tenderTitle);

  return {
    tenderId,
    // Legacy data doesn't carry an explicit lane flag. Default to procurement
    // since 95%+ of paid orders are UN/IFI procurement; grant lanes will
    // override this via pipeline_items.opportunity_type in a later sprint.
    lane: "procurement",
    methodology: "cumulative",
    lotMetadata,
    docs: [solicitationDoc],
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
