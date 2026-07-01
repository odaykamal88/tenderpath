/**
 * Pure-logic smoke for the deep review's ScoreResult → ReviewOutput mapping (P1.1).
 * No DB, no LLM. Run: npx tsx scripts/proposal-review-deep-smoke.ts
 *
 * The mapping is the spec's centrepiece ("the ScoreResult seeds the full
 * ReviewOutput"). Guards: triggered disqualifiers → BLOCK admin gates + a rank-1
 * BLOCK fix + "fails" clearance + hold; achievable sits between current and max;
 * exposure reflects double-weighting; a clean score clears.
 */

import { buildReviewOutputFromScore } from "../src/lib/proposal-package/review-deep";
import type { TenderRubric, ScoreResult, Disqualifier, SourceRef } from "../src/lib/proposal-package/scoring-engine";
import type { CallRef, ApplicantRef, ComplianceContestability } from "../src/lib/proposal-package/review-types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}`); }
}

const src: SourceRef = { docId: "sol", rubricVersion: 1 };
const dqForm: Disqualifier = { id: "dq_form", rule: "Mandatory technical proposal form", kind: "mandatory_form", source: src };
const dqDeadline: Disqualifier = { id: "dq_deadline", rule: "Submit before the deadline", kind: "deadline", source: src };

const rubric: TenderRubric = {
  tenderId: "t1",
  lane: "procurement",
  methodology: "cumulative",
  rubricVersion: 1,
  documentSet: [],
  noticeWideDisqualifiers: [dqDeadline],
  lots: [
    {
      lotId: "main",
      label: "Main",
      criteria: [
        { id: "1.1", label: "Methodology", weight: 0.4, maxScore: 40, doubleWeighted: true, source: src },
        { id: "1.2", label: "Experience", weight: 0.6, maxScore: 60, source: src },
      ],
      disqualifiers: [dqForm],
    },
  ],
};

const call: CallRef = { tender_id: 1, title: "Consultancy services", agency: "UNICEF", country: "Yemen", deadline: null, opportunity_type: "RFP" };
const applicant: ApplicantRef = { user_id: 7, organisation: "Acme", org_type: "company" };
const mixed: ComplianceContestability = { band: "Mixed", line: "…", basis: [] };

console.log("blocked case — a triggered disqualifier");
{
  const score: ScoreResult = {
    rubricVersion: 1,
    lotResults: [
      {
        lotId: "main",
        perCriterion: [
          { criterionId: "1.1", estimatedScore: 34, maxScore: 40, confidence: "evidenced", weaknesses: [], missingEvidence: [] },
          { criterionId: "1.2", estimatedScore: 20, maxScore: 60, confidence: "gap", weaknesses: ["thin track record"], missingEvidence: ["no past performance evidence"] },
        ],
        estimatedTotal: 54,
        lotDisqualifiersTriggered: [dqForm],
        passesGating: false,
      },
    ],
    noticeWideDisqualifiersTriggered: [],
    routedGaps: [],
  };
  const r = buildReviewOutputFromScore({ rubric, score, call, applicant, contestability: mixed, workOrderId: 99, revision: 1 });

  check("kind = review", r.kind === "review");
  check("ref_tag REV-*", r.ref_tag.startsWith("REV-"));
  check("2 scoring rows", r.scoring.length === 2);
  const c11 = r.scoring.find((s) => s.criterion_id === "1.1")!;
  const c12 = r.scoring.find((s) => s.criterion_id === "1.2")!;
  check("achievable between current and max (1.1)", c11.current_score < c11.achievable_score && c11.achievable_score <= 40);
  check("1.2 evidence_label = gap", c12.evidence_label === "gap");
  check("totals: current 54 / max 100", r.scoring_totals.current === 54 && r.scoring_totals.max === 100);
  check("threshold_clearance = fails (gating failed)", r.scoring_totals.threshold_clearance === "fails");
  check("admin_gates has both disqualifiers", r.admin_gates.length === 2);
  check("triggered form gate is BLOCK + missing", r.admin_gates.some((g) => g.id === "dq_form" && g.severity === "BLOCK" && g.status === "missing"));
  check("untriggered deadline gate is ok", r.admin_gates.some((g) => g.id === "dq_deadline" && g.status === "ok"));
  check("rank-1 fix is BLOCK", r.priority_fixes[0]?.severity === "BLOCK");
  check("evaluation_risks sorted by exposure (1.2 first: 40 > 1.1 12)", r.evaluation_risks[0]?.criterion_id === "1.2");
  check("1.1 exposure reflects double-weight ((40-34)*2=12)", r.evaluation_risks.find((e) => e.criterion_id === "1.1")?.exposure_points === 12);
  check("strengths include 1.1 (0.85 ratio) not 1.2", r.strengths.some((s) => s.label === "Methodology") && !r.strengths.some((s) => s.label === "Experience"));
  check("go/no-go leans hold (blocked)", r.go_no_go.lean === "hold");
  check("output_quality blocked", r.output_quality?.status === "blocked");
}

console.log("clean case — nothing triggered, decent scores");
{
  const score: ScoreResult = {
    rubricVersion: 1,
    lotResults: [
      {
        lotId: "main",
        perCriterion: [
          { criterionId: "1.1", estimatedScore: 32, maxScore: 40, confidence: "evidenced", weaknesses: [], missingEvidence: [] },
          { criterionId: "1.2", estimatedScore: 48, maxScore: 60, confidence: "inferred", weaknesses: [], missingEvidence: [] },
        ],
        estimatedTotal: 80,
        lotDisqualifiersTriggered: [],
        passesGating: true,
      },
    ],
    noticeWideDisqualifiersTriggered: [],
    routedGaps: [],
  };
  const r = buildReviewOutputFromScore({ rubric, score, call, applicant, contestability: { band: "Open", line: "", basis: ["open"] }, workOrderId: 1, revision: 2 });
  check("clears (80/100, gating ok)", r.scoring_totals.threshold_clearance === "clears");
  check("no BLOCK fixes when nothing triggered", !r.priority_fixes.some((f) => f.severity === "BLOCK"));
  check("open field + clears → go", r.go_no_go.lean === "go");
  check("revision carried (2)", r.revision === 2 && r.ref_tag.endsWith("-002"));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
