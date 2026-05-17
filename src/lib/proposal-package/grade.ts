/**
 * Output-quality grader — Sprint 13a.
 *
 * Sonnet judge that scores a generated ProposalOutput against a fixed
 * five-criterion rubric, each 0-2 for a 0-10 total. Designed to feed
 * the paid-services validation harness an auxiliary signal that
 * reflects what the LLM actually produced, not just what inputs were
 * supplied.
 *
 * Rationale: the existing harness scoring is input-completeness biased
 * (assessment + context + match + fit). After Sprints 9-11 the same
 * inputs produce a measurably better output (capability_match,
 * evidence_from_library citations, compliance gate). The harness does
 * not see any of that. A judge that reads the actual output closes
 * the gap between "the system delivers" and "the harness reports".
 *
 * The grader is deterministic-ish (temperature 0.1) and idempotent
 * given the same inputs. Cached results live in
 * outputs/paid-services-validation/grades/<key>.json so reruns are
 * free unless the cache file is deleted.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ProposalOutput, RosterOutput, TenderRequirements } from "./types";

const SONNET_MODEL = "claude-sonnet-4-6";

export interface GradingInputs {
  /** The proposal output to grade. */
  output: ProposalOutput;
  /** Extracted requirements the proposal was generated against. */
  requirements: TenderRequirements;
  /** The company context the generator saw — used to verify specificity. */
  companyContext: string;
  /** Optional: original tender text snippet so the judge can validate
   *  call-specific references in the draft. We cap to keep prompt small. */
  tenderTextExcerpt?: string;
}

export interface GradeBreakdown {
  /** 0-2: references actual call (lot/agency/deadline/geography) and actual company by name. */
  specificity: number;
  /** 0-2: compliance + missing_information cite library files / profile evidence, not handwave. */
  evidence_anchoring: number;
  /** 0-2: all 8 output fields meaningfully populated (not stub strings). */
  completeness: number;
  /** 0-2: compliance_checklist + gate_state + missing_information internally consistent;
   *       cover letter doesn't claim things flagged as gaps. */
  internal_consistency: number;
  /** 0-2: cover letter is a real letter; technical_approach paragraphs have substance;
   *       next_steps are operationally specific. */
  submission_usability: number;
}

export interface ProposalGrade {
  /** Sum of breakdown. 0-10. */
  score_0_10: number;
  breakdown: GradeBreakdown;
  /** One sentence per criterion explaining the score. */
  rationale: string[];
  /** Token / model bookkeeping. */
  model: string;
  graded_at: string;
}

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try { return JSON.parse(candidate.slice(start, i + 1)) as T; } catch { break; }
          }
        }
      }
    }
    console.error("[proposal-grade:json_parse_failed]", {
      preview: text.slice(0, 240),
      tail: text.slice(-160),
    });
    return fallback;
  }
}

function clamp02(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(2, Math.round(v)));
}

const DEFAULT_GRADE: ProposalGrade = {
  score_0_10: 0,
  breakdown: { specificity: 0, evidence_anchoring: 0, completeness: 0, internal_consistency: 0, submission_usability: 0 },
  rationale: [],
  model: SONNET_MODEL,
  graded_at: new Date(0).toISOString(),
};

export async function gradeProposalOutput(inputs: GradingInputs): Promise<ProposalGrade> {
  const client = getClient();
  // Cap text payloads so a long tender does not blow the judge's context.
  const tenderSnippet = (inputs.tenderTextExcerpt ?? "").slice(0, 6000);
  const outputJson = JSON.stringify(inputs.output, null, 2).slice(0, 30000);
  const requirementsJson = JSON.stringify(inputs.requirements, null, 2).slice(0, 8000);
  const companyContext = inputs.companyContext.slice(0, 4000);

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `You are a senior bid manager auditing the quality of an automated proposal draft. You score the draft against a fixed five-criterion rubric. You are strict and concrete: if a draft is generic, hand-wavy, or internally inconsistent, you score low. If a draft references the exact call by name, cites specific evidence by file name, and is internally consistent, you score high.

ORIGINAL TENDER (excerpt):
${tenderSnippet}

EXTRACTED REQUIREMENTS (what the generator saw):
${requirementsJson}

COMPANY PROFILE (what the generator saw):
${companyContext}

GENERATED PROPOSAL OUTPUT (the draft to score):
${outputJson}

Score each criterion 0, 1, or 2 (integers only):

1. specificity (0-2)
   2 = references the actual call (lot, agency, deadline, geography, country names) AND the actual company (capabilities, certifications, geography) by name throughout the draft.
   1 = some specifics but mixed with generic prose.
   0 = generic template prose; the same draft would fit any tender.

2. evidence_anchoring (0-2)
   2 = compliance_checklist items cite specific evidence (library file names, profile capabilities, named past projects). missing_information names concrete artefacts.
   1 = some items cite evidence, others handwave.
   0 = boilerplate "Confirm evidence before submission" or similar non-specific text.

3. completeness (0-2)
   2 = all 8 ProposalOutput fields (executive_summary, technical_approach, compliance_checklist, required_documents, cover_letter_draft, financial_template_notes, missing_information, next_steps) are meaningfully populated (not empty, not stubs).
   1 = 5-7 fields populated meaningfully.
   0 = ≤4 fields meaningful or many fields are stubs.

4. internal_consistency (0-2)
   2 = compliance_checklist statuses align with gate_state.gap_items and missing_information; cover_letter does not claim capabilities flagged as gaps; technical_approach mentions only capabilities the company has.
   1 = mostly consistent, one or two minor contradictions.
   0 = cover letter claims what gate flags as missing, or compliance says compliant but missing_information lists the same item as a gap.

5. submission_usability (0-2)
   2 = cover_letter_draft is a complete letter (greeting, body, signature block) with no [bracketed placeholders] except date/salutation. technical_approach paragraphs each carry substance (methodology, deliverables, indicators). next_steps are operationally specific (named action + named owner or deadline).
   1 = usable with significant editing; placeholders or thin paragraphs present.
   0 = cover letter has multiple placeholders or is generic; technical_approach paragraphs are skeletal.

Return ONLY a strict-shape JSON object with EXACTLY these keys:
{
  "specificity": 0|1|2,
  "evidence_anchoring": 0|1|2,
  "completeness": 0|1|2,
  "internal_consistency": 0|1|2,
  "submission_usability": 0|1|2,
  "rationale": [
    "specificity: <one sentence>",
    "evidence_anchoring: <one sentence>",
    "completeness: <one sentence>",
    "internal_consistency: <one sentence>",
    "submission_usability: <one sentence>"
  ]
}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{
    specificity: number; evidence_anchoring: number; completeness: number;
    internal_consistency: number; submission_usability: number;
    rationale: string[];
  }>(text, {
    specificity: 0, evidence_anchoring: 0, completeness: 0,
    internal_consistency: 0, submission_usability: 0, rationale: [],
  });
  const breakdown: GradeBreakdown = {
    specificity: clamp02(parsed.specificity),
    evidence_anchoring: clamp02(parsed.evidence_anchoring),
    completeness: clamp02(parsed.completeness),
    internal_consistency: clamp02(parsed.internal_consistency),
    submission_usability: clamp02(parsed.submission_usability),
  };
  const score_0_10 =
    breakdown.specificity + breakdown.evidence_anchoring + breakdown.completeness +
    breakdown.internal_consistency + breakdown.submission_usability;
  return {
    score_0_10,
    breakdown,
    rationale: Array.isArray(parsed.rationale) ? parsed.rationale.slice(0, 5) : [],
    model: SONNET_MODEL,
    graded_at: new Date().toISOString(),
  };
}

export { DEFAULT_GRADE };

/* ============================================================
 * Roster grader — Sprint 14.
 *
 * Mirrors gradeProposalOutput but scored against Roster's actual shape.
 * Two of the five criteria swap meaning to fit the roster context:
 *
 *  - "agency_fit_honesty" replaces "internal_consistency". A roster
 *    that scores the applicant 9/10 on three agencies they have no
 *    business registering with is dishonest. A roster that names the
 *    one agency they should start with and explains why is honest.
 *
 *  - "submission_usability" stays but is judged against the registration
 *    flow (real registration steps, real document filenames, cover
 *    letter that doesn't have unresolved placeholders), not against a
 *    bid submission.
 *
 * Same cache shape as the proposal grader, same harness blending path.
 * ============================================================ */

export interface RosterGradingInputs {
  output: RosterOutput;
  companyContext: string;
  /** Optional. The picked-agency context the generator saw. Used to
   *  validate that the narrative matches the named primary agency. */
  primaryAgencyContext?: string;
  /** Optional. The full agency catalogue summary the generator saw.
   *  Used to verify the breakdown covers the right agencies. */
  agencyCatalogueExcerpt?: string;
}

export interface RosterGradeBreakdown {
  /** 0-2: references actual agency (portal, codes, doc names) AND
   *  actual company (capabilities, certifications, geography) by name. */
  specificity: number;
  /** 0-2: capability_statement + checklist cite specific evidence/files
   *  + breakdown rationales name specific docs (not handwave). */
  evidence_anchoring: number;
  /** 0-2: all 9 RosterOutput fields meaningfully populated. */
  completeness: number;
  /** 0-2: agency_readiness_breakdown is brutally honest — applicant's
   *  actual evidence/capabilities map cleanly to per-agency scores;
   *  start_here is genuinely the best fit; blocked agencies name real
   *  blockers; no agency is scored 9/10 on weak evidence. */
  agency_fit_honesty: number;
  /** 0-2: registration_checklist is operationally specific; cover
   *  letter has no unresolved placeholders; document_renaming_rules
   *  follow the named agency's convention. */
  submission_usability: number;
}

export interface RosterGrade {
  score_0_10: number;
  breakdown: RosterGradeBreakdown;
  rationale: string[];
  model: string;
  graded_at: string;
}

const DEFAULT_ROSTER_GRADE: RosterGrade = {
  score_0_10: 0,
  breakdown: {
    specificity: 0,
    evidence_anchoring: 0,
    completeness: 0,
    agency_fit_honesty: 0,
    submission_usability: 0,
  },
  rationale: [],
  model: SONNET_MODEL,
  graded_at: new Date(0).toISOString(),
};

export async function gradeRosterOutput(inputs: RosterGradingInputs): Promise<RosterGrade> {
  const client = getClient();
  const outputJson = JSON.stringify(inputs.output, null, 2).slice(0, 30000);
  const companyContext = inputs.companyContext.slice(0, 4000);
  const primaryAgencyContext = (inputs.primaryAgencyContext ?? "").slice(0, 3000);
  const agencyCatalogueExcerpt = (inputs.agencyCatalogueExcerpt ?? "").slice(0, 8000);

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1800,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `You are a senior procurement advisor auditing the quality of an automated UN-agency roster registration package. You score the output against a fixed five-criterion rubric. You are strict: if the breakdown scores an agency 9/10 on weak evidence, that's dishonest and you mark it down. If the package names exactly one "start_here" agency with cited rationale, that's a win.

COMPANY PROFILE (what the generator saw):
${companyContext}

PRIMARY TARGET AGENCY (the picked agency the narrative is written against):
${primaryAgencyContext || "(not provided)"}

AGENCY CATALOGUE EXCERPT (what the breakdown was scored against):
${agencyCatalogueExcerpt || "(not provided)"}

GENERATED ROSTER OUTPUT (the package to score):
${outputJson}

Score each criterion 0, 1, or 2 (integers only):

1. specificity (0-2)
   2 = references the actual primary agency by name (portal, registration steps, category codes) AND the actual company by name (capabilities, certifications, geography) throughout the narrative + breakdown.
   1 = some specifics but mixed with generic prose.
   0 = the same package would fit any vendor + any agency.

2. evidence_anchoring (0-2)
   2 = capability_statement_draft names specific company evidence (file names, named past projects, named certifications). agency_readiness_breakdown rationales cite specific evidence_library files or specific company-profile capabilities. missing_documents lists concrete docs by name.
   1 = some items cite evidence, others handwave.
   0 = boilerplate "company has strong capabilities" or "needs more docs" with no specifics.

3. completeness (0-2)
   2 = all 9 RosterOutput fields (registration_checklist, capability_statement_draft, required_documents, organization_profile_notes, cover_letter_draft, submission_guidance, document_renaming_rules, missing_information, next_steps) meaningfully populated AND agency_readiness_breakdown has one entry per plausible agency.
   1 = 6-8 fields populated meaningfully OR breakdown covers only some plausible agencies.
   0 = ≤5 fields meaningful OR breakdown is empty/stub.

4. agency_fit_honesty (0-2)
   2 = the breakdown's "start_here" agency is genuinely the best fit given the company's actual capabilities and geography. "viable" agencies have ≥6 readiness with named gaps. "blocked" agencies have explicit blockers cited (e.g. "WHO requires PQS device listing — applicant is an advisory firm, not a device manufacturer"). No agency is over-scored.
   1 = scoring is roughly right but one agency is over-rated OR start_here is plausible but not clearly best.
   0 = breakdown is sycophantic (everything is "viable" or "start_here"), OR start_here is wrong, OR an agency the company has no business with is scored ≥7.

5. submission_usability (0-2)
   2 = registration_checklist steps are operationally specific (named portal sections, named buttons, named upload pages). cover_letter_draft has no unresolved [bracketed placeholders] except [DATE]. document_renaming_rules follow the named primary agency's convention (or correctly state the agency does not enforce filenames). next_steps cite specific times/deadlines/costs where applicable.
   1 = usable with significant editing; placeholders or thin steps present.
   0 = checklist is generic, cover letter has multiple unresolved placeholders, or renaming rules are absent/wrong.

Return ONLY a strict-shape JSON object with EXACTLY these keys:
{
  "specificity": 0|1|2,
  "evidence_anchoring": 0|1|2,
  "completeness": 0|1|2,
  "agency_fit_honesty": 0|1|2,
  "submission_usability": 0|1|2,
  "rationale": [
    "specificity: <one sentence>",
    "evidence_anchoring: <one sentence>",
    "completeness: <one sentence>",
    "agency_fit_honesty: <one sentence>",
    "submission_usability: <one sentence>"
  ]
}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{
    specificity: number; evidence_anchoring: number; completeness: number;
    agency_fit_honesty: number; submission_usability: number;
    rationale: string[];
  }>(text, {
    specificity: 0, evidence_anchoring: 0, completeness: 0,
    agency_fit_honesty: 0, submission_usability: 0, rationale: [],
  });
  const breakdown: RosterGradeBreakdown = {
    specificity: clamp02(parsed.specificity),
    evidence_anchoring: clamp02(parsed.evidence_anchoring),
    completeness: clamp02(parsed.completeness),
    agency_fit_honesty: clamp02(parsed.agency_fit_honesty),
    submission_usability: clamp02(parsed.submission_usability),
  };
  const score_0_10 =
    breakdown.specificity + breakdown.evidence_anchoring + breakdown.completeness +
    breakdown.agency_fit_honesty + breakdown.submission_usability;
  return {
    score_0_10,
    breakdown,
    rationale: Array.isArray(parsed.rationale) ? parsed.rationale.slice(0, 5) : [],
    model: SONNET_MODEL,
    graded_at: new Date().toISOString(),
  };
}

export { DEFAULT_ROSTER_GRADE };
