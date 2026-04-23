import type { SectorSlug } from "@/lib/crawlers/sector-map";

export const ADJACENT_SECTORS: Partial<Record<SectorSlug, SectorSlug[]>> = {
  agriculture:     ["food", "environment", "water_sanitation", "logistics"],
  food:            ["agriculture", "logistics", "healthcare", "environment", "water_sanitation"],
  logistics:       ["food", "construction", "water_sanitation"],
  it:              ["education", "consulting", "language_services"],
  language_services: ["it", "education", "consulting"],
  construction:    ["water_sanitation", "energy", "environment", "engineering"],
  engineering:     ["construction", "energy", "environment", "water_sanitation"],
  healthcare:      ["food", "water_sanitation", "environment"],
  education:       ["it", "language_services"],
  environment:     ["agriculture", "water_sanitation", "energy", "construction"],
  water_sanitation:["construction", "healthcare", "agriculture", "environment"],
  energy:          ["engineering", "construction", "environment"],
  security:        ["logistics", "consulting"],
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
