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
import type { ProposalOutput, TenderRequirements } from "./types";

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
