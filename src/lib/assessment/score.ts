import type { AIAnalysis } from "@/lib/types";

/**
 * Grant readiness score formula from audit appendix:
 *   Impact & Methodology:   30%  (experience_relevance 60% + technical_capability 40%)
 *   M&E Capability:         20%  (compliance_readiness 70% + technical_capability 30%)
 *   Grant Management:       20%  (financial_stability 50% + compliance_readiness 50%)
 *   Organisational Capacity:15%  (technical_capability)
 *   Financial Controls:     15%  (financial_stability)
 *
 * Bonuses: +5 for NGO org type, +3 for >2 dev themes
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
  const grantMgmt = Math.min(
    100,
    d.financial_stability * 0.5 + d.compliance_readiness * 0.5
  );
  const orgCapacity = d.technical_capability;
  const financialControls = d.financial_stability;

  let score =
    impact * 0.3 +
    mAndE * 0.2 +
    grantMgmt * 0.2 +
    orgCapacity * 0.15 +
    financialControls * 0.15;

  if (orgType === "NGO") score = Math.min(100, score + 5);
  if (devThemes.length > 2) score = Math.min(100, score + 3);

  return Math.round(score);
}
