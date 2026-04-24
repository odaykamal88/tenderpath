/**
 * Sector normalization. Crawler feeds publish sector/theme strings in wildly
 * different vocabularies (UNSPSC text, OCDS CPV codes, ReliefWeb theme names,
 * free-form agency labels). Matching relies on a single 14-slug vocabulary
 * shared with `classifyIndustry` so a user's "Information Technology" actually
 * lines up with a tender tagged "56101504 - Software development services".
 */

export type SectorSlug =
  | "it"
  | "education"
  | "healthcare"
  | "logistics"
  | "construction"
  | "consulting"
  | "food"
  | "security"
  | "language_services"
  | "engineering"
  | "environment"
  | "agriculture"
  | "water_sanitation"
  | "energy";

export const SECTOR_SLUGS: SectorSlug[] = [
  "it", "education", "healthcare", "logistics", "construction", "consulting",
  "food", "security", "language_services", "engineering", "environment",
  "agriculture", "water_sanitation", "energy",
];

// Keyword → slug map. Checked against lowercased raw sector + title + description.
// Ordered roughly by specificity — first hit wins per slug, but every slug
// that matches is returned so a "construction consultancy" hits both.
const SLUG_KEYWORDS: Record<SectorSlug, string[]> = {
  it: [
    "software", "it service", "information technolog", "information system",
    "digital", "saas", "cloud", "cyber", "data center", "hardware",
    "computing", "internet service", "web develop", "mobile app",
    "ict", "platform develop", "system integrat", "database", "devops",
    "technolog",
  ],
  education: [
    "education", "training", "teaching", "capacity build", "curriculum",
    "learning", "school", "university", "academic", "e-learning",
    "skills develop", "vocational",
  ],
  healthcare: [
    "health", "medical", "pharmaceutic", "hospital", "clinic", "vaccine",
    "disease", "hiv", "malaria", "tuberculosis", "maternal", "nutrition",
    "surgery", "medicine", "diagnostic", "laboratory service",
  ],
  logistics: [
    "logistic", "supply chain", "warehous", "freight", "transport",
    "shipping", "distribution", "last mile", "last-mile", "fleet", "customs",
    "procurement service", "procurement and delivery", "supply and delivery",
    "delivery of goods", "delivery and installation", "installation and delivery",
    "forwarding", "haulage", "trucking", "cargo", "stockpile",
    "prepositioning", "pre-positioning", "clearing agent", "clearance service",
    "storage service", "fuel delivery",
    // UNGM/UNSPSC-informed warehousing & distribution terms (UNSPSC 78xxx)
    "bonded warehouse", "fulfillment", "cold chain", "cold storage",
    "distribution center", "3pl", "third-party logistic", "stevedoring",
    "port handling", "cargo handling", "cross-dock", "material handling",
    "packing service", "port service", "courier service", "parcel deliver",
    "transit storage", "in-transit storage",
  ],
  construction: [
    "construction", "building work", "civil work", "infrastructure",
    "roadwork", "bridge", "housing", "renovation", "rehabilitation of",
    "demolition", "architecture", "road construction",
  ],
  consulting: [
    "consulting", "consultancy", "advisory", "technical assistance",
    "policy", "research service", "evaluation service", "mid-term evaluation",
    "final evaluation", "external evaluation", "impact evaluation",
    "monitoring and evaluation", "m&e ",
    "assessment service", "feasibility stud", "governance",
    "public financial management", "institutional support",
    "programme management", "project management",
  ],
  food: [
    "food", "nutrition supply", "catering", "meal", "commodit",
    "foodstuff", "ration", "grain",
  ],
  security: [
    "security service", "guard", "surveillance", "safety service",
    "protection service", "demining", "de-mining", "risk manage",
    "fire safety",
  ],
  language_services: [
    "translation", "interpret", "language service", "linguist",
    "localization", "localisation",
  ],
  engineering: [
    "engineering", "mechanical", "electrical install", "structural",
    "design service", "technical design",
  ],
  environment: [
    "environment", "climate", "biodivers", "conservation", "ecosystem",
    "pollution", "waste manage", "recycling", "forestry", "carbon",
  ],
  agriculture: [
    "agricultur", "farm", "livestock", "crop", "irrigation", "fisher",
    "aquaculture", "food security", "rural develop",
  ],
  water_sanitation: [
    "water", "sanitation", "wash ", "hygiene", "sewer", "latrine",
    "borehole", "water supply", "water and sanitation",
  ],
  energy: [
    "energy", "electricity", "solar", "power supply", "renewable",
    "photovoltaic", "grid ", "fuel supply", "generator",
  ],
};

// Human-readable sector labels (what the AI typically returns in `sectors[]`)
// mapped to slugs. Lets us match "Information Technology" → "it" directly
// instead of relying solely on keyword fuzz.
const LABEL_TO_SLUG: Record<string, SectorSlug> = {
  "information technology": "it",
  "it": "it",
  "ict": "it",
  "technology": "it",
  "software": "it",
  "digital services": "it",
  "education": "education",
  "training": "education",
  "capacity building": "education",
  "education & training": "education",
  "healthcare": "healthcare",
  "health": "healthcare",
  "medical": "healthcare",
  "logistics": "logistics",
  "logistics & supply chain": "logistics",
  "supply chain": "logistics",
  "transport": "logistics",
  "construction": "construction",
  "infrastructure": "construction",
  "consulting": "consulting",
  "consulting services": "consulting",
  "professional services": "consulting",
  "advisory": "consulting",
  "advisory services": "consulting",
  "technical assistance": "consulting",
  "monitoring and evaluation": "consulting",
  "monitoring & evaluation": "consulting",
  "program/project management": "consulting",
  "program management": "consulting",
  "project management": "consulting",
  "programme management": "consulting",
  "staffing & human resources": "consulting",
  "human resources": "consulting",
  "staffing": "consulting",
  "food": "food",
  "food services": "food",
  "catering": "food",
  "nutrition": "food",
  "security": "security",
  "security services": "security",
  "language services": "language_services",
  "translation": "language_services",
  "publishing & communications": "language_services",
  "publishing & media services": "language_services",
  "publishing": "language_services",
  "communications": "language_services",
  "editorial services": "language_services",
  "engineering": "engineering",
  "environment": "environment",
  "climate": "environment",
  "environmental services": "environment",
  "waste management": "environment",
  "waste management & environmental services": "environment",
  "facility management": "environment",
  "agriculture": "agriculture",
  "rural development": "agriculture",
  "water and sanitation": "water_sanitation",
  "water & sanitation": "water_sanitation",
  "wash": "water_sanitation",
  "water": "water_sanitation",
  "energy": "energy",
  "renewable energy": "energy",
  "power": "energy",
};

export function slugFromLabel(label: string | null | undefined): SectorSlug | null {
  if (!label) return null;
  const key = label.trim().toLowerCase();
  return LABEL_TO_SLUG[key] ?? null;
}

/**
 * UNSPSC → sector slug. UN feeds (UNGM, UNDP) tag notices with UNSPSC codes,
 * where the first 2 digits are the segment. Segments are authoritative at
 * the top of the tree, so this mapping carries real signal even when the
 * notice has no useful title or sector string.
 *
 * Source: https://www.unspsc.org/codeset — taxonomy is stable across versions.
 * Covers the segments that actually show up in UN procurement; leftovers
 * (raw materials, chemicals, live plants, etc.) return null so callers can
 * fall back to keyword matching.
 */
const UNSPSC_SEGMENT_TO_SLUG: Record<string, SectorSlug> = {
  // 10 - Live plant/animal material → agriculture
  "10": "agriculture",
  // 26 - Power generation / electrical equipment
  "26": "energy",
  // 31 - Manufacturing components / industrial supplies → engineering
  "31": "engineering",
  // 39 - Electrical systems / lighting / power generation
  "39": "energy",
  // 41 - Lab / measuring / observing equipment → engineering
  "41": "engineering",
  // 42 - Medical equipment, accessories, supplies
  "42": "healthcare",
  // 43 - IT broadcasting and telecom
  "43": "it",
  // 44 - Office equipment → consulting (closest fit in our vocab)
  "44": "consulting",
  // 46 - Defense/law-enforcement/security/safety
  "46": "security",
  // 47 - Cleaning equipment/supplies — no slug; skip
  // 50 - Food, beverage, tobacco
  "50": "food",
  // 51 - Drugs & pharmaceutical products
  "51": "healthcare",
  // 53 - Apparel/luggage/personal care — no slug; skip
  // 55 - Published products — no slug; skip
  // 56 - Furniture — no slug; skip
  // 60 - Musical/recreational/educational equipment/supplies
  "60": "education",
  // 70 - Farming / fishing / forestry / wildlife
  "70": "agriculture",
  // 71 - Mining / oil & gas services
  "71": "energy",
  // 72 - Building, construction, maintenance services
  "72": "construction",
  // 73 - Industrial production / manufacturing services → engineering
  "73": "engineering",
  // 76 - Cleaning & waste management services
  "76": "environment",
  // 77 - Environmental services
  "77": "environment",
  // 78 - Transportation, storage, mail services
  "78": "logistics",
  // 80 - Management & business/admin/professional services
  "80": "consulting",
  // 81 - Research & scientific services (includes software/engineering R&D)
  "81": "it",
  // 82 - Editorial/design/graphic/fine-art (covers translation/linguistics)
  "82": "language_services",
  // 83 - Public utilities / public-sector services (water, sewerage)
  "83": "water_sanitation",
  // 84 - Financial & insurance services — no slug; skip
  // 85 - Healthcare services
  "85": "healthcare",
  // 86 - Education & training services
  "86": "education",
  // 90 - Travel/food/lodging/entertainment services — no slug; skip
  // 91 - Personal & domestic services — no slug; skip
  // 92 - National defense / public order / security / safety services
  "92": "security",
  // 93 - Politics / civic affairs — no slug; skip
  // 94 - Organizations & clubs — no slug; skip
  // 95 - Land / buildings / structures / thoroughfares — construction-adjacent
  "95": "construction",
};

/**
 * Map a UNSPSC code (full or 2-digit segment) to a canonical sector slug.
 * Accepts "43211500", "43-21-15-00", or "43". Returns null when the segment
 * has no meaningful mapping in our 14-slug vocab.
 */
export function unspscSegmentToSlug(code: string | null | undefined): SectorSlug | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return UNSPSC_SEGMENT_TO_SLUG[digits.slice(0, 2)] ?? null;
}

/**
 * Classify a tender into zero or more sector slugs based on its raw
 * sector string plus title/description context. Multi-label because a
 * "consulting services for water supply" tender legitimately matches both.
 */
export function normalizeSector(
  rawSector: string | null | undefined,
  title: string | null | undefined,
  description?: string | null,
): SectorSlug[] {
  const haystack = [rawSector, title, description].filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return [];

  // Label-exact check on the raw sector (handles AI-style labels on some feeds).
  const direct = slugFromLabel(rawSector);
  const hits = new Set<SectorSlug>();
  if (direct) hits.add(direct);

  // UNSPSC / NAICS-style numeric-coded feeds (UNGM, SAM.gov, WB) lose all
  // sector signal through keyword matching. Try segment mapping first so
  // "336413" → engineering instead of null.
  if (rawSector) {
    const trimmed = rawSector.trim();
    // Pure numeric codes (allow separators like "43-21-15-00")
    if (/^\d[\d\s\-.]*$/.test(trimmed)) {
      const fromCode = unspscSegmentToSlug(trimmed);
      if (fromCode) hits.add(fromCode);
    }
    // Multiple codes in a list ("43211500, 81112200")
    const codeMatches = trimmed.match(/\b\d{4,8}\b/g);
    if (codeMatches) {
      for (const code of codeMatches) {
        const s = unspscSegmentToSlug(code);
        if (s) hits.add(s);
      }
    }
  }

  for (const slug of SECTOR_SLUGS) {
    if (hits.has(slug)) continue;
    for (const kw of SLUG_KEYWORDS[slug]) {
      if (haystack.includes(kw)) {
        hits.add(slug);
        break;
      }
    }
  }
  return [...hits];
}

/**
 * Collapse the AI's sectors[] array (human-readable labels) + detected_industry
 * slug into a Set of slugs for matching. detected_industry is already a slug.
 */
export function userSectorSlugs(
  detectedIndustry: string | null | undefined,
  sectorLabels: string[] | null | undefined,
): Set<SectorSlug> {
  const slugs = new Set<SectorSlug>();
  if (detectedIndustry && (SECTOR_SLUGS as string[]).includes(detectedIndustry)) {
    slugs.add(detectedIndustry as SectorSlug);
  }
  for (const label of sectorLabels ?? []) {
    const slug = slugFromLabel(label);
    if (slug) slugs.add(slug);
    // Fall back to keyword match on the label itself so "Water & Sanitation"
    // still resolves even if LABEL_TO_SLUG misses a variant.
    const fromKeywords = normalizeSector(label, null);
    for (const s of fromKeywords) slugs.add(s);
  }
  return slugs;
}
