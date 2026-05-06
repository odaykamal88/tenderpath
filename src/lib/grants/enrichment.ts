import { ALL_COUNTRIES, REGION_GROUPS } from "@/lib/countries";
import { normalizeSector, type SectorSlug } from "@/lib/crawlers/sector-map";

export type GrantMetadataPatch = {
  sector: SectorSlug | null;
  themes: string[];
  eligible_org_types: string[];
  country: string | null;
  region: string | null;
  countries: string[];
  value_range: string | null;
  reasons: string[];
};

export type GrantLike = {
  title?: string | null;
  agency?: string | null;
  sector?: string | null;
  themes?: unknown;
  eligible_org_types?: unknown;
  country?: string | null;
  region?: string | null;
  countries?: unknown;
  value_range?: string | null;
};

const COUNTRY_TO_REGION = new Map(
  ALL_COUNTRIES.map((row) => [row.country.toLowerCase(), row.region]),
);

const REGION_ALIASES: Record<string, string> = {
  africa: "Sub-Saharan Africa",
  "sub-saharan africa": "Sub-Saharan Africa",
  mena: "Middle East & North Africa",
  "middle east": "Middle East & North Africa",
  "middle east and north africa": "Middle East & North Africa",
  asia: "South & Southeast Asia",
  "south asia": "South & Southeast Asia",
  "southeast asia": "South & Southeast Asia",
  europe: "Eastern Europe & Central Asia",
  "eastern europe": "Eastern Europe & Central Asia",
  "central asia": "Eastern Europe & Central Asia",
  "latin america": "Latin America & Caribbean",
  caribbean: "Latin America & Caribbean",
  pacific: "East Asia & Pacific",
  "north america": "Western Europe & North America",
};

// Common Department of State post codes in Grants.gov agency strings. We keep
// this table explicit so country inference stays auditable instead of guessing
// from every three-letter suffix.
const DOS_POST_COUNTRIES: Record<string, string> = {
  ARG: "Argentina",
  BAH: "Bahrain",
  BFA: "Burkina Faso",
  BGD: "Bangladesh",
  BGR: "Bulgaria",
  BIH: "Bosnia and Herzegovina",
  BLR: "Belarus",
  BRB: "Barbados",
  CAF: "Central African Republic",
  CIV: "Côte d'Ivoire",
  DEU: "Germany",
  EST: "Estonia",
  HND: "Honduras",
  HUN: "Hungary",
  IDN: "Indonesia",
  KEN: "Kenya",
  KGC: "Kyrgyzstan",
  LBY: "Libya",
  MDA: "Moldova",
  MLA: "Malaysia",
  MEX: "Mexico",
  MOZ: "Mozambique",
  NGA: "Nigeria",
  NER: "Niger",
  NPL: "Nepal",
  NZL: "New Zealand",
  RWA: "Rwanda",
  TGO: "Togo",
  TLS: "Timor-Leste",
  UZB: "Uzbekistan",
  VEN: "Venezuela",
  ZAM: "Zambia",
  ZWE: "Zimbabwe",
};

const DOMESTIC_US_AGENCY_RE = /^(HHS|NSF|NASA|DOC|DOL|USDA|DOI|EPA|HUD|ED|NEH|PAMS|DOD|DOE|DOT|USDOT|VA|DHS|USDOJ|BJA|NIJ|OJJDP|CDC|HRSA|NIH|ACL|AC|ONDCP|LOC)(?:-|$)/i;
const DOS_INTERNATIONAL_RE = /^DOS(?:-|$)/i;

function asArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim())
    : [];
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function regionForCountry(country: string | null): string | null {
  if (!country) return null;
  return COUNTRY_TO_REGION.get(country.toLowerCase()) ?? null;
}

function findCountryInText(text: string): string | null {
  const lower = text.toLowerCase();
  const countries = [...ALL_COUNTRIES]
    .sort((a, b) => b.country.length - a.country.length);
  for (const row of countries) {
    const escaped = row.country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(lower)) return row.country;
  }
  return null;
}

function findRegionInText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const group of REGION_GROUPS) {
    if (lower.includes(group.label.toLowerCase())) return group.label;
  }
  for (const [alias, region] of Object.entries(REGION_ALIASES)) {
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) return region;
  }
  return null;
}

function inferGeography(title: string, agency: string): Pick<GrantMetadataPatch, "country" | "region" | "countries"> & { reasons: string[] } {
  const reasons: string[] = [];
  const explicitCountry = findCountryInText(`${title} ${agency}`);
  if (explicitCountry) {
    reasons.push(`country from title/agency: ${explicitCountry}`);
    return {
      country: explicitCountry,
      region: regionForCountry(explicitCountry),
      countries: [explicitCountry],
      reasons,
    };
  }

  const dosCode = agency.match(/^DOS-([A-Z]{3})(?:-|$)/i)?.[1]?.toUpperCase();
  const dosCountry = dosCode ? DOS_POST_COUNTRIES[dosCode] : null;
  if (dosCountry) {
    reasons.push(`country from DOS post code: ${dosCode}`);
    return {
      country: dosCountry,
      region: regionForCountry(dosCountry),
      countries: [dosCountry],
      reasons,
    };
  }

  if (DOMESTIC_US_AGENCY_RE.test(agency) && !DOS_INTERNATIONAL_RE.test(agency)) {
    reasons.push("country from U.S.-domestic agency prefix");
    return {
      country: "United States",
      region: regionForCountry("United States"),
      countries: ["United States"],
      reasons,
    };
  }

  const explicitRegion = findRegionInText(`${title} ${agency}`);
  if (explicitRegion) {
    reasons.push(`region from title/agency: ${explicitRegion}`);
    return { country: null, region: explicitRegion, countries: [], reasons };
  }

  return { country: null, region: null, countries: [], reasons };
}

function inferThemesAndEligibility(text: string, agency: string): {
  themes: string[];
  eligible_org_types: string[];
  value_range: string | null;
  reasons: string[];
} {
  const themes: string[] = [];
  const orgs: string[] = [];
  const reasons: string[] = [];
  let valueRange: string | null = null;

  if (/\b(alumni engagement innovation fund|aeif)\b/i.test(text)) {
    return {
      themes: ["education", "training", "youth", "capacity building", "civil society"],
      eligible_org_types: ["NGO", "education_institution", "research_institution"],
      value_range: DOS_INTERNATIONAL_RE.test(agency) ? "small_grant" : null,
      reasons: ["alumni/public-diplomacy grant pattern"],
    };
  }

  const add = (matched: boolean, nextThemes: string[], nextOrgs: string[], reason: string) => {
    if (!matched) return;
    themes.push(...nextThemes);
    orgs.push(...nextOrgs);
    reasons.push(reason);
  };

  add(/\b(education|training|learning|school|student|youth|alumni|fellowship|exchange|curriculum|teacher|university|academic|workforce|skills)\b/i.test(text),
    ["education", "training", "youth", "capacity building"],
    ["NGO", "education_institution", "research_institution"],
    "education/youth keywords");
  add(/\b(health|medical|clinical|hospital|disease|hiv|aids|malaria|mental health|behavioral health|opioid|substance use|nutrition|maternal|screening|telehealth)\b/i.test(text),
    ["health", "public health", "medical", "nutrition"],
    ["NGO", "research_institution", "education_institution", "government_entity"],
    "health keywords");
  add(/\b(agricultur|food security|farm|crop|rural|livelihood|nutrition assistance|commodity)\b/i.test(text),
    ["agriculture", "food security", "rural development", "livelihoods"],
    ["NGO", "company", "cooperative", "research_institution", "education_institution"],
    "agriculture/food keywords");
  add(/\b(wash|water|sanitation|hygiene|wastewater|drinking water)\b/i.test(text),
    ["wash", "water", "sanitation", "public health"],
    ["NGO", "company", "government_entity", "research_institution"],
    "WASH keywords");
  add(/\b(climate|environment|conservation|biodiversity|wildlife|ecosystem|wetland|coastal|ocean|fisheries|pollution|resilience)\b/i.test(text),
    ["climate", "environment", "biodiversity", "natural resources", "resilience"],
    ["NGO", "research_institution", "education_institution", "government_entity"],
    "environment/climate keywords");
  add(/\b(energy|renewable|solar|electric|grid|hydrogen|critical mineral|battery|efficiency)\b/i.test(text),
    ["energy", "renewable energy", "climate", "infrastructure"],
    ["company", "research_institution", "education_institution", "government_entity"],
    "energy keywords");
  add(/\b(digital|technology|software|data|cyber|innovation|artificial intelligence|\bai\b|machine learning|robotics|uas|drone|broadband|telecommunications)\b/i.test(text),
    ["digital", "technology", "innovation", "data"],
    ["company", "research_institution", "education_institution"],
    "digital/technology keywords");
  add(/\b(democracy|governance|civil society|human rights|rule of law|justice|anti-corruption|media|journalis|public diplomacy|countering disinformation)\b/i.test(text),
    ["governance", "civil society", "rule of law", "democracy"],
    ["NGO", "research_institution", "education_institution"],
    "governance/civil society keywords");
  add(/\b(security|counterterrorism|terrorism|law enforcement|gang|violence|trafficking|conflict|peacebuilding|stabilization|protection)\b/i.test(text),
    ["security", "peacebuilding", "protection", "rule of law"],
    ["NGO", "research_institution", "government_entity"],
    "security/peacebuilding keywords");

  if (DOS_INTERNATIONAL_RE.test(agency)) {
    themes.push("civil society", "capacity building");
    orgs.push("NGO", "education_institution", "research_institution");
    valueRange = "small_grant";
    reasons.push("Department of State assistance-style grant");
  }

  if (/^(NSF|NASA|PAMS|DOE|DOC-NIST)(?:-|$)/i.test(agency)) {
    orgs.push("research_institution", "education_institution", "company");
    themes.push("research", "innovation");
    reasons.push("research/science agency");
  }

  if (/^(USDA|DOI|EPA|DOC-DOCNOAA)(?:-|$)/i.test(agency)) {
    orgs.push("NGO", "research_institution", "education_institution", "government_entity", "company");
    reasons.push("environment/agriculture agency eligibility pattern");
  }

  if (/^(HHS|ED|HUD|DOL|USDOJ|VA)(?:-|$)/i.test(agency)) {
    orgs.push("NGO", "education_institution", "government_entity", "research_institution");
    reasons.push("domestic public-service agency eligibility pattern");
  }

  return {
    themes: unique(themes),
    eligible_org_types: unique(orgs),
    value_range: valueRange,
    reasons,
  };
}

export function inferGrantMetadata(grant: GrantLike): GrantMetadataPatch {
  const title = grant.title?.trim() ?? "";
  const agency = grant.agency?.trim() ?? "";
  const text = `${title} ${agency}`;
  const reasons: string[] = [];

  const sectorHits = normalizeSector(grant.sector ?? "", title, "");
  const sector = /\b(alumni engagement innovation fund|aeif)\b/i.test(`${title} ${agency}`)
    ? "education"
    : sectorHits[0] ?? null;
  if (sector) reasons.push(`sector from normalized title/sector: ${sector}`);

  const geography = inferGeography(title, agency);
  const profile = inferThemesAndEligibility(text, agency);

  return {
    sector,
    themes: profile.themes,
    eligible_org_types: profile.eligible_org_types,
    country: geography.country,
    region: geography.region,
    countries: geography.countries,
    value_range: profile.value_range,
    reasons: unique([...reasons, ...geography.reasons, ...profile.reasons]),
  };
}

export function grantPatchHasSignal(patch: GrantMetadataPatch): boolean {
  return !!patch.sector
    || patch.themes.length > 0
    || patch.eligible_org_types.length > 0
    || !!patch.country
    || !!patch.region
    || patch.countries.length > 0
    || !!patch.value_range;
}

export function mergeGrantMetadata(existing: GrantLike, patch: GrantMetadataPatch): GrantMetadataPatch {
  const existingCountries = asArray(existing.countries);
  return {
    sector: existing.sector?.trim() ? existing.sector.trim() as SectorSlug : patch.sector,
    themes: asArray(existing.themes).length ? asArray(existing.themes) : patch.themes,
    eligible_org_types: asArray(existing.eligible_org_types).length ? asArray(existing.eligible_org_types) : patch.eligible_org_types,
    country: existing.country?.trim() || patch.country,
    region: existing.region?.trim() || patch.region,
    countries: existingCountries.length ? existingCountries : patch.countries,
    value_range: existing.value_range?.trim() || patch.value_range,
    reasons: patch.reasons,
  };
}
