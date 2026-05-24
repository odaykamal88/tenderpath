/**
 * gap-routing.ts — the SINGLE shared module that turns gaps into paid actions.
 *
 * Sprint 4 scope. Built once here, used by BOTH:
 *   - the $299 Proposal Draft output (rubric-scorer.ts attaches
 *     ScoreResult.routedGaps via routeAllGaps below)
 *   - the Sprint 5 free Vendor Readiness Assessment engine (imports the
 *     same routeCriterionWeakness + routeDisqualifier unchanged)
 *
 * Per proposal-output-ux.md A3 + readiness-output-ux.md R1: a gap without
 * a routed service is NOT done. The routing target is the conversion
 * mechanism for both surfaces. Forking this logic across the two
 * surfaces is the named anti-pattern.
 *
 * Design:
 *   - Pure functions. No LLM. No I/O. Deterministic.
 *   - Rule table (ROUTING_RULES) is debuggable in 30 lines and editable
 *     without changing the routing API.
 *   - Origin-exclusion: routing never recommends the SKU the user is
 *     already inside (no "buy Proposal Draft" CTAs on a Proposal Draft).
 *
 * Routing taxonomy (the four paid SKUs):
 *   - bid_no_bid       ($39)   — analyze a SPECIFIC tender before committing
 *   - matching         ($49/mo)— ongoing tender discovery
 *   - proposal_draft   ($299)  — write a strong response (this sprint's product)
 *   - roster           ($749)  — UN supplier registration + LTA prep (long arc)
 */

import type {
  Claim,
  Confidence,
  Disqualifier,
  DisqualifierKind,
  ProvenanceKind,
  RoutedGap,
  RoutingContext,
  ScoreResult,
  ServiceSku,
  SourceRef,
} from "./scoring-engine";

// ============================================================================
// Service catalog — the canonical SKU metadata
// ============================================================================

export interface ServiceMeta {
  sku: ServiceSku;
  label: string;
  price: string; // display string; the actual price lives in pricing config
  ctaCopy: string;
}

export const SERVICE_CATALOG: Record<ServiceSku, ServiceMeta> = {
  bid_no_bid: {
    sku: "bid_no_bid",
    label: "Bid/No-Bid Analyst",
    price: "$39",
    ctaCopy: "Run Bid/No-Bid Analysis ($39)",
  },
  matching: {
    sku: "matching",
    label: "Matching Subscription",
    price: "$49/mo",
    ctaCopy: "Start Tender Matching ($49/mo)",
  },
  proposal_draft: {
    sku: "proposal_draft",
    label: "Proposal Draft",
    price: "$299",
    ctaCopy: "Order Proposal Draft ($299)",
  },
  roster: {
    sku: "roster",
    label: "Roster Fast-Track",
    price: "$749",
    ctaCopy: "Start Roster Fast-Track ($749)",
  },
};

// ============================================================================
// Routing rules — debuggable rule table for criterion-level gap text
// ============================================================================

interface RoutingRule {
  /** Stable id for telemetry / debugging. */
  id: string;
  /** Any pattern match wins. Order matters — earlier rules take precedence. */
  patterns: RegExp[];
  to: ServiceSku;
  /** One short sentence — why this SKU closes this kind of gap. */
  rationale: string;
}

export const ROUTING_RULES: RoutingRule[] = [
  {
    id: "roster_registration",
    patterns: [
      /\bungm\b/i,
      /supplier registration/i,
      /\blta\b/i,
      /long.?term agreement/i,
      /pre.?qualif/i,
      /vendor registration/i,
      /not.*on.*roster/i,
    ],
    to: "roster",
    rationale:
      "Roster Fast-Track gets your UN supplier registration and LTA posture set up so this stops being a gap on every future bid.",
  },
  {
    id: "past_performance",
    patterns: [
      /past performance/i,
      /reference contract/i,
      /track record/i,
      /prior contract/i,
      /similar project/i,
      /\bp45\b|\bp4\/p5\b/i,
      /demonstrated experience/i,
      /\bproject (register|log|history)\b/i,
      /\bproject (engagement|registry)\b/i,
      /predating.*\d{4}/i, // "predating 2022" — Sprint 4.5: UN evaluators ask for older references
      /continuity across.*period/i,
    ],
    to: "roster",
    rationale:
      "Roster Fast-Track structures your UN past-performance posture so future bids cite the right contracts the way evaluators want to see them.",
  },
  // Sprint 4.5: financial capacity is one of the most-asked-for evidence
  // categories on UN tenders. Audited statements, bank refs, credit lines,
  // financial stability — all roster-readiness fixes.
  {
    id: "financial_capacity",
    patterns: [
      /audited.*financial/i,
      /financial statement/i,
      /balance sheet/i,
      /annual report/i,
      /financial capacity/i,
      /financial stability/i,
      /bank reference/i,
      /credit (facility|line)/i,
      /turnover/i,
      /\baudit\b/i,
      /fiscal year/i,
    ],
    to: "roster",
    rationale:
      "Roster Fast-Track builds the financial documentation pack (audited statements, bank references, credit lines) UN evaluators need to clear the financial capacity gate.",
  },
  // Sprint 4.5: organizational capacity — facilities, workshops, infrastructure,
  // staffing depth, org charts. These are systemic readiness gaps, not bid-
  // specific ones, so they route to Roster.
  {
    id: "organizational_capacity",
    patterns: [
      /facility (description|inventory|address)/i,
      /facilities/i,
      /workshop/i,
      /office (location|address)/i,
      /physical (presence|infrastructure)/i,
      /organis(at)?ional chart/i,
      /staffing (depth|complement|register)/i,
      /headcount/i,
      /personnel complement/i,
      /staff (depth|register|roster)/i,
      /\b(field|junior|senior) technicians?\b/i, // Sprint 4.5b
      /infrastructure/i,
      /incorporation (certificate|document|date)/i, // Sprint 4.5b: catches "incorporation date"
      /registration certificate/i, // Sprint 4.5b: company registration
      /\bestablish(ed|ment) (date|year|in)/i, // Sprint 4.5b
    ],
    to: "roster",
    rationale:
      "Roster Fast-Track captures the organizational-capacity evidence (facilities, staffing depth, org chart, incorporation) UN evaluators expect alongside past performance.",
  },
  // Sprint 4.5b: partnership documentation — named partners, MoUs, sub-contracts.
  // UN evaluators ask for partnership evidence to back regional coverage claims;
  // when missing, it's a Roster-readiness gap.
  {
    id: "partnership_documentation",
    patterns: [
      /partner (agreement|contract)/i,
      /\bmou\b|memorandum of understanding/i,
      /sub.?contract/i,
      /named partner/i,
      /partnership (agreement|evidence|documentation)/i,
      /\bteaming agreement\b/i,
    ],
    to: "roster",
    rationale:
      "Roster Fast-Track structures the partnership evidence (MoUs, sub-contracts, named partner agreements) UN evaluators expect when you claim regional coverage you don't directly own.",
  },
  // Sprint 4.5b: geographic / regional coverage gaps — when the gap is "you
  // can't credibly serve region X", the answer is to bid where you CAN credibly
  // serve. Matching is the right close.
  {
    id: "geographic_coverage",
    patterns: [
      /\b(field|regional|geographic) (presence|coverage|reach|capacity)\b/i,
      /standing field presence/i,
      /mobilisation timeline/i,
      /response capacity for/i,
      /non.?resident region/i,
      /serve (more|additional) countries/i,
      /\bcountry coverage\b/i,
    ],
    to: "matching",
    rationale:
      "Matching surfaces tenders where your existing geographic footprint is the right fit, rather than stretching to claim coverage you can't credibly support.",
  },
  {
    id: "spec_mismatch",
    patterns: [
      /specification/i,
      /technical compl/i,
      /\b(en|astm|iso|bs\s*en)\s*\d/i,
      /spec.*mismatch/i,
      /standard.*required/i,
      /technical.*gap/i,
      /capability.*mismatch/i,
    ],
    to: "matching",
    rationale:
      "Matching surfaces tenders where your existing capability already meets the spec — easier than stretching to fit this one.",
  },
  {
    id: "mandatory_form",
    patterns: [
      /mandatory.*form/i,
      /financial proposal.*separate/i,
      /submission deadline/i,
      /signature/i,
      /original copy/i,
      /required.*template/i,
      /missing.*form/i,
    ],
    to: "bid_no_bid",
    rationale:
      "Bid/No-Bid analysis catches missing forms and admin gates BEFORE a draft is committed.",
  },
  {
    id: "eligibility",
    patterns: [
      /\beligib/i,
      /country of registration/i,
      /geographic.*restrict/i,
      /sector.*restrict/i,
      /consortium/i,
      /nationality/i,
      /local.*partner/i,
    ],
    to: "matching",
    rationale:
      "Matching surfaces tenders where you are already eligible — solves this by selection rather than by submission.",
  },
  // Sprint 4.5: personnel / CV / qualifications — drafting concern.
  // The Proposal Draft service is the right close: stronger personnel
  // sections with CVs and qualifications mapped to rubric language.
  {
    id: "personnel",
    patterns: [
      /\bcvs?\b/i, // Sprint 4.5b: catch "CV" + "CVs"
      /curriculum vitae/i,
      /key personnel/i,
      /qualifications? (of|missing|are|with|including)?/i,
      /academic qualifications/i,
      /professional registration/i,
      /personnel (depth|details|profile)/i,
      /staff cv/i,
      /resume/i,
      /\bbio(graph)?\b/i,
      /individual cvs/i,
    ],
    to: "proposal_draft",
    rationale:
      "A Proposal Draft service builds the personnel section with rubric-aligned CVs and qualifications evaluators score on.",
  },
  // Sprint 4.5b: methodology / scope articulation — when the gap is "the
  // draft doesn't explain HOW you do it", the answer is a stronger Proposal
  // Draft. Catches case studies, diagnostic processes, scope conflations.
  {
    id: "methodology",
    patterns: [
      /methodology/i,
      /case stud(y|ies)/i,
      /diagnostic process/i,
      /assessment (process|methodology)/i,
      /draft (conflates|fails to|does not (describe|specify|explain))/i,
      /scope (conflict|conflation|mismatch)/i,
      /no standalone narrative/i,
      /\bplant types\b/i, // UNICEF-specific: "plant types not specified"
    ],
    to: "proposal_draft",
    rationale:
      "A Proposal Draft service rebuilds the methodology / approach sections with rubric-aligned narrative that surfaces evidence evaluators score on.",
  },
  // Sprint 4.5b: manufacturer / OEM authorisation — vendors claim authorisation
  // but rarely attach the letters. The Proposal Draft service writes the
  // section AND prompts for the attachments.
  {
    id: "manufacturer_authorisation",
    patterns: [
      /\boem (auth|certif)/i,
      /manufacturer (auth|certif)/i,
      /authoris(ed|ation) (letter|certif)/i,
      /(airsep|novair|atlas copco|caterpillar|cummins)/i, // common UNICEF biomedical OEMs
    ],
    to: "proposal_draft",
    rationale:
      "A Proposal Draft service builds the manufacturer-authorisation evidence package (letters, certificates, OEM relationship narrative) UN evaluators expect cited inline.",
  },
  {
    id: "presentation",
    patterns: [
      /presentation/i,
      /articulat/i,
      /narrative.*weak/i,
      /structure.*proposal/i,
      /poorly.*organi[sz]ed/i,
      /writing.*quality/i,
      /quality control process/i,
      /submission quality/i,
      /standalone narrative/i,
      /composite score derived/i, // Sprint 4.5: the LLM's own pet phrase for "I rolled this up"
    ],
    to: "proposal_draft",
    rationale:
      "A Proposal Draft service rebuilds the weak sections with rubric-aligned framing.",
  },
];

// ============================================================================
// DisqualifierKind direct lookup — disqualifiers route by KIND, not regex
// ============================================================================

const DISQ_KIND_TO_SKU: Record<DisqualifierKind, { to: ServiceSku; rationale: string; ruleId: string }> = {
  mandatory_form: {
    to: "bid_no_bid",
    rationale:
      "Bid/No-Bid analysis flags mandatory-form gaps before the bid is committed; this is exactly what the $39 service catches.",
    ruleId: "disq_mandatory_form",
  },
  eligibility: {
    to: "matching",
    rationale:
      "An eligibility breach means this tender was the wrong fit. Matching finds tenders where your country/sector/partnership posture is already eligible.",
    ruleId: "disq_eligibility",
  },
  format: {
    to: "bid_no_bid",
    rationale:
      "Format/technical-spec breaches (page limits, file format, units, standards) are exactly what Bid/No-Bid analysis catches before submission.",
    ruleId: "disq_format",
  },
  deadline: {
    to: "matching",
    rationale:
      "Matching surfaces tenders with deadlines you can realistically hit, with reminders before the cutoff.",
    ruleId: "disq_deadline",
  },
  financial: {
    to: "bid_no_bid",
    rationale:
      "Financial-form and price-strategy issues are exactly what Bid/No-Bid analysis tests against the call's financial methodology.",
    ruleId: "disq_financial",
  },
};

// ============================================================================
// Origin-exclusion — never recommend the SKU the user is already inside
// ============================================================================

const FALLBACK_CHAIN: Record<ServiceSku, ServiceSku> = {
  proposal_draft: "matching",
  matching: "bid_no_bid",
  bid_no_bid: "matching",
  roster: "matching",
};

const FALLBACK_RATIONALE: Record<ServiceSku, string> = {
  matching:
    "Matching surfaces better-fit tenders so the same gap doesn't recur on the next bid.",
  bid_no_bid:
    "Bid/No-Bid analysis catches this kind of gap before the next draft is committed.",
  proposal_draft:
    "A Proposal Draft service rebuilds the section with rubric-aligned framing.",
  roster:
    "Roster Fast-Track addresses systemic readiness so this stops being a recurring gap.",
};

function applyOriginExclusion(
  candidate: ServiceSku,
  context: RoutingContext,
): ServiceSku {
  if (context.originSku === "readiness") return candidate; // free funnel can recommend any SKU
  if (candidate !== context.originSku) return candidate;
  return FALLBACK_CHAIN[context.originSku];
}

// ============================================================================
// Public API — three entry points
// ============================================================================

/** Route a free-text criterion-level gap (weakness / missingEvidence / claim.note). */
export function routeCriterionWeakness(
  text: string,
  context: RoutingContext,
  opts: {
    lotId?: string;
    criterionId?: string;
    kind?: RoutedGap["kind"];
  } = {},
): RoutedGap {
  const lower = (text ?? "").toLowerCase();
  for (const rule of ROUTING_RULES) {
    if (rule.patterns.some((rx) => rx.test(lower))) {
      const to = applyOriginExclusion(rule.to, context);
      const rationale =
        to === rule.to ? rule.rationale : FALLBACK_RATIONALE[to];
      return {
        text,
        kind: opts.kind ?? "weakness",
        lotId: opts.lotId,
        criterionId: opts.criterionId,
        routedTo: to,
        rationale,
        ctaCopy: SERVICE_CATALOG[to].ctaCopy,
        ruleId: rule.id,
      };
    }
  }
  // No rule matched → fallback per origin
  const to = applyOriginExclusion("proposal_draft", context);
  return {
    text,
    kind: opts.kind ?? "weakness",
    lotId: opts.lotId,
    criterionId: opts.criterionId,
    routedTo: to,
    rationale: FALLBACK_RATIONALE[to],
    ctaCopy: SERVICE_CATALOG[to].ctaCopy,
    ruleId: "fallback",
  };
}

/** Route a triggered Disqualifier. Disqualifiers route by KIND, not regex. */
export function routeDisqualifier(
  disq: Disqualifier,
  context: RoutingContext,
  opts: { lotId?: string } = {},
): RoutedGap {
  const lookup = DISQ_KIND_TO_SKU[disq.kind];
  const to = applyOriginExclusion(lookup.to, context);
  const rationale = to === lookup.to ? lookup.rationale : FALLBACK_RATIONALE[to];
  return {
    text: disq.rule,
    kind: "disqualifier",
    lotId: opts.lotId,
    routedTo: to,
    rationale,
    ctaCopy: SERVICE_CATALOG[to].ctaCopy,
    sourceRef: disq.source,
    ruleId: lookup.ruleId,
  };
}

/**
 * Orchestrator: walk a ScoreResult + the draft that produced it, emit one
 * RoutedGap per surfaced gap. Iteration order is stable (lot order →
 * criterion order → weakness, then missingEvidence, then disqualifiers →
 * notice-wide disqualifiers last).
 */
export function routeAllGaps(
  score: ScoreResult,
  context: RoutingContext,
  draft?: Array<{
    lotId?: string;
    criterionId: string;
    claims: Claim[];
  }>,
): RoutedGap[] {
  const out: RoutedGap[] = [];

  // 1. Per-criterion weaknesses + missingEvidence
  for (const lot of score.lotResults) {
    for (const c of lot.perCriterion) {
      for (const w of c.weaknesses) {
        out.push(
          routeCriterionWeakness(w, context, {
            lotId: lot.lotId,
            criterionId: c.criterionId,
            kind: "weakness",
          }),
        );
      }
      for (const m of c.missingEvidence) {
        out.push(
          routeCriterionWeakness(m, context, {
            lotId: lot.lotId,
            criterionId: c.criterionId,
            kind: "missing_evidence",
          }),
        );
      }
    }
    // 2. Lot-scoped triggered disqualifiers
    for (const d of lot.lotDisqualifiersTriggered) {
      out.push(routeDisqualifier(d, context, { lotId: lot.lotId }));
    }
  }

  // 3. Notice-wide disqualifiers — no lotId; affect every lot
  for (const d of score.noticeWideDisqualifiersTriggered) {
    out.push(routeDisqualifier(d, context));
  }

  // 4. Claim-level gaps (proposal-output-ux.md A3: "every gap-provenance claim")
  if (draft) {
    for (const section of draft) {
      for (const cl of section.claims) {
        if (cl.provenance.kind !== "gap") continue;
        const text = cl.provenance.note || cl.text;
        out.push(
          routeCriterionWeakness(text, context, {
            lotId: section.lotId,
            criterionId: section.criterionId,
            kind: "claim_gap",
          }),
        );
      }
    }
  }

  return out;
}

// ============================================================================
// Confidence helpers (proposal-output-ux.md A4 — presentable at claim level too)
// ============================================================================

/**
 * Map a single claim's ProvenanceKind onto the 4-way Confidence taxonomy the
 * UI renders. The Confidence vocabulary is intentionally smaller than
 * Provenance — the UI doesn't distinguish "from tender doc" vs "from
 * applicant library" (both are "evidenced") at the claim badge level.
 */
export function provenanceToConfidence(kind: ProvenanceKind): Confidence {
  switch (kind) {
    case "applicant_library":
    case "uploaded_document":
      return "evidenced";
    case "inferred":
      return "inferred";
    case "gap":
      return "gap";
    default:
      return "unverified";
  }
}

/**
 * Roll a list of claims up to one criterion-level Confidence. Mechanical;
 * runs alongside the LLM-judged confidence from rubric-scorer. The two can
 * agree (high trust) or disagree (signal worth surfacing in the UI).
 *
 * Rule (in priority order):
 *   - empty claims → "unverified"
 *   - any "applicant_library" or "uploaded_document" present → "evidenced"
 *   - else any "inferred" present → "inferred"
 *   - else any "gap" present → "gap"
 *   - else → "unverified"
 *
 * Why "evidenced" wins over "gap" when both are present: a criterion with
 * both grounded claims AND surfaced gaps is BETTER than one with only
 * gaps. The UI shows the gaps separately (routed); the criterion-level
 * confidence reflects the strongest evidence backing it.
 */
export function rollupConfidenceFromClaims(claims: Claim[]): Confidence {
  if (!claims || claims.length === 0) return "unverified";
  const kinds = new Set(claims.map((c) => c.provenance.kind));
  if (kinds.has("applicant_library") || kinds.has("uploaded_document")) return "evidenced";
  if (kinds.has("inferred")) return "inferred";
  if (kinds.has("gap")) return "gap";
  return "unverified";
}

/**
 * Count claims by provenance kind. UI uses this for the "5 evidenced / 2
 * inferred / 1 gap" subline under each criterion score.
 */
export function countClaimsByProvenance(
  claims: Claim[],
): Partial<Record<ProvenanceKind, number>> {
  const out: Partial<Record<ProvenanceKind, number>> = {};
  for (const c of claims) {
    const k = c.provenance.kind;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// ============================================================================
// Sprint 4.5: leaf-only filtering for parent/child rubric structures
// ============================================================================
//
// UN evaluation rubrics commonly have a hierarchical structure: a parent
// criterion (e.g. "1 — Profile of institution", max 50) that rolls up
// children (1.1, 1.2, 1.3, 1.4 — summing to 50). Points are awarded ONLY
// at the leaves; the parent's max is the structural total of its children.
//
// The rubric extractor faithfully captures both levels (it should — the
// rubric is the contract). But scoring + totals should run on LEAVES ONLY,
// otherwise we double-count. Same for gap routing: a parent's "weakness"
// is structurally the sum of its children's weaknesses; surfacing both
// produces duplicate gaps.
//
// A criterion is a PARENT iff any other criterion's id starts with
// "<thisId>." — i.e. the dot-numbering convention UN rubrics universally
// use ("1.1" is a child of "1", "2.2a" is a child of "2"). Single-level
// rubrics naturally have zero parents; the filter is a no-op.

interface CriterionLike {
  id: string;
}

/**
 * Return only the LEAF criteria from a flat list. A criterion is a leaf
 * when no other criterion's id is a dot-prefixed continuation of its id.
 *
 * Pure function. Stable order (preserves input order). Single-level rubrics
 * (no dot ids) pass through unchanged.
 */
export function getLeafCriteria<T extends CriterionLike>(criteria: T[]): T[] {
  const ids = criteria.map((c) => c.id);
  return criteria.filter((c) => !ids.some((other) => other !== c.id && other.startsWith(c.id + ".")));
}

/** Predicate form for selective filtering of CriterionAssessment lists. */
export function isLeafCriterionId(id: string, allIds: string[]): boolean {
  return !allIds.some((other) => other !== id && other.startsWith(id + "."));
}

// Re-export SourceRef so callers can `import { SourceRef } from "./gap-routing"`
// without crossing back into scoring-engine. Keeps the surface tight.
export type { SourceRef };
