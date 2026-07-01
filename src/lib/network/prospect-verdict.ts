/**
 * Lite prospect verdict — the free, shallow "should you look at this?" read.
 *
 * This is the top-of-funnel wedge, NOT the paid deep adjudication. It is fully
 * deterministic (no LLM): a fast, repeatable go/look/hold taste built from the
 * fit tier, the practical registration gate, and the contestability band. The
 * paid Proposal Review SKU is where the sharp rubric/panel-weighting no-bid
 * lives — this only helps a prospect decide whether the opportunity is worth
 * their own closer look.
 *
 * Positioning (durable, see AGENTS.md): augmentation, not replacement. The read
 * is honest about no-bid internally (the `recommendation` we LOG), but the public
 * outreach surface phrases the cautious case softly ("worth a closer look"),
 * never a blunt "don't bid" to a cold prospect. The blunt call is a paid depth.
 */

import type { ContestabilityBand, RegistrationRisk } from "@/lib/tenders/contestability";

/** Ordered strongest→weakest fit; derived from either raw score or the public band. */
export type FitTier = "excellent" | "strong" | "good" | "marginal";

export type ProspectRecommendation = "pursue" | "prepare" | "monitor";
export type VerdictConfidence = "strong" | "moderate" | "exploratory";

export interface ProspectVerdictInput {
  fitTier: FitTier;
  registrationRisk?: RegistrationRisk;
  contestabilityBand?: ContestabilityBand;
  /** Whether at least one matched buyer is a UN-agency (UNGM) tender. */
  ungmApplies?: boolean;
}

export interface ProspectVerdict {
  recommendation: ProspectRecommendation;
  confidence: VerdictConfidence;
  /** One line in the augmentation voice, safe to show a cold prospect. */
  headline: string;
  /** 2–3 evidence-anchored reasons. */
  reasons: string[];
  /** Honest caveat that this is a shallow read; deeper review is a paid step. */
  caveat: string;
}

/** Map a raw 0–100 match score to a fit tier (admin/calibration path). */
export function fitTierFromScore(score: number): FitTier {
  if (score >= 85) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 65) return "good";
  return "marginal";
}

/** Map the prospect-facing FitBand to a fit tier (public path — raw score hidden). */
export function fitTierFromBand(band: "Excellent fit" | "Strong fit" | "Good fit"): FitTier {
  if (band === "Excellent fit") return "excellent";
  if (band === "Strong fit") return "strong";
  return "good";
}

/**
 * Deterministic lite verdict. Starts from fit, then applies the practical gate
 * (registration timing) and the contestability band as dampeners. Never returns
 * a blunt "skip" — the softest public recommendation is "monitor".
 */
export function buildProspectVerdict(input: ProspectVerdictInput): ProspectVerdict {
  const { fitTier } = input;
  const regRisk: RegistrationRisk = input.registrationRisk ?? "none";
  const band: ContestabilityBand = input.contestabilityBand ?? "Mixed";

  const reasons: string[] = [];

  // Base recommendation from fit.
  let rec: ProspectRecommendation =
    fitTier === "excellent" || fitTier === "strong" ? "pursue" : fitTier === "good" ? "prepare" : "monitor";
  let confidence: VerdictConfidence =
    fitTier === "excellent" ? "strong" : fitTier === "marginal" ? "exploratory" : "moderate";

  if (fitTier === "excellent") reasons.push("Strong alignment between your stated capabilities and this call.");
  else if (fitTier === "strong") reasons.push("Good capability overlap with this call.");
  else if (fitTier === "good") reasons.push("Partial overlap — a credible bid, with some positioning work.");
  else reasons.push("Only a partial overlap on the surface — worth confirming before investing time.");

  // Practical gate: a very-tight registration window pulls a "pursue" back to
  // "prepare" (act on registration now), and downgrades confidence.
  if (regRisk === "very-tight") {
    if (rec === "pursue") rec = "prepare";
    if (confidence === "strong") confidence = "moderate";
    reasons.push("The registration/lead-time window is tight — start supplier registration now, not after deciding to bid.");
  } else if (regRisk === "tight") {
    reasons.push("Leave time for first-time supplier registration before the deadline.");
  }

  // Contestability dampener (orthogonal to fit — a strong fit on a captured
  // tender still isn't worth a full effort). Constrained pulls toward monitor.
  if (band === "Constrained") {
    rec = "monitor";
    if (confidence === "strong") confidence = "moderate";
    reasons.push("Signals suggest a narrowed or incumbent-favoured field — verify the real competition before committing.");
  } else if (band === "Open") {
    reasons.push("Reads as an open, merit-decided competition.");
  }

  const headline =
    rec === "pursue"
      ? "Worth a proper look — this one fits."
      : rec === "prepare"
        ? "Promising, but there's groundwork to do first."
        : "On the radar — confirm the field before committing time.";

  const caveat =
    "A quick surface read, not a full adjudication. A deep review scores it against the published rubric and panel weighting.";

  return { recommendation: rec, confidence, headline, reasons: reasons.slice(0, 3), caveat };
}
