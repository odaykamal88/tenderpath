import { sql } from "@/lib/db";
import type { MatchedTender, MatchedGrant, AIAnalysis } from "@/lib/types";
import { normalizeSector, userSectorSlugs, type SectorSlug } from "@/lib/crawlers/sector-map";

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
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
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
): Promise<MatchedTender[]> {
  const countrySet = new Set(countries.map((c) => c.toLowerCase()));
  const acceptsGlobal = countrySet.has("global");

  // Pre-probe the strict-geo pool size for this user. When country-specific
  // supply is thin (common for logistics in Syria/Lebanon/Palestine etc.),
  // we auto-relax geo so geo-open tenders score as if the user opted in to
  // Global. This is the key differentiator for niche MENA profiles — better
  // to surface a handful of highly relevant geo-open opportunities than an
  // empty page because the user's country has no open notices today.
  const countryArr = countries.map((c) => c.toLowerCase());
  const strictProbe = await sql`
    SELECT COUNT(*)::int AS n FROM tenders
    WHERE status='open' AND deadline >= CURRENT_DATE
      AND LOWER(country) = ANY(${countryArr}::text[])`;
  const strictPoolSize = Number(strictProbe?.[0]?.n ?? 0);
  const autoGeoOpen = !acceptsGlobal && strictPoolSize < 25;

  const userSlugs = userSectorSlugs(analysis.detected_industry, analysis.sectors);

  // Consultancy tenders (ReliefWeb jobs feed, UN individual-consultant roster)
  // are individual-recruitment postings, not B2B procurement. A logistics or
  // warehousing company should never see "M&E Specialist Consultant" or
  // "Investigator Roster" — those are jobs for people, not contracts for firms.
  // Only surface them when the user actually sells consulting services.
  const userIsConsulting = userSlugs.has("consulting");

  // Pool per slug instead of a single deadline-sorted LIMIT 600 — otherwise a
  // heavy sector (M&E / consulting) dominates the candidate window and starves
  // narrower industries (logistics, language services) of any candidates to
  // score. We union per-slug pools, then de-dupe by id.
  const slugKeywordMap: Record<string, string[]> = {
    it: ["software", "information technology", "it ", "digital", "platform", "system", "data", "technology"],
    education: ["education", "training", "curriculum", "learning", "teacher", "school"],
    healthcare: ["health", "medical", "hospital", "clinic", "pharmaceutical", "vaccine"],
    logistics: [
      "logistics", "transport", "freight", "shipping", "warehouse", "warehousing",
      "supply chain", "distribution", "fleet", "customs", "cargo", "storage",
      "forwarding", "forwarder", "haulage", "trucking", "delivery of",
      "supply and delivery", "supply of", "procurement and delivery",
      "procurement services", "last mile", "last-mile", "stockpile",
      "prepositioning", "pre-positioning", "clearing", "clearance",
      "loading", "unloading", "import", "export", "dispatch",
      "installation and delivery",
    ],
    construction: ["construction", "civil works", "infrastructure", "building", "rehabilitation", "refurbishment"],
    consulting: ["consulting", "consultancy", "advisory", "technical assistance", "feasibility", "evaluation service", "mid-term evaluation", "final evaluation", "external evaluation", "impact evaluation"],
    food: ["food", "nutrition", "catering", "meal", "agricultural produce", "ration", "foodstuff", "kitchen", "cafeteria"],
    security: ["security", "guarding", "surveillance", "protection", "guard service", "safety service", "access control", "fire safety"],
    language_services: ["translation", "interpretation", "interpreter", "translator", "linguistic", "language service", "transcription", "proofreading", "editorial"],
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
  };
  const byId = new Map<number, Row>();

  if (userSlugs.size) {
    // Per-slug pool — LIKE on title + sector pulls genuinely relevant rows
    // rather than whatever happens to have the earliest deadline. Each slug
    // gets up to 150; union deduped by id.
    for (const slug of userSlugs) {
      const kws = slugKeywordMap[slug] ?? [slug.replace(/_/g, " ")];
      const patterns = kws.map((k) => `%${k}%`);
      const rows = await sql`
        SELECT id, title, description, agency, deadline, country, sector,
               reference_id, requirements, experience_level, opportunity_type,
               source_url, submission_language
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

  // Always mix in a deadline-sorted baseline so we don't miss tenders whose
  // relevance only shows through tokens/agency even when no slug keyword hits.
  const baseline = await sql`
    SELECT id, title, description, agency, deadline, country, sector,
           reference_id, requirements, experience_level, opportunity_type,
           source_url, submission_language
    FROM tenders
    WHERE status = 'open'
      AND deadline >= CURRENT_DATE
    ORDER BY deadline ASC
    LIMIT 300
  `;
  for (const r of baseline) if (!byId.has(r.id as number)) byId.set(r.id as number, r as Row);

  const candidates = Array.from(byId.values());
  if (!candidates.length) return [];

  // Build user capability token bag from services + capabilities + detected_industry.
  const userTokens = new Set<string>([
    ...tokenize((analysis.services ?? []).join(" ")),
    ...tokenize((analysis.capabilities ?? []).join(" ")),
    ...tokenize(analysis.detected_industry ?? ""),
  ]);

  type Scored = MatchedTender & { _strict: boolean; _geoOpen: boolean; _sectorScore: number };
  const scored: Scored[] = [];

  for (const t of candidates) {
    const rawTitle = (t.title as string ?? "");
    if (!isEnglishTitle(rawTitle, t.submission_language as string | null)) continue;

    // Drop individual-consultant recruitments (ReliefWeb jobs feed, UN rosters)
    // unless the user is itself a consulting firm. These pollute results for
    // every other industry — a warehousing company doesn't bid on
    // "Proposal Writers Network" or "External Evaluator Roster".
    if (!userIsConsulting && (t.opportunity_type as string | null) === "Consultancy") continue;

    const tSector = (t.sector as string ?? "");
    const tCountry = (t.country as string ?? "").toLowerCase();
    const tTitle = rawTitle;
    const tAgency = (t.agency as string ?? "");
    const tDescription = (t.description as string | null) ?? "";
    const reqs = (t.requirements as string[] | null) ?? [];

    const isGeoOpen = !tCountry || tCountry === "global" || tCountry === "remote" || tCountry === "multiple";
    const strictGeoMatch = countrySet.has(tCountry);
    // Skip tenders that are geographically impossible. We keep geo-open ones
    // around for the soft fallback pass even when the user didn't opt in.
    if (!strictGeoMatch && !isGeoOpen) continue;

    // Sector overlap via canonical slugs — symmetric, so "it" on both sides scores.
    // Description is a huge signal lift for UN feeds where `sector` is often
    // a bare UNSPSC code and the title is boilerplate ("Request for Proposal").
    const tSlugs = new Set<SectorSlug>(
      normalizeSector(tSector, tTitle, `${reqs.join(" ")} ${tDescription}`.trim()),
    );
    let sectorScore = 0;
    for (const s of userSlugs) if (tSlugs.has(s)) sectorScore += 40;
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
    else if (isGeoOpen && (acceptsGlobal || autoGeoOpen)) geoScore = 10;
    // else: geo-open, user didn't opt in and strict supply is healthy — held at 0.

    const total = sectorScore + tokenScore + agencyScore + geoScore;

    // Lower threshold vs before — with canonical sector slugs even a partial
    // match should carry real signal. Token-only matches score ~25-30.
    if (sectorScore === 0 && tokenHits === 0) continue;
    if (total < 15) continue;

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
      _strict: strictGeoMatch,
      _geoOpen: isGeoOpen,
      _sectorScore: sectorScore,
    });
  }

  const strict = scored.filter((s) => s._strict).sort((a, b) => b.score - a.score);
  // Soft pool: drop anything that didn't hit a sector slug. Pure token-only
  // hits on boilerplate ("project management", "programme coordinator") would
  // otherwise spray identical M&E / consulting tenders across every industry.
  // Drop the sectorScore floor to 40 only when strict supply is healthy. For
  // thin-supply profiles (autoGeoOpen), any sector-slug hit (score ≥20) is
  // signal — a single keyword match on a logistics notice in a Global feed
  // is exactly the "hidden opportunity" we want to surface.
  const softSectorFloor = autoGeoOpen ? 20 : 40;
  const softPool = scored
    .filter((s) => !s._strict && s._geoOpen && s._sectorScore >= softSectorFloor)
    .sort((a, b) => b.score - a.score);

  const out: MatchedTender[] = strict.slice(0, 10).map(stripMeta);

  // Soft geo fallback: raised threshold from 3 → 5 when supply is thin, so
  // niche MENA profiles get a real list. Also keep score discount milder
  // (0.75 vs 0.6) when autoGeoOpen — these are legitimate matches, not
  // second-class.
  const fallbackTarget = autoGeoOpen ? 8 : 3;
  if (out.length < fallbackTarget && softPool.length) {
    const discount = autoGeoOpen ? 0.75 : 0.6;
    const need = Math.min(10 - out.length, softPool.length);
    for (let i = 0; i < need; i++) {
      const s = softPool[i];
      out.push({ ...stripMeta(s), score: Math.max(20, Math.round(s.score * discount)) });
    }
  }

  return out;
}

function stripMeta(s: MatchedTender & { _strict: boolean; _geoOpen: boolean; _sectorScore: number }): MatchedTender {
  const { _strict, _geoOpen, _sectorScore, ...rest } = s;
  void _strict; void _geoOpen; void _sectorScore;
  return rest;
}

/**
 * Match open grants against org type, development themes, and sectors.
 */
export async function matchGrants(
  sectors: string[],
  orgType: string | null,
  devThemes: string[]
): Promise<MatchedGrant[]> {
  const candidates = await sql`
    SELECT id, title, agency, deadline, sector, themes, eligible_org_types, source_url
    FROM grants
    WHERE status = 'open'
      AND (deadline IS NULL OR deadline >= NOW())
    ORDER BY deadline ASC NULLS LAST
    LIMIT 200
  `;

  if (!candidates.length) return [];

  const userSlugs = userSectorSlugs(null, sectors);
  const themeSet = new Set(devThemes.map((t) => t.toLowerCase()));

  const scored: MatchedGrant[] = [];

  for (const g of candidates) {
    let score = 0;
    const gSector = (g.sector as string ?? "");
    const gTitle = (g.title as string ?? "");

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

    if (score === 0) score = 8;

    scored.push({
      id: g.id as number,
      title: g.title as string,
      agency: g.agency as string,
      deadline: g.deadline as string,
      sector: g.sector as string,
      score: Math.min(100, score),
      source_url: (g.source_url as string | null) ?? null,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}
