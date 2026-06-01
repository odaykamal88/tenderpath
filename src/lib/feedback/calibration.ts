/**
 * feedback/calibration.ts — the B2 measurement.
 *
 * Reads PROMOTED outcome records and asks: did the predicted score line up with
 * the real result? Until this shows the score is calibrated, the UI must keep
 * presenting conservatively (band, not a precise predicted number — Stage B1).
 * `calibrated === true` is what earns the graduation to a precise score (B3).
 *
 * The dishonesty signal to watch is the OPTIMISTIC rate — how often a draft we
 * rated competitive actually lost. Survivorship bias (only capturing happy
 * outcomes) pushes this down artificially, which is why Loop 1 chases losses.
 */

import type { FeedbackRecord } from "./types";
import { calibrationVerdict } from "./store";

/** Minimum decided outcomes before calibration can be judged at all. */
export const CALIBRATION_MIN_SAMPLE = 20;
/** Above this optimistic-miss rate the score is running hot — stay conservative. */
export const CALIBRATION_MAX_OPTIMISTIC_RATE = 0.2;

export interface CalibrationReport {
  /** All promoted outcome records considered. */
  totalOutcomes: number;
  /** Decided outcomes WITH a predicted score (n/a excluded — the real sample). */
  sampleSize: number;
  aligned: number;
  optimistic: number;
  pessimistic: number;
  /** optimistic / sampleSize — the "we said strong, they lost" rate. */
  optimisticRate: number;
  /** aligned / sampleSize. */
  alignedRate: number;
  /** True only when there's enough sample AND the optimistic rate is in bounds.
   *  This is the B3 graduation gate — flip the precise-score UI only on this. */
  calibrated: boolean;
  /** Plain-language status for the admin surface. */
  note: string;
}

export function computeCalibration(outcomes: FeedbackRecord[]): CalibrationReport {
  let aligned = 0;
  let optimistic = 0;
  let pessimistic = 0;
  let sampleSize = 0;

  for (const o of outcomes) {
    if (o.kind !== "outcome" || !o.outcome) continue;
    const v = calibrationVerdict(o.predictedScore, o.predictedMax, o.outcome);
    if (v === "n/a") continue; // undecided or no predicted score — not a calibration data point
    sampleSize += 1;
    if (v === "aligned") aligned += 1;
    else if (v === "optimistic") optimistic += 1;
    else pessimistic += 1;
  }

  const optimisticRate = sampleSize > 0 ? optimistic / sampleSize : 0;
  const alignedRate = sampleSize > 0 ? aligned / sampleSize : 0;
  const calibrated = sampleSize >= CALIBRATION_MIN_SAMPLE && optimisticRate <= CALIBRATION_MAX_OPTIMISTIC_RATE;

  let note: string;
  if (sampleSize < CALIBRATION_MIN_SAMPLE) {
    note = `Not enough data: ${sampleSize}/${CALIBRATION_MIN_SAMPLE} decided outcomes. Keep presenting the score conservatively (band, not a number).`;
  } else if (optimisticRate > CALIBRATION_MAX_OPTIMISTIC_RATE) {
    note = `Score runs OPTIMISTIC — ${Math.round(optimisticRate * 100)}% of drafts we rated competitive lost. Stay conservative; do not graduate to a precise number.`;
  } else {
    note = `Calibrated: ${Math.round(alignedRate * 100)}% aligned over ${sampleSize} outcomes, optimistic misses at ${Math.round(optimisticRate * 100)}%. Eligible to graduate the score to a precise number (B3).`;
  }

  return {
    totalOutcomes: outcomes.length,
    sampleSize,
    aligned,
    optimistic,
    pessimistic,
    optimisticRate,
    alignedRate,
    calibrated,
    note,
  };
}
