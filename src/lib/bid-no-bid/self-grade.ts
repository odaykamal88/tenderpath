/**
 * Bid/no-bid self-grading meta-score — PR-H, user-facing.
 *
 * Distinct from `grade.ts` (Sprint 15) which is a Sonnet-judge harness
 * grader used for internal validation. This one is deterministic, fast,
 * reproducible, and rendered in the work-order UI + PDF so the user can
 * see "this analysis scored 88/100 because…".
 *
 * Why deterministic, not LLM-judged:
 *   - The whole point of the meta-score is to build user trust. That
 *     requires it to be predictable and explainable — an LLM judge
 *     introduces variance into a trust-building signal.
 *   - Adds another Sonnet call (~$0.01 + 5-10 s) to a flow we want
 *     snappy.
 *   - Most of what we care about is structurally inspectable from the
 *     output JSON anyway (cited docs count, evidence labels, rubric
 *     presence, next-step shape).
 *
 * Five dimensions × 20 points = 100:
 *
 *   1. grounding         — did the analysis cite the user's uploaded docs?
 *   2. evidence_quality  — are findings honestly labeled (evidence vs
 *                          inference vs gap vs unverified)?
 *   3. rubric_match      — did we project against the published rubric,
 *                          or correctly skip when none exists?
 *   4. actionability     — are next_steps verb-led and specific?
 *   5. completeness      — are all core sections populated?
 *
 * Bands:  90+ excellent · 75-89 strong · 60-74 competent · 40-59 thin · <40 weak
 */
import type { BidNoBidOutput, BidNoBidSelfGrade } from "./types";
import type { BidNoBidDocument } from "./documents";

export type SelfGradeBand = BidNoBidSelfGrade["band"];

export type SelfGradeDimension = BidNoBidSelfGrade["dimensions"]["grounding"];

const BAND_LABELS: Record<SelfGradeBand, string> = {
  excellent: "Excellent — submission-ready guidance",
  strong: "Strong — minor refinement recommended",
  competent: "Competent — usable, with caveats",
  thin: "Thin — re-run with sharper inputs",
  weak: "Weak — grounding is missing",
};

function bandFromScore(score: number): SelfGradeBand {
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 60) return "competent";
  if (score >= 40) return "thin";
  return "weak";
}

/* ── Dimension 1: grounding ─────────────────────────────────────────── */
function scoreGrounding(
  output: BidNoBidOutput,
  docs: BidNoBidDocument[],
): SelfGradeDimension {
  const ingested = docs.length;
  const cited = (output.applicant_documents_cited ?? []).length;
  if (ingested === 0) {
    return {
      score_0_20: 0,
      rationale: "No documents uploaded — analysis ran on tender URL + pasted criteria alone.",
    };
  }
  if (cited === 0) {
    return {
      score_0_20: 5,
      rationale: `${ingested} document${ingested === 1 ? "" : "s"} ingested but none cited — the analysis read them but didn't anchor findings in them.`,
    };
  }
  const ratio = cited / ingested;
  if (cited >= 3 && ratio >= 0.5) {
    return {
      score_0_20: 20,
      rationale: `${cited} of ${ingested} documents cited (${Math.round(ratio * 100)}% citation rate) — findings are well anchored.`,
    };
  }
  if (cited >= 2) {
    return {
      score_0_20: 15,
      rationale: `${cited} of ${ingested} documents cited — solid grounding, room for tighter citation.`,
    };
  }
  return {
    score_0_20: 10,
    rationale: `${cited} of ${ingested} documents cited — grounding is partial.`,
  };
}

/* ── Dimension 2: evidence_quality ──────────────────────────────────── */
function scoreEvidenceQuality(output: BidNoBidOutput): SelfGradeDimension {
  const findings: string[] = [
    ...(output.gap_analysis ?? [])
      .map((g) => g.evidence_label as string | undefined)
      .filter((l): l is string => typeof l === "string"),
    ...(output.eligibility_findings ?? [])
      .map((f) => f.evidence_label as string | undefined)
      .filter((l): l is string => typeof l === "string"),
  ];
  if (findings.length === 0) {
    return {
      score_0_20: 0,
      rationale: "No evidence-labeled findings — gap_analysis and eligibility_findings are empty.",
    };
  }
  const counts: Record<string, number> = {
    evidence: 0,
    inference: 0,
    gap: 0,
    unverified: 0,
  };
  for (const l of findings) {
    if (l in counts) counts[l] += 1;
  }
  const total = findings.length;
  const unverifiedRatio = counts.unverified / total;
  const evidenceRatio = counts.evidence / total;

  if (evidenceRatio >= 0.4 && unverifiedRatio <= 0.2) {
    return {
      score_0_20: 20,
      rationale: `${counts.evidence}/${total} findings labeled "evidence" with low unverified rate — honest, well-anchored.`,
    };
  }
  if (evidenceRatio >= 0.2 || unverifiedRatio <= 0.3) {
    return {
      score_0_20: 15,
      rationale: `Mixed labels — ${counts.evidence} evidence · ${counts.inference} inference · ${counts.gap} gap · ${counts.unverified} unverified.`,
    };
  }
  if (unverifiedRatio > 0.5) {
    return {
      score_0_20: 5,
      rationale: `${counts.unverified}/${total} findings labeled "unverified" — analysis is short on hard evidence.`,
    };
  }
  return {
    score_0_20: 10,
    rationale: `${counts.inference}/${total} findings are inferences — usable but light on direct evidence.`,
  };
}

/* ── Dimension 3: rubric_match ──────────────────────────────────────── */
function scoreRubricMatch(
  output: BidNoBidOutput,
  tenderText: string,
): SelfGradeDimension {
  const ps = output.projected_score;
  // Heuristic: a published rubric tends to use these tokens. Conservative —
  // when in doubt, we'd rather not penalize the model for correctly
  // skipping a non-existent rubric than ding it for missing a phantom one.
  const RUBRIC_HINTS =
    /(\bpoints?\b|\bweight(s|ing)?\b|\bscoring\b|technical\s+\d{1,3}\b|financial\s+\d{1,3}\b|max(?:imum)?\s+\d{1,3}\s*(?:points?|marks?))/i;
  const rubricLikelyInTender = RUBRIC_HINTS.test(tenderText);

  if (!ps || ps.rubric_source === "absent") {
    if (rubricLikelyInTender) {
      return {
        score_0_20: 0,
        rationale: "Tender text contains scoring keywords but no rubric was extracted — likely a missed scoring table.",
      };
    }
    return {
      score_0_20: 10,
      rationale: "Tender doesn't publish a scoring rubric; analysis correctly skipped projection.",
    };
  }
  if (ps.rubric_source === "stated_in_tender" && ps.criteria.length >= 2) {
    return {
      score_0_20: 20,
      rationale: `Stated rubric extracted with ${ps.criteria.length} criteria — full per-criterion projection produced.`,
    };
  }
  if (ps.rubric_source === "inferred_from_text" && ps.criteria.length >= 2) {
    return {
      score_0_20: 15,
      rationale: `${ps.criteria.length} criteria inferred from prose — projection produced with a verify-in-TOR caveat.`,
    };
  }
  return {
    score_0_20: 5,
    rationale: "Rubric source was non-absent but fewer than 2 criteria — thin projection.",
  };
}

/* ── Dimension 4: actionability ─────────────────────────────────────── */
const ACTION_VERBS = [
  "verify", "obtain", "complete", "register", "review", "contact",
  "request", "submit", "draft", "prepare", "confirm", "secure",
  "engage", "reach", "negotiate", "translate", "validate", "renew",
  "compile", "extract", "produce", "schedule", "audit", "update",
];

function isSpecificStep(step: string): number {
  const s = step.trim();
  let score = 0;
  // Verb-led
  const firstWord = (s.split(/\s+/)[0] ?? "").toLowerCase();
  if (
    ACTION_VERBS.some((v) => firstWord === v || s.toLowerCase().startsWith(v + " "))
  )
    score += 1;
  // Has a specific reference (filename, date, agency abbreviation, %)
  const hasFilename = /\.\b(pdf|docx?|xlsx?)\b/i.test(s);
  const hasDate =
    /\b(?:20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s);
  const hasAgency = /\b[A-Z]{2,6}\b/.test(s);
  const hasPercent = /\d{1,3}\s*%/.test(s);
  if (hasFilename || hasDate || hasAgency || hasPercent) score += 1;
  // Substance — short bullets are usually generic ("Begin proposal.")
  if (s.length >= 60) score += 1;
  return score; // 0-3
}

function scoreActionability(output: BidNoBidOutput): SelfGradeDimension {
  const steps = output.next_steps ?? [];
  if (steps.length === 0) {
    return { score_0_20: 0, rationale: "No next_steps were produced." };
  }
  const specifics = steps.map(isSpecificStep);
  const avg = specifics.reduce((a, b) => a + b, 0) / specifics.length;
  if (steps.length >= 3 && avg >= 2.3) {
    return {
      score_0_20: 20,
      rationale: `${steps.length} next_steps, mostly verb-led and specific (avg ${avg.toFixed(1)}/3).`,
    };
  }
  if (steps.length >= 3 && avg >= 1.5) {
    return {
      score_0_20: 15,
      rationale: `${steps.length} next_steps; most are specific but a few are generic.`,
    };
  }
  if (steps.length >= 2) {
    return {
      score_0_20: 10,
      rationale: `${steps.length} next_steps, leaning generic (avg ${avg.toFixed(1)}/3).`,
    };
  }
  return {
    score_0_20: 5,
    rationale: `Only ${steps.length} next_step — too thin to drive submission action.`,
  };
}

/* ── Dimension 5: completeness ──────────────────────────────────────── */
function scoreCompleteness(output: BidNoBidOutput): SelfGradeDimension {
  const checks: Array<{ name: string; ok: boolean }> = [
    { name: "fit_reasoning", ok: (output.fit_reasoning?.length ?? 0) >= 3 },
    { name: "gap_analysis", ok: (output.gap_analysis?.length ?? 0) >= 2 },
    {
      name: "eligibility_findings",
      ok: (output.eligibility_findings?.length ?? 0) >= 2,
    },
    {
      name: "required_documents",
      ok: (output.required_documents?.length ?? 0) >= 4,
    },
    { name: "next_steps", ok: (output.next_steps?.length ?? 0) >= 3 },
  ];
  const passed = checks.filter((c) => c.ok);
  const score_0_20 = passed.length * 4;
  if (passed.length === 5) {
    return {
      score_0_20,
      rationale: "All five core sections populated with substantive content.",
    };
  }
  const missing = checks.filter((c) => !c.ok).map((c) => c.name);
  return {
    score_0_20,
    rationale: `${passed.length}/5 sections populated. Thin: ${missing.join(", ")}.`,
  };
}

/* ── Top-level grader ───────────────────────────────────────────────── */

export interface SelfGradeArgs {
  output: BidNoBidOutput;
  docs: BidNoBidDocument[];
  /** Concatenated tender + pasted-criteria text so rubric_match can sniff for missed scoring tables. */
  tenderText: string;
}

export function gradeAnalysis(args: SelfGradeArgs): BidNoBidSelfGrade {
  const grounding = scoreGrounding(args.output, args.docs);
  const evidence_quality = scoreEvidenceQuality(args.output);
  const rubric_match = scoreRubricMatch(args.output, args.tenderText);
  const actionability = scoreActionability(args.output);
  const completeness = scoreCompleteness(args.output);

  const score_0_100 =
    grounding.score_0_20 +
    evidence_quality.score_0_20 +
    rubric_match.score_0_20 +
    actionability.score_0_20 +
    completeness.score_0_20;
  const band = bandFromScore(score_0_100);

  // Callouts — surface the dimensions that cost the most points, with an
  // actionable next-step for each.
  const dimensionTips: Array<{ key: string; score: number; tip: string }> = [
    {
      key: "grounding",
      score: grounding.score_0_20,
      tip:
        args.docs.length === 0
          ? "Upload a TOR plus your capability statement and CV to anchor the analysis."
          : "Re-run with more applicant evidence attached (cap statement, CV, compliance certs) so more findings cite a source.",
    },
    {
      key: "rubric_match",
      score: rubric_match.score_0_20,
      tip:
        rubric_match.score_0_20 === 0
          ? "Paste the scoring table from the tender's evaluation section to unlock the projected score."
          : "Re-run with the evaluation section verbatim — projects directly against the explicit rubric.",
    },
    {
      key: "evidence_quality",
      score: evidence_quality.score_0_20,
      tip: "Upload supporting docs that directly evidence the eligibility lines — turns inferences into evidence.",
    },
    {
      key: "actionability",
      score: actionability.score_0_20,
      tip: "Next-steps sharpen automatically as more documents are attached — generic steps usually signal thin context.",
    },
    {
      key: "completeness",
      score: completeness.score_0_20,
      tip: "Re-run if a section is empty; transient model truncation is the usual cause.",
    },
  ];
  const callouts = dimensionTips
    .filter((d) => d.score < 15)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((d) => d.tip);

  return {
    score_0_100,
    band,
    band_label: BAND_LABELS[band],
    dimensions: {
      grounding,
      evidence_quality,
      rubric_match,
      actionability,
      completeness,
    },
    callouts,
    rubric_version: "v1",
  };
}
