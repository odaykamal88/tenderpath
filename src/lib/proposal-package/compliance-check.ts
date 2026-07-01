/**
 * FREE shallow compliance-gap check (P1.1 wedge). Orchestrates the LLM gate-match
 * (review-llm) with the deterministic contestability band (P0.3) and assembles a
 * `ComplianceGapCheck` — the honest administrative read + the go/no-go question
 * that leads the review SKU. The paid deep tier (ReviewOutput) adds per-criterion
 * scoring, panel weighting, and drop-in rewrites.
 *
 * The verdict + go/no-go derivations are PURE and unit-tested (proposal-review-smoke).
 */

import { classifyContestability } from "@/lib/tenders/contestability";
import { checkDraftCompliance } from "./review-llm";
import type {
  AdminGate,
  ApplicantRef,
  CallRef,
  ComplianceContestability,
  ComplianceGapCheck,
  ComplianceTopGap,
  ComplianceVerdictStatus,
  ExclusionCheck,
  GoNoGo,
  ReviewEvidenceLabel,
  ReviewGateStatus,
  ReviewQualityProfile,
  ReviewSeverity,
} from "./review-types";

const SEVERITIES: ReviewSeverity[] = ["BLOCK", "HIGH", "MED", "LOW"];
const GATE_STATUSES: ReviewGateStatus[] = ["ok", "missing", "partial", "unverified", "not_applicable"];
const EVIDENCE_LABELS: ReviewEvidenceLabel[] = ["evidence", "inference", "gap", "unverified"];

function coerce<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

/** The $15k question — the headline value of the review SKU (a question, not a feature). */
export const GO_NO_GO_QUESTION = "Should you spend ~$15,000 and 60 hours preparing this bid?";

export interface ComplianceCheckTender {
  tender_id: number | null;
  title: string;
  agency: string | null;
  country: string | null;
  deadline: string | null; // ISO
  opportunity_type: string | null;
  description?: string | null;
  requirementsText?: string | null;
  estimated_value?: string | null;
}

export interface RunComplianceCheckInput {
  tender: ComplianceCheckTender;
  draftText: string;
  applicant: ApplicantRef;
  companyContext?: string;
  revision?: number;
}

/** Compose the raw tender text handed to the model. */
function tenderTextFor(t: ComplianceCheckTender): string {
  return [
    t.title ? `Title: ${t.title}` : "",
    t.agency ? `Buyer/Agency: ${t.agency}` : "",
    t.country ? `Country: ${t.country}` : "",
    t.opportunity_type ? `Type: ${t.opportunity_type}` : "",
    t.deadline ? `Deadline: ${t.deadline}` : "",
    t.estimated_value ? `Estimated value: ${t.estimated_value}` : "",
    t.description ? `\nDescription:\n${t.description}` : "",
    t.requirementsText ? `\nRequirements:\n${t.requirementsText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Compliance verdict from the gate set. PURE.
 *  - blocked : a BLOCK-severity gate is verified MISSING (administrative rejection risk).
 *  - at_risk : a BLOCK/HIGH gate is partial/unverified, or a HIGH gate is missing.
 *  - clears  : nothing above surfaced (only MED/LOW gaps or all ok).
 * An unverified BLOCK is at_risk, never blocked — we don't assert an absence we can't see.
 */
export function deriveComplianceVerdict(gates: AdminGate[]): {
  status: ComplianceVerdictStatus;
  headline: string;
  summary: string;
} {
  const isMissing = (g: AdminGate) => g.status === "missing";
  const isSoft = (g: AdminGate) => g.status === "partial" || g.status === "unverified";

  const blocked = gates.some((g) => g.severity === "BLOCK" && isMissing(g));
  const atRisk =
    !blocked &&
    gates.some(
      (g) =>
        (g.severity === "BLOCK" && isSoft(g)) ||
        (g.severity === "HIGH" && (isMissing(g) || isSoft(g))),
    );

  if (blocked) {
    return {
      status: "blocked",
      headline: "Administrative blocker — this draft is at rejection risk as it stands.",
      summary:
        "At least one mandatory requirement looks unmet. Administrative rejection happens before any scoring, so fix this before anything else.",
    };
  }
  if (atRisk) {
    return {
      status: "at_risk",
      headline: "Compliance gaps to close before submission.",
      summary:
        "No hard blocker confirmed, but there are administrative gaps that could cost you on eligibility or completeness. Close them before the deadline.",
    };
  }
  return {
    status: "clears",
    headline: "No administrative blocker surfaced in this shallow check.",
    summary:
      "The obvious administrative gates look addressed. This is a shallow check — the deep review scores how the panel would actually rate the content.",
  };
}

/**
 * The go/no-go framing. PURE. Conservative: a blocker or a Constrained field
 * leans HOLD; at-risk or a Mixed field leans CAUTION; otherwise GO.
 */
export function deriveGoNoGo(
  verdictStatus: ComplianceVerdictStatus,
  contestabilityBand: "Open" | "Mixed" | "Constrained",
  blockOrHighGapCount: number,
): GoNoGo {
  let lean: GoNoGo["lean"];
  if (verdictStatus === "blocked" || contestabilityBand === "Constrained") lean = "hold";
  else if (verdictStatus === "at_risk" || blockOrHighGapCount > 0 || contestabilityBand === "Mixed") lean = "caution";
  else lean = "go";

  const one_liner =
    lean === "hold"
      ? "Hold: fix the blocker (or reassess the field) before you sink 60 hours into this."
      : lean === "caution"
        ? "Proceed with eyes open: close the gaps first, and know the field before committing full effort."
        : "Worth pursuing: no blocker surfaced and the field reads open — put your hours here.";

  return { question: GO_NO_GO_QUESTION, lean, one_liner };
}

function toAdminGate(raw: {
  id?: unknown;
  label?: unknown;
  status?: unknown;
  severity?: unknown;
  action?: unknown;
  evidence_label?: unknown;
  note?: unknown;
}, i: number): AdminGate {
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `gate_${i + 1}`,
    label: typeof raw.label === "string" ? raw.label : "Requirement",
    status: coerce<ReviewGateStatus>(raw.status, GATE_STATUSES, "unverified"),
    severity: coerce<ReviewSeverity>(raw.severity, SEVERITIES, "MED"),
    action: typeof raw.action === "string" ? raw.action : "Confirm against the notice.",
    owner: "Bid lead",
    evidence_label: coerce<ReviewEvidenceLabel>(raw.evidence_label, EVIDENCE_LABELS, "unverified"),
    note: typeof raw.note === "string" ? raw.note : undefined,
  };
}

function slug(s: string | null | undefined): string {
  return (s ?? "call").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "call";
}

function qualityProfile(
  status: ComplianceVerdictStatus,
  degraded: boolean,
  warnings: string[],
  gateCount: number,
): ReviewQualityProfile {
  const qStatus: ReviewQualityProfile["status"] =
    status === "blocked" ? "blocked" : degraded || warnings.length > 0 || gateCount === 0 ? "needs_review" : "ready";
  const score = degraded || gateCount === 0 ? 3 : status === "clears" ? 8 : status === "at_risk" ? 6 : 5;
  return {
    status: qStatus,
    score_0_10: score,
    missing_inputs: gateCount === 0 ? ["No administrative gates could be assessed from the provided text."] : [],
    warnings,
  };
}

/** Run the free shallow compliance-gap check end to end. */
export async function runComplianceGapCheck(input: RunComplianceCheckInput): Promise<ComplianceGapCheck> {
  const { tender, draftText, applicant } = input;
  const revision = input.revision ?? 1;

  const findings = await checkDraftCompliance({
    tenderText: tenderTextFor(tender),
    draftText,
    companyContext: input.companyContext ?? "",
  });

  const admin_gates: AdminGate[] = findings.admin_gates.map(toAdminGate);
  const mandatory_exclusions: ExclusionCheck[] = findings.mandatory_exclusions.map((r, i) => ({
    id: typeof r.id === "string" && r.id.trim() ? r.id : `exclusion_${i + 1}`,
    label: typeof r.label === "string" ? r.label : "Cross-cutting requirement",
    addressed: r.addressed === true,
    evidence_label: coerce<ReviewEvidenceLabel>(r.evidence_label, EVIDENCE_LABELS, "unverified"),
    notes: typeof r.notes === "string" ? r.notes : "",
  }));
  const top_gaps: ComplianceTopGap[] = findings.top_gaps.map((r) => ({
    severity: coerce<ReviewSeverity>(r.severity, SEVERITIES, "MED"),
    issue: typeof r.issue === "string" ? r.issue : "Gap",
    evidence_label: coerce<ReviewEvidenceLabel>(r.evidence_label, EVIDENCE_LABELS, "unverified"),
    gate_id: typeof r.gate_id === "string" ? r.gate_id : undefined,
  }));

  const verdict = deriveComplianceVerdict(admin_gates);

  const contestabilitySignal = classifyContestability({
    title: tender.title,
    description: tender.description ?? null,
    opportunityType: tender.opportunity_type,
  });
  const contestability: ComplianceContestability = {
    band: contestabilitySignal.band,
    line: contestabilitySignal.line,
    basis: contestabilitySignal.basis,
  };

  const blockOrHigh = top_gaps.filter((g) => g.severity === "BLOCK" || g.severity === "HIGH").length;
  const go_no_go = deriveGoNoGo(verdict.status, contestability.band, blockOrHigh);

  const call: CallRef = {
    tender_id: tender.tender_id,
    title: tender.title,
    agency: tender.agency,
    country: tender.country,
    deadline: tender.deadline,
    opportunity_type: tender.opportunity_type,
  };

  return {
    kind: "compliance_check",
    ref_tag: `CHK-${slug(tender.agency ?? tender.title).toUpperCase()}-${String(revision).padStart(3, "0")}`,
    generated_at: new Date().toISOString(),
    revision,
    call,
    applicant,
    compliance_verdict: verdict,
    admin_gates,
    mandatory_exclusions,
    top_gaps,
    contestability,
    go_no_go,
    deep_review: {
      available: true,
      what_you_get: [
        "Every evaluation criterion scored current → achievable against the published rubric",
        "Panel-weighting applied (double-weighted and gating criteria called out)",
        "Drop-in rewrites for the highest-impact sections",
        "Priority fixes with an owner and a deadline on each",
        "Full contestability read on how the field is likely to behave",
      ],
    },
    output_quality: qualityProfile(verdict.status, findings.degraded === true, findings.quality_warnings, admin_gates.length),
  };
}
