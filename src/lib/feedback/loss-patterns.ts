/**
 * feedback/loss-patterns.ts — Loop 2 aggregation (Phase 3).
 *
 * recordLossReason captures WHERE each draft was weak (auto-score gaps + user
 * loss notes). The non-static value is AGGREGATING across drafts: when the same
 * criterion is flagged in many drafts, that's ONE systematic weakness in rubric
 * extraction or drafting — fix it once and every future draft benefits. Safe by
 * construction: this is the team's aggregate pattern data, not anyone's
 * confidential content, so it reads loss-reasons regardless of curation state —
 * the aggregate is informational; the human acts on the pattern.
 */

import type { FeedbackRecord } from "./types";

export interface LossPattern {
  /** The criterion the weakness clusters on. "(unspecified)" when the gap
   *  carried no criterion id (e.g. a notice-wide finding). */
  criterionId: string;
  /** How many loss-reason records hit this criterion. */
  count: number;
  /** Distinct agencies where it showed up (helps tell "UNICEF RFP format" vs
   *  "a one-off" apart — Loop 4's per-format angle). */
  agencies: string[];
  /** Up to 3 example detail strings, for the admin to eyeball the pattern. */
  samples: string[];
}

export function aggregateLossReasons(records: FeedbackRecord[]): LossPattern[] {
  const byCriterion = new Map<string, { count: number; agencies: Set<string>; samples: string[] }>();

  for (const r of records) {
    if (r.kind !== "loss_reason") continue;
    const rawCrit = r.payload?.criterionId;
    const criterionId = typeof rawCrit === "string" && rawCrit.trim() ? rawCrit : "(unspecified)";

    const entry = byCriterion.get(criterionId) ?? { count: 0, agencies: new Set<string>(), samples: [] };
    entry.count += 1;
    if (r.agency && r.agency.trim()) entry.agencies.add(r.agency);
    if (r.detail && r.detail.trim() && entry.samples.length < 3) entry.samples.push(r.detail);
    byCriterion.set(criterionId, entry);
  }

  return [...byCriterion.entries()]
    .map(([criterionId, e]) => ({ criterionId, count: e.count, agencies: [...e.agencies], samples: e.samples }))
    .sort((a, b) => b.count - a.count || a.criterionId.localeCompare(b.criterionId));
}
