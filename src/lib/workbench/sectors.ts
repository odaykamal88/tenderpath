/* Sector taxonomy for the profile type-ahead editor. Suggestions only — the
 * editor accepts free text too (matched to an existing label or added as new),
 * since the backend stores sectors as a single free-text `users.sector` field. */
export const SECTOR_TAXONOMY: string[] = [
  "Climate advisory", "Climate adaptation", "Climate finance", "Environmental advisory",
  "Monitoring & Evaluation", "Research & data", "Baseline & endline surveys",
  "Logistics", "Supply chain", "Warehousing & transport", "Procurement services",
  "Renewable energy", "Solar systems", "Off-grid energy", "Energy efficiency",
  "Health systems", "Health infrastructure", "WASH", "Nutrition",
  "Education", "Digital skills", "EdTech", "Vocational training",
  "Gender & inclusion", "Protection", "Humanitarian response", "Resilience",
  "Governance", "Public financial management", "Anti-corruption",
  "Agriculture", "Food security", "Rural development",
  "Infrastructure", "Construction", "Roads & transport",
  "ICT & digital", "Software development", "Data systems", "GIS & mapping",
  "Financial inclusion", "Private sector development", "SME support",
  "Translation & localization", "Communications", "Capacity building",
];

/** Split a free-text sector field into chips. */
export function splitSectors(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[·,;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Join chips back to the stored free-text form. */
export function joinSectors(chips: string[]): string {
  return chips.join(" · ");
}
