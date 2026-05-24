/**
 * rubric-diff.ts — pure diff over two TenderRubric objects → RubricDelta[].
 *
 * Sprint 3 scope. The mechanism behind reextractAndDiff: given a prior rubric
 * (rubricVersion = N) and a re-extracted rubric (rubricVersion = N+1) built
 * after an amendment / corrigendum / binding Q&A landed, return the structural
 * deltas so callers can:
 *   - decide whether to bump rubricVersion (changed = deltas.length > 0)
 *   - render the deltas to the user ("Section 7.2 weight changed: 25 → 30")
 *   - flag every prior GenerationSnapshot whose rubricVersion is now stale
 *
 * Pure function. No LLM. No I/O. The deltas it returns are the data the
 * Sprint 3 amendment-versioning flow runs on top of.
 *
 * Comparison rules:
 *   - methodology: notice-wide; one delta if it changes
 *   - lots: matched by lotId; lot added / lot removed / lot label changed
 *   - criteria within a lot: matched by criterionId; added / removed / changed
 *       (weight, maxScore, gatingThreshold, doubleWeighted, kind, label)
 *   - lot disqualifiers: matched by disqualifier id; added / removed / changed (rule, kind)
 *   - noticeWideDisqualifiers: same matching as lot disqualifiers
 *
 * Rule text is normalised (lowercase + collapsed whitespace) before comparison
 * so a re-extraction that re-renders the same rule with different spacing
 * doesn't fire a false-positive delta.
 */

import type {
  TenderRubric,
  RubricDelta,
  LotRubric,
  EvaluationCriterion,
  Disqualifier,
} from "./scoring-engine";

export function diffRubrics(
  prior: TenderRubric,
  next: TenderRubric,
): RubricDelta[] {
  const deltas: RubricDelta[] = [];

  if (prior.methodology !== next.methodology) {
    deltas.push({
      field: "methodology",
      before: prior.methodology,
      after: next.methodology,
    });
  }

  // -- Lots --------------------------------------------------------------
  diffLots(prior.lots, next.lots, deltas);

  // -- Notice-wide disqualifiers ----------------------------------------
  diffDisqualifierList(
    prior.noticeWideDisqualifiers,
    next.noticeWideDisqualifiers,
    deltas,
    { lotId: undefined },
  );

  return deltas;
}

// ============================================================================
// Lot-level diff
// ============================================================================

function diffLots(
  prior: LotRubric[],
  next: LotRubric[],
  deltas: RubricDelta[],
): void {
  const priorById = new Map(prior.map((l) => [l.lotId, l]));
  const nextById = new Map(next.map((l) => [l.lotId, l]));

  // Added lots
  for (const lot of next) {
    if (!priorById.has(lot.lotId)) {
      deltas.push({
        lotId: lot.lotId,
        field: "lot_added",
        before: null,
        after: { lotId: lot.lotId, label: lot.label },
      });
    }
  }

  // Removed lots
  for (const lot of prior) {
    if (!nextById.has(lot.lotId)) {
      deltas.push({
        lotId: lot.lotId,
        field: "lot_removed",
        before: { lotId: lot.lotId, label: lot.label },
        after: null,
      });
    }
  }

  // Lots present in both: diff criteria + disqualifiers
  for (const lot of next) {
    const priorLot = priorById.get(lot.lotId);
    if (!priorLot) continue;

    if (priorLot.label !== lot.label) {
      deltas.push({
        lotId: lot.lotId,
        field: "lot_label",
        before: priorLot.label,
        after: lot.label,
      });
    }

    diffCriteria(priorLot.criteria, lot.criteria, deltas, lot.lotId);
    diffDisqualifierList(priorLot.disqualifiers, lot.disqualifiers, deltas, {
      lotId: lot.lotId,
    });
  }
}

// ============================================================================
// Criterion-level diff
// ============================================================================

function diffCriteria(
  prior: EvaluationCriterion[],
  next: EvaluationCriterion[],
  deltas: RubricDelta[],
  lotId: string,
): void {
  const priorById = new Map(prior.map((c) => [c.id, c]));
  const nextById = new Map(next.map((c) => [c.id, c]));

  // Added
  for (const c of next) {
    if (!priorById.has(c.id)) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "criterion_added",
        before: null,
        after: { id: c.id, label: c.label, maxScore: c.maxScore },
      });
    }
  }

  // Removed
  for (const c of prior) {
    if (!nextById.has(c.id)) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "criterion_removed",
        before: { id: c.id, label: c.label, maxScore: c.maxScore },
        after: null,
      });
    }
  }

  // Changed
  for (const c of next) {
    const before = priorById.get(c.id);
    if (!before) continue;

    if (before.label !== c.label) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "label",
        before: before.label,
        after: c.label,
      });
    }
    if (before.weight !== c.weight) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "weight",
        before: before.weight,
        after: c.weight,
      });
    }
    if (before.maxScore !== c.maxScore) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "maxScore",
        before: before.maxScore,
        after: c.maxScore,
      });
    }
    if ((before.gatingThreshold ?? null) !== (c.gatingThreshold ?? null)) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "gatingThreshold",
        before: before.gatingThreshold ?? null,
        after: c.gatingThreshold ?? null,
      });
    }
    if (!!before.doubleWeighted !== !!c.doubleWeighted) {
      deltas.push({
        lotId,
        criterionId: c.id,
        field: "doubleWeighted",
        before: !!before.doubleWeighted,
        after: !!c.doubleWeighted,
      });
    }
    // NOTE: EvaluationCriterion has no `kind` field (kind lives on Disqualifier).
    // Criterion comparison covers label / weight / maxScore / gatingThreshold /
    // doubleWeighted, which is the full mutable set per scoring-engine.ts.
  }
}

// ============================================================================
// Disqualifier diff (used for both lot-scoped and notice-wide)
// ============================================================================

function diffDisqualifierList(
  prior: Disqualifier[],
  next: Disqualifier[],
  deltas: RubricDelta[],
  scope: { lotId?: string },
): void {
  const priorById = new Map(prior.map((d) => [d.id, d]));
  const nextById = new Map(next.map((d) => [d.id, d]));

  // Added
  for (const d of next) {
    if (!priorById.has(d.id)) {
      deltas.push({
        lotId: scope.lotId,
        disqualifierId: d.id,
        field: "disqualifier_added",
        before: null,
        after: { id: d.id, kind: d.kind, rule: d.rule.slice(0, 160) },
      });
    }
  }

  // Removed
  for (const d of prior) {
    if (!nextById.has(d.id)) {
      deltas.push({
        lotId: scope.lotId,
        disqualifierId: d.id,
        field: "disqualifier_removed",
        before: { id: d.id, kind: d.kind, rule: d.rule.slice(0, 160) },
        after: null,
      });
    }
  }

  // Changed
  for (const d of next) {
    const before = priorById.get(d.id);
    if (!before) continue;
    if (before.kind !== d.kind) {
      deltas.push({
        lotId: scope.lotId,
        disqualifierId: d.id,
        field: "disqualifier_kind",
        before: before.kind,
        after: d.kind,
      });
    }
    if (normaliseRule(before.rule) !== normaliseRule(d.rule)) {
      deltas.push({
        lotId: scope.lotId,
        disqualifierId: d.id,
        field: "disqualifier_rule",
        before: before.rule,
        after: d.rule,
      });
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normaliseRule(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Convenience renderer for acceptance scripts / future UI. Pure function —
 * just stringifies a RubricDelta into a short one-line summary.
 */
export function formatDelta(d: RubricDelta): string {
  const scope = d.lotId ? `[lot ${d.lotId}]` : "[notice-wide]";
  const id = d.criterionId
    ? `criterion ${d.criterionId}`
    : d.disqualifierId
      ? `disqualifier ${d.disqualifierId}`
      : "";
  const beforeStr = d.before == null ? "—" : JSON.stringify(d.before).slice(0, 80);
  const afterStr = d.after == null ? "—" : JSON.stringify(d.after).slice(0, 80);
  return `${scope} ${id} ${d.field}: ${beforeStr} → ${afterStr}`.trim();
}
