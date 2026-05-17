/**
 * Bid/No-Bid output-quality grader — Sprint 15.
 *
 * Mirrors the Proposal Draft + Roster Fast-Track graders shipped in
 * Sprints 13a + 14: a Sonnet judge reads a generated BidNoBidOutput
 * against a fixed five-criterion rubric (each 0-2, sum 0-10) and
 * returns a structured grade plus per-criterion rationale.
 *
 * Rubric is tuned for the analytical product (the user is paying $39
 * for a go/no-go call, not a deliverable). Two criteria swap meaning
 * vs. the proposal grader:
 *
 *  - "recommendation_calibration" replaces "internal_consistency".
 *    The recommendation, win_probability_band, fit_reasoning, and
 *    red_flags must be internally coherent. A "bid" verdict alongside
 *    high-severity red_flags and a 10-25% win band is incoherent.
 *
 *  - "actionability" replaces "submission_usability". The Bid/No-Bid
 *    isn't a submission — it's a decision support doc. The grader
 *    asks whether next_steps + conditions_for_bid are specific enough
 *    to act on without further analyst help.
 *
 * Idempotent caching: the harness reads grades from
 * outputs/paid-services-validation/grades/<panel_id>.json with the
 * same shape as the proposal grader.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BidNoBidOutput, TenderRequirements } from "./types";

const SONNET_MODEL = "claude-sonnet-4-6";

export interface BidGradingInputs {
  output: BidNoBidOutput;
  /** Extracted requirements the bid analysis was generated against. */
  requirements: TenderRequirements;
  /** Company context the generator saw — used to verify specificity. */
  companyContext: string;
  /** Optional. Original tender excerpt for the judge. Capped to keep prompt small. */
  tenderTextExcerpt?: string;
}

export interface BidGradeBreakdown {
  /** 0-2: references actual tender (lot/agency/deadline/value) AND actual company by name. */
  specificity: number;
  /** 0-2: fit_reasoning + gap_analysis cite specific tender requirements and specific
   *       company capabilities; not boilerplate. */
  evidence_anchoring: number;
  /** 0-2: all 13 BidNoBidOutput fields meaningfully populated (not stubs). */
  completeness: number;
  /** 0-2: recommendation + win_probability_band + fit_reasoning + red_flags + eligibility_findings
   *       internally coherent. "bid" with high-severity red flags is incoherent.
   *       "no-bid" with no red flags cited is incoherent. */
  recommendation_calibration: number;
  /** 0-2: next_steps are operationally specific (named action + named owner or deadline);
   *       conditions_for_bid are concrete and testable;
   *       effort_estimate_hours is grounded, not a placeholder. */
  actionability: number;
}

export interface BidGrade {
  score_0_10: number;
  breakdown: BidGradeBreakdown;
  rationale: string[];
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
    console.error("[bid-no-bid-grade:json_parse_failed]", {
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

const DEFAULT_BID_GRADE: BidGrade = {
  score_0_10: 0,
  breakdown: {
    specificity: 0,
    evidence_anchoring: 0,
    completeness: 0,
    recommendation_calibration: 0,
    actionability: 0,
  },
  rationale: [],
  model: SONNET_MODEL,
  graded_at: new Date(0).toISOString(),
};

export async function gradeBidNoBidOutput(inputs: BidGradingInputs): Promise<BidGrade> {
  const client = getClient();
  const tenderSnippet = (inputs.tenderTextExcerpt ?? "").slice(0, 6000);
  const outputJson = JSON.stringify(inputs.output, null, 2).slice(0, 30000);
  const requirementsJson = JSON.stringify(inputs.requirements, null, 2).slice(0, 6000);
  const companyContext = inputs.companyContext.slice(0, 4000);

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `You are a senior bid manager auditing the quality of an automated Bid/No-Bid analysis. You score the analysis against a fixed five-criterion rubric. The user paid $39 for a go/no-go call — you score whether the call is specific, evidence-anchored, complete, internally coherent, and actionable. You are strict: if the analysis is generic, hand-wavy, or internally inconsistent (e.g. "bid" verdict with high red flags and a 10-25% win band), you score low. If the analysis names the specific tender, cites specific evidence, gives a calibrated recommendation, and lists actionable next steps, you score high.

ORIGINAL TENDER (excerpt):
${tenderSnippet}

EXTRACTED REQUIREMENTS (what the generator saw):
${requirementsJson}

COMPANY PROFILE (what the generator saw):
${companyContext}

GENERATED BID/NO-BID OUTPUT (the analysis to score):
${outputJson}

Score each criterion 0, 1, or 2 (integers only):

1. specificity (0-2)
   2 = references the actual tender (lot/agency/deadline/value/country/agency portal) AND the actual company (capabilities, certifications, past performance) by name throughout the analysis.
   1 = some specifics but mixed with generic prose.
   0 = the same analysis would fit any tender + any company.

2. evidence_anchoring (0-2)
   2 = fit_reasoning items cite specific tender requirements AND specific company capabilities. gap_analysis items name concrete gaps with concrete fixes. eligibility_findings (if present) cite specific text from the tender. evidence labels (evidence/inference/gap/unverified) are applied appropriately.
   1 = some items cite evidence, others handwave.
   0 = boilerplate "company has strong capabilities" or "key gaps exist" with no specifics.

3. completeness (0-2)
   2 = all of these BidNoBidOutput fields are meaningfully populated (not empty, not stubs):
       recommendation, win_probability_band, headline, fit_reasoning, gap_analysis,
       required_documents, effort_estimate_hours, red_flags, conditions_for_bid,
       next_steps, evidence.{tender_excerpt,company_capabilities_matched,company_capabilities_missing},
       tender_type, commercial_terms, eligibility_findings.
   1 = 9-11 of those fields populated meaningfully.
   0 = ≤8 fields meaningful or many fields are stubs.

4. recommendation_calibration (0-2)
   2 = recommendation + win_probability_band + fit_reasoning + red_flags + eligibility_findings are internally coherent. A "bid" verdict aligns with high category_fit + low red_flags + ≥25-50% win band. A "no-bid" cites red_flags and/or unmet mandatory eligibility. A "conditional" names specific conditions in conditions_for_bid that, if resolved, would shift the verdict to "bid".
   1 = mostly coherent, one or two minor tensions (e.g. "conditional" but conditions are vague; "bid" but win band only 10-25% with no caveat).
   0 = recommendation flatly contradicts the evidence (e.g. "bid" verdict alongside three high-severity red flags and an unmet mandatory eligibility item).

5. actionability (0-2)
   2 = next_steps are operationally specific (named action + named owner OR deadline OR cost estimate). conditions_for_bid are concrete and testable (not "improve documentation"). effort_estimate_hours is non-zero and reasonable given the gap_analysis. required_documents include priority labels where present.
   1 = usable with significant editing; some steps too vague.
   0 = next_steps are generic ("prepare proposal"); effort estimate is 0 or implausible; conditions are non-actionable.

Return ONLY a strict-shape JSON object with EXACTLY these keys:
{
  "specificity": 0|1|2,
  "evidence_anchoring": 0|1|2,
  "completeness": 0|1|2,
  "recommendation_calibration": 0|1|2,
  "actionability": 0|1|2,
  "rationale": [
    "specificity: <one sentence>",
    "evidence_anchoring: <one sentence>",
    "completeness: <one sentence>",
    "recommendation_calibration: <one sentence>",
    "actionability: <one sentence>"
  ]
}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{
    specificity: number; evidence_anchoring: number; completeness: number;
    recommendation_calibration: number; actionability: number;
    rationale: string[];
  }>(text, {
    specificity: 0, evidence_anchoring: 0, completeness: 0,
    recommendation_calibration: 0, actionability: 0, rationale: [],
  });
  const breakdown: BidGradeBreakdown = {
    specificity: clamp02(parsed.specificity),
    evidence_anchoring: clamp02(parsed.evidence_anchoring),
    completeness: clamp02(parsed.completeness),
    recommendation_calibration: clamp02(parsed.recommendation_calibration),
    actionability: clamp02(parsed.actionability),
  };
  const score_0_10 =
    breakdown.specificity + breakdown.evidence_anchoring + breakdown.completeness +
    breakdown.recommendation_calibration + breakdown.actionability;
  return {
    score_0_10,
    breakdown,
    rationale: Array.isArray(parsed.rationale) ? parsed.rationale.slice(0, 5) : [],
    model: SONNET_MODEL,
    graded_at: new Date().toISOString(),
  };
}

export { DEFAULT_BID_GRADE };
