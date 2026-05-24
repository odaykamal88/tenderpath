/**
 * readiness-engine.ts — Free Vendor Readiness Assessment engine.
 *
 * Sprint 5 scope. Top-of-funnel conversion tool: score an applicant against
 * the static UN-generic readiness rubric, route every gap to a paid SKU
 * via the shared gap-routing.ts module, package the whole thing into a
 * ReadinessOutput payload.
 *
 * Design decisions locked at Sprint 4.5:
 *   - Reuses ScoringEngine types (Claim, Provenance, ScoreResult,
 *     CriterionAssessment, RoutedGap) — same shape as the $299
 *     ProposalOutput, just produced deterministically. R2 from
 *     readiness-output-ux.md: don't fork the type system.
 *   - Imports gap-routing.ts UNCHANGED — the single-source-of-truth
 *     invariant Sprint 4 made true. Origin is 'readiness' so all 4 SKUs
 *     are open routes (no origin-exclusion).
 *   - Persists under proposal_packages with kind='readiness'
 *     discriminator (decision: reuse the table, no new DDL). Persistence
 *     wiring lands with Sprint 7 UI; Sprint 5 emits the typed payload.
 *
 * Determinstic. No LLM. Runs in milliseconds — that's what makes a free
 * top-of-funnel tool economically viable.
 *
 * Readiness bands:
 *   - high:   70-100 → ready for active bidding; primary CTA usually matching
 *   - medium: 40-69  → mixed posture; primary CTA usually roster
 *   - low:    0-39   → foundational fixes first; primary CTA roster
 */

import type {
  ScoreResult,
  LotScoreResult,
  CriterionAssessment,
  DraftSection,
  RoutedGap,
  ServiceSku,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import {
  routeAllGaps,
  rollupConfidenceFromClaims,
  countClaimsByProvenance,
  SERVICE_CATALOG,
} from "./gap-routing";
import {
  READINESS_CRITERIA,
  READINESS_LOT_ID,
  READINESS_RUBRIC_VERSION,
  READINESS_TENDER_ID,
} from "./readiness-rubric";

// ============================================================================
// Founder credibility — readiness-output-ux.md S4
// ============================================================================
//
// TenderPath's positioning asset: this isn't a generic readiness quiz, it
// uses the criteria a senior UN procurement evaluator actually applies.
// Lives on the output payload as STRUCTURED DATA (not a UI-only string)
// so the Sprint 7 screen can render it consistently with the rest of the
// payload and Sprint 8 evidence-carry-forward can read it for context.

export const FOUNDER_CREDIBILITY: ReadinessOutput["founderCredibility"] = {
  line: "Built by an ex-UN procurement officer with six years of senior experience at WFP (P4/P5 grades). The criteria below mirror the readiness check a UN evaluation panel applies before opening your bid.",
  yearsExperience: 6,
  agencies: ["WFP"],
  seniorityLevel: "P4/P5",
};

// ============================================================================
// ReadinessOutput — the public payload shape
// ============================================================================

export interface ReadinessOutput {
  kind: "readiness";
  /** Applicant context used for the run, captured for Sprint 8 carry-forward. */
  applicant: ApplicantContext;
  /** Same ScoreResult shape as the $299 output. Every gap is routed.
   *  This is what makes Sprint 7's UI implementation share components
   *  with Sprint 6's $299 screen — both consume ScoreResult + routedGaps. */
  score: ScoreResult;
  /** Top-level readiness summary the screen leads with. */
  summary: {
    /** One-line readiness verdict. */
    headline: string;
    /** 0-100 normalized total (sum of leaf criterion scores). */
    overallScore: number;
    /** Display band derived from overallScore. */
    band: "high" | "medium" | "low";
    /** Sprint 7 / readiness-output-ux.md S3: the SINGLE primary CTA the
     *  screen funnels every gap toward. Derived from routing distribution
     *  with priority tie-breaks. */
    primaryAction: ServiceSku;
    /** Why this action is the right one for this applicant's posture. */
    primaryActionRationale: string;
  };
  /** Sprint 7 / readiness-output-ux.md S4: founder-credibility line at the
   *  trust moment. Structured data, not a UI-only string. */
  founderCredibility: {
    line: string;
    yearsExperience: number;
    agencies: string[];
    seniorityLevel: string;
  };
  /** Static rubric version — bumps when criteria definitions change so
   *  cross-run comparisons can detect rubric drift. */
  rubricVersion: number;
  /** Stable id for the rubric run — used by persist.ts to dedupe. */
  rubricId: string;
}

// ============================================================================
// Public API — single entry point
// ============================================================================

/**
 * Score an applicant against the static readiness rubric and emit a
 * ReadinessOutput. Pure function. No I/O. No LLM. ~50ms.
 */
export function scoreReadiness(applicant: ApplicantContext): ReadinessOutput {
  // Step 1: deterministic per-criterion scoring via the rubric's score functions.
  // We iterate READINESS_CRITERIA directly; callers that need the full
  // TenderRubric shape (e.g. a generic-engine integration) can import
  // buildReadinessRubric from readiness-rubric.ts separately.
  // Each emits a synthetic DraftSection (with claims that flow into mechanical
  // confidence rollup) and a CriterionAssessment-shaped result.
  const draft: DraftSection[] = [];
  const perCriterion: CriterionAssessment[] = [];

  for (const def of READINESS_CRITERIA) {
    const result = def.score(applicant);

    // Synthetic DraftSection — the readiness engine doesn't generate prose,
    // but emitting a DraftSection lets gap-routing.routeAllGaps process
    // claim-level gaps unchanged.
    const section: DraftSection = {
      lotId: READINESS_LOT_ID,
      criterionId: def.criterion.id,
      content: `Readiness assessment for ${def.criterion.label}.`,
      claims: result.claims,
    };
    draft.push(section);

    perCriterion.push({
      criterionId: def.criterion.id,
      estimatedScore: result.estimatedScore,
      maxScore: def.criterion.maxScore,
      confidence: result.confidence,
      // Sprint 4 (A4): mechanicalConfidence rolled up from the claims this
      // criterion emitted. For readiness this typically matches the LLM-
      // judged confidence (because the same scoring function produces both).
      mechanicalConfidence: rollupConfidenceFromClaims(result.claims),
      claimCount: result.claims.length,
      claimsByProvenance: countClaimsByProvenance(result.claims),
      weaknesses: result.weaknesses,
      missingEvidence: result.missingEvidence,
    });
  }

  const estimatedTotal = perCriterion.reduce((s, c) => s + c.estimatedScore, 0);
  const achievableTotal = perCriterion.reduce((s, c) => s + c.maxScore, 0);

  const lotResults: LotScoreResult[] = [
    {
      lotId: READINESS_LOT_ID,
      perCriterion,
      estimatedTotal,
      lotDisqualifiersTriggered: [],
      // Readiness has no gating threshold; everything "passes" — the score
      // and gaps are the substance.
      passesGating: true,
    },
  ];

  // Step 2: route every gap via the shared module. Origin is 'readiness' so
  // all 4 SKUs are open routes (no origin-exclusion).
  const partialScore: ScoreResult = {
    rubricVersion: READINESS_RUBRIC_VERSION,
    lotResults,
    noticeWideDisqualifiersTriggered: [],
    routedGaps: [],
  };
  const routedGaps = routeAllGaps(partialScore, { originSku: "readiness" }, draft);
  const score: ScoreResult = { ...partialScore, routedGaps };

  // Step 3: build the top-level summary — band, primary CTA, headline.
  const summary = buildSummary(applicant, estimatedTotal, achievableTotal, routedGaps);

  return {
    kind: "readiness",
    applicant,
    score,
    summary,
    founderCredibility: FOUNDER_CREDIBILITY,
    rubricVersion: READINESS_RUBRIC_VERSION,
    rubricId: READINESS_TENDER_ID,
  };
}

// ============================================================================
// Summary builders
// ============================================================================

function buildSummary(
  applicant: ApplicantContext,
  estimatedTotal: number,
  achievableTotal: number,
  routedGaps: RoutedGap[],
): ReadinessOutput["summary"] {
  // Normalize to a 0-100 scale. The rubric already sums to 100, so this is
  // a no-op for the default rubric — but written defensively in case the
  // rubric expands.
  const overallScore = achievableTotal > 0 ? Math.round((estimatedTotal / achievableTotal) * 100) : 0;

  const band: "high" | "medium" | "low" =
    overallScore >= 70 ? "high" : overallScore >= 40 ? "medium" : "low";

  const primaryAction = pickPrimaryAction(routedGaps, band);
  const primaryActionRationale = buildActionRationale(primaryAction, band, applicant);
  const headline = buildHeadline(applicant.companyName, overallScore, band);

  return { headline, overallScore, band, primaryAction, primaryActionRationale };
}

function pickPrimaryAction(
  routedGaps: RoutedGap[],
  band: "high" | "medium" | "low",
): ServiceSku {
  // BAND-DRIVEN primary CTA. This is "what does this applicant most need"
  // not "which SKU shows up most often in the routing distribution".
  //
  // - low band:    foundational fixes — roster posture is the right
  //                next step regardless of which specific gaps surfaced.
  // - high band:   already ready — matching surfaces tender flow.
  // - medium:      ambiguous; fall back to routing distribution.
  //
  // Sprint 5 audit caught the original count-driven picker: a WEAK
  // applicant whose 12 fallback gaps all routed to matching had matching
  // win over the 6 roster gaps, which inverted the actual recommendation.
  if (band === "low") return "roster";
  if (band === "high") return "matching";

  // medium band: use routing distribution to pick the dominant SKU.
  const counts = new Map<ServiceSku, number>();
  for (const g of routedGaps) counts.set(g.routedTo, (counts.get(g.routedTo) ?? 0) + 1);
  if (counts.size === 0) return "matching";
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

function buildActionRationale(
  action: ServiceSku,
  band: "high" | "medium" | "low",
  applicant: ApplicantContext,
): string {
  const meta = SERVICE_CATALOG[action];
  switch (action) {
    case "roster":
      return band === "low"
        ? `Foundational readiness gaps in ${applicant.companyName}'s posture (UNGM, financial documentation, past performance shape) need to land before active bidding pays off. ${meta.label} is the highest-leverage next step.`
        : `Several readiness fixes will compound across every future UN bid. ${meta.label} packages them into one structured engagement.`;
    case "matching":
      return band === "high"
        ? `${applicant.companyName} is already in good shape for UN procurement. The next-highest-leverage step is finding tenders that fit your strongest evidence — that's what ${meta.label} does.`
        : `Tender selection matters more than tender response: ${meta.label} surfaces opportunities where your existing evidence already scores well.`;
    case "bid_no_bid":
      return `Catch admin gates and fit issues before committing a $299 draft. ${meta.label} runs a per-tender analysis against your evidence.`;
    case "proposal_draft":
      return `Strong response-writing on a fit tender is the conversion: ${meta.label} produces a rubric-aligned draft.`;
  }
}

function buildHeadline(companyName: string, overallScore: number, band: "high" | "medium" | "low"): string {
  switch (band) {
    case "high":
      return `${companyName} is high-readiness for UN procurement (${overallScore}/100). Ready to bid on the right tenders.`;
    case "medium":
      return `${companyName} has mixed UN procurement readiness (${overallScore}/100). A few targeted fixes unlock more agency surface.`;
    case "low":
      return `${companyName} is early-stage for UN procurement (${overallScore}/100). Foundational steps first; the gaps below show the path.`;
  }
}
