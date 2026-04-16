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
  "offer", "offering", "including",
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

  const candidates = await sql`
    SELECT id, title, description, agency, deadline, country, sector,
           reference_id, requirements, experience_level, opportunity_type,
           source_url, submission_language
    FROM tenders
    WHERE status = 'open'
      AND deadline >= CURRENT_DATE
    ORDER BY deadline ASC
    LIMIT 600
  `;

  if (!candidates.length) return [];

  const userSlugs = userSectorSlugs(analysis.detected_industry, analysis.sectors);

  // Build user capability token bag from services + capabilities + detected_industry.
  const userTokens = new Set<string>([
    ...tokenize((analysis.services ?? []).join(" ")),
    ...tokenize((analysis.capabilities ?? []).join(" ")),
    ...tokenize(analysis.detected_industry ?? ""),
  ]);

  type Scored = MatchedTender & { _strict: boolean; _geoOpen: boolean };
  const scored: Scored[] = [];

  for (const t of candidates) {
    const rawTitle = (t.title as string ?? "");
    if (!isEnglishTitle(rawTitle, t.submission_language as string | null)) continue;

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
    else if (isGeoOpen && acceptsGlobal) geoScore = 10;
    // else: geo-open, user didn't opt in — held at 0; may surface in soft pass.

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
    });
  }

  const strict = scored.filter((s) => s._strict).sort((a, b) => b.score - a.score);
  const softPool = scored.filter((s) => !s._strict && s._geoOpen).sort((a, b) => b.score - a.score);

  const out: MatchedTender[] = strict.slice(0, 10).map(stripMeta);

  // Soft geo fallback: if strict yields <3, surface geo-open tenders at a
  // reduced score so users see *something* relevant.
  if (out.length < 3 && softPool.length) {
    const need = Math.min(10 - out.length, softPool.length);
    for (let i = 0; i < need; i++) {
      const s = softPool[i];
      out.push({ ...stripMeta(s), score: Math.max(15, Math.round(s.score * 0.6)) });
    }
  }

  return out;
}

function stripMeta(s: MatchedTender & { _strict: boolean; _geoOpen: boolean }): MatchedTender {
  const { _strict, _geoOpen, ...rest } = s;
  void _strict; void _geoOpen;
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
