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
    "diaper", "diapers", "medical supply", "healthcare supply",
  ],
  logistics: [
    "logistic", "supply chain", "warehous", "freight", "transport",
    "shipping", "distribution", "last mile", "last-mile", "fleet", "customs",
    "procurement service", "procurement and delivery", "supply and delivery",
    "delivery of goods", "delivery and installation", "installation and delivery",
    "supply of goods", "supply of basic goods", "general goods",
    "non-specialized goods", "non specialized goods", "non-food item",
    "non food item", "nfi", "relief item", "hygiene kit",
    "spare part", "replacement part", "furniture", "office supplies",
    "school furniture", "accommodation", "accommodation service",
    "lodging", "lodging service", "hotel venue",
    "forwarding", "haulage", "trucking", "cargo", "stockpile",
    "prepositioning", "pre-positioning", "clearing agent", "clearance service",
    "storage service", "fuel delivery",
    // UNGM/UNSPSC-informed warehousing & distribution terms (UNSPSC 78xxx)
    "bonded warehouse", "fulfillment", "cold chain", "cold storage",
    "distribution center", "3pl", "third-party logistic", "stevedoring",
    "port handling", "cargo handling", "cross-dock", "material handling",
    "packing service", "port service", "courier service", "parcel deliver",
    "transit storage", "in-transit storage",
    // Extended warehouse/storage terms (DevelopmentAid / UNGM patterns)
    "inventory storage", "inventory management",
    "records storage", "archive storage", "document storage",
    "storage facility", "storage facilities", "warehousing services",
    "rental of storage", "storage space", "temporary storage",
    "container depot", "bulk storage", "secure storage",
    "yard management", "open storage", "fulfillment center",
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
    "public financial management", "public administration", "institutional support",
    "programme management", "project management",
  ],
  food: [
    "food", "nutrition supply", "catering", "meal", "commodit",
    "foodstuff", "ration pack", "emergency ration", "grain",
    "bakery", "bakeries", "bread", "ready-to-eat", "ready to eat",
    "food basket", "food baskets", "rte basket",
  ],
  security: [
    "security service", "guard", "surveillance", "safety service",
    "protection service", "demining", "de-mining", "risk manage",
    "fire safety", "security assessment", "security training",
    "ngo safety", "ngo security", "security risk", "security management",
    "security analysis", "defensive driving", "armored vehicle",
    "armoured vehicle", "protective service",
  ],
  language_services: [
    "translation", "interpret", "language service", "linguist",
    "localization", "localisation", "proofreading", "editing",
    "subtitling", "voice-over", "voice over", "dubbing",
    "multilingual",
  ],
  engineering: [
    "engineering", "mechanical", "electrical install", "structural",
    "design service", "technical design", "spare part", "production line",
    "maintenance of production", "mechanical spare",
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
    "borehole", "boreholes", "water supply", "water and sanitation",
    "wastewater", "water network", "water networks", "pumping line",
    "pump station", "sewage network", "sewage networks",
    "water infrastructure", "water supply system", "water harvesting",
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
  "warehousing": "logistics",
  "warehousing & distribution": "logistics",
  "storage": "logistics",
  "storage & warehousing": "logistics",
  "food security & supply chain": "logistics",
  "food security & humanitarian logistics": "logistics",
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
  "operational safety & security": "security",
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
  "janitorial & maintenance": "environment",
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

const NAICS_PREFIX_TO_SLUG: Array<[RegExp, SectorSlug]> = [
  [/^11/, "agriculture"],
  [/^21/, "energy"],
  [/^22/, "energy"],
  [/^23/, "construction"],
  [/^311|^312/, "food"],
  [/^3254|^3391/, "healthcare"],
  [/^31|^32|^33/, "engineering"],
  [/^4234|^446|^621|^622|^623|^624/, "healthcare"],
  [/^42343|^42344|^5112|^5121|^517|^518|^519|^5415/, "it"],
  [/^42|^44|^45/, "logistics"],
  [/^48|^49/, "logistics"],
  [/^5413/, "engineering"],
  [/^5417/, "consulting"],
  [/^54/, "consulting"],
  [/^5616/, "security"],
  [/^5617|^562/, "environment"],
  [/^56/, "consulting"],
  [/^61/, "education"],
  [/^72/, "food"],
  [/^811|^812/, "engineering"],
];

const CPV_PREFIX_TO_SLUG: Array<[RegExp, SectorSlug]> = [
  [/^03/, "agriculture"],
  [/^15/, "food"],
  [/^30|^32|^48|^72/, "it"],
  [/^33|^85/, "healthcare"],
  [/^34|^60|^63/, "logistics"],
  [/^35/, "security"],
  [/^38|^42|^50|^71/, "engineering"],
  [/^41|^65|^90/, "water_sanitation"],
  [/^44|^45/, "construction"],
  [/^55/, "food"],
  [/^64/, "it"],
  [/^73|^75|^79|^98/, "consulting"],
  [/^77/, "environment"],
  [/^80/, "education"],
];

export function naicsCodeToSlug(code: string | null | undefined): SectorSlug | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return NAICS_PREFIX_TO_SLUG.find(([re]) => re.test(digits))?.[1] ?? null;
}

export function cpvCodeToSlug(code: string | null | undefined): SectorSlug | null {
  if (!code) return null;
  const digits = code.replace(/\D/g, "");
  if (digits.length < 2) return null;
  return CPV_PREFIX_TO_SLUG.find(([re]) => re.test(digits))?.[1] ?? null;
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
    // Pure numeric codes (allow separators like "43-21-15-00").
    // Six digits are usually NAICS (SAM.gov). Eight digits are usually UNSPSC
    // unless the source labels them as CPV (TED EU).
    if (/^\d[\d\s\-.]*$/.test(trimmed)) {
      const digits = trimmed.replace(/\D/g, "");
      const fromNaics = digits.length === 6 ? naicsCodeToSlug(digits) : null;
      const fromUnspsc = digits.length !== 6 ? unspscSegmentToSlug(digits) : null;
      for (const slug of [fromNaics, fromUnspsc]) {
        if (slug) hits.add(slug);
      }
    }
    // Multiple codes in a list ("43211500, 81112200")
    const codeMatches = trimmed.match(/\b\d{4,8}\b/g);
    if (codeMatches) {
      const cpvMarked = /\bcpv\b/i.test(trimmed);
      for (const code of codeMatches) {
        const fromNaics = code.length === 6 ? naicsCodeToSlug(code) : null;
        const fromCpv = cpvMarked && code.length === 8 ? cpvCodeToSlug(code) : null;
        const fromUnspsc = code.length !== 6 && !cpvMarked ? unspscSegmentToSlug(code) : null;
        for (const slug of [fromNaics, fromCpv, fromUnspsc]) {
          if (slug) hits.add(slug);
        }
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
    if (slug) {
      slugs.add(slug);
      continue;
    }
    // Fall back to keyword match on the label itself so "Water & Sanitation"
    // still resolves even if LABEL_TO_SLUG misses a variant.
    const fromKeywords = normalizeSector(label, null);
    for (const s of fromKeywords) slugs.add(s);
  }
  return slugs;
}
