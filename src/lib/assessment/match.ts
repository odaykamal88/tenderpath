import { sql } from "@/lib/db";
import type { MatchedTender, MatchedGrant, AIAnalysis, MatchReason, GeographyMode, OpportunityBucket } from "@/lib/types";
import { normalizeSector, userSectorSlugs, type SectorSlug } from "@/lib/crawlers/sector-map";
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
  "manager", "assistant", "consultant",
  // Generic procurement verbs. "Supply and delivery of laptops" is an IT
  // goods tender, not a logistics-services tender.
  "supply", "delivery", "deliver", "procurement", "provision",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
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

const OPPORTUNITY_BUCKET_META: Record<OpportunityBucket, { label: string; priority: number }> = {
  act_now: { label: "Act Now", priority: 1 },
  strong_fit: { label: "Strong Fit", priority: 2 },
  strategic: { label: "Strategic Expansion", priority: 3 },
  adjacent: { label: "Adjacent Bet", priority: 4 },
  watchlist: { label: "Watchlist", priority: 5 },
};

const HARD_LOGISTICS_RE = /\b(logistics?|supply chain|warehous(?:e|ing)|freight|transport(?:ation)? services?|shipping|distribution services?|last[- ]mile|fleet|customs|cargo|stockpil(?:e|ing)|preposition(?:ing)?|pre-position(?:ing)?|clearing agent|clearance service|storage service|cold chain|cold storage|distribution cent(?:er|re)|3pl|third-party logistic|stevedoring|port handling|cargo handling|cross-dock|material handling|packing service|courier service|parcel deliver(?:y)?|inventory storage|records storage|archive storage|document storage|storage facilit(?:y|ies)|warehousing services|storage space|temporary storage|container depot|bulk storage|secure storage|yard management|fulfillment cent(?:er|re))\b/i;

function refineTenderSlugs(slugs: Set<SectorSlug>, evidenceText: string): Set<SectorSlug> {
  const refined = new Set(slugs);
  if (refined.has("logistics") && !HARD_LOGISTICS_RE.test(evidenceText)) {
    refined.delete("logistics");
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
      (a.opportunity_bucket_priority ?? 99) - (b.opportunity_bucket_priority ?? 99)
      || b.score - a.score
    );
}

function grantOpportunityBucket(grant: MatchedGrant): { key: OpportunityBucket; reason: string } {
  const days = daysUntil(grant.deadline);
  const urgent = days != null && days >= 0 && days <= 30;
  const location = (grant.country ?? grant.region ?? "").toLowerCase();
  const globalOrRegional = !location || /global|international|worldwide|multiple|regional|multi-country/.test(location);

  if (grant.org_type_mismatch) {
    return {
      key: "watchlist",
      reason: "Eligibility may not match your organization type; verify before applying.",
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
      || b.score - a.score
    );
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
  options?: { includeConsultancies?: boolean; userEmail?: string; adjacentSectorLabels?: string[] },
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
  const strictProbe = await sql`
    SELECT COUNT(*)::int AS n FROM tenders
    WHERE status='open' AND deadline >= CURRENT_DATE
      AND LOWER(country) = ANY(${countryArr}::text[])`;
  const strictPoolSize = Number(strictProbe?.[0]?.n ?? 0);
  const autoGeoOpen = !acceptsGlobal && strictPoolSize < 25;

  const userSlugs = userSectorSlugs(analysis.detected_industry, analysis.sectors);
  const explicitAdjacentSlugs = userSectorSlugs(null, options?.adjacentSectorLabels ?? []);
  const regtechSignal = detectRegtechSignal(analysis);
  const effectiveUserSlugs = new Set(userSlugs);
  if (regtechSignal && !effectiveUserSlugs.has("it")) effectiveUserSlugs.add("it" as SectorSlug);

  // Consultancy tenders (ReliefWeb jobs feed, UN individual-consultant roster)
  // are individual-recruitment postings, not B2B procurement. Only gate on the
  // PRIMARY detected industry, not the full union of sectors[]. Service firms
  // routinely get "Consulting Services"/"Technical Assistance"/"Project
  // Management" added to sectors[] by the LLM (all three normalize → consulting
  // slug), which would otherwise disable the filter for translation firms,
  // logistics companies, etc. If consulting isn't the primary trade, skip them.
  const userIsConsulting = (analysis.detected_industry ?? "").toLowerCase() === "consulting";
  // User may explicitly opt in to consultancy-style tenders (e.g. sole traders,
  // individuals bidding as consultants). Default is OFF for org/company flows.
  const allowConsultancies = userIsConsulting || (options?.includeConsultancies ?? false);

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
    ],
    education: ["education", "training", "curriculum", "learning", "teacher", "school"],
    healthcare: ["health", "medical", "hospital", "clinic", "pharmaceutical", "vaccine"],
    logistics: [
      "logistics", "transport", "freight", "shipping", "warehouse", "warehousing",
      "supply chain", "distribution", "fleet", "customs", "cargo", "storage",
      "forwarding", "forwarder", "haulage", "trucking", "delivery of",
      "supply and delivery", "procurement and delivery",
      "procurement services", "last mile", "last-mile", "stockpile",
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
    consulting: ["consulting", "consultancy", "advisory", "technical assistance", "feasibility", "evaluation service", "mid-term evaluation", "final evaluation", "external evaluation", "impact evaluation"],
    food: ["food", "nutrition", "catering", "meal", "agricultural produce", "ration", "foodstuff", "kitchen", "cafeteria"],
    security: ["security", "guarding", "surveillance", "protection", "guard service", "safety service", "access control", "fire safety"],
    language_services: [
      "translation", "interpretation", "interpreter", "translator", "linguistic", "language service",
      "transcription", "proofreading", "editorial", "document translation", "certified translation",
      "legal translation", "technical translation", "localization", "subtitling", "voice-over",
      "dubbing", "multilingual", "language support",
    ],
    engineering: ["engineering", "mechanical", "electrical engineering", "civil engineering"],
    environment: ["environment", "climate", "biodiversity", "pollution", "waste management", "cleaning service", "janitorial", "sanitation service", "recycling"],
    agriculture: ["agriculture", "agricultural", "farming", "livestock", "crop", "irrigation"],
    water_sanitation: ["water", "sanitation", "wash", "hygiene", "sewage", "latrine"],
    energy: ["energy", "solar", "electricity", "power", "renewable", "grid"],
  };

  type Row = {
    id: number; title: string; description: string | null; agency: string;
    deadline: string; country: string; sector: string; reference_id: string;
    requirements: string[] | null; experience_level: string | null;
    opportunity_type: string | null; source_url: string | null;
    submission_language: string | null;
    estimated_value: string | number | null;
  };
  const byId = new Map<number, Row>();

  if (effectiveUserSlugs.size) {
    // Per-slug pool — LIKE on title + sector pulls genuinely relevant rows
    // rather than whatever happens to have the earliest deadline. Each slug
    // gets up to 150; union deduped by id.
    for (const slug of effectiveUserSlugs) {
      const kws = slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")];
      const patterns = kws.map((k) => `%${k}%`);
      const rows = await sql`
        SELECT id, title, description, agency, deadline, country, sector,
               reference_id, requirements, experience_level, opportunity_type,
               source_url, submission_language, estimated_value
        FROM tenders
        WHERE status = 'open'
          AND deadline >= CURRENT_DATE
          AND (
            title ILIKE ANY(${patterns}::text[])
            OR sector ILIKE ANY(${patterns}::text[])
            OR COALESCE(description, '') ILIKE ANY(${patterns}::text[])
          )
        ORDER BY deadline ASC
        LIMIT 150
      `;
      for (const r of rows) byId.set(r.id as number, r as Row);
    }
  }

  // Baseline pool only when the per-slug pass yielded thin results — avoids
  // off-sector contamination (the "Zawda noise" problem) when we already have
  // a solid candidate set from the slug keywords.
  if (byId.size < 10 || effectiveUserSlugs.size === 0) {
    const baseline = await sql`
      SELECT id, title, description, agency, deadline, country, sector,
             reference_id, requirements, experience_level, opportunity_type,
             source_url, submission_language, estimated_value
      FROM tenders
      WHERE status = 'open'
        AND deadline >= CURRENT_DATE
      ORDER BY deadline ASC
      LIMIT 300
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

  type Scored = MatchedTender & { _strict: boolean; _regional: boolean; _geoOpen: boolean; _sectorScore: number };
  const scored: Scored[] = [];

  for (const t of candidates) {
    const rawTitle = (t.title as string ?? "");
    if (!isEnglishTitle(rawTitle, t.submission_language as string | null)) continue;

    // Drop individual-consultant recruitments (ReliefWeb jobs feed, UN rosters)
    // unless the user is itself a consulting firm or has opted in explicitly.
    if (!allowConsultancies && (t.opportunity_type as string | null) === "Consultancy") continue;

    // Second line of defence: many crawlers tag individual-contractor/roster
    // postings as plain "RFP" or "Individual Contractor" rather than
    // "Consultancy". Catch those by title pattern.
    if (!allowConsultancies && INDIVIDUAL_ROLE_RE.test(rawTitle)) continue;

    // Gate sources per configurable rules (e.g. SAM.gov for non-US companies).
    if (feedbackProfile.dismissedTenderIds.has(t.id as number)) continue;

    const tSourceUrl = (t.source_url as string | null) ?? "";
    if (shouldSuppressSource(tSourceUrl, countrySet)) continue;

    const tSector = (t.sector as string ?? "");
    const tCountry = (t.country as string ?? "").toLowerCase();
    const tTitle = rawTitle;
    const tAgency = (t.agency as string ?? "");
    const tDescription = (t.description as string | null) ?? "";
    const reqs = (t.requirements as string[] | null) ?? [];

    const isGeoOpen = !tCountry || tCountry === "global" || tCountry === "remote" || tCountry === "multiple";
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
    let tokenHits = 0;
    for (const tok of userTokens) if (tenderTokens.has(tok)) tokenHits++;
    const tokenScore = Math.min(25, tokenHits * 5);

    // Agency name overlap — captures "UN Women" matching a gender-focused consultancy.
    const agencyTokens = new Set<string>(tokenize(tAgency));
    let agencyHits = 0;
    for (const tok of userTokens) if (agencyTokens.has(tok)) agencyHits++;
    const agencyScore = Math.min(5, agencyHits * 2);

    let geoScore = 0;
    if (strictGeoMatch) geoScore = 30;
    else if (regionalGeoMatch) geoScore = 20;
    else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) geoScore = 10;
    // else: geo-open, user didn't opt in and strict supply is healthy — held at 0.

    let feedbackScore = 0;
    const normalizedAgency = tAgency.toLowerCase();
    if (normalizedAgency && feedbackProfile.positiveAgencies.has(normalizedAgency)) feedbackScore += 5;
    for (const slug of tSlugs) {
      if (feedbackProfile.positiveSectorSlugs.has(slug)) feedbackScore += 5;
    }
    feedbackScore = Math.min(10, feedbackScore);

    let total = sectorScore + tokenScore + agencyScore + geoScore + feedbackScore;

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
    if (total < 15) continue;

    // Flat match_reasons (legacy compat)
    const matchReasons: string[] = [];
    const matchedSlugs = [...effectiveUserSlugs].filter((s) => tSlugs.has(s));
    if (matchedSlugs.length) matchReasons.push(`Sector: ${matchedSlugs.map((s) => s.replace(/_/g, " ")).join(", ")}`);
    if (tokenHits > 0) {
      const matchedTokens = [...userTokens].filter((tok) => tenderTokens.has(tok)).slice(0, 3);
      if (matchedTokens.length) matchReasons.push(`Keywords: ${matchedTokens.join(", ")}`);
    }
    if (strictGeoMatch) matchReasons.push(`Country: ${t.country}`);
    else if (regionalGeoMatch) matchReasons.push(`Regional: ${t.country}`);
    else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) {
      matchReasons.push(tCountry === "remote" ? "Remote (location-agnostic)" : "Global (no country required)");
    }

    // Structured match reason (Sprint 5)
    const srSectorNames = matchedSlugs.map((s) => s.replace(/_/g, " "));
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
    if (autoGeoOpen && !strictGeoMatch) srCaveats.push("Geography widened beyond your selected countries.");
    if (sparseProfile) srCaveats.push("Company profile based on limited website content.");
    const deadline = new Date(t.deadline as string);
    if (!Number.isNaN(deadline.getTime())) {
      const daysLeft = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
      if (daysLeft >= 0 && daysLeft <= 7) srCaveats.push(`Deadline is soon (${daysLeft} day${daysLeft === 1 ? "" : "s"} left).`);
    }

    const srSummary: string[] = [];
    if (srSectorNames.length) srSummary.push(`Matched on ${srSectorNames.join(", ")} sector${srSectorNames.length > 1 ? "s" : ""}.`);
    if (srCaps.length) srSummary.push(`Capabilities: ${srCaps.join(", ")}.`);
    else if (srKws.length) srSummary.push(`Keywords: ${srKws.join(", ")}.`);
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
      source_url: (t.source_url as string | null) ?? null,
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
  for (const s of strictPool.slice(0, 15)) out.push(stripMeta(s));

  // Regional: lightly discount so country-specific still ranks higher.
  const regionalDiscount = autoGeoOpen ? 0.85 : 0.75;
  for (const s of regionalPool.slice(0, 10)) {
    out.push({ ...stripMeta(s), score: Math.max(20, Math.round(s.score * regionalDiscount)) });
  }

  // Global: only show when user opted in OR strict+regional supply is thin.
  const wantGlobal = acceptsGlobal || autoGeoOpen || out.length < 8;
  if (wantGlobal) {
    const globalDiscount = acceptsGlobal ? 0.9 : (autoGeoOpen ? 0.75 : 0.6);
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
  if (adjacentSlugs.size) {
    const adjacentById = new Map<number, Row>();
    for (const slug of adjacentSlugs) {
      const kws = slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")];
      const patterns = kws.map((k) => `%${k}%`);
      const rows = await sql`
        SELECT id, title, description, agency, deadline, country, sector,
               reference_id, requirements, experience_level, opportunity_type,
               source_url, submission_language, estimated_value
        FROM tenders
        WHERE status = 'open'
          AND deadline >= CURRENT_DATE
          AND (
            title ILIKE ANY(${patterns}::text[])
            OR sector ILIKE ANY(${patterns}::text[])
            OR COALESCE(description, '') ILIKE ANY(${patterns}::text[])
          )
        ORDER BY deadline ASC
        LIMIT 100
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
      if (feedbackProfile.dismissedTenderIds.has(t.id as number)) continue;
      if (!allowConsultancies && (t.opportunity_type as string | null) === "Consultancy") continue;
      if (!allowConsultancies && INDIVIDUAL_ROLE_RE.test(rawTitle)) continue;

      const adjSourceUrl = (t.source_url as string | null) ?? "";
      if (shouldSuppressSource(adjSourceUrl, countrySet)) continue;

      const tSector = (t.sector as string ?? "");
      const tCountry = (t.country as string ?? "").toLowerCase();
      const tTitle = rawTitle;
      const tAgency = (t.agency as string ?? "");
      const tDescription = (t.description as string | null) ?? "";
      const reqs = (t.requirements as string[] | null) ?? [];

      const isGeoOpen = !tCountry || tCountry === "global" || tCountry === "remote" || tCountry === "multiple";
      const strictGeoMatch = countrySet.has(tCountry);
      const regionalGeoMatch = !strictGeoMatch && !isGeoOpen && regionalSet.has(tCountry);
      if (!strictGeoMatch && !regionalGeoMatch && !isGeoOpen) continue;

      const adjEvidenceText = `${tTitle} ${tSector} ${reqs.join(" ")} ${tDescription}`.trim();
      const tSlugs = refineTenderSlugs(
        new Set<SectorSlug>(normalizeSector(tSector, tTitle, `${reqs.join(" ")} ${tDescription}`.trim())),
        adjEvidenceText,
      );
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
      const total = Math.round((sectorScore + tokenScore + agencyScore + geoScore + feedbackScore) * 0.6);
      if (total < 10) continue;

      const matchedAdjSlugs = [...adjacentSlugs].filter((s) => tSlugs.has(s));
      const matchedExplicitAdjSlugs = matchedAdjSlugs.filter((s) => explicitAdjacentSlugs.has(s));
      const adjMatchReasons: string[] = [];
      if (matchedAdjSlugs.length) {
        adjMatchReasons.push(
          `${matchedExplicitAdjSlugs.length ? "Requested adjacent" : "Adjacent"}: ${matchedAdjSlugs.map((s) => s.replace(/_/g, " ")).join(", ")}`
        );
      }
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
        source_url: (t.source_url as string | null) ?? null,
        match_reasons: adjMatchReasons,
        structured_reasons: adj_structured_reasons,
        bucket: adjBucket,
        is_adjacent: true,
      });
    }
    adjOut.sort((a, b) => b.score - a.score);
    for (const s of adjOut.slice(0, 50)) out.push(s);
  }

  const finalOut = await enrichTopMatches(assignOpportunityBuckets(dedupeFinalMatches(out)));

  // EPIC E: confidence distribution observability
  const confidenceDist = finalOut.reduce((acc, t) => {
    const c = t.structured_reasons?.confidence ?? "none";
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const withoutStructured = finalOut.filter((t) => !t.structured_reasons).length;
  console.log("[tp:match:confidence]", confidenceDist, { total: finalOut.length, withoutStructured });

  return finalOut;
}

function stripMeta(s: MatchedTender & { _strict: boolean; _regional: boolean; _geoOpen: boolean; _sectorScore: number }): MatchedTender {
  const { _strict, _regional, _geoOpen, _sectorScore, ...rest } = s;
  void _strict; void _regional; void _geoOpen; void _sectorScore;
  return rest;
}

function finalMatchKey(tender: MatchedTender): string {
  const title = tender.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const agency = (tender.agency ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const deadline = tender.deadline ? new Date(tender.deadline).toISOString().slice(0, 10) : "";
  return `${title}|${agency}|${deadline}`;
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
  const userCountries = countries.map((c) => c.toLowerCase());
  const globalTerms = ["global", "international", "worldwide", "multiple", "multi-country", "regional", "all countries"];

  // When no countries provided (legacy calls), skip country filtering so we
  // don't accidentally return zero grants for existing assessments.
  const candidates = userCountries.length
    ? await sql`
        SELECT id, title, agency, deadline, sector, themes, eligible_org_types,
               source_url, description, value_range, country, region
        FROM grants
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= NOW())
          AND (
            country IS NULL
            OR country = ''
            OR LOWER(country) = ANY(${globalTerms}::text[])
            OR LOWER(country) = ANY(${userCountries}::text[])
          )
        ORDER BY deadline ASC NULLS LAST
        LIMIT 200
      `
    : await sql`
        SELECT id, title, agency, deadline, sector, themes, eligible_org_types,
               source_url, description, value_range, country, region
        FROM grants
        WHERE status = 'open'
          AND (deadline IS NULL OR deadline >= NOW())
        ORDER BY deadline ASC NULLS LAST
        LIMIT 200
      `;

  if (!candidates.length) return [];

  const userSlugs = userSectorSlugs(null, sectors);
  const themeSet = new Set(devThemes.map((t) => t.toLowerCase()));
  const grantUserTokens = new Set<string>([
    ...tokenize(sectors.join(" ")),
    ...tokenize(devThemes.join(" ")),
  ]);

  const scored: MatchedGrant[] = [];

  for (const g of candidates) {
    let score = 0;
    const gSector = (g.sector as string ?? "");
    const gTitle = (g.title as string ?? "");
    const gDescription = (g.description as string | null) ?? "";

    const gSlugs = new Set<SectorSlug>(normalizeSector(gSector, gTitle, null));
    let sectorHits = 0;
    for (const s of userSlugs) if (gSlugs.has(s)) sectorHits++;
    if (sectorHits > 0) score += Math.min(40, sectorHits * 25);

    const eligibleOrgs = g.eligible_org_types as string[] | null;
    if (eligibleOrgs?.length) {
      if (orgType) {
        const orgLower = orgType.toLowerCase();
        const matched = eligibleOrgs.some((o) => {
          const oLower = o.toLowerCase();
          return oLower === orgLower || oLower.includes(orgLower) || orgLower.includes(oLower);
        });
        if (matched) score += 25;
      } else {
        score += 5;
      }
    } else {
      score += 15;
    }

    const grantThemes = g.themes as string[] | null;
    if (grantThemes?.length && themeSet.size) {
      let themeHits = 0;
      for (const gt of grantThemes) if (themeSet.has(gt.toLowerCase())) themeHits++;
      score += Math.min(30, themeHits * 10);
    } else if (grantThemes?.length) {
      score += 5;
    }

    if (grantUserTokens.size) {
      const grantTokens = new Set<string>([
        ...tokenize(gTitle), ...tokenize(gDescription), ...tokenize(gSector),
      ]);
      let tokenHits = 0;
      for (const tok of grantUserTokens) if (grantTokens.has(tok)) tokenHits++;
      score += Math.min(15, tokenHits * 5);
    }

    // Skip zero-signal grants — the old `score = 8` floor caused identical
    // grants to appear for every company regardless of relevance.
    if (score === 0) continue;

    scored.push({
      id: g.id as number,
      title: g.title as string,
      agency: g.agency as string,
      deadline: g.deadline as string,
      sector: g.sector as string,
      score: Math.min(100, score),
      source_url: (g.source_url as string | null) ?? null,
      description: gDescription || null,
      value_range: (g.value_range as string | null) ?? null,
      country: (g.country as string | null) ?? null,
      region: (g.region as string | null) ?? null,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  // Cap at 2 results per agency to avoid one donor dominating the list.
  const agencyCounts = new Map<string, number>();
  const out: MatchedGrant[] = [];
  for (const g of scored) {
    const agency = g.agency ?? "";
    const count = agencyCounts.get(agency) ?? 0;
    if (count >= 3) continue;
    agencyCounts.set(agency, count + 1);
    out.push(g);
    if (out.length >= 20) break;
  }
  return assignGrantOpportunityBuckets(dedupeGrantMatches(out));
}
