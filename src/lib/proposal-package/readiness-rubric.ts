/**
 * readiness-rubric.ts — static UN-generic readiness rubric.
 *
 * Sprint 5 scope. The FREE Vendor Readiness Assessment scores a vendor
 * against GENERIC UN procurement readiness criteria (not a specific
 * tender's rubric). The rubric is hand-authored here as a TypeScript
 * constant; no extractor needed.
 *
 * Eight dimensions, max 100 points total, calibrated against the
 * UN Supplier Manual + UNGM portal expectations + WFP P5 evaluator
 * heuristics (the founder credibility line in readiness-output-ux.md
 * S4 — six years senior UN procurement at WFP).
 *
 * Each criterion exports:
 *   - the EvaluationCriterion (consumed by the readiness-engine via the
 *     same TenderRubric shape the $299 engine uses → gap-routing.ts
 *     imports unchanged, per the single-source-of-truth invariant from
 *     Sprint 4)
 *   - a `score` function: (applicant) → { estimatedScore, confidence,
 *     weaknesses, missingEvidence, claims } that emits a synthetic
 *     DraftSection's worth of structured assessment for the criterion.
 *
 * Determinstic. No LLM. The whole engine runs in ~50ms for a single
 * applicant — that's what makes this a viable top-of-funnel free tool.
 */

import type {
  EvaluationCriterion,
  Claim,
  Confidence,
  Disqualifier,
  TenderRubric,
  LotRubric,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";

export const READINESS_RUBRIC_VERSION = 1;
export const READINESS_TENDER_ID = "tenderpath-un-readiness-v1";
export const READINESS_LOT_ID = "main";

export interface ReadinessCriterionScore {
  estimatedScore: number;
  confidence: Confidence;
  weaknesses: string[];
  missingEvidence: string[];
  /** Synthetic claims with provenance — flows into DraftSection.claims so
   *  scorer's mechanicalConfidence rollup + gap-routing work unchanged. */
  claims: Claim[];
}

interface ReadinessCriterionDef {
  criterion: EvaluationCriterion;
  score: (applicant: ApplicantContext) => ReadinessCriterionScore;
}

// ============================================================================
// Per-criterion scoring rules — deterministic, debuggable, no LLM
// ============================================================================

const SOURCE_REF = { docId: "tenderpath-readiness-rubric-v1", section: "TenderPath readiness rubric", rubricVersion: READINESS_RUBRIC_VERSION };

/** R1. UNGM Registration (max 15) */
const R1_UNGM: ReadinessCriterionDef = {
  criterion: {
    id: "ungm",
    label: "UNGM supplier registration",
    weight: 0.15,
    maxScore: 15,
    source: SOURCE_REF,
  },
  score: (a) => {
    const reg = a.unSupplierRegistration;
    const hasUngm = !!reg?.agencies?.some((x) => x.toLowerCase().includes("ungm"));
    const hasVendorNum = !!reg?.vendorNumber;
    if (hasUngm && hasVendorNum) {
      return {
        estimatedScore: 15,
        confidence: "evidenced",
        weaknesses: [],
        missingEvidence: [],
        claims: [
          {
            text: `Registered on UNGM as vendor ${reg.vendorNumber}`,
            provenance: { kind: "applicant_library" },
          },
        ],
      };
    }
    if (reg && (reg.vendorNumber || (reg.agencies?.length ?? 0) > 0)) {
      // Some UN registration but UNGM specifically not confirmed
      return {
        estimatedScore: 8,
        confidence: "inferred",
        weaknesses: ["UN supplier presence indicated but UNGM registration not confirmed in applicant evidence"],
        missingEvidence: ["UNGM vendor number with active status"],
        claims: [
          {
            text: `Some UN supplier registration history (${reg.agencies?.join(", ") ?? "agencies unspecified"}) but UNGM-specific entry not confirmed`,
            provenance: { kind: "inferred", note: "agencies listed but UNGM presence not explicitly stated" },
          },
        ],
      };
    }
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No UNGM supplier registration on file"],
      missingEvidence: ["UNGM vendor registration is the gating prerequisite for almost every UN-agency bid"],
      claims: [
        {
          text: "Applicant is not registered on UNGM",
          provenance: { kind: "gap", note: "no UNGM vendor number in applicant evidence" },
        },
      ],
    };
  },
};

/** R2. Years of UN-relevant operation (max 10) */
const R2_YEARS: ReadinessCriterionDef = {
  criterion: {
    id: "years",
    label: "Years of relevant operation",
    weight: 0.1,
    maxScore: 10,
    source: SOURCE_REF,
  },
  score: (a) => {
    const y = a.yearsOfExperience ?? 0;
    if (y >= 10) return mkScore(10, "evidenced", a, `${y} years of relevant operation (>10 years threshold met)`, []);
    if (y >= 6) return mkScore(8, "evidenced", a, `${y} years of relevant operation`, ["Continuous-operation evidence for years 6-10 strengthens this criterion"]);
    if (y >= 3) return mkScore(5, "inferred", a, `${y} years of operation`, ["UN evaluators prefer 5+ years of relevant experience for LTAs"]);
    if (y >= 1) return mkScore(2, "inferred", a, `${y} years of operation`, ["Limited operating history; most UN tenders require 3+ years minimum"]);
    return mkScore(0, "gap", a, "Operating history not stated or under 1 year", ["UN procurement typically requires demonstrated operating history with documented past performance"]);
  },
};

/** R3. UN Agency Past Performance (max 20) */
const R3_AGENCIES: ReadinessCriterionDef = {
  criterion: {
    id: "agencies",
    label: "UN agency past performance breadth",
    weight: 0.2,
    maxScore: 20,
    source: SOURCE_REF,
  },
  score: (a) => {
    const past = a.pastPerformance ?? [];
    const unClients = past.filter((p) => /\b(un|unicef|undp|unhcr|unops|who|wfp|unicrc|iaea|ungm)\b/i.test(p.client));
    const uniqueAgencies = new Set(unClients.map((p) => p.client.replace(/[^a-zA-Z]/g, "").toLowerCase()));
    const count = uniqueAgencies.size;
    if (count >= 4) {
      return {
        estimatedScore: 20,
        confidence: "evidenced",
        weaknesses: [],
        missingEvidence: [],
        claims: unClients.slice(0, 6).map((p) => ({
          text: `Past performance with ${p.client} — ${p.project} (${p.year})`,
          provenance: { kind: "applicant_library" as const },
        })),
      };
    }
    if (count >= 2) {
      return {
        estimatedScore: 14,
        confidence: "evidenced",
        weaknesses: [`Past performance covers ${count} UN agencies; LTA-tier readiness expects 4+`],
        missingEvidence: ["Additional UN agency engagements (UNDP, UNHCR, WHO, WFP, UNOPS) to broaden the past-performance footprint"],
        claims: unClients.slice(0, 4).map((p) => ({
          text: `Past performance with ${p.client} — ${p.project} (${p.year})`,
          provenance: { kind: "applicant_library" as const },
        })),
      };
    }
    if (count === 1) {
      return {
        estimatedScore: 5,
        confidence: "inferred",
        weaknesses: ["Single UN agency in past performance — bidders typically need 2+ for credibility"],
        missingEvidence: ["Past performance with at least one additional UN agency"],
        claims: unClients.map((p) => ({
          text: `Single UN engagement: ${p.client} — ${p.project} (${p.year})`,
          provenance: { kind: "applicant_library" as const, note: "single UN agency — limited breadth" },
        })),
      };
    }
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No UN agency past performance documented"],
      missingEvidence: ["Any documented contract or LTA with a UN agency (UNICEF, UNDP, UNHCR, WHO, WFP, UNOPS, IOM, FAO, etc.)"],
      claims: [
        {
          text: "No UN agency in past-performance record",
          provenance: { kind: "gap", note: "applicant past-performance list contains no UN clients" },
        },
      ],
    };
  },
};

/** R4. Past Contract Value Demonstrated (max 15) */
const R4_VALUE: ReadinessCriterionDef = {
  criterion: {
    id: "value",
    label: "Past contract value demonstrated",
    weight: 0.15,
    maxScore: 15,
    source: SOURCE_REF,
  },
  score: (a) => {
    const past = a.pastPerformance ?? [];
    const total = past.reduce((s, p) => s + parseUSD(p.value), 0);
    if (total >= 2_000_000) return mkValueScore(15, "evidenced", total, a, []);
    if (total >= 500_000) return mkValueScore(11, "evidenced", total, a, ["Higher-tier UN LTAs typically expect USD 2M+ demonstrated contract throughput"]);
    if (total >= 100_000) return mkValueScore(6, "inferred", total, a, ["UN evaluators expect demonstrated throughput at the value range of the tender being bid"]);
    if (total > 0) return mkValueScore(2, "inferred", total, a, ["Low demonstrated contract value (<USD 100k) suggests small-engagement experience only"]);
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No past contract values documented"],
      missingEvidence: ["Contract values (USD) on past-performance entries — UN evaluators use these to size the bid against demonstrated capacity"],
      claims: [
        {
          text: "Past contract values not documented",
          provenance: { kind: "gap", note: "value field missing from past-performance records" },
        },
      ],
    };
  },
};

/** R5. Sector Coverage Depth (max 10) */
const R5_SECTORS: ReadinessCriterionDef = {
  criterion: {
    id: "sectors",
    label: "Sector coverage depth",
    weight: 0.1,
    maxScore: 10,
    source: SOURCE_REF,
  },
  score: (a) => {
    const n = a.sectorsCovered?.length ?? 0;
    if (n >= 3) return mkScore(10, "evidenced", a, `${n} sectors covered`, [], a.sectorsCovered);
    if (n === 2) return mkScore(7, "evidenced", a, `${n} sectors covered`, ["Three or more sectors strengthens portfolio readiness"], a.sectorsCovered);
    if (n === 1) return mkScore(4, "inferred", a, `${n} sector covered`, ["Specialized in one sector — limits LTA breadth; multi-sector bidders are evaluated higher on agency LTAs"], a.sectorsCovered);
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No sectors of operation stated"],
      missingEvidence: ["Sector list (e.g. health, WASH, education, supply chain, biomedical, construction)"],
      claims: [
        {
          text: "Sectors of operation not stated",
          provenance: { kind: "gap", note: "sectorsCovered is empty" },
        },
      ],
    };
  },
};

/** R6. Geographic Coverage (max 10) */
const R6_GEO: ReadinessCriterionDef = {
  criterion: {
    id: "geo",
    label: "Geographic coverage",
    weight: 0.1,
    maxScore: 10,
    source: SOURCE_REF,
  },
  score: (a) => {
    const n = a.geographicReach?.length ?? 0;
    if (n >= 4) return mkScore(10, "evidenced", a, `Multi-region coverage across ${n} regions/countries`, [], a.geographicReach);
    if (n === 2 || n === 3) return mkScore(6, "evidenced", a, `Regional coverage (${n} regions/countries)`, ["Multi-region delivery (4+) unlocks global LTA tier"], a.geographicReach);
    if (n === 1) return mkScore(3, "inferred", a, `Single-country / single-region coverage`, ["UN evaluators favour multi-country footprint for resilience and delivery flexibility"], a.geographicReach);
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["Geographic coverage not stated"],
      missingEvidence: ["List of countries / regions where you can deliver with named offices, partners, or local presence"],
      claims: [
        {
          text: "Geographic reach not stated",
          provenance: { kind: "gap", note: "geographicReach is empty" },
        },
      ],
    };
  },
};

/** R7. Key Personnel Depth (max 10) */
const R7_PERSONNEL: ReadinessCriterionDef = {
  criterion: {
    id: "personnel",
    label: "Key personnel depth",
    weight: 0.1,
    maxScore: 10,
    source: SOURCE_REF,
  },
  score: (a) => {
    const n = a.keyPersonnel?.length ?? 0;
    if (n >= 5) return mkPersonnelScore(10, "evidenced", a, []);
    if (n >= 3) return mkPersonnelScore(7, "evidenced", a, ["Deeper team (5+ named senior staff) is preferred for LTA-tier work"]);
    if (n >= 1) return mkPersonnelScore(4, "inferred", a, ["Named team is thin (<3 senior staff); UN evaluators flag key-person risk"]);
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No key personnel named"],
      missingEvidence: ["Named senior staff with role + years of experience + sector focus (3+ minimum for credibility)"],
      claims: [
        {
          text: "Key personnel not named in applicant evidence",
          provenance: { kind: "gap", note: "keyPersonnel array is empty" },
        },
      ],
    };
  },
};

/** R8. Certifications & Compliance Posture (max 10) */
const R8_CERTS: ReadinessCriterionDef = {
  criterion: {
    id: "certs",
    label: "Certifications and compliance posture",
    weight: 0.1,
    maxScore: 10,
    source: SOURCE_REF,
  },
  score: (a) => {
    const n = a.certifications?.length ?? 0;
    const baseline = a.meetsUnSupplierBaseline === true;
    if (n >= 3 && baseline) return mkCertScore(10, "evidenced", a, []);
    if (n >= 1) return mkCertScore(6, "evidenced", a, ["UN evaluators expect ISO 9001 + sector-specific certifications (ISO 13485 for biomedical, ISO 14001 environmental, etc.)"]);
    if (baseline) return mkCertScore(4, "inferred", a, ["UN supplier baseline confirmed but no named certifications — evaluators score certifications on the certificate, not the declaration"]);
    return {
      estimatedScore: 0,
      confidence: "gap",
      weaknesses: ["No certifications listed and UN supplier baseline not confirmed"],
      missingEvidence: ["Named certifications (ISO 9001, ISO 13485, ISO 14001, etc.) with certificate numbers + valid dates"],
      claims: [
        {
          text: "No certifications listed in applicant evidence",
          provenance: { kind: "gap", note: "certifications array is empty and meetsUnSupplierBaseline not confirmed" },
        },
      ],
    };
  },
};

// ============================================================================
// Helpers
// ============================================================================

function parseUSD(value: string | undefined): number {
  if (!value) return 0;
  const m = value.match(/[\d,]+(?:\.\d+)?/);
  if (!m) return 0;
  return parseFloat(m[0].replace(/,/g, "")) || 0;
}

function mkScore(
  estimatedScore: number,
  confidence: Confidence,
  _a: ApplicantContext,
  description: string,
  missingEvidence: string[],
  evidenceList?: string[],
): ReadinessCriterionScore {
  const claims: Claim[] =
    evidenceList && evidenceList.length > 0
      ? evidenceList.slice(0, 4).map((e) => ({
          text: e,
          provenance: { kind: "applicant_library" as const },
        }))
      : [
          {
            text: description,
            provenance: { kind: confidence === "evidenced" ? "applicant_library" : (confidence === "gap" ? "gap" : "inferred"), note: description },
          },
        ];
  return {
    estimatedScore,
    confidence,
    weaknesses: confidence === "evidenced" ? [] : [description],
    missingEvidence,
    claims,
  };
}

function mkValueScore(
  estimatedScore: number,
  confidence: Confidence,
  total: number,
  _a: ApplicantContext,
  missingEvidence: string[],
): ReadinessCriterionScore {
  return {
    estimatedScore,
    confidence,
    weaknesses: total < 500_000 ? [`Demonstrated contract value totals USD ${total.toLocaleString()} — below the USD 500k threshold for mid-tier LTA bids`] : [],
    missingEvidence,
    claims: [
      {
        text: `Demonstrated contract value across past performance: USD ${total.toLocaleString()}`,
        provenance: { kind: "applicant_library" },
      },
    ],
  };
}

function mkPersonnelScore(
  estimatedScore: number,
  confidence: Confidence,
  a: ApplicantContext,
  missingEvidence: string[],
): ReadinessCriterionScore {
  return {
    estimatedScore,
    confidence,
    weaknesses: a.keyPersonnel && a.keyPersonnel.length < 3 ? [`${a.keyPersonnel.length} named senior staff (UN evaluators prefer 3+ to mitigate key-person risk)`] : [],
    missingEvidence,
    claims: (a.keyPersonnel ?? []).slice(0, 4).map((p) => ({
      text: `${p.name} — ${p.role} (${p.yearsExperience} years)`,
      provenance: { kind: "applicant_library" as const },
    })),
  };
}

function mkCertScore(
  estimatedScore: number,
  confidence: Confidence,
  a: ApplicantContext,
  missingEvidence: string[],
): ReadinessCriterionScore {
  return {
    estimatedScore,
    confidence,
    weaknesses: (a.certifications?.length ?? 0) < 3 ? ["Certifications list is thin; UN evaluators score certifications individually, not as a baseline"] : [],
    missingEvidence,
    claims: (a.certifications ?? []).slice(0, 4).map((c) => ({
      text: `Certification: ${c}`,
      provenance: { kind: "applicant_library" as const },
    })),
  };
}

// ============================================================================
// Public API — the static rubric (8 criteria) + scoring entry point
// ============================================================================

export const READINESS_CRITERIA: ReadinessCriterionDef[] = [
  R1_UNGM,
  R2_YEARS,
  R3_AGENCIES,
  R4_VALUE,
  R5_SECTORS,
  R6_GEO,
  R7_PERSONNEL,
  R8_CERTS,
];

/**
 * Readiness has minimal disqualifiers — the goal is to identify gaps + route
 * them, not to deny service. The only hard gate is "country of registration
 * is sanctioned", which is informational here (real sanctions check requires
 * an API integration deferred to Sprint 8+).
 */
export const READINESS_NOTICE_WIDE_DISQUALIFIERS: Disqualifier[] = [];

/**
 * Build the full TenderRubric for the readiness assessment. Used by the
 * engine to plug into the existing scoreDraft + routeAllGaps pipeline.
 */
export function buildReadinessRubric(): TenderRubric {
  const lot: LotRubric = {
    lotId: READINESS_LOT_ID,
    label: "Vendor Readiness for UN Procurement",
    scope: "Generic readiness criteria — UNGM, past performance, agency coverage, financials, geo, personnel, certifications",
    criteria: READINESS_CRITERIA.map((c) => c.criterion),
    disqualifiers: [],
  };

  return {
    tenderId: READINESS_TENDER_ID,
    lane: "procurement",
    methodology: "cumulative",
    lots: [lot],
    noticeWideDisqualifiers: READINESS_NOTICE_WIDE_DISQUALIFIERS,
    documentSet: [],
    rubricVersion: READINESS_RUBRIC_VERSION,
  };
}
