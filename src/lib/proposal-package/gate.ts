/**
 * Compliance gate — Sprint 11.
 *
 * The proposal pipeline historically rendered + zipped + emailed every
 * generation unconditionally. Users discovered compliance gaps only after
 * downloading the package — too late to remediate inline before the call
 * deadline. Sprint 11 introduces an explicit decision point:
 *
 *   - if compliance_checklist contains ≥1 item with status="needs_action"
 *     AND priority="mandatory", the package is held in
 *     generation_status="needs_remediation". The output JSON is persisted
 *     so the dashboard can render it, but the ZIP bundle is not produced.
 *
 *   - otherwise the bundle proceeds as before (generation_status="ready").
 *
 * Legacy items without an explicit `priority` are treated as recommended
 * (no gate) so pre-Sprint-11 LLM output never trips the gate retroactively.
 */
import type { ComplianceItem, GateState, ProposalOutput } from "./types";

export function summariseComplianceGate(output: ProposalOutput): GateState {
  const items = Array.isArray(output.compliance_checklist) ? output.compliance_checklist : [];
  const gapItems: GateState["gap_items"] = [];
  let mandatoryGaps = 0;
  let recommendedGaps = 0;

  for (const item of items) {
    if (item.status !== "needs_action") continue;
    const priority = item.priority ?? "recommended";
    if (priority === "mandatory") mandatoryGaps += 1;
    else recommendedGaps += 1;
    gapItems.push({
      requirement: item.requirement,
      priority,
      evidence_or_action: item.evidence_or_action,
      evidence_label: item.evidence_label,
    });
  }

  return {
    total: items.length,
    mandatory_gaps: mandatoryGaps,
    recommended_gaps: recommendedGaps,
    gap_items: gapItems,
  };
}

export function isBlocked(gate: GateState): boolean {
  return gate.mandatory_gaps > 0;
}

export function describeGate(gate: GateState): string {
  if (gate.mandatory_gaps > 0) {
    const noun = gate.mandatory_gaps === 1 ? "item" : "items";
    return `${gate.mandatory_gaps} mandatory ${noun} need remediation before this draft can ship.`;
  }
  if (gate.recommended_gaps > 0) {
    return `${gate.recommended_gaps} recommended improvements available; the draft is ready to ship.`;
  }
  return "All compliance items satisfied.";
}

/**
 * Attach the gate summary onto the proposal output so the renderer and
 * dashboard see it as part of the persisted JSONB. Mutation-free.
 */
export function withGateState(output: ProposalOutput, gate: GateState): ProposalOutput {
  return { ...output, gate_state: gate };
}

/**
 * For renderers (PDF compliance matrix): when the gate is open, we still
 * want to render the matrix but mark mandatory gaps visibly. This helper
 * returns the items sorted so mandatory gaps surface first.
 */
export function sortComplianceForRender(items: ComplianceItem[]): ComplianceItem[] {
  const priorityRank: Record<string, number> = { mandatory: 0, recommended: 1 };
  const statusRank: Record<string, number> = { needs_action: 0, partial: 1, compliant: 2 };
  return [...items].sort((a, b) => {
    const ap = priorityRank[a.priority ?? "recommended"] ?? 1;
    const bp = priorityRank[b.priority ?? "recommended"] ?? 1;
    if (ap !== bp) return ap - bp;
    return (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3);
  });
}
