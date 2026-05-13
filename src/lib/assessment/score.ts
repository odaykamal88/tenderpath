import type { AIAnalysis } from "@/lib/types";

/**
 * Grant readiness score formula. Financial-stability evidence is collected at
 * the deliverable purchase step (bid-no-bid / proposal-draft / roster) where
 * the user uploads audited financials and bank references — it is not part of
 * the dashboard score because there is no public signal to anchor it.
 *
 *   Impact & Methodology:    35%  (experience_relevance 60% + technical_capability 40%)
 *   M&E Capability:          25%  (compliance_readiness 70% + technical_capability 30%)
 *   Grant Management:        20%  (compliance_readiness)
 *   Organisational Capacity: 20%  (technical_capability)
 *
 * Bonuses: +5 for NGO org type, +3 for >2 dev themes.
 */
export function computeGrantReadinessScore(
  orgType: string | null,
  analysis: AIAnalysis,
  devThemes: string[]
): number {
  const d = analysis.readiness_dimensions;

  const impact = Math.min(
    100,
    d.experience_relevance * 0.6 + d.technical_capability * 0.4
  );
  const mAndE = Math.min(
    100,
    d.compliance_readiness * 0.7 + d.technical_capability * 0.3
  );
  const grantMgmt = d.compliance_readiness;
  const orgCapacity = d.technical_capability;

  let score =
    impact * 0.35 +
    mAndE * 0.25 +
    grantMgmt * 0.2 +
    orgCapacity * 0.2;

  if (orgType === "NGO") score = Math.min(100, score + 5);
  if (devThemes.length > 2) score = Math.min(100, score + 3);

  return Math.round(score);
}
