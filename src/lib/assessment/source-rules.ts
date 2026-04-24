/**
 * Configurable source-level suppression rules for tender matching.
 *
 * Add entries here to gate or down-rank tenders by source domain without
 * code changes. Rules are evaluated in order; first match wins.
 *
 * Sprint 4: extend with scoreFactor for soft down-ranking.
 */

export interface SourceRule {
  /** Suppress when source_url contains this substring (case-insensitive). */
  domain: string;
  /**
   * Suppress this source unless the user's countrySet contains at least one
   * of these values (all lowercase).
   */
  requiresAnyCountry?: string[];
  /** Human-readable explanation for logs / future UI. */
  label?: string;
}

/**
 * Ordered list of source suppression rules.
 * First matching rule suppresses the tender.
 */
export const SOURCE_RULES: SourceRule[] = [
  {
    domain: "sam.gov",
    requiresAnyCountry: [
      "united states",
      "usa",
      "united states of america",
      "u.s.",
      "u.s.a.",
    ],
    label: "US Federal procurement — requires US entity registration / CAGE code",
  },
];

/**
 * Returns true when the tender from `sourceUrl` should be suppressed for
 * this user given their `countrySet` (already lowercased and alias-expanded).
 */
export function shouldSuppressSource(
  sourceUrl: string,
  countrySet: Set<string>,
): boolean {
  const urlLower = sourceUrl.toLowerCase();
  for (const rule of SOURCE_RULES) {
    if (!urlLower.includes(rule.domain)) continue;
    if (rule.requiresAnyCountry) {
      const hasRequired = rule.requiresAnyCountry.some((c) => countrySet.has(c));
      if (!hasRequired) return true;
    }
  }
  return false;
}
