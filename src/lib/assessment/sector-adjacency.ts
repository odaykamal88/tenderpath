import type { SectorSlug } from "@/lib/crawlers/sector-map";

export const ADJACENT_SECTORS: Partial<Record<SectorSlug, SectorSlug[]>> = {
  agriculture:     ["food", "environment", "water_sanitation", "logistics"],
  food:            ["agriculture", "logistics", "healthcare", "environment", "water_sanitation"],
  // Logistics expands to operational adjacencies: security (guard/escort),
  // food (rations/supply), construction (camp/prefab/depot build), and
  // engineering (vehicle maintenance, cold-chain infrastructure).
  logistics:       ["security", "food", "construction", "engineering"],
  // Remove consulting — IT companies should not see consultant/advisory tenders.
  it:              ["education", "language_services"],
  // Remove consulting — language/doc firms should not see advisory tenders.
  language_services: ["it", "education"],
  construction:    ["water_sanitation", "energy", "environment", "engineering"],
  engineering:     ["construction", "energy", "environment", "water_sanitation"],
  healthcare:      ["food", "water_sanitation", "environment"],
  education:       ["it", "language_services"],
  environment:     ["agriculture", "water_sanitation", "energy", "construction"],
  water_sanitation:["construction", "healthcare", "agriculture", "environment"],
  energy:          ["engineering", "construction", "environment"],
  // Remove consulting from security adjacency — warehouse/guard firms don't
  // bid on individual-consultant postings.
  security:        ["logistics"],
  consulting:      ["it", "education", "language_services"],
};

export function computeAdjacentSlugs(userSlugs: Set<SectorSlug>): Set<SectorSlug> {
  const out = new Set<SectorSlug>();
  for (const slug of userSlugs) {
    for (const neighbour of ADJACENT_SECTORS[slug] ?? []) {
      if (!userSlugs.has(neighbour)) out.add(neighbour);
    }
  }
  return out;
}
