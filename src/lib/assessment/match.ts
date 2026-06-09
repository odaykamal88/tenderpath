import { sql } from "@/lib/db";
import type { MatchedTender, MatchedGrant, AIAnalysis, MatchReason, GeographyMode, OpportunityBucket } from "@/lib/types";
import { SECTOR_SLUGS, normalizeSector, userSectorSlugs, type SectorSlug } from "@/lib/crawlers/sector-map";
import { ALL_COUNTRIES } from "@/lib/countries";
import { computeAdjacentSlugs } from "./sector-adjacency";
import { shouldSuppressSource } from "./source-rules";
import { enrichTopMatches } from "./enrich";

// Non-Latin scripts: Arabic, CJK, Cyrillic, Greek, Hebrew, Thai, Devanagari, etc.
const NON_LATIN_SCRIPT = /[\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;

const FOREIGN_TOKENS = new Set([
  "le", "la", "les", "des", "du", "une", "aux", "pour", "avec", "sur", "dans", "est", "sont", "sélection", "appel", "offres", "fourniture", "marché", "recrutement",
  "el", "los", "las", "unos", "unas", "para", "con", "por", "sobre", "em", "aos", "das", "dos", "contratação", "licitación", "licitacao", "servicios", "serviços",
  "gli", "degli", "dei", "delle", "della", "nella", "sulla", "appalto",
  "und", "oder", "mit", "für", "auf", "ein", "eine", "einen", "vergabe", "ausschreibung", "lieferung",
]);

function isEnglishTitle(title: string, submissionLanguage: string | null): boolean {
  if (!title) return false;
  if (NON_LATIN_SCRIPT.test(title)) return false;

  const lang = (submissionLanguage ?? "").toLowerCase();
  if (lang && lang !== "english" && lang !== "en") return false;

  const lower = title.toLowerCase();
  const accentHits = (lower.match(/[àâäçéèêëîïôöùûüÿñãõ]/g) ?? []).length;
  if (accentHits >= 3) return false;

  const tokens = lower.split(/[\s,.:;\-–—/()\[\]"']+/).filter(Boolean);
  if (tokens.length < 3) return true;
  let foreignHits = 0;
  for (const tok of tokens) if (FOREIGN_TOKENS.has(tok)) foreignHits++;
  return foreignHits < 2;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "will", "your",
  "our", "are", "not", "but", "can", "all", "any", "has", "into", "out", "via",
  "per", "its", "their", "them", "these", "those", "other", "more", "such",
  "including", "provide", "providing", "services", "service", "solutions",
  "solution", "support", "company", "companies", "work", "works", "based",
  "offer", "offering",
  // Generic tender/role vocabulary — these fire on nearly every UN notice
  // regardless of industry and drown out real capability signal.
  "management", "specialist", "coordinator", "project", "program", "programme",
  "manager", "assistant", "consultant", "technical", "assistance", "advisory",
  "development", "capacity", "building", "registration", "ungm", "public",
  "context", "systems", "governance",
  // Generic procurement verbs. "Supply and delivery of laptops" is an IT
  // goods tender, not a logistics-services tender.
  "supply", "delivery", "deliver", "procurement", "provision",
]);

const GRANT_TOKEN_STOPWORDS = new Set([
  "security", "development", "capacity", "building", "program", "programme",
  "grant", "grants", "fund", "funding", "assistance", "regional",
]);

const GENERIC_CONSULTING_MATCH_TOKENS = new Set([
  "advisory",
  "analysis",
  "assistance",
  "assessment",
  "capacity",
  "consultancy",
  "consulting",
  "development",
  "financial",
  "governance",
  "institutional",
  "management",
  "program",
  "programme",
  "project",
  "public",
  "reform",
  "services",
  "strategic",
  "strategy",
  "studies",
  "study",
  "support",
  "technical",
  "training",
]);

const DESCRIPTION_QUERY_STOPWORDS = new Set([
  "advisory",
  "climate",
  "consultancy",
  "consulting",
  "data",
  "digital",
  "education",
  "energy",
  "environment",
  "food",
  "health",
  "it ",
  "medical",
  "services",
  "solar",
  "system",
  "technology",
  "training",
  "water",
]);

function descriptionKeywordsFor(keywords: string[]): string[] {
  return keywords.filter((keyword) => {
    const normalized = keyword.trim().toLowerCase();
    return normalized.length >= 10
      && !DESCRIPTION_QUERY_STOPWORDS.has(normalized)
      && (normalized.includes(" ") || normalized.length >= 12);
  });
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

type MatchDomain =
  | "policy_research"
  | "monitoring_evaluation"
  | "health_systems"
  | "environment_climate"
  | "food_safety"
  | "media_sbc"
  | "cold_chain_monitoring"
  | "energy_access"
  | "finance_pfm";

const DOMAIN_LABELS: Record<MatchDomain, string> = {
  policy_research: "policy/research",
  monitoring_evaluation: "monitoring & evaluation",
  health_systems: "health systems",
  environment_climate: "environment/climate",
  food_safety: "food safety",
  media_sbc: "SBC/media",
  cold_chain_monitoring: "cold-chain monitoring",
  energy_access: "energy access",
  finance_pfm: "public financial management",
};

const NICHE_DOMAIN_GATES: MatchDomain[] = [
  "policy_research",
  "food_safety",
  "cold_chain_monitoring",
  "media_sbc",
  "monitoring_evaluation",
  "health_systems",
];

function detectMatchDomains(text: string): Set<MatchDomain> {
  const normalized = text.toLowerCase();
  const out = new Set<MatchDomain>();
  if (/\b(evidence[- ]?to[- ]?policy|policy research|policy dialogue|policy advisory|research (?:and|&) policy|think tank|research institution)\b/.test(normalized)) {
    out.add("policy_research");
  }
  if (/\b(monitoring and evaluation|monitoring & evaluation|\bm&e\b|third[- ]party monitoring|impact evaluation|external evaluation|baseline survey|endline survey|household survey|data collection)\b/.test(normalized)) {
    out.add("monitoring_evaluation");
  }
  if (/\b(health systems?|health financing|health policy|public health|primary health|universal health coverage|uhc|health workforce)\b/.test(normalized)) {
    out.add("health_systems");
  }
  if (/\b(environmental|environment|climate|biodiversity|waste management|sesa|strategic environmental|environmental impact|eia)\b/.test(normalized)) {
    out.add("environment_climate");
  }
  if (/\b(food safety|haccp|codex|iso 22000|food quality|food compliance|food control|phytosanitary|sanitary standard|laboratory testing)\b/.test(normalized)) {
    out.add("food_safety");
  }
  if (/\b(social and behavior change|social behaviour change|\bsbc\b|sbcc|edutainment|media production|communication campaign|behavior change communication|behaviour change communication)\b/.test(normalized)) {
    out.add("media_sbc");
  }
  if (/\b(cold[- ]chain|vaccine carrier|vaccine monitoring|pqs|temperature monitor|remote monitoring|iot monitoring|data logger|refrigeration monitor)\b/.test(normalized)) {
    out.add("cold_chain_monitoring");
  }
  if (/\b(mini[- ]grid|off[- ]grid|energy access|renewable energy|solar power|photovoltaic|solar station|hybrid solar)\b/.test(normalized)) {
    out.add("energy_access");
  }
  if (/\b(public financial management|\bpfm\b|financial management and accountability|budget reform|treasury reform|public finance reform)\b/.test(normalized)) {
    out.add("finance_pfm");
  }
  return out;
}

function domainsOverlap(profileDomains: Set<MatchDomain>, tenderDomains: Set<MatchDomain>): boolean {
  for (const domain of profileDomains) {
    if (tenderDomains.has(domain)) return true;
    if (domain === "policy_research" && tenderDomains.has("monitoring_evaluation")) return true;
    if (domain === "monitoring_evaluation" && tenderDomains.has("policy_research")) return true;
    if (domain === "health_systems" && tenderDomains.has("policy_research")) return true;
  }
  return false;
}

// Country-name aliasing. User picks "Syria" but WB/UN post "Syrian Arab
// Republic"; picks "Palestine" but WB posts "West Bank and Gaza". Without
// this table every MENA/Africa/Asia user gets zero strict matches and
// autoGeoOpen fires, so they see Global results only. Keys and values are
// all lowercase for case-insensitive matching against tender.country.
const COUNTRY_ALIASES: Record<string, string[]> = {
  "syria": ["syrian arab republic", "syria (syrian arab republic)"],
  "syrian arab republic": ["syria"],
  "palestine": ["west bank and gaza", "occupied palestinian territory", "state of palestine", "palestinian territories", "gaza", "west bank", "gaza strip"],
  "iran": ["iran, islamic republic of", "islamic republic of iran"],
  "vietnam": ["viet nam"],
  "viet nam": ["vietnam"],
  "laos": ["lao people's democratic republic", "lao pdr"],
  "russia": ["russian federation"],
  "moldova": ["republic of moldova"],
  "tanzania": ["united republic of tanzania"],
  "congo": ["republic of congo", "congo-brazzaville"],
  "drc": ["democratic republic of the congo", "democratic republic of congo", "congo, dem. rep.", "dr congo"],
  "democratic republic of the congo": ["drc", "dr congo"],
  "ivory coast": ["côte d'ivoire", "cote d'ivoire"],
  "côte d'ivoire": ["ivory coast", "cote d'ivoire"],
  "cote d'ivoire": ["côte d'ivoire", "ivory coast"],
  "cabo verde": ["cape verde"],
  "cape verde": ["cabo verde"],
  "south korea": ["korea, republic of", "republic of korea"],
  "north korea": ["democratic people's republic of korea", "korea, dpr"],
  "czech republic": ["czechia"],
  "czechia": ["czech republic"],
  "macedonia": ["north macedonia", "republic of north macedonia", "former yugoslav republic of macedonia"],
  "north macedonia": ["macedonia"],
  "myanmar": ["burma"],
  "east timor": ["timor-leste", "timor leste"],
  "timor-leste": ["east timor", "timor leste"],
  "swaziland": ["eswatini"],
  "eswatini": ["swaziland"],
  "turkey": ["türkiye", "turkiye"],
  "türkiye": ["turkey"],
  "egypt": ["egypt, arab rep.", "arab republic of egypt"],
  "yemen": ["yemen, rep.", "yemen, republic of"],
  "venezuela": ["venezuela, rb", "bolivarian republic of venezuela"],
  "bolivia": ["bolivia (plurinational state of)", "plurinational state of bolivia"],
  "uk": ["united kingdom", "great britain"],
  "united kingdom": ["uk", "great britain"],
  "usa": ["united states", "united states of america", "u.s.", "u.s.a."],
  "united states": ["usa", "united states of america"],
  "uae": ["united arab emirates"],
  "united arab emirates": ["uae"],
  "saudi arabia": ["kingdom of saudi arabia"],
  "bosnia": ["bosnia and herzegovina"],
  "bosnia and herzegovina": ["bosnia"],
};

// Regional adjacency. When the user's country has thin direct supply (typical
// for Syria/Palestine/Libya/Yemen), tenders posted for a neighbour are often
// legitimate targets — UN country-offices frequently serve cross-border ops
// from an adjacent hub (Amman for Syria, Cairo for Libya, etc.). We surface
// these as a separate "Regional Opportunities" bucket rather than folding
// them into Global, so the UI can label them correctly.
const REGIONAL_NEIGHBOURS: Record<string, string[]> = {
  syria: ["lebanon", "jordan", "iraq", "turkey", "türkiye", "turkiye", "palestine", "state of palestine", "west bank and gaza"],
  lebanon: ["syria", "syrian arab republic", "jordan", "palestine", "state of palestine", "cyprus"],
  jordan: ["syria", "syrian arab republic", "lebanon", "iraq", "palestine", "state of palestine", "saudi arabia", "egypt"],
  iraq: ["syria", "syrian arab republic", "jordan", "iran", "kuwait", "saudi arabia", "turkey", "türkiye"],
  palestine: ["jordan", "lebanon", "egypt", "syria", "syrian arab republic"],
  "state of palestine": ["jordan", "lebanon", "egypt", "syria"],
  yemen: ["saudi arabia", "oman", "djibouti", "somalia", "sudan"],
  libya: ["tunisia", "egypt", "algeria", "sudan", "chad", "niger"],
  egypt: ["libya", "sudan", "palestine", "state of palestine", "jordan", "saudi arabia"],
  tunisia: ["libya", "algeria"],
  morocco: ["algeria", "mauritania", "western sahara"],
  algeria: ["morocco", "tunisia", "libya", "mauritania", "mali", "niger"],
  sudan: ["egypt", "libya", "chad", "south sudan", "ethiopia", "eritrea", "central african republic"],
  "saudi arabia": ["jordan", "iraq", "kuwait", "qatar", "bahrain", "uae", "united arab emirates", "oman", "yemen"],
  uae: ["saudi arabia", "oman", "qatar"],
  "united arab emirates": ["saudi arabia", "oman", "qatar"],
  oman: ["uae", "united arab emirates", "saudi arabia", "yemen"],
  qatar: ["saudi arabia", "uae", "united arab emirates", "bahrain"],
  kuwait: ["saudi arabia", "iraq"],
  bahrain: ["saudi arabia", "qatar"],
  iran: ["iraq", "turkey", "türkiye", "turkmenistan", "afghanistan", "pakistan", "armenia", "azerbaijan"],
  turkey: ["syria", "syrian arab republic", "iraq", "iran", "greece", "bulgaria", "georgia", "armenia"],
  "türkiye": ["syria", "iraq", "iran", "greece", "bulgaria", "georgia", "armenia"],
};

function expandRegionalSet(countries: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of countries) {
    const key = raw.trim().toLowerCase();
    const neighbours = REGIONAL_NEIGHBOURS[key];
    if (neighbours) for (const n of neighbours) out.add(n.toLowerCase());
  }
  return out;
}

function expandCountrySet(countries: string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of countries) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    out.add(key);
    const aliases = COUNTRY_ALIASES[key];
    if (aliases) for (const a of aliases) out.add(a.toLowerCase());
  }
  return out;
}

// Individual-contractor / jobs-feed titles, regardless of opportunity_type.
// Many crawlers (UNGM, SAM.gov, UNDP Atlas) tag these as "RFP" or "Individual
// Contractor" rather than "Consultancy", so the type filter alone misses them.
// Pattern is conservative — substrings that only appear in recruitment.
const INDIVIDUAL_ROLE_RE = /\b(individual contractor|individual consultant|ssa \d|special service agreement|short[- ]term expert|long[- ]term expert|roster of experts?|roster of consultants?|expert(s)? roster|consultant roster|national consultant|international consultant|junior consultant|senior consultant|home[- ]based consultant|un volunteer|unv [a-z]+|request for cv|call for cv|call for experts?|national professional officer)\b|(?:^|[-_/])ic[-_/]/i;
const RELIEFWEB_JOB_SOURCE_RE = /reliefweb\.int\/job\//i;
const INSTITUTIONAL_TENDER_RE = /\b(request for proposals?|rfp|request for quotation|rfq|invitation to bid|itb|expression of interest|eoi|tender|service provider|consulting firm|consultancy firm|company|companies|vendor|supplier|consortium|framework|long[- ]term agreement|\blta\b|pre[- ]?qualification)\b/i;
const ROLE_LIKE_CONSULTANCY_RE = /\b(specialist|officer|coordinator|assistant|manager|advisor|adviser|expert|trainer|facilitator|consultant|enumerator|analyst|lead|role|position)\b/i;

const LANGUAGE_B2B_RE = /\b(translat(?:e|ed|ing|ion|or)|interpret(?:ation|er|ing)?|linguistic|language service|locali[sz]ation|proofreading|editing|subtitling|voice[- ]over|dubbing|multilingual)\b/i;
const B2B_TENDER_RE = /\b(call for tenders?|request for proposals?|rfp|rfq|provision of|services?|lta|framework|translation\/revision)\b/i;

function isLanguageB2BTender(userSlugs: Set<SectorSlug>, text: string): boolean {
  return userSlugs.has("language_services") && LANGUAGE_B2B_RE.test(text) && B2B_TENDER_RE.test(text);
}

function isLikelyIndividualConsultancy(args: {
  title: string;
  opportunityType: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  description: string;
  requirements: string[];
  languageB2B: boolean;
}): boolean {
  if (args.languageB2B) return false;

  const text = `${args.title} ${args.opportunityType ?? ""} ${args.description.slice(0, 700)} ${args.requirements.join(" ")}`;
  const source = `${args.sourceName ?? ""} ${args.sourceUrl ?? ""}`;
  const isReliefWebJobUrl = RELIEFWEB_JOB_SOURCE_RE.test(source);

  // Audit 2026-05-20 (axiom.co.ke walkthrough): the old early-return on
  // reliefweb.int/job/ blanket-suppressed every ReliefWeb tender for firm
  // profiles. But ReliefWeb hosts BOTH individual job posts AND firm-scope
  // RFPs at the same /job/ URL pattern. ~10 firm-eligible M&E tenders were
  // silently filtered. Now: institutional markers in body override URL,
  // and we require role-like title alongside the URL signal before
  // suppressing on URL alone.
  if (INSTITUTIONAL_TENDER_RE.test(text)) return false;

  if (INDIVIDUAL_ROLE_RE.test(args.title)) return true;
  if (/\bindividual contractor|individual consultant|consultant roster|request for cv|call for experts?\b/i.test(args.opportunityType ?? "")) return true;
  // ReliefWeb URL + role-like title is still a strong individual-job signal
  // (e.g. "Evaluation Specialist" at /job/ → almost certainly an individual
  // post). Without role-like title (e.g. "Evaluation of X Programme") we
  // let the tender through.
  if (isReliefWebJobUrl && ROLE_LIKE_CONSULTANCY_RE.test(args.title)) return true;
  return /\bconsult/i.test(args.opportunityType ?? "") && ROLE_LIKE_CONSULTANCY_RE.test(args.title);
}

function isGeoOpenCountry(country: string): boolean {
  const normalized = country.toLowerCase().trim();
  return !normalized
    || normalized === "global"
    || normalized === "remote"
    || normalized === "multiple"
    || normalized === "multiple destinations"
    || normalized === "various"
    || normalized === "international"
    || normalized === "worldwide"
    || normalized === "multi-country"
    || normalized === "multicountry";
}

const OPPORTUNITY_BUCKET_META: Record<OpportunityBucket, { label: string; priority: number }> = {
  act_now: { label: "Act Now", priority: 1 },
  strong_fit: { label: "Strong Fit", priority: 2 },
  strategic: { label: "Strategic Expansion", priority: 3 },
  adjacent: { label: "Adjacent Bet", priority: 4 },
  watchlist: { label: "Watchlist", priority: 5 },
};

const HARD_LOGISTICS_RE = /\b(logistics?|supply chain|warehous(?:e|ing)|freight|transport(?:ation)?(?: services?| of)?|shipping|distribution services?|last[- ]mile|fleet|customs|cargo|supply and delivery|procurement and delivery|procurement services?|delivery of goods|supply of goods|supply of basic goods|general goods|non[- ]specialized goods|non[- ]food items?|nfi|relief items?|hygiene kits?|spare parts?|replacement parts?|furniture|office supplies|school furniture|accommodation|lodging|hotel venue|stockpil(?:e|ing)|preposition(?:ing)?|pre-position(?:ing)?|clearing agent|clearance service|storage service|cold chain|cold storage|distribution cent(?:er|re)|3pl|third-party logistic|stevedoring|port handling|cargo handling|cross-dock|material handling|packing service|courier service|parcel deliver(?:y)?|inventory storage|records storage|archive storage|document storage|storage facilit(?:y|ies)|warehousing services|storage space|temporary storage|container depot|bulk storage|secure storage|yard management|fulfillment cent(?:er|re))\b/i;
const OFFICE_EQUIPMENT_RE = /\b(photocopiers?|printers?|scanners?|toner|office equipment|office machines?)\b/i;
const HARD_ENGINEERING_RE = /\b(mechanical|electrical|civil works?|infrastructure|construction|structural|hvac|generator|solar|photovoltaic|pump(?:ing)?|water supply|wastewater|borehole|commissioning|technical design|production line)\b/i;

function refineTenderSlugs(slugs: Set<SectorSlug>, evidenceText: string): Set<SectorSlug> {
  const refined = new Set(slugs);
  if (refined.has("logistics") && !HARD_LOGISTICS_RE.test(evidenceText)) {
    refined.delete("logistics");
  }
  if (refined.has("engineering") && OFFICE_EQUIPMENT_RE.test(evidenceText) && !HARD_ENGINEERING_RE.test(evidenceText)) {
    refined.delete("engineering");
  }
  return refined;
}

function daysUntil(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

function opportunityBucketForTender(tender: MatchedTender): {
  key: OpportunityBucket;
  reason: string;
} {
  const geoMode = tender.structured_reasons?.geographyAlignment?.mode;
  const confidence = tender.structured_reasons?.confidence ?? "low";
  const evidenceQuality = tender.structured_reasons?.evidenceQuality ?? "thin";
  const days = daysUntil(tender.deadline);
  const directGeo = tender.bucket === "country" || geoMode === "direct";
  const widerGeo = tender.bucket === "regional" || tender.bucket === "global" || tender.bucket === "remote";
  const urgent = days != null && days >= 0 && days <= 21;

  if (tender.is_adjacent) {
    return {
      key: "adjacent",
      reason: "Adjacent to the company profile; good for partnerships, expansion, or monitoring.",
    };
  }

  if (tender.score >= 70 && directGeo && urgent && confidence !== "low") {
    return {
      key: "act_now",
      reason: days == null
        ? "High fit and direct geography; review immediately."
        : `High fit, direct geography, and ${days} day${days === 1 ? "" : "s"} until deadline.`,
    };
  }

  if (tender.score >= 70 && directGeo) {
    return {
      key: "strong_fit",
      reason: "High fit with direct geography; shortlist for bid/no-bid review.",
    };
  }

  if (tender.score >= 55 && (widerGeo || confidence === "high")) {
    return {
      key: "strategic",
      reason: widerGeo
        ? "Relevant beyond the selected country; useful for regional or globally open pursuit."
        : "Strong evidence match that may be strategically useful.",
    };
  }

  if (evidenceQuality === "thin" || confidence === "low" || tender.score < 50) {
    return {
      key: "watchlist",
      reason: "Potential signal, but evidence or fit is not strong enough to pursue without source verification.",
    };
  }

  return {
    key: "strategic",
    reason: "Moderate fit worth reviewing if capacity and documents are already in place.",
  };
}

function assignOpportunityBuckets(tenders: MatchedTender[]): MatchedTender[] {
  return tenders
    .map((tender) => {
      const bucket = opportunityBucketForTender(tender);
      const meta = OPPORTUNITY_BUCKET_META[bucket.key];
      return {
        ...tender,
        opportunity_bucket: bucket.key,
        opportunity_bucket_label: meta.label,
        opportunity_bucket_reason: bucket.reason,
        opportunity_bucket_priority: meta.priority,
      };
    })
    .sort((a, b) =>
      Number(b.score >= 40) - Number(a.score >= 40)
      || (a.opportunity_bucket_priority ?? 99) - (b.opportunity_bucket_priority ?? 99)
      || b.score - a.score
    );
}

function grantOpportunityBucket(grant: MatchedGrant): { key: OpportunityBucket; reason: string } {
  const days = daysUntil(grant.deadline);
  const urgent = days != null && days >= 0 && days <= 30;
  const location = (grant.country ?? grant.region ?? "").toLowerCase();
  const globalOrRegional = !location || /global|international|worldwide|multiple|regional|multi-country/.test(location);
  const weakGeography = grant.geography_alignment?.mode === "global-open" || grant.geography_alignment?.mode === "unknown";
  const userCountrySet = new Set((grant.geography_alignment?.userCountries ?? []).map((country) => country.toLowerCase()));
  const grantCountry = (grant.country ?? "").toLowerCase();
  const regionOnlyCountry = !!grantCountry
    && !GRANT_GLOBAL_TERMS.has(grantCountry)
    && userCountrySet.size > 0
    && !userCountrySet.has(grantCountry);

  if (grant.org_type_mismatch) {
    return {
      key: "watchlist",
      reason: "Eligibility may not match your organization type; verify before applying.",
    };
  }

  if (grant.score >= 45 && (weakGeography || globalOrRegional || regionOnlyCountry)) {
    return {
      key: "strategic",
      reason: regionOnlyCountry
        ? "Relevant regional funder opportunity; verify country eligibility before prioritizing."
        : "Relevant regional or global funder opportunity worth monitoring.",
    };
  }

  if (grant.score >= 65 && urgent) {
    return {
      key: "act_now",
      reason: days == null
        ? "Strong grant fit; review application requirements now."
        : `Strong grant fit with ${days} day${days === 1 ? "" : "s"} until deadline.`,
    };
  }

  if (grant.score >= 65) {
    return {
      key: "strong_fit",
      reason: "Strong alignment with your sectors, themes, and eligibility profile.",
    };
  }

  if (grant.score >= 45 && globalOrRegional) {
    return {
      key: "strategic",
      reason: "Relevant regional or global funder opportunity worth monitoring.",
    };
  }

  return {
    key: "watchlist",
    reason: "Some alignment exists, but fit or eligibility should be verified before investing time.",
  };
}

function assignGrantOpportunityBuckets(grants: MatchedGrant[]): MatchedGrant[] {
  return grants
    .map((grant) => {
      const bucket = grantOpportunityBucket(grant);
      const meta = OPPORTUNITY_BUCKET_META[bucket.key];
      return {
        ...grant,
        opportunity_bucket: bucket.key,
        opportunity_bucket_label: meta.label,
        opportunity_bucket_reason: bucket.reason,
        opportunity_bucket_priority: meta.priority,
      };
    })
    .sort((a, b) =>
      (a.opportunity_bucket_priority ?? 99) - (b.opportunity_bucket_priority ?? 99)
      || Number(b.geography_alignment?.mode === "direct") - Number(a.geography_alignment?.mode === "direct")
      || b.score - a.score
    );
}

function weakGrantGeography(grant: MatchedGrant): boolean {
  return grant.geography_alignment?.mode === "global-open" || grant.geography_alignment?.mode === "unknown";
}

function localGrantGeography(grant: MatchedGrant): boolean {
  return grant.geography_alignment?.mode === "direct";
}

function exactGrantCountryMatch(grant: MatchedGrant): boolean {
  const grantCountry = grant.country?.toLowerCase();
  if (!grantCountry || GRANT_GLOBAL_TERMS.has(grantCountry)) return false;
  return (grant.geography_alignment?.userCountries ?? [])
    .some((country) => country.toLowerCase() === grantCountry);
}

function regionOnlyGrantGeography(grant: MatchedGrant): boolean {
  return localGrantGeography(grant) && !!grant.country && !exactGrantCountryMatch(grant);
}

// Parse estimated_value strings like "$50,000,000", "USD 2.5M", "EUR 500k"
// into a rough USD number. Conservative — if we can't parse, return null and
// skip the demote rather than misfire.
function parseUsdValue(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const s = raw.toString().toLowerCase().replace(/[,\s]/g, "");
  const m = /([\d.]+)\s*(k|m|b|million|billion|thousand)?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2] ?? "";
  const mult =
    unit === "k" || unit === "thousand" ? 1_000 :
    unit === "m" || unit === "million" ? 1_000_000 :
    unit === "b" || unit === "billion" ? 1_000_000_000 : 1;
  return n * mult;
}

// company_size_signal is free-text from the LLM ("small SME", "mid-sized",
// "large enterprise", "micro"). Normalize to a rough bucket.
function companyTier(signal: string | null | undefined): "micro" | "small" | "mid" | "large" | "unknown" {
  if (!signal) return "unknown";
  const s = signal.toLowerCase();
  if (/\bmicro\b|solo|freelanc|1[-\s]?2 (people|staff|employees)/.test(s)) return "micro";
  if (/\bsmall\b|\bsme\b|startup|boutique/.test(s)) return "small";
  if (/\bmid\b|medium|growing/.test(s)) return "mid";
  if (/\blarge\b|enterprise|multinational|global firm/.test(s)) return "large";
  return "unknown";
}

const REGTECH_TERMS = [
  "compliance", "regulatory", "kyc", "aml", "regtech", "anti-money laundering",
  "know your customer", "due diligence", "document verification", "identity verification",
  "financial compliance", "audit trail", "screening", "document management",
  "records management", "content management",
];

function detectRegtechSignal(analysis: AIAnalysis): boolean {
  const texts = [
    ...(analysis.services ?? []),
    ...(analysis.capabilities ?? []),
    analysis.detected_industry ?? "",
  ].join(" ").toLowerCase();
  return REGTECH_TERMS.some((term) => texts.includes(term));
}

type FeedbackProfile = {
  dismissedTenderIds: Set<number>;
  positiveAgencies: Set<string>;
  positiveSectorSlugs: Set<SectorSlug>;
};

type SourceProvenance = "primary" | "aggregator" | "unknown";

const SECTOR_LABELS: Record<SectorSlug, string> = {
  it: "Information Technology",
  education: "Education & Training",
  healthcare: "Healthcare",
  logistics: "Logistics & Supply Chain",
  construction: "Construction & Infrastructure",
  consulting: "Consulting Services",
  monitoring_evaluation: "Monitoring & Evaluation",
  food: "Food & Nutrition",
  security: "Security & Safety",
  language_services: "Language Services",
  engineering: "Engineering",
  environment: "Environment & Climate",
  agriculture: "Agriculture",
  water_sanitation: "Water & Sanitation",
  energy: "Energy",
};

function sourceProvenance(sourceName: string | null | undefined, sourceUrl: string | null | undefined): SourceProvenance {
  const source = (sourceName ?? "").toLowerCase();
  const url = (sourceUrl ?? "").toLowerCase();
  if (source.includes("developmentaid") || url.includes("developmentaid.org")) return "aggregator";
  if (!sourceName && !sourceUrl) return "unknown";
  return "primary";
}

function readableSector(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const directSlug = slugFromReadableSector(trimmed);
  if (directSlug) return SECTOR_LABELS[directSlug];

  const embeddedDescriptions = sectorDescriptionsFromEscapedJson(trimmed);
  if (embeddedDescriptions.length) return embeddedDescriptions.join(", ");

  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const labels = values.flatMap((value) => {
      if (typeof value === "string") {
        try {
          const nested = JSON.parse(value) as { sector_description?: string; sector_code?: string };
          return nested.sector_description ?? nested.sector_code ?? value;
        } catch {
          return value;
        }
      }
      if (value && typeof value === "object") {
        const item = value as { sector_description?: string; sector_code?: string };
        return item.sector_description ?? item.sector_code ?? "";
      }
      return "";
    }).filter(Boolean);
    return labels.join(", ") || trimmed;
  } catch {
    return trimmed;
  }
}

function slugFromReadableSector(value: string): SectorSlug | null {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (SECTOR_SLUGS as string[]).includes(normalized) ? normalized as SectorSlug : null;
}

function sectorDescriptionsFromEscapedJson(raw: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /sector_description\\?":\\?"([^"\\]+(?:\\.[^"\\]*)*)/g,
    /sector_description=([^,}]+)/g,
  ];
  for (const pattern of patterns) {
    for (const match of raw.matchAll(pattern)) {
      const label = match[1]
        ?.replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\")
        .replace(/["{}]+$/g, "")
        .trim();
      if (label) out.add(label);
    }
  }
  return [...out];
}

function procurementCategory(args: {
  title: string;
  sector: string | null;
  opportunityType: string | null;
}): string {
  const text = `${args.title} ${args.sector ?? ""} ${args.opportunityType ?? ""}`.toLowerCase();
  if (/\bgrant|call for proposals|cfp\b|funding opportunity/.test(text)) return "Grant";
  if (/\broster|long[- ]term agreement|\blta\b|framework agreement|framework contract/.test(text)) return "Roster/LTA";
  if (/\beoi\b|expression of interest|request for expressions/.test(text)) return "EOI";
  if (/\bworks\b|civil works|construction|rehabilitation|retrofitting|installation works|repair works|water network|sewage network|solar pv installation|renovation/.test(text)) return "Works";
  if (/consult|advisory|evaluation|feasibility|technical assistance|study|trainer|training program|research|assessment|strategy|expert support|capacity building/.test(text)) return "Consulting services";
  if (/goods|supply|procurement of|purchase|equipment|vehicle|poultry|meat|food|pump|pipe|kit|furniture|materials|generator|laptop|tablet|medical supplies|agricultural inputs/.test(text)) return "Goods";
  if (/services|maintenance|rental|accommodation|travel|event|logistics|transport|internet|connectivity|communication campaign|media production|translation|interpretation|warehouse|storage/.test(text)) return "Non-consulting services";
  return args.opportunityType?.trim() || "Procurement notice";
}

function sectorLabelFromSlugs(slugs: Set<SectorSlug>, rawSector: string | null | undefined): string | null {
  const readable = readableSector(rawSector);
  if (readable && !/^\d[\d\s,.\-]*$/.test(readable.trim())) return readable;
  const labels = [...slugs].map((slug) => SECTOR_LABELS[slug]).filter(Boolean);
  return labels.length ? labels.join(", ") : readable;
}

function buildProcurementMetadata(args: {
  title: string;
  rawSector: string | null;
  opportunityType: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  estimatedValue: string | number | null;
  slugs: Set<SectorSlug>;
}) {
  const sectorLabel = sectorLabelFromSlugs(args.slugs, args.rawSector);
  const category = procurementCategory({
    title: args.title,
    sector: sectorLabel ?? args.rawSector,
    opportunityType: args.opportunityType,
  });

  return {
    category,
    opportunityType: args.opportunityType,
    sourceName: args.sourceName,
    sourceUrl: args.sourceUrl || null,
    sourceProvenance: sourceProvenance(args.sourceName, args.sourceUrl),
    postedDate: args.createdAt,
    updatedDate: args.updatedAt,
    sectorLabel,
    estimatedValue: args.estimatedValue,
  };
}

async function loadFeedbackProfile(email: string | null | undefined): Promise<FeedbackProfile> {
  const empty = {
    dismissedTenderIds: new Set<number>(),
    positiveAgencies: new Set<string>(),
    positiveSectorSlugs: new Set<SectorSlug>(),
  };
  if (!email) return empty;

  const users = await sql`
    SELECT id FROM users
    WHERE LOWER(email) = LOWER(${email})
    LIMIT 1
  `;
  const userId = users[0]?.id as number | undefined;
  if (!userId) return empty;

  const feedbackRows = await sql`
    SELECT
      f.tender_id,
      f.status,
      t.agency,
      t.sector,
      t.title,
      t.description
    FROM user_tender_feedback f
    LEFT JOIN tenders t ON t.id = f.tender_id
    WHERE f.user_id = ${userId}
  `;

  const dismissedTenderIds = new Set<number>();
  const positiveAgencies = new Set<string>();
  const positiveSectorSlugs = new Set<SectorSlug>();
  const positiveStatuses = new Set(["saved", "evaluating", "preparing", "submitted", "in_progress", "applied"]);

  for (const row of feedbackRows) {
    const tenderId = Number(row.tender_id);
    const status = String(row.status ?? "");
    if (status === "not_relevant" && Number.isFinite(tenderId)) {
      dismissedTenderIds.add(tenderId);
      continue;
    }
    if (!positiveStatuses.has(status)) continue;

    const agency = typeof row.agency === "string" ? row.agency.trim().toLowerCase() : "";
    if (agency) positiveAgencies.add(agency);

    const slugs = normalizeSector(
      typeof row.sector === "string" ? row.sector : "",
      typeof row.title === "string" ? row.title : "",
      typeof row.description === "string" ? row.description : "",
    );
    for (const slug of slugs) positiveSectorSlugs.add(slug);
  }

  return { dismissedTenderIds, positiveAgencies, positiveSectorSlugs };
}

/**
 * Match open tenders using text-signal scoring.
 *
 * Sector matching goes through a canonical 14-slug vocabulary so AI labels
 * ("Information Technology") align with raw crawler strings ("56101504 -
 * Software development services"). Capabilities/services token overlap gives
 * finer-grained relevance beyond sector. Geo is strict, with a soft fallback
 * when the strict pass surfaces fewer than 3 hits — better to show
 * geo-open opportunities at reduced score than an empty page.
 */
export async function matchTenders(
  analysis: AIAnalysis,
  countries: string[],
  options?: {
    includeConsultancies?: boolean;
    includeIndividualConsultancies?: boolean;
    skipEnrichment?: boolean;
    skipAdjacent?: boolean;
    userEmail?: string;
    adjacentSectorLabels?: string[];
    // Audit P1 #6: regional-geo adjacency (e.g. Egypt for a Jordan user) is
    // OFF by default — the audit caught Persona 3 seeing Iraq + Egypt at the
    // top of a Jordan-focused list. Set to true only when the user explicitly
    // opts in via a future UI toggle. Sector adjacency is a separate axis
    // controlled by adjacentSectorLabels.
    includeRegionalAdjacency?: boolean;
    orgType?: string | null;
    candidateLimitPerSlug?: number;
    geographyCandidateLimit?: number;
    baselineCandidateLimit?: number;
    adjacentCandidateLimit?: number;
  },
): Promise<MatchedTender[]> {
  // Expand user country list through alias table so "Syria" matches tenders
  // posted as "Syrian Arab Republic", "Palestine" matches "West Bank and Gaza",
  // etc. Without this expansion strictGeoMatch silently fails for most
  // MENA/Africa/Asia users and autoGeoOpen kicks in even when local supply
  // exists — users never see their own country's tenders.
  const countrySet = expandCountrySet(countries);
  const regionalSet = expandRegionalSet(countries);
  // Remove any overlap — strict always wins over regional.
  for (const c of countrySet) regionalSet.delete(c);
  const acceptsGlobal = countrySet.has("global");
  const feedbackProfile = await loadFeedbackProfile(options?.userEmail);

  // Pre-probe the strict-geo pool size for this user. When country-specific
  // supply is thin (common for logistics in Syria/Lebanon/Palestine etc.),
  // we auto-relax geo so geo-open tenders score as if the user opted in to
  // Global. This is the key differentiator for niche MENA profiles — better
  // to surface a handful of highly relevant geo-open opportunities than an
  // empty page because the user's country has no open notices today.
  const countryArr = [...countrySet];
  const regionalArr = [...regionalSet];
  const strictProbe = await sql`
    SELECT COUNT(*)::int AS n FROM tenders
    WHERE status='open' AND deadline >= CURRENT_DATE
      AND LOWER(country) = ANY(${countryArr}::text[])`;
  const strictPoolSize = Number(strictProbe?.[0]?.n ?? 0);
  // autoGeoOpen now uses the sector-aware strict pool count (computed after
  // slugKeywordMap is in scope, below). Keep strictPoolSize around for logging
  // and for the no-slug fallback path.
  const perSlugLimit = Math.min(300, Math.max(25, options?.candidateLimitPerSlug ?? 150));
  const geographyCandidateLimit = Math.min(600, Math.max(50, options?.geographyCandidateLimit ?? 400));
  const baselineCandidateLimit = Math.min(500, Math.max(50, options?.baselineCandidateLimit ?? 300));
  const adjacentCandidateLimit = Math.min(200, Math.max(25, options?.adjacentCandidateLimit ?? 100));

  const userSlugs = userSectorSlugs(analysis.detected_industry, analysis.sectors);
  const explicitAdjacentSlugs = userSectorSlugs(null, options?.adjacentSectorLabels ?? []);
  const regtechSignal = detectRegtechSignal(analysis);
  const effectiveUserSlugs = new Set(userSlugs);
  if (regtechSignal && !effectiveUserSlugs.has("it")) effectiveUserSlugs.add("it" as SectorSlug);
  const primarySlug = (SECTOR_SLUGS as string[]).includes(analysis.detected_industry ?? "")
    ? analysis.detected_industry as SectorSlug
    : null;
  const primaryIsLanguageServices = (analysis.detected_industry ?? "").toLowerCase() === "language_services";
  const explicitLanguageServices = (analysis.sectors ?? []).some((sector) => /^(language services|translation|interpretation)$/i.test(sector.trim()));
  const userWantsLanguageServices = primaryIsLanguageServices || explicitLanguageServices;

  // Consultancy tenders (ReliefWeb jobs feed, UN individual-consultant roster)
  // are individual-recruitment postings, not B2B procurement. Only gate on the
  // PRIMARY detected industry, not the full union of sectors[]. Service firms
  // routinely get "Consulting Services"/"Technical Assistance"/"Project
  // Management" added to sectors[] by the LLM (all three normalize → consulting
  // slug), which would otherwise disable the filter for translation firms,
  // logistics companies, etc. If consulting isn't the primary trade, skip them.
  const userIsConsulting = (analysis.detected_industry ?? "").toLowerCase() === "consulting";
  const userIsNgo = ["ngo", "non-profit", "nonprofit", "civil-society"].includes((options?.orgType ?? "").toLowerCase());
  // User may explicitly opt in to consultancy-style tenders (e.g. sole traders,
  // individuals bidding as consultants). Default is OFF for org/company flows.
  const allowConsultancies = (userIsConsulting && !userIsNgo) || (options?.includeConsultancies ?? false);
  const normalizedOrgType = (options?.orgType ?? "").toLowerCase();
  const profileCanBidIndividualConsultancies = /\b(individual|freelance|freelancer|sole|independent)\b/.test(normalizedOrgType);
  const allowIndividualConsultancies = options?.includeIndividualConsultancies ?? profileCanBidIndividualConsultancies;

  // Pool per slug instead of a single deadline-sorted LIMIT 600 — otherwise a
  // heavy sector (M&E / consulting) dominates the candidate window and starves
  // narrower industries (logistics, language services) of any candidates to
  // score. We union per-slug pools, then de-dupe by id.
  const slugKeywordMap: Record<string, string[]> = {
    it: [
      "software", "information technology", "it ", "digital", "platform", "system", "data", "technology",
      "document management", "records management", "content management", "ecm", "edms", "dms",
      "document control", "archiving", "enterprise content", "regulatory technology", "regtech",
      "compliance software", "contract management", "procurement software", "workflow automation",
      "it equipment", "ict equipment", "ict hardware", "hardware and software",
      "computer desktop", "computer desktops", "computer equipment", "laptop", "laptops",
      "network equipment", "digital media service",
    ],
    education: ["education", "training", "curriculum", "learning", "teacher", "school"],
    healthcare: [
      "health", "medical", "hospital", "clinic", "pharmaceutical", "vaccine",
      "diaper", "diapers", "medical supply", "healthcare supply",
    ],
    logistics: [
      "logistics", "transport", "freight", "shipping", "warehouse", "warehousing",
      "supply chain", "distribution", "fleet", "customs", "cargo", "storage",
      "forwarding", "forwarder", "haulage", "trucking", "delivery of",
      "supply and delivery", "procurement and delivery",
      "procurement services", "last mile", "last-mile", "stockpile",
      "supply of goods", "supply of basic goods", "general goods",
      "non-specialized goods", "non specialized goods", "non-food item",
      "non food item", "nfi", "relief item", "hygiene kit",
      "spare part", "replacement part",
      // NB: "furniture", "office supplies", "school furniture",
      // "accommodation", "lodging", "hotel venue" were removed — they pulled
      // pure goods/hospitality tenders (e.g. UNIDO Coffee Training Center
      // furniture) into the logistics candidate pool and were causing Rafiki
      // Holdings false matches. Genuine combined-delivery tenders still match
      // via "supply and delivery", "delivery of", and warehousing terms below.
      "prepositioning", "pre-positioning", "clearing", "clearance",
      "loading", "unloading", "import", "export", "dispatch",
      "installation and delivery",
      // UNGM/UNSPSC 78xxx — warehousing, storage, distribution
      "bonded warehouse", "fulfillment", "cold chain", "cold storage",
      "distribution center", "3pl", "third-party logistic", "stevedoring",
      "port handling", "cargo handling", "cross-dock", "material handling",
      "packing service", "courier service", "parcel deliver",
      "transit storage", "in-transit storage",
      // Extended warehouse/storage terms (DevelopmentAid / UNGM patterns)
      "inventory storage", "inventory management",
      "records storage", "archive storage", "document storage",
      "storage facility", "storage facilities", "warehousing services",
      "rental of storage", "storage space", "temporary storage",
      "container depot", "bulk storage", "secure storage",
      "yard management", "open storage",
      "fulfillment center",
    ],
    construction: ["construction", "civil works", "infrastructure", "building", "rehabilitation", "refurbishment"],
    consulting: [
      "consulting", "consultancy", "consultant",
      "advisory", "technical assistance", "feasibility",
      "evaluation service", "mid-term evaluation", "final evaluation",
      "external evaluation", "impact evaluation",
      // axiom.co.ke walkthrough: M&E firm RFPs commonly titled "X Consultant"
      // (singular) or describe scope as "Evaluation of Y" without the word
      // "consultancy" anywhere. Pre-fix the per-slug fetch missed them
      // entirely and they never entered the candidate pool.
      "needs assessment", "needs analysis", "market analysis",
      "research study", "feasibility study", "capacity assessment",
      "policy analysis", "baseline assessment", "endline assessment",
    ],
    monitoring_evaluation: [
      "monitoring and evaluation", "monitoring & evaluation", "m&e ",
      "evaluation", "evaluation of", "evaluation service",
      "mid-term evaluation", "final evaluation", "external evaluation",
      "impact evaluation", "process evaluation", "real-time evaluation",
      "program evaluation", "programme evaluation", "project evaluation",
      "baseline", "endline", "midline", "baseline study", "endline study",
      "baseline survey", "endline survey", "household survey", "field data",
      "data collection", "data analysis", "third-party monitoring",
      "meal expert", "meal officer", "meal manager", "meal specialist",
      "results framework", "logical framework", "logframe", "theory of change",
      "market systems analysis", "outcome harvesting", "policy brief",
    ],
    food: [
      "food", "nutrition", "catering", "meal", "agricultural produce",
      "ration", "foodstuff", "kitchen", "cafeteria", "bakery", "bakeries",
      "bread", "ready-to-eat", "ready to eat", "food basket", "food baskets",
      "rte basket",
    ],
    security: [
      "security", "guarding", "surveillance", "protection", "guard service",
      "safety service", "access control", "fire safety", "security assessment",
      "security training", "ngo safety", "ngo security", "security risk",
      "security management", "security analysis", "defensive driving",
      "armored vehicle", "armoured vehicle", "protective service",
    ],
    language_services: [
      "translation", "interpretation", "interpreter", "translator", "linguistic", "language service",
      "transcription", "proofreading", "editorial", "document translation", "certified translation",
      "legal translation", "technical translation", "localization", "subtitling", "voice-over",
      "dubbing", "multilingual", "language support",
    ],
    engineering: [
      "engineering", "mechanical", "electrical engineering", "civil engineering",
      "spare part", "production line", "maintenance of production",
      "mechanical spare",
    ],
    environment: ["environment", "climate", "biodiversity", "pollution", "waste management", "cleaning service", "janitorial", "sanitation service", "recycling"],
    agriculture: [
      "agriculture", "agricultural", "farming", "livestock", "crop", "irrigation",
      // Agri-inputs & commodity supply — fertilizer/feed/seed tenders (often
      // NULL-sector) must enter the agriculture candidate pool (Fortuna DMCC).
      "fertiliz", "agrochemical", "pesticide", "seeds", "seedling", "oilseed",
      "fodder", "animal feed", "fish feed", "poultry feed", "livestock feed",
      "agro-process", "agribusiness",
    ],
    water_sanitation: [
      "water", "sanitation", "wash", "hygiene", "sewage", "latrine",
      "borehole", "boreholes", "wastewater", "water network",
      "water networks", "pumping line", "pump station", "sewage network",
      "sewage networks", "water infrastructure", "water supply system",
      "water harvesting",
    ],
    energy: ["energy", "solar", "electricity", "power", "renewable", "grid"],
  };

  // Sector-aware strict supply probe. The naive strictPoolSize above counts
  // every open tender in the user's countries regardless of sector relevance.
  // Discovered on axiom.co.ke walkthrough (Kenya consulting profile): the user
  // picked 8 countries that totalled 100+ strict tenders, but the corpus for
  // those countries was dominated by construction / water / health — almost
  // nothing matched a consulting profile. naive strictPoolSize > 25 so
  // autoGeoOpen never fired, softSectorFloor stayed at the strict 40, and the
  // 184 country='Global' consulting tenders in the corpus never had a chance
  // to enter the result set.
  //
  // The right question is "how many RELEVANT tenders are in the user's
  // countries", not "how many tenders period". When sector-relevant strict
  // supply is thin, fire autoGeoOpen so the global pool flows in with the
  // softer 20-point sector floor.
  let strictSectorPoolSize = strictPoolSize;
  if (effectiveUserSlugs.size > 0 && countryArr.length > 0) {
    const sectorKws = new Set<string>();
    for (const slug of effectiveUserSlugs) {
      for (const k of slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")]) sectorKws.add(k);
    }
    if (sectorKws.size > 0) {
      const sectorPatterns = [...sectorKws].map((k) => `%${k}%`);
      const sectorAwareProbe = await sql`
        SELECT COUNT(*)::int AS n FROM tenders
        WHERE status='open' AND deadline >= CURRENT_DATE
          AND LOWER(country) = ANY(${countryArr}::text[])
          AND (
            title ILIKE ANY(${sectorPatterns}::text[])
            OR sector ILIKE ANY(${sectorPatterns}::text[])
          )`;
      strictSectorPoolSize = Number(sectorAwareProbe?.[0]?.n ?? 0);
    }
  }
  const autoGeoOpen = !acceptsGlobal && strictSectorPoolSize < 25;

  type Row = {
    id: number; title: string; description: string | null; agency: string;
    deadline: string; country: string; sector: string; reference_id: string;
    requirements: string[] | null; experience_level: string | null;
    opportunity_type: string | null; source_url: string | null;
    submission_language: string | null;
    estimated_value: string | number | null;
    source_name: string | null; created_at: string | null; updated_at: string | null;
  };
  const byId = new Map<number, Row>();

  if (effectiveUserSlugs.size) {
    // Per-slug pool — LIKE on title + sector pulls genuinely relevant rows
    // rather than whatever happens to have the earliest deadline. Each slug
    // gets up to 150; union deduped by id.
    for (const slug of effectiveUserSlugs) {
      const kws = slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")];
      const patterns = kws.map((k) => `%${k}%`);
      const descKws = descriptionKeywordsFor(kws);
      const descPatterns = descKws.length ? descKws.map((k) => `%${k}%`) : ["__tp_no_description_match__"];
      const rows = await sql`
        SELECT id, title, description, agency, deadline, country, sector,
               reference_id, requirements, experience_level, opportunity_type,
               source_url, submission_language, estimated_value, source_name, created_at, updated_at
        FROM tenders
        WHERE status = 'open'
          AND deadline >= CURRENT_DATE
          AND (
            title ILIKE ANY(${patterns}::text[])
            OR sector ILIKE ANY(${patterns}::text[])
            OR (${descKws.length > 0} AND COALESCE(description, '') ILIKE ANY(${descPatterns}::text[]))
          )
        ORDER BY deadline ASC
        LIMIT ${perSlugLimit}
      `;
      for (const r of rows) byId.set(r.id as number, r as Row);
    }
  }

  if (!acceptsGlobal && countryArr.length) {
    const strictCountryRows = await sql`
      SELECT id, title, description, agency, deadline, country, sector,
             reference_id, requirements, experience_level, opportunity_type,
             source_url, submission_language, estimated_value, source_name, created_at, updated_at
      FROM tenders
      WHERE status = 'open'
        AND deadline >= CURRENT_DATE
        AND LOWER(country) = ANY(${countryArr}::text[])
      ORDER BY deadline ASC
      LIMIT ${geographyCandidateLimit}
    `;
    for (const r of strictCountryRows) if (!byId.has(r.id as number)) byId.set(r.id as number, r as Row);
  }

  if (!acceptsGlobal && regionalArr.length) {
    const regionalCountryRows = await sql`
      SELECT id, title, description, agency, deadline, country, sector,
             reference_id, requirements, experience_level, opportunity_type,
             source_url, submission_language, estimated_value, source_name, created_at, updated_at
      FROM tenders
      WHERE status = 'open'
        AND deadline >= CURRENT_DATE
        AND LOWER(country) = ANY(${regionalArr}::text[])
      ORDER BY deadline ASC
      LIMIT ${geographyCandidateLimit}
    `;
    for (const r of regionalCountryRows) if (!byId.has(r.id as number)) byId.set(r.id as number, r as Row);
  }

  // Baseline pool only when the per-slug pass yielded thin results — avoids
  // off-sector contamination (the "Zawda noise" problem) when we already have
  // a solid candidate set from the slug keywords.
  if (byId.size < 10 || effectiveUserSlugs.size === 0) {
    const baseline = await sql`
      SELECT id, title, description, agency, deadline, country, sector,
             reference_id, requirements, experience_level, opportunity_type,
             source_url, submission_language, estimated_value, source_name, created_at, updated_at
      FROM tenders
      WHERE status = 'open'
        AND deadline >= CURRENT_DATE
      ORDER BY deadline ASC
      LIMIT ${baselineCandidateLimit}
    `;
    for (const r of baseline) if (!byId.has(r.id as number)) byId.set(r.id as number, r as Row);
  }

  const candidates = Array.from(byId.values());
  if (!candidates.length) return [];

  // Build user token bags. capabilityTokens and serviceTokens are tracked
  // separately so structured_reasons can report which capabilities vs keywords
  // triggered each match. userTokens remains the full union for scoring.
  const capabilityTokens = new Set<string>(tokenize((analysis.capabilities ?? []).join(" ")));
  const serviceTokens = new Set<string>([
    ...tokenize((analysis.services ?? []).join(" ")),
    ...tokenize(analysis.detected_industry ?? ""),
  ]);
  const userTokens = new Set<string>([...capabilityTokens, ...serviceTokens]);
  const sparseProfile = (analysis.services ?? []).length === 0 && (analysis.capabilities ?? []).length === 0;
  const profileDomainText = [
    analysis.detected_industry,
    ...(analysis.sectors ?? []),
    ...(analysis.services ?? []),
    ...(analysis.capabilities ?? []),
    ...(analysis.strengths ?? []),
    // NB: analysis.summary is deliberately excluded. The narrative summary
    // carries readiness caveats and negations ("no documented food safety
    // certifications") whose bare substrings trip niche-domain gates
    // (food_safety / M&E / health-systems) and silently zero out a profile's
    // matches. Gate on hard structured evidence only — not narrative prose.
    // (Discovered on Fortuna DMCC, an agri-commodity trader gated as a
    // food-safety lab via a negated phrase, 2026-06.)
  ].filter(Boolean).join(" ");
  const profileDomains = detectMatchDomains(profileDomainText);
  const profileHasNicheDomainGate = NICHE_DOMAIN_GATES.some((domain) => profileDomains.has(domain));

  type Scored = MatchedTender & { _strict: boolean; _regional: boolean; _geoOpen: boolean; _sectorScore: number };
  const scored: Scored[] = [];

  for (const t of candidates) {
    const rawTitle = (t.title as string ?? "");
    if (!isEnglishTitle(rawTitle, t.submission_language as string | null)) continue;
    const earlyEvidenceText = `${rawTitle} ${t.sector ?? ""}`;
    const languageB2B = isLanguageB2BTender(effectiveUserSlugs, earlyEvidenceText);

    // Gate sources per configurable rules (e.g. SAM.gov for non-US companies).
    if (feedbackProfile.dismissedTenderIds.has(t.id as number)) continue;

    const tSourceUrl = (t.source_url as string | null) ?? "";
    if (shouldSuppressSource(tSourceUrl, countrySet)) continue;

    const tSector = (t.sector as string ?? "");
    const tOpportunityType = (t.opportunity_type as string | null) ?? null;
    const tSourceName = (t.source_name as string | null) ?? null;
    const tCountry = (t.country as string ?? "").toLowerCase();
    const tTitle = rawTitle;
    const tAgency = (t.agency as string ?? "");
    const tDescription = (t.description as string | null) ?? "";
    const reqs = (t.requirements as string[] | null) ?? [];
    const likelyIndividualConsultancy = isLikelyIndividualConsultancy({
      title: rawTitle,
      opportunityType: tOpportunityType,
      sourceName: tSourceName,
      sourceUrl: tSourceUrl,
      description: tDescription,
      requirements: reqs,
      languageB2B,
    });

    // Institutional service firms can bid consulting procurements, but they
    // should not see job-feed / individual-consultant roles as paid-service
    // matches unless the profile explicitly represents an individual.
    if (likelyIndividualConsultancy && !allowIndividualConsultancies) continue;
    if (!allowConsultancies && tOpportunityType === "Consultancy" && !languageB2B) continue;

    const isGeoOpen = isGeoOpenCountry(tCountry);
    const strictGeoMatch = countrySet.has(tCountry);
    const regionalGeoMatch = !strictGeoMatch && !isGeoOpen && regionalSet.has(tCountry);
    // Skip tenders that are geographically impossible. Keep geo-open (global)
    // and regional-neighbour rows around for the respective buckets. A tender
    // posted in a distant non-neighbour country is dropped.
    if (!strictGeoMatch && !regionalGeoMatch && !isGeoOpen) continue;

    // Sector overlap via canonical slugs — symmetric, so "it" on both sides scores.
    // Description is a huge signal lift for UN feeds where `sector` is often
    // a bare UNSPSC code and the title is boilerplate ("Request for Proposal").
    const evidenceText = `${tTitle} ${tSector} ${reqs.join(" ")} ${tDescription}`.trim();
    const tSlugs = refineTenderSlugs(
      new Set<SectorSlug>(normalizeSector(tSector, tTitle, `${reqs.join(" ")} ${tDescription}`.trim())),
      evidenceText,
    );
    const tenderDomains = detectMatchDomains(evidenceText);
    const matchedDomains = [...profileDomains].filter((domain) => tenderDomains.has(domain));
    const domainAligned = profileDomains.size === 0 || domainsOverlap(profileDomains, tenderDomains);
    if (LANGUAGE_B2B_RE.test(evidenceText) && !userWantsLanguageServices) {
      continue;
    }
    if (
      primaryIsLanguageServices
      && !tSlugs.has("language_services")
      && !isLanguageB2BTender(effectiveUserSlugs, evidenceText)
    ) {
      continue;
    }
    const procurement = buildProcurementMetadata({
      title: tTitle,
      rawSector: tSector,
      opportunityType: tOpportunityType,
      sourceName: tSourceName,
      sourceUrl: tSourceUrl,
      createdAt: (t.created_at as string | null) ?? null,
      updatedAt: (t.updated_at as string | null) ?? null,
      estimatedValue: (t.estimated_value as string | number | null) ?? null,
      slugs: tSlugs,
    });
    let sectorScore = 0;
    for (const s of effectiveUserSlugs) if (tSlugs.has(s)) sectorScore += 40;
    sectorScore = Math.min(60, sectorScore);

    // Capability/service token overlap on title + sector + requirements + description.
    const tenderTokens = new Set<string>([
      ...tokenize(tTitle),
      ...tokenize(tSector),
      ...tokenize(reqs.join(" ")),
      ...tokenize(tDescription),
    ]);
    const matchedUserTokens = [...userTokens].filter((tok) => tenderTokens.has(tok));
    const distinctiveTokenHits = matchedUserTokens.filter((tok) => !GENERIC_CONSULTING_MATCH_TOKENS.has(tok)).length;
    const tokenHits = matchedUserTokens.length;
    const tokenScore = Math.min(25, tokenHits * 5);

    // Agency name overlap — captures "UN Women" matching a gender-focused consultancy.
    const agencyTokens = new Set<string>(tokenize(tAgency));
    let agencyHits = 0;
    for (const tok of userTokens) if (agencyTokens.has(tok)) agencyHits++;
    const agencyScore = Math.min(5, agencyHits * 2);

    let geoScore = 0;
    if (strictGeoMatch) geoScore = 30;
    else if (regionalGeoMatch) geoScore = 20;
    else if (isGeoOpen) geoScore = 10;

    let feedbackScore = 0;
    const normalizedAgency = tAgency.toLowerCase();
    if (normalizedAgency && feedbackProfile.positiveAgencies.has(normalizedAgency)) feedbackScore += 5;
    for (const slug of tSlugs) {
      if (feedbackProfile.positiveSectorSlugs.has(slug)) feedbackScore += 5;
    }
    feedbackScore = Math.min(10, feedbackScore);

    let total = sectorScore + tokenScore + agencyScore + geoScore + feedbackScore;
    const matchedSlugs = [...effectiveUserSlugs].filter((s) => tSlugs.has(s));
    const onlyConsultingSectorMatch = matchedSlugs.length === 1 && matchedSlugs[0] === "consulting";
    const broadConsultingOnlyMatch =
      primarySlug === "consulting"
      && onlyConsultingSectorMatch;

    // Value × company-size sanity check. A 2-person freelance outfit has no
    // realistic path to bid on a $50M WB civil-works contract. Parse the
    // estimated_value and demote (or skip) when the contract is clearly out
    // of reach. Conservative: only fires when both value AND tier parse
    // cleanly; otherwise we let the match through unchanged.
    const usd = parseUsdValue(t.estimated_value as string | number | null);
    const tier = companyTier(analysis.company_size_signal as string | null | undefined);
    if (usd != null && (tier === "micro" || tier === "small")) {
      if (tier === "micro" && usd >= 20_000_000) continue;
      if (usd >= 5_000_000) total = Math.round(total * 0.6);
    }

    // Lower threshold vs before — with canonical sector slugs even a partial
    // match should carry real signal. Token-only matches score ~25-30.
    if (sectorScore === 0 && tokenHits === 0) continue;
    if (sectorScore === 0 && distinctiveTokenHits < 2) continue;
    if (sectorScore > 0 && primarySlug && !tSlugs.has(primarySlug) && tokenHits === 0) continue;
    if (onlyConsultingSectorMatch && profileDomains.size > 0 && !domainAligned) continue;
    if (profileHasNicheDomainGate && !domainAligned) continue;
    // Consulting + zero distinctive tokens used to be an unconditional skip —
    // designed to suppress generic-consulting noise for non-consulting profiles
    // accidentally matched via "technical assistance" or "advisory" keywords.
    // But it over-fires on legitimate niche-consulting profiles (M&E,
    // policy research, health systems) whose actual target tenders ARE
    // consulting-only and whose differentiator is the domain, not exotic
    // tokens. Discovered on axiom.co.ke (a Kenya M&E firm) returning zero
    // matches despite strictSectorPoolSize=18. When domain alignment exists,
    // the niche signal IS the distinctive evidence — keep the match.
    if (broadConsultingOnlyMatch && distinctiveTokenHits === 0 && !domainAligned) continue;
    if (broadConsultingOnlyMatch && distinctiveTokenHits < 2) total = Math.min(total, 49);
    if (onlyConsultingSectorMatch && distinctiveTokenHits < 2) total = Math.min(total, 49);
    if (total < 15) continue;

    // Flat match_reasons (legacy compat)
    const matchReasons: string[] = [];
    if (matchedSlugs.length) matchReasons.push(`Sector: ${matchedSlugs.map((s) => SECTOR_LABELS[s] || s.replace(/_/g, " ")).join(", ")}`);
    if (matchedDomains.length) matchReasons.push(`Domain: ${matchedDomains.map((domain) => DOMAIN_LABELS[domain]).join(", ")}`);
    if (tokenHits > 0) {
      const matchedTokens = matchedUserTokens.slice(0, 3);
      if (matchedTokens.length) matchReasons.push(`Keywords: ${matchedTokens.join(", ")}`);
    }
    if (strictGeoMatch) matchReasons.push(`Country: ${t.country}`);
    else if (regionalGeoMatch) matchReasons.push(`Regional: ${t.country}`);
    else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) {
      matchReasons.push(tCountry === "remote" ? "Remote (location-agnostic)" : "Global (no country required)");
    }
    if (procurement.estimatedValue) matchReasons.push(`Value: ${procurement.estimatedValue}`);

    // Structured match reason (Sprint 5)
    const srSectorNames = matchedSlugs.map((s) => SECTOR_LABELS[s] || s.replace(/_/g, " "));
    const srCaps = [...capabilityTokens].filter((tok) => tenderTokens.has(tok)).slice(0, 5);
    const srKws = [...serviceTokens].filter((tok) => tenderTokens.has(tok) && !capabilityTokens.has(tok)).slice(0, 5);

    let geoMode: GeographyMode = "unknown";
    if (strictGeoMatch) geoMode = "direct";
    else if (regionalGeoMatch) geoMode = "regional";
    else if (isGeoOpen && acceptsGlobal) geoMode = "global-open";
    else if (isGeoOpen && autoGeoOpen) geoMode = "auto-expanded";
    else if (isGeoOpen) geoMode = "global-open";

    let srConfidence: "high" | "medium" | "low" = "low";
    if (sectorScore >= 40 && strictGeoMatch && tokenHits >= 2) srConfidence = "high";
    else if ((sectorScore >= 20 && tokenHits >= 1) || strictGeoMatch) srConfidence = "medium";

    const srCaveats: string[] = [];
    const evidenceQuality: "rich" | "thin" = tDescription.length >= 250 || reqs.length > 0 ? "rich" : "thin";
    if (evidenceQuality === "thin") srCaveats.push("Tender evidence is thin; verify the source notice before committing.");
    if (sectorScore === 0 && tokenHits > 0) srCaveats.push("Keyword-only match; sector alignment is weak.");
    if (broadConsultingOnlyMatch && distinctiveTokenHits < 2) srCaveats.push("Consulting is a broad sector; verify the tender's exact domain before shortlisting.");
    if (profileDomains.size > 0 && matchedDomains.length === 0) srCaveats.push("Domain evidence is weak; verify the tender scope before shortlisting.");
    if (autoGeoOpen && !strictGeoMatch) srCaveats.push("Geography widened beyond your selected countries.");
    if (sparseProfile) srCaveats.push("Company profile based on limited website content.");
    const deadline = new Date(t.deadline as string);
    if (!Number.isNaN(deadline.getTime())) {
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
      if (daysLeft >= 0 && daysLeft <= 7) srCaveats.push(`Deadline is soon (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`);
    }

    const srSummary: string[] = [];
    if (srSectorNames.length) srSummary.push(`Matched on ${srSectorNames.join(", ")} sector${srSectorNames.length > 1 ? "s" : ""}.`);
    if (matchedDomains.length) srSummary.push(`Domain fit: ${matchedDomains.map((domain) => DOMAIN_LABELS[domain]).join(", ")}.`);
    if (srCaps.length) srSummary.push(`Capabilities: ${srCaps.join(", ")}.`);
    else if (srKws.length) srSummary.push(`Keywords: ${srKws.join(", ")}.`);
    if (procurement.estimatedValue) srSummary.push(`Estimated value: ${procurement.estimatedValue}.`);
    if (feedbackScore > 0) srSummary.push("Boosted by your prior tender feedback.");
    if (geoMode === "direct") srSummary.push(`Posted in ${t.country as string}.`);
    else if (geoMode === "regional") srSummary.push("Regional opportunity near your target countries.");
    else if (geoMode === "global-open") srSummary.push("Open globally — no country restriction.");
    else if (geoMode === "auto-expanded") srSummary.push("Geography auto-expanded — limited local supply.");

    const structured_reasons: MatchReason = {
      summary: srSummary,
      matchedSectors: srSectorNames.length ? srSectorNames : undefined,
      matchedCapabilities: srCaps.length ? srCaps : undefined,
      matchedKeywords: srKws.length ? srKws : undefined,
      procurement,
      geographyAlignment: { userCountries: countries, tenderCountry: t.country as string | null, mode: geoMode },
      scoreBreakdown: {
        sector: sectorScore,
        capabilities: tokenScore,
        geography: geoScore,
        agency: agencyScore,
        feedback: feedbackScore || undefined,
      },
      evidenceQuality,
      confidence: srConfidence,
      caveats: srCaveats.length ? srCaveats : undefined,
    };

    const tendBucket: "country" | "regional" | "global" | "remote" =
      strictGeoMatch ? "country"
      : regionalGeoMatch ? "regional"
      : tCountry === "remote" ? "remote"
      : "global";

    scored.push({
      id: t.id as number,
      title: t.title as string,
      agency: t.agency as string,
      deadline: t.deadline as string,
      country: t.country as string,
      sector: t.sector as string,
      score: Math.min(100, total),
      reference_id: t.reference_id as string,
      source_name: tSourceName,
      source_url: (t.source_url as string | null) ?? null,
      opportunity_type: tOpportunityType,
      procurement_category: procurement.category,
      source_provenance: procurement.sourceProvenance,
      posted_date: (t.created_at as string | null) ?? null,
      updated_at: (t.updated_at as string | null) ?? null,
      estimated_value: (t.estimated_value as string | number | null) ?? null,
      match_reasons: matchReasons,
      structured_reasons,
      bucket: tendBucket,
      _strict: strictGeoMatch,
      _regional: regionalGeoMatch,
      _geoOpen: isGeoOpen,
      _sectorScore: sectorScore,
    });
  }

  // Three separate pools. Sector floor relaxes when strict supply is thin —
  // any sector-slug hit (score ≥20) counts as signal for niche MENA profiles;
  // otherwise require a stronger match (≥40) so boilerplate keyword hits
  // don't spray identical M&E / consulting tenders across every industry.
  const softSectorFloor = autoGeoOpen ? 20 : 40;

  const strictPool = scored.filter((s) => s._strict).sort((a, b) => b.score - a.score);
  const regionalPool = scored
    .filter((s) => s._regional && s._sectorScore >= softSectorFloor)
    .sort((a, b) => b.score - a.score);
  // Global bucket is ONLY truly geo-agnostic rows — not country-specific
  // tenders from distant countries. That was the old bug where a Yemen tender
  // would show up under "Global" for a Syria user; now Yemen → Regional (if
  // adjacent) or dropped.
  const globalPool = scored
    .filter((s) => !s._strict && !s._regional && s._geoOpen && s._sectorScore >= softSectorFloor)
    .sort((a, b) => b.score - a.score);

  const out: MatchedTender[] = [];
  for (const s of strictPool.slice(0, 25)) out.push(stripMeta(s));

  // Regional adjacency is OFF by default. Audit 2026-05-19 P1 #6: Persona 3
  // (Jordan user) saw UNICEF Iraq + ILO Egypt + UNFPA Egypt at the top of
  // their matched list because regionalPool was always pushed. The audit's
  // recommended fix: hard-gate by country, render an honest empty state if
  // the result is thin. Set options.includeRegionalAdjacency to admit
  // neighbouring-country matches with the existing discount.
  const wantRegional = options?.includeRegionalAdjacency ?? false;
  if (wantRegional) {
    const regionalDiscount = autoGeoOpen ? 0.85 : 0.75;
    for (const s of regionalPool.slice(0, 10)) {
      out.push({ ...stripMeta(s), score: Math.max(20, Math.round(s.score * regionalDiscount)) });
    }
  } else if (regionalPool.length > 0) {
    console.log("[match:regional:gated]", {
      dropped: regionalPool.length,
      strictPool: strictPool.length,
      autoGeoOpen,
      hint: "includeRegionalAdjacency is off by default — pass true to admit neighbour-country matches",
    });
  }

  // Global: only show when user opted in OR strict+regional supply is thin.
  const wantGlobal = acceptsGlobal || autoGeoOpen || out.length < 8;
  if (wantGlobal) {
    const globalDiscount = acceptsGlobal ? 0.9 : (autoGeoOpen ? 0.75 : 0.65);
    for (const s of globalPool.slice(0, 8)) {
      out.push({ ...stripMeta(s), score: Math.max(20, Math.round(s.score * globalDiscount)) });
    }
  }

  // Track which tenders actually made it into the final output so we can
  // exclude them from the adjacent pass without also excluding tenders that
  // were in the baseline pool but never surfaced (zero primary-sector score).
  const outIds = new Set(out.map((t) => t.id));

  // Adjacent-sector pass — pull tenders for neighbouring sectors not already
  // in the final output, score with 0.6× discount, cap at 50 results.
  const adjacentSlugs = computeAdjacentSlugs(effectiveUserSlugs);
  for (const slug of explicitAdjacentSlugs) {
    if (!effectiveUserSlugs.has(slug)) adjacentSlugs.add(slug);
  }
  const shouldRunAdjacent = !options?.skipAdjacent && adjacentSlugs.size > 0 && (out.length < 8 || explicitAdjacentSlugs.size > 0);
  if (shouldRunAdjacent) {
    const adjacentById = new Map<number, Row>();
    for (const slug of adjacentSlugs) {
      const kws = slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")];
      const patterns = kws.map((k) => `%${k}%`);
      const descKws = descriptionKeywordsFor(kws);
      const descPatterns = descKws.length ? descKws.map((k) => `%${k}%`) : ["__tp_no_description_match__"];
      const rows = await sql`
        SELECT id, title, description, agency, deadline, country, sector,
               reference_id, requirements, experience_level, opportunity_type,
               source_url, submission_language, estimated_value, source_name, created_at, updated_at
        FROM tenders
        WHERE status = 'open'
          AND deadline >= CURRENT_DATE
          AND (
            title ILIKE ANY(${patterns}::text[])
            OR sector ILIKE ANY(${patterns}::text[])
            OR (${descKws.length > 0} AND COALESCE(description, '') ILIKE ANY(${descPatterns}::text[]))
          )
        ORDER BY deadline ASC
        LIMIT ${adjacentCandidateLimit}
      `;
      for (const r of rows) {
        const rid = r.id as number;
        if (!outIds.has(rid) && !adjacentById.has(rid)) adjacentById.set(rid, r as Row);
      }
    }

    const adjOut: MatchedTender[] = [];
    for (const t of adjacentById.values()) {
      const rawTitle = (t.title as string ?? "");
      if (!isEnglishTitle(rawTitle, t.submission_language as string | null)) continue;
      const earlyEvidenceText = `${rawTitle} ${t.sector ?? ""}`;
      const languageB2B = isLanguageB2BTender(effectiveUserSlugs, earlyEvidenceText);
      if (feedbackProfile.dismissedTenderIds.has(t.id as number)) continue;

      const adjSourceUrl = (t.source_url as string | null) ?? "";
      if (shouldSuppressSource(adjSourceUrl, countrySet)) continue;

      const tSector = (t.sector as string ?? "");
      const tOpportunityType = (t.opportunity_type as string | null) ?? null;
      const tSourceName = (t.source_name as string | null) ?? null;
      const tCountry = (t.country as string ?? "").toLowerCase();
      const tTitle = rawTitle;
      const tAgency = (t.agency as string ?? "");
      const tDescription = (t.description as string | null) ?? "";
      const reqs = (t.requirements as string[] | null) ?? [];
      const likelyIndividualConsultancy = isLikelyIndividualConsultancy({
        title: rawTitle,
        opportunityType: tOpportunityType,
        sourceName: tSourceName,
        sourceUrl: adjSourceUrl,
        description: tDescription,
        requirements: reqs,
        languageB2B,
      });
      if (likelyIndividualConsultancy && !allowIndividualConsultancies) continue;
      if (!allowConsultancies && tOpportunityType === "Consultancy" && !languageB2B) continue;

      const isGeoOpen = isGeoOpenCountry(tCountry);
      const strictGeoMatch = countrySet.has(tCountry);
      const regionalGeoMatch = !strictGeoMatch && !isGeoOpen && regionalSet.has(tCountry);
      if (!strictGeoMatch && !regionalGeoMatch && !isGeoOpen) continue;

      const adjEvidenceText = `${tTitle} ${tSector} ${reqs.join(" ")} ${tDescription}`.trim();
      const tSlugs = refineTenderSlugs(
        new Set<SectorSlug>(normalizeSector(tSector, tTitle, `${reqs.join(" ")} ${tDescription}`.trim())),
        adjEvidenceText,
      );
      const adjTenderDomains = detectMatchDomains(adjEvidenceText);
      const matchedAdjDomains = [...profileDomains].filter((domain) => adjTenderDomains.has(domain));
      const adjDomainAligned = profileDomains.size === 0 || domainsOverlap(profileDomains, adjTenderDomains);
      if (LANGUAGE_B2B_RE.test(adjEvidenceText) && !userWantsLanguageServices) {
        continue;
      }
      if (
        primaryIsLanguageServices
        && !tSlugs.has("language_services")
        && !isLanguageB2BTender(effectiveUserSlugs, adjEvidenceText)
      ) {
        continue;
      }
      const procurement = buildProcurementMetadata({
        title: tTitle,
        rawSector: tSector,
        opportunityType: tOpportunityType,
        sourceName: tSourceName,
        sourceUrl: adjSourceUrl,
        createdAt: (t.created_at as string | null) ?? null,
        updatedAt: (t.updated_at as string | null) ?? null,
        estimatedValue: (t.estimated_value as string | number | null) ?? null,
        slugs: tSlugs,
      });
      let sectorScore = 0;
      for (const s of adjacentSlugs) if (tSlugs.has(s)) sectorScore += 40;
      sectorScore = Math.min(60, sectorScore);

      const tenderTokens = new Set<string>([
        ...tokenize(tTitle), ...tokenize(tSector),
        ...tokenize(reqs.join(" ")), ...tokenize(tDescription),
      ]);
      let tokenHits = 0;
      for (const tok of userTokens) if (tenderTokens.has(tok)) tokenHits++;
      const tokenScore = Math.min(25, tokenHits * 5);
      const matchedAdjSlugs = [...adjacentSlugs].filter((s) => tSlugs.has(s));
      const matchedExplicitAdjSlugs = matchedAdjSlugs.filter((s) => explicitAdjacentSlugs.has(s));

      const agencyTokens = new Set<string>(tokenize(tAgency));
      let agencyHits = 0;
      for (const tok of userTokens) if (agencyTokens.has(tok)) agencyHits++;
      const agencyScore = Math.min(5, agencyHits * 2);

      let geoScore = 0;
      if (strictGeoMatch) geoScore = 30;
      else if (regionalGeoMatch) geoScore = 20;
      else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) geoScore = 10;

      let feedbackScore = 0;
      const normalizedAgency = tAgency.toLowerCase();
      if (normalizedAgency && feedbackProfile.positiveAgencies.has(normalizedAgency)) feedbackScore += 5;
      for (const slug of tSlugs) {
        if (feedbackProfile.positiveSectorSlugs.has(slug)) feedbackScore += 5;
      }
      feedbackScore = Math.min(10, feedbackScore);

      if (sectorScore === 0 && tokenHits === 0) continue;
      if (profileHasNicheDomainGate && !adjDomainAligned) continue;
      if (!matchedExplicitAdjSlugs.length && tokenHits === 0) continue;
      const total = Math.round((sectorScore + tokenScore + agencyScore + geoScore + feedbackScore) * 0.6);
      if (total < 10) continue;

      const adjMatchReasons: string[] = [];
      if (matchedAdjSlugs.length) {
        adjMatchReasons.push(
          `${matchedExplicitAdjSlugs.length ? "Requested adjacent" : "Adjacent"}: ${matchedAdjSlugs.map((s) => s.replace(/_/g, " ")).join(", ")}`
        );
      }
      if (matchedAdjDomains.length) adjMatchReasons.push(`Domain: ${matchedAdjDomains.map((domain) => DOMAIN_LABELS[domain]).join(", ")}`);
      if (tokenHits > 0) {
        const matchedTokens = [...userTokens].filter((tok) => tenderTokens.has(tok)).slice(0, 3);
        if (matchedTokens.length) adjMatchReasons.push(`Keywords: ${matchedTokens.join(", ")}`);
      }
      if (strictGeoMatch) adjMatchReasons.push(`Country: ${t.country as string}`);
      else if (regionalGeoMatch) adjMatchReasons.push(`Regional: ${t.country as string}`);
      else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) {
        const adjTCountry = (t.country as string ?? "").toLowerCase();
        adjMatchReasons.push(adjTCountry === "remote" ? "Remote (location-agnostic)" : "Global (no country required)");
      }

      // Structured reasons for adjacent
      const adjSectorNames = matchedAdjSlugs.map((s) => s.replace(/_/g, " "));
      const adjCaps = [...capabilityTokens].filter((tok) => tenderTokens.has(tok)).slice(0, 5);
      const adjKws = [...serviceTokens].filter((tok) => tenderTokens.has(tok) && !capabilityTokens.has(tok)).slice(0, 5);
      let adjGeoMode: GeographyMode = "unknown";
      if (strictGeoMatch) adjGeoMode = "direct";
      else if (regionalGeoMatch) adjGeoMode = "regional";
      else if (isGeoOpen && acceptsGlobal) adjGeoMode = "global-open";
      else if (isGeoOpen && autoGeoOpen) adjGeoMode = "auto-expanded";
      else if (isGeoOpen) adjGeoMode = "global-open";
      const adjSummary: string[] = [
        matchedExplicitAdjSlugs.length
          ? "Matches an adjacent field you asked TenderPath to watch."
          : "Adjacent sector match inferred from your profile.",
      ];
      if (adjSectorNames.length) adjSummary.push(`Near-sector: ${adjSectorNames.join(", ")}.`);
      if (matchedAdjDomains.length) adjSummary.push(`Domain fit: ${matchedAdjDomains.map((domain) => DOMAIN_LABELS[domain]).join(", ")}.`);
      if (adjCaps.length) adjSummary.push(`Capabilities: ${adjCaps.join(", ")}.`);
      else if (adjKws.length) adjSummary.push(`Keywords: ${adjKws.join(", ")}.`);
      if (feedbackScore > 0) adjSummary.push("Boosted by your prior tender feedback.");
      const adjCaveats = [
        matchedExplicitAdjSlugs.length
          ? "Adjacent field requested by you; verify fit before bidding."
          : "Adjacent sector inferred by TenderPath; lower direct relevance.",
      ];
      if (sparseProfile) adjCaveats.push("Company profile based on limited website content.");
      const evidenceQuality: "rich" | "thin" = tDescription.length >= 250 || reqs.length > 0 ? "rich" : "thin";
      if (evidenceQuality === "thin") adjCaveats.push("Tender evidence is thin; verify the source notice before committing.");
      const adj_structured_reasons: MatchReason = {
        summary: adjSummary,
        matchedSectors: adjSectorNames.length ? adjSectorNames : undefined,
        matchedCapabilities: adjCaps.length ? adjCaps : undefined,
        matchedKeywords: adjKws.length ? adjKws : undefined,
        procurement,
        geographyAlignment: { userCountries: countries, tenderCountry: t.country as string | null, mode: adjGeoMode },
        scoreBreakdown: {
          sector: sectorScore,
          capabilities: tokenScore,
          geography: geoScore,
          agency: agencyScore,
          feedback: feedbackScore || undefined,
        },
        evidenceQuality,
        confidence: "low",
        caveats: adjCaveats,
      };

      const adjTCountry2 = (t.country as string ?? "").toLowerCase();
      const adjBucket: "country" | "regional" | "global" | "remote" =
        strictGeoMatch ? "country"
        : regionalGeoMatch ? "regional"
        : adjTCountry2 === "remote" ? "remote"
        : "global";

      adjOut.push({
        id: t.id as number,
        title: t.title as string,
        agency: t.agency as string,
        deadline: t.deadline as string,
        country: t.country as string,
        sector: t.sector as string,
        score: Math.min(100, total),
        reference_id: t.reference_id as string,
        source_name: tSourceName,
        source_url: (t.source_url as string | null) ?? null,
        opportunity_type: tOpportunityType,
        procurement_category: procurement.category,
        source_provenance: procurement.sourceProvenance,
        posted_date: (t.created_at as string | null) ?? null,
        updated_at: (t.updated_at as string | null) ?? null,
        estimated_value: (t.estimated_value as string | number | null) ?? null,
        match_reasons: adjMatchReasons,
        structured_reasons: adj_structured_reasons,
        bucket: adjBucket,
        is_adjacent: true,
      });
    }
    adjOut.sort((a, b) => b.score - a.score);
    for (const s of adjOut.slice(0, 50)) out.push(s);
  }

  const bucketedOut = assignOpportunityBuckets(dedupeFinalMatches(out));
  const finalOut = options?.skipEnrichment ? bucketedOut : await enrichTopMatches(bucketedOut);

  // EPIC E: confidence distribution observability
  const confidenceDist = finalOut.reduce((acc, t) => {
    const c = t.structured_reasons?.confidence ?? "none";
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const withoutStructured = finalOut.filter((t) => !t.structured_reasons).length;
  console.log("[tp:match:confidence]", confidenceDist, { total: finalOut.length, withoutStructured });

  // Full pool-size diagnostics. Grep prod logs for [match:result] to answer
  // "why did this user get N tenders" without re-running the pipeline.
  // Added after the axiom.co.ke walkthrough hit zero matches and we had to
  // diagnose via raw DB queries — that loop should never repeat.
  console.log("[match:result]", {
    strictPoolSize,           // raw count of open tenders in user's countries
    strictSectorPoolSize,     // ↑ filtered to user's sector keywords
    autoGeoOpen,
    softSectorFloor,
    strict: strictPool.length,
    regional: regionalPool.length,
    global: globalPool.length,
    out: finalOut.length,
    countries: countryArr,
    slugs: [...effectiveUserSlugs],
  });

  return finalOut;
}

function stripMeta(s: MatchedTender & { _strict: boolean; _regional: boolean; _geoOpen: boolean; _sectorScore: number }): MatchedTender {
  const { _strict, _regional, _geoOpen, _sectorScore, ...rest } = s;
  void _strict; void _regional; void _geoOpen; void _sectorScore;
  return rest;
}

function finalMatchKey(tender: MatchedTender): string {
  const title = tender.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const country = (tender.country ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const deadline = tender.deadline ? new Date(tender.deadline).toISOString().slice(0, 10) : "";
  return `${title}|${country}|${deadline}`;
}

function dedupeFinalMatches(matches: MatchedTender[]): MatchedTender[] {
  const byKey = new Map<string, MatchedTender>();
  for (const match of matches) {
    const key = finalMatchKey(match);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, match);
      continue;
    }

    const existingRank = (existing.is_adjacent ? 0 : 8) + existing.score;
    const newRank = (match.is_adjacent ? 0 : 8) + match.score;
    if (newRank > existingRank) byKey.set(key, match);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

function finalGrantKey(grant: MatchedGrant): string {
  const title = grant.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const agency = (grant.agency ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const deadline = grant.deadline ? new Date(grant.deadline).toISOString().slice(0, 10) : "";
  return `${title}|${agency}|${deadline}`;
}

function dedupeGrantMatches(grants: MatchedGrant[]): MatchedGrant[] {
  const byKey = new Map<string, MatchedGrant>();
  for (const grant of grants) {
    const key = finalGrantKey(grant);
    const existing = byKey.get(key);
    if (!existing || grant.score > existing.score) byKey.set(key, grant);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score);
}

const SECTOR_TO_GRANT_THEME: Record<SectorSlug, string[]> = {
  it: ["digital", "technology", "innovation", "data", "cybersecurity"],
  education: ["education", "training", "skills", "youth", "capacity building"],
  healthcare: ["health", "nutrition", "medical", "public health"],
  logistics: ["humanitarian response", "supply chain", "resilience", "emergency response"],
  construction: ["infrastructure", "housing", "resilience", "urban development"],
  consulting: ["governance", "technical assistance", "capacity building"],
  monitoring_evaluation: ["evaluation", "monitoring", "research", "policy", "evidence", "learning"],
  food: ["food security", "nutrition", "agriculture", "livelihoods"],
  security: ["protection", "safety", "peacebuilding", "risk"],
  language_services: ["inclusion", "communications", "education", "civil society"],
  engineering: ["infrastructure", "innovation", "industrial development"],
  environment: ["climate", "environment", "biodiversity", "natural resources"],
  agriculture: ["agriculture", "food security", "rural development", "livelihoods"],
  water_sanitation: ["wash", "water", "sanitation", "public health"],
  energy: ["energy", "renewable energy", "climate", "infrastructure"],
};

const BROAD_GRANT_THEMES = new Set([
  "innovation",
  "capacity building",
  "resilience",
  "technical assistance",
  "infrastructure",
  "urban development",
  "emergency response",
  "governance",
]);

const GRANT_GLOBAL_TERMS = new Set([
  "global", "international", "worldwide", "multiple", "multi-country",
  "regional", "all countries", "world", "any country",
]);

const KNOWN_COUNTRY_NAMES = ALL_COUNTRIES.map((c) => c.country.toLowerCase());
const COUNTRY_TO_GRANT_REGION = new Map(ALL_COUNTRIES.map((c) => [c.country.toLowerCase(), c.region.toLowerCase()]));
const US_DOMESTIC_GRANT_AGENCY_RE = /^(HHS|NSF|NASA|DOC|DOL|USDA|DOI|EPA|PAMS|BJA|NIJ|OJJDP|CDC|HRSA|NIH|DOE|DOT|USDOT|HUD|ED|NEH|VA|DHS|DOD|USDOJ|AC|ONDCP|LOC)(?:-|$)/i;
const INTERNATIONAL_GRANT_RE = /\b(international|global|worldwide|foreign assistance|embassy|consulate|usaid|state department|democracy|humanitarian|developing countries|low- and middle-income|lmics?|africa|middle east|mena|asia|latin america)\b/i;

function normalizeGrantArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeGrantOrgType(value: string): string {
  const normalized = value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (/\b(sme|company|business|private sector|for profit|commercial|vendor)\b/.test(normalized)) return "company";
  if (/\b(ngo|non profit|nonprofit|non-government|civil society|charity|foundation|ingo)\b/.test(normalized)) return "ngo";
  if (/\b(research|university|academic)\b/.test(normalized)) return "research_institution";
  if (/\b(education|school|college|institution of higher education|ihe)\b/.test(normalized)) return "education_institution";
  if (/\b(government|public agency|state|local|municipal|tribal)\b/.test(normalized)) return "government_entity";
  if (/\b(cooperative|co-op)\b/.test(normalized)) return "cooperative";
  return normalized.replace(/\s+/g, "_");
}

function orgMatchesGrant(orgType: string | null, eligibleOrgs: string[]): boolean | null {
  if (!eligibleOrgs.length) return null;
  if (!orgType) return null;
  const orgLower = normalizeGrantOrgType(orgType);
  return eligibleOrgs.some((o) => {
    const oLower = normalizeGrantOrgType(o);
    return oLower === orgLower || oLower.includes(orgLower) || orgLower.includes(oLower);
  });
}

function grantCountryValues(g: { country?: unknown; region?: unknown; countries?: unknown }): string[] {
  return [
    typeof g.country === "string" ? g.country : null,
    typeof g.region === "string" ? g.region : null,
    ...normalizeGrantArray(g.countries),
  ].filter((v): v is string => !!v && !!v.trim()).map((v) => v.trim());
}

function grantExplicitCountries(g: { country?: unknown; countries?: unknown }): string[] {
  return [
    typeof g.country === "string" ? g.country : null,
    ...normalizeGrantArray(g.countries),
  ].filter((v): v is string => !!v && !!v.trim()).map((v) => v.trim());
}

function mentionedKnownCountries(text: string): string[] {
  const lower = text.toLowerCase();
  return KNOWN_COUNTRY_NAMES.filter((country) => {
    const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
  });
}

function evaluateGrantGeography(
  g: { country?: unknown; region?: unknown; countries?: unknown; title?: unknown; description?: unknown },
  userCountrySet: Set<string>,
): { mode: "direct" | "global-open" | "unknown" | "mismatch"; score: number; label: string | null } {
  if (!userCountrySet.size) return { mode: "unknown", score: 0, label: null };

  const explicitValues = grantCountryValues(g);
  const explicitLower = explicitValues.map((v) => v.toLowerCase());
  const global = explicitLower.some((v) => GRANT_GLOBAL_TERMS.has(v));
  if (explicitLower.some((v) => userCountrySet.has(v))) {
    return { mode: "direct", score: 25, label: explicitValues.join(", ") };
  }
  const userRegions = new Set(
    [...userCountrySet]
      .map((country) => COUNTRY_TO_GRANT_REGION.get(country))
      .filter((region): region is string => !!region),
  );
  if (typeof g.region === "string" && userRegions.has(g.region.toLowerCase())) {
    return { mode: "direct", score: 18, label: g.region };
  }
  if (global) return { mode: "global-open", score: 10, label: explicitValues.join(", ") };
  if (explicitValues.length > 0) return { mode: "mismatch", score: -30, label: explicitValues.join(", ") };

  const textCountries = mentionedKnownCountries(`${String(g.title ?? "")} ${String(g.description ?? "")}`);
  if (textCountries.length > 0) {
    const direct = textCountries.some((c) => userCountrySet.has(c));
    return {
      mode: direct ? "direct" : "mismatch",
      score: direct ? 20 : -25,
      label: textCountries.map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase())).join(", "),
    };
  }

  return { mode: "unknown", score: -4, label: null };
}

function userIncludesUnitedStates(countries: string[]): boolean {
  const expanded = expandCountrySet(countries);
  return expanded.has("united states") || expanded.has("usa") || expanded.has("united states of america");
}

function inferGrantFundingScope(
  g: { agency?: unknown; country?: unknown; region?: unknown; countries?: unknown; title?: unknown; description?: unknown },
): "domestic" | "international" | "global" | "unknown" {
  const explicitValues = grantExplicitCountries(g).map((v) => v.toLowerCase());
  const region = typeof g.region === "string" ? g.region.toLowerCase() : "";
  if (explicitValues.some((v) => GRANT_GLOBAL_TERMS.has(v))) return "global";
  if (region && GRANT_GLOBAL_TERMS.has(region)) return "global";
  if (explicitValues.some((v) => v && v !== "united states" && v !== "usa" && v !== "u.s.")) return "international";

  const text = `${String(g.agency ?? "")} ${String(g.title ?? "")} ${String(g.description ?? "")}`;
  if (INTERNATIONAL_GRANT_RE.test(text)) return "international";
  if (US_DOMESTIC_GRANT_AGENCY_RE.test(String(g.agency ?? ""))) return "domestic";
  if (/\b(united states|u\.s\.|usa|american communities|states|counties|tribal|domestic)\b/i.test(text)) return "domestic";
  return "unknown";
}

/**
 * Match open grants against org type, development themes, and sectors.
 */
export async function matchGrants(
  sectors: string[],
  orgType: string | null,
  devThemes: string[],
  countries: string[] = []
): Promise<MatchedGrant[]> {
  // Normalise user countries for matching
  const userCountries = [...expandCountrySet(countries)];
  const userCountrySet = new Set(userCountries);
  const userGrantRegions = [
    ...new Set(
      userCountries
        .map((country) => COUNTRY_TO_GRANT_REGION.get(country))
        .filter((region): region is string => !!region),
    ),
  ];
  const includesUnitedStates = userIncludesUnitedStates(countries);
  const globalTerms = [...GRANT_GLOBAL_TERMS];

  // When no countries provided (legacy calls), skip country filtering so we
  // don't accidentally return zero grants for existing assessments.
  const candidates = userCountries.length
    ? await sql`
        SELECT id, title, agency, deadline, sector, themes, eligible_org_types, countries,
               source_url, description, value_range, country, region
        FROM grants
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= NOW())
          AND (
            country IS NULL
            OR country = ''
            OR LOWER(country) = ANY(${globalTerms}::text[])
            OR LOWER(country) = ANY(${userCountries}::text[])
            OR region IS NULL
            OR region = ''
            OR LOWER(region) = ANY(${globalTerms}::text[])
            OR LOWER(region) = ANY(${userCountries}::text[])
            OR LOWER(region) = ANY(${userGrantRegions}::text[])
          )
        ORDER BY deadline ASC NULLS LAST
        LIMIT 200
      `
    : await sql`
        SELECT id, title, agency, deadline, sector, themes, eligible_org_types, countries,
               source_url, description, value_range, country, region
        FROM grants
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= NOW())
        ORDER BY deadline ASC NULLS LAST
        LIMIT 200
      `;

  if (!candidates.length) return [];

  const userSlugs = userSectorSlugs(null, sectors);
  const explicitEducationTheme = devThemes.some((theme) =>
    /\b(education|training|skills|youth|teacher|school|curriculum|learning)\b/i.test(theme)
  );
  if (
    userSlugs.has("it")
    && userSlugs.has("education")
    && normalizeGrantOrgType(orgType ?? "") !== "ngo"
    && !explicitEducationTheme
  ) {
    userSlugs.delete("education");
  }
  const themeSet = new Set([
    ...devThemes.map((t) => t.toLowerCase()),
    ...[...userSlugs].flatMap((slug) => SECTOR_TO_GRANT_THEME[slug] ?? []),
  ]);
  const grantUserTokens = new Set<string>([
    ...tokenize(sectors.join(" ")),
    ...tokenize(devThemes.join(" ")),
  ].filter((token) => !GRANT_TOKEN_STOPWORDS.has(token)));
  const normalizedUserOrgType = normalizeGrantOrgType(orgType ?? "");

  const scored: MatchedGrant[] = [];

  for (const g of candidates) {
    let score = 0;
    const gSector = (g.sector as string ?? "");
    const gTitle = (g.title as string ?? "");
    const gDescription = (g.description as string | null) ?? "";
    const reasons: string[] = [];
    const matchedThemes: string[] = [];

    // Grant descriptions are often long policy/program text and can mention
    // many adjacent themes. Use the curated/enriched sector and title for the
    // hard sector gate, then let descriptions contribute only softer keyword
    // and theme signals below.
    const gSlugs = new Set<SectorSlug>(normalizeSector(gSector, gTitle, ""));
    let sectorHits = 0;
    for (const s of userSlugs) if (gSlugs.has(s)) sectorHits++;
    if (sectorHits > 0) {
      score += Math.min(35, sectorHits * 22);
      reasons.push(`Sector fit: ${[...userSlugs].filter((s) => gSlugs.has(s)).join(", ")}.`);
    }

    const eligibleOrgs = normalizeGrantArray(g.eligible_org_types);
    const orgMatch = orgMatchesGrant(orgType, eligibleOrgs);
    if (eligibleOrgs.length) {
      if (orgMatch) {
        score += 20;
        reasons.push(`Eligibility fit: ${orgType} appears eligible.`);
      } else if (orgMatch === false) {
        score -= 25;
        reasons.push(`Eligibility caveat: listed org types are ${eligibleOrgs.join(", ")}.`);
      } else {
        score += 4;
        reasons.push(`Eligibility needs review: listed org types are ${eligibleOrgs.join(", ")}.`);
      }
    } else {
      score += 6;
      reasons.push("Eligibility is not explicit in the grant row.");
    }

    const grantThemes = normalizeGrantArray(g.themes);
    let themeHits = 0;
    if (grantThemes.length && themeSet.size) {
      for (const gt of grantThemes) {
        if (themeSet.has(gt.toLowerCase())) {
          themeHits++;
          matchedThemes.push(gt);
        }
      }
      if (themeHits > 0) {
        score += Math.min(25, themeHits * 10);
        reasons.push(`Theme fit: ${matchedThemes.slice(0, 3).join(", ")}.`);
      }
    } else if (grantThemes.length) {
      score += 3;
    }

    let tokenHits = 0;
    if (grantUserTokens.size) {
      const grantTokens = new Set<string>([
        ...tokenize(gTitle), ...tokenize(gDescription), ...tokenize(gSector),
      ]);
      for (const tok of grantUserTokens) if (grantTokens.has(tok)) tokenHits++;
      if (tokenHits > 0) {
        score += Math.min(14, tokenHits * 4);
        reasons.push(`Keyword overlap: ${tokenHits} profile term${tokenHits === 1 ? "" : "s"} found.`);
      }
    }

    const washFocusedProfile = userSlugs.has("water_sanitation")
      || devThemes.some((theme) => /\b(wash|water|sanitation|hygiene)\b/i.test(theme));
    const grantHasWashSignal = gSlugs.has("water_sanitation")
      || grantThemes.some((theme) => /\b(wash|water|sanitation|hygiene)\b/i.test(theme))
      || /\b(wash|water|sanitation|hygiene)\b/i.test(`${gTitle} ${gDescription}`);
    const exactCountryGrant = grantExplicitCountries(g)
      .map((value) => value.toLowerCase())
      .some((value) => userCountrySet.has(value));
    if (washFocusedProfile && !grantHasWashSignal && (gSlugs.has("healthcare") || grantThemes.some((theme) => /health/i.test(theme)))) {
      score -= 16;
      reasons.push("Specificity caveat: health-related, but no explicit WASH/water/sanitation signal.");
    }
    const waterCompanyProfile = normalizedUserOrgType === "company" && washFocusedProfile;
    const grantHasInfrastructureSignal = gSlugs.has("construction")
      || grantThemes.some((theme) => /\b(infrastructure|urban development|resilience)\b/i.test(theme))
      || /\b(infrastructure|water network|wastewater|irrigation|stormwater|flood|sanitation)\b/i.test(`${gTitle} ${gDescription}`);
    if (waterCompanyProfile && !grantHasWashSignal) {
      reasons.push("Specificity caveat: water/infrastructure profile, but no explicit water grant signal.");
      if (!exactCountryGrant) continue;
      score -= grantHasInfrastructureSignal ? 14 : 22;
    }

    const geography = evaluateGrantGeography(g, userCountrySet);
    const fundingScope = inferGrantFundingScope(g);
    const publicDiplomacyGrant = /\b(alumni engagement innovation fund|aeif|public diplomacy|pds annual|embassy .*program statement)\b/i
      .test(`${gTitle} ${gDescription} ${String(g.agency ?? "")}`);
    const profileWantsPublicDiplomacy = devThemes.some((theme) =>
      /\b(public diplomacy|alumni|exchange|cultural|media|journalism|civil discourse)\b/i.test(theme)
    );
    if (publicDiplomacyGrant && !profileWantsPublicDiplomacy && !exactCountryGrant) continue;
    score += geography.score;
    if (geography.mode === "direct") reasons.push(`Geography fit: ${geography.label ?? "selected country"}.`);
    else if (geography.mode === "global-open") reasons.push("Geography fit: global or regional opportunity.");
    else if (geography.mode === "mismatch") reasons.push(`Geography caveat: grant appears tied to ${geography.label}.`);
    else if (userCountrySet.size) reasons.push("Geography caveat: no country eligibility was listed.");
    if (exactCountryGrant) {
      score += 20;
      reasons.push("Geography priority: country-specific opportunity.");
    }

    if (fundingScope === "domestic" && countries.length > 0 && !includesUnitedStates) {
      score -= 14;
      reasons.push("Funding-scope caveat: appears likely U.S.-domestic, not clearly international.");
    } else if (fundingScope === "international" || fundingScope === "global") {
      score += 6;
      reasons.push(`Funding scope: ${fundingScope === "global" ? "global" : "international"} opportunity.`);
    }

    const fitSignals = sectorHits + themeHits + tokenHits;
    const hasSpecificThemeHit = matchedThemes.some((theme) => !BROAD_GRANT_THEMES.has(theme.toLowerCase()));
    const geographyIsStrong = geography.mode === "direct";
    const geographyIsWeak = geography.mode === "global-open" || geography.mode === "unknown";
    const broadGlobalOnly = geographyIsWeak && sectorHits === 0 && !hasSpecificThemeHit && tokenHits < 3;

    // Skip weak grants where geography/org eligibility are the only reasons.
    // Those rows are useful as raw inventory but feel random in the dashboard.
    if (fitSignals <= 0) continue;
    if (sectorHits === 0 && themeHits === 0 && tokenHits <= 1) continue;
    if (broadGlobalOnly) continue;

    // For companies, a grant should have a real programmatic fit signal. A
    // broad theme plus generic company eligibility is not enough to earn a
    // dashboard card, especially for global/EU calls.
    if (normalizeGrantOrgType(orgType ?? "") === "company" && !geographyIsStrong) {
      if (sectorHits === 0 && !hasSpecificThemeHit && tokenHits < 4) continue;
      if (fundingScope === "unknown" && geography.mode === "unknown" && sectorHits === 0) continue;
    }

    // Skip zero-signal grants — the old `score = 8` floor caused identical
    // grants to appear for every company regardless of relevance.
    if (score < 38) continue;

    const NGO_TERMS = new Set(["ngo", "non-profit", "nonprofit", "civil society", "charity", "foundation", "ingo", "non profit"]);
    const isNgoOnly = eligibleOrgs.length > 0 &&
      eligibleOrgs.every((o) => NGO_TERMS.has(o.toLowerCase()) || normalizeGrantOrgType(o) === "ngo");
    const NON_NGO_TYPES = new Set(["company", "sole_trader", "government_entity"]);
    const orgTypeMismatch = isNgoOnly && !!orgType && NON_NGO_TYPES.has(normalizeGrantOrgType(orgType));
    if (orgTypeMismatch) score = Math.min(score, 44);

    const regionOnlyMatch = geography.mode === "direct" && userCountrySet.size > 0 && !exactCountryGrant;

    let cappedScore = geography.mode === "mismatch" || (fundingScope === "domestic" && !includesUnitedStates)
      ? Math.min(score, 49)
      : score;
    // Region-level grants are useful, but should not bury a country-specific
    // CFP/grant with the same thematic fit.
    if (regionOnlyMatch) cappedScore = Math.min(cappedScore, 84);
    if (geographyIsWeak && sectorHits === 0) cappedScore = Math.min(cappedScore, 54);
    if (geographyIsWeak && sectorHits === 0 && !hasSpecificThemeHit) cappedScore = Math.min(cappedScore, 44);

    scored.push({
      id: g.id as number,
      title: g.title as string,
      agency: g.agency as string,
      deadline: g.deadline as string,
      sector: g.sector as string,
      score: Math.min(100, Math.max(0, cappedScore)),
      source_url: (g.source_url as string | null) ?? null,
      description: gDescription || null,
      value_range: (g.value_range as string | null) ?? null,
      country: (g.country as string | null) ?? null,
      region: (g.region as string | null) ?? null,
      org_type_mismatch: orgTypeMismatch || undefined,
      match_reason: reasons[0] ?? null,
      match_reasons: reasons,
      geography_alignment: {
        userCountries: countries,
        grantCountry: geography.label ?? (g.country as string | null) ?? (g.region as string | null) ?? null,
        mode: geography.mode,
      },
      funding_scope: fundingScope,
    });
  }

  const dedupedScored = dedupeGrantMatches(scored);
  const hasLocalGrants = dedupedScored.some(localGrantGeography);
  const hasExactCountryGrants = dedupedScored.some(exactGrantCountryMatch);
  const normalizedOrgType = normalizeGrantOrgType(orgType ?? "");
  const weakGeoLimit = hasLocalGrants
    ? (normalizedOrgType === "company" ? 2 : 3)
    : 5;
  const regionOnlyLimit = hasExactCountryGrants
    ? (normalizedOrgType === "company" ? 2 : 3)
    : 6;

  // Cap at 2 results per agency to avoid one donor dominating the list.
  const agencyCounts = new Map<string, number>();
  const out: MatchedGrant[] = [];
  let weakGeoCount = 0;
  let regionOnlyCount = 0;
  for (const g of dedupedScored) {
    if (weakGrantGeography(g)) {
      if (weakGeoCount >= weakGeoLimit) continue;
      weakGeoCount++;
    }
    if (regionOnlyGrantGeography(g)) {
      if (regionOnlyCount >= regionOnlyLimit) continue;
      regionOnlyCount++;
    }
    const agency = g.agency ?? "";
    const count = agencyCounts.get(agency) ?? 0;
    if (count >= 2) continue;
    agencyCounts.set(agency, count + 1);
    out.push(g);
    if (out.length >= 20) break;
  }
  return assignGrantOpportunityBuckets(out);
}
