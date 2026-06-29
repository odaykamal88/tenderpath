import { sql } from "@/lib/db";
import type { AIAnalysis, GeographyMode, MatchReason } from "@/lib/types";
import { ensureNetworkMatchingColumns } from "./schema";

export const TENDER_NETWORK_DISCOVERY_THRESHOLD = 52;
export const TENDER_NETWORK_DISCOVERY_LIMIT = 40;
export const TENDER_NETWORK_DISCOVERY_SCAN_LIMIT = 2500;

type TenderDiscoveryRow = {
  id: number;
  title: string;
  description: string | null;
  agency: string | null;
  country: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  eligibility_summary: string | null;
  required_registrations: string | null;
  requirements: unknown;
};

type NetworkCompanyDiscoveryRow = {
  id: number;
  name: string;
  website: string | null;
  services_text: string | null;
  countries: unknown;
  sectors: unknown;
  org_type: string | null;
  ai_analysis: unknown;
  contact_email: string | null;
  contact_linkedin: string | null;
  ungm_status: string | null;
};

type ScoredNetworkCompany = {
  companyId: number;
  score: number;
  matchReasons: string[];
  structuredReasons: MatchReason;
};

export interface TenderNetworkDiscoveryResult {
  tenderId: number;
  scanned: number;
  qualified: number;
  inserted: number;
  refreshed: number;
  threshold: number;
  limit: number;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      return asStringArray(JSON.parse(trimmed) as unknown);
    } catch {
      return trimmed.split(",").map((v) => v.trim()).filter(Boolean);
    }
  }
  return [];
}

function compact(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value?.trim();
    if (!clean) continue;
    const key = normalized(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const TOKEN_STOPWORDS = new Set([
  "agency",
  "award",
  "business",
  "company",
  "companies",
  "consultant",
  "contract",
  "development",
  "goods",
  "management",
  "procurement",
  "programme",
  "project",
  "provide",
  "services",
  "service",
  "solution",
  "solutions",
  "supplier",
  "support",
  "technical",
  "tender",
  "work",
  "works",
]);

function tokenSet(value: string): Set<string> {
  return new Set(
    normalized(value)
      .split(" ")
      .filter((token) => token.length > 3 && !TOKEN_STOPWORDS.has(token)),
  );
}

function hasTextOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const aa = normalized(a);
  const bb = normalized(b);
  if (!aa || !bb) return false;
  if (aa.includes(bb) || bb.includes(aa)) return true;
  const aTokens = tokenSet(aa);
  for (const token of tokenSet(bb)) if (aTokens.has(token)) return true;
  return false;
}

function phraseHits(tenderText: string, phrases: string[], max: number): string[] {
  const text = normalized(tenderText);
  const tenderTokens = tokenSet(text);
  const hits: string[] = [];

  for (const phrase of phrases) {
    const p = normalized(phrase);
    if (p.length < 4) continue;
    if (text.includes(p)) {
      hits.push(phrase);
    } else {
      const phraseTokens = tokenSet(p);
      let overlap = 0;
      for (const token of phraseTokens) if (tenderTokens.has(token)) overlap++;
      if (overlap >= Math.min(2, Math.max(1, phraseTokens.size))) hits.push(phrase);
    }
    if (hits.length >= max) break;
  }

  return hits;
}

function countryAlignment(companyCountries: string[], tenderCountry: string | null): {
  score: number;
  mode: GeographyMode;
  label: string | null;
  caveat: string | null;
} {
  const country = normalized(tenderCountry);
  if (!country) return { score: 0, mode: "unknown", label: null, caveat: null };

  for (const c of companyCountries) {
    const cc = normalized(c);
    if (!cc) continue;
    if (cc === country || cc.includes(country) || country.includes(cc)) {
      return { score: 18, mode: "direct", label: c, caveat: null };
    }
    if (["global", "worldwide", "international"].includes(cc)) {
      return { score: 10, mode: "global-open", label: c, caveat: null };
    }
    if (["regional", "mena", "middle east", "africa", "asia", "europe"].includes(cc)) {
      return { score: 8, mode: "regional", label: c, caveat: null };
    }
  }

  return {
    score: 0,
    mode: "unknown",
    label: null,
    caveat: `No explicit ${tenderCountry} coverage in network profile.`,
  };
}

function confidenceFor(score: number, caveats: string[]): "high" | "medium" | "low" {
  if (score >= 74 && caveats.length <= 1) return "high";
  if (score >= 60) return "medium";
  return "low";
}

function tenderText(tender: TenderDiscoveryRow): string {
  return [
    tender.title,
    tender.description,
    tender.sector,
    tender.eligibility_summary,
    tender.required_registrations,
    typeof tender.requirements === "string" ? tender.requirements : JSON.stringify(tender.requirements ?? ""),
  ].filter(Boolean).join(" ");
}

function scoreNetworkCompanyForTender(
  tender: TenderDiscoveryRow,
  company: NetworkCompanyDiscoveryRow,
): ScoredNetworkCompany | null {
  const analysis = (company.ai_analysis ?? null) as Partial<AIAnalysis> | null;
  if (!analysis) return null;

  const countries = asStringArray(company.countries);
  const sectors = compact([
    ...asStringArray(company.sectors),
    ...(Array.isArray(analysis.sectors) ? analysis.sectors : []),
    analysis.detected_industry,
  ]);
  const services = compact([
    ...(Array.isArray(analysis.services) ? analysis.services : []),
    company.services_text,
  ]);
  const capabilities = compact([
    ...(Array.isArray(analysis.capabilities) ? analysis.capabilities : []),
    ...(Array.isArray(analysis.strengths) ? analysis.strengths : []),
  ]);
  const text = tenderText(tender);
  const reasons: string[] = [];
  const caveats: string[] = [];
  const matchedSectors: string[] = [];
  const matchedCapabilities: string[] = [];
  const matchedKeywords: string[] = [];
  let sectorScore = 0;
  let capabilityScore = 0;
  let geographyScore = 0;
  let operationalScore = 0;

  const directSector = sectors.find((sector) => hasTextOverlap(sector, tender.sector));
  if (directSector) {
    sectorScore = 26;
    matchedSectors.push(directSector);
    reasons.push(`Sector aligns: ${directSector}.`);
  } else {
    const sectorHits = phraseHits(text, sectors, 2);
    if (sectorHits.length) {
      sectorScore = Math.min(18, sectorHits.length * 9);
      matchedSectors.push(...sectorHits);
      reasons.push(`Sector evidence: ${sectorHits.join(", ")}.`);
    } else {
      caveats.push("Sector fit needs review.");
    }
  }

  const capabilityHits = phraseHits(text, capabilities, 4);
  if (capabilityHits.length) {
    capabilityScore += Math.min(32, capabilityHits.length * 10);
    matchedCapabilities.push(...capabilityHits);
    reasons.push(`Capability evidence: ${capabilityHits.slice(0, 3).join(", ")}.`);
  } else {
    caveats.push("No direct capability phrase hit.");
  }

  const serviceHits = phraseHits(text, services, 3);
  if (serviceHits.length) {
    capabilityScore += Math.min(16, serviceHits.length * 7);
    matchedKeywords.push(...serviceHits);
    reasons.push(`Service overlap: ${serviceHits.slice(0, 2).join(", ")}.`);
  }

  if (analysis.summary) {
    const summaryHits = phraseHits(text, [analysis.summary], 1);
    if (summaryHits.length) {
      capabilityScore += 6;
      matchedKeywords.push("company summary");
    }
  }

  const geo = countryAlignment(countries, tender.country);
  geographyScore = geo.score;
  if (geo.label) reasons.push(`Geography covers ${geo.label}.`);
  if (geo.caveat) caveats.push(geo.caveat);

  const ungmStatus = normalized(company.ungm_status);
  if (["basic", "level 1", "level 2"].includes(ungmStatus)) {
    operationalScore += 5;
    reasons.push(`UNGM status recorded: ${company.ungm_status}.`);
  } else if (!ungmStatus || ungmStatus === "unknown") {
    caveats.push("UNGM status unknown.");
  }

  if (company.contact_email?.includes("@")) {
    operationalScore += 3;
    reasons.push("Email contact available.");
  } else if (company.contact_linkedin) {
    operationalScore += 2;
    reasons.push("LinkedIn contact available.");
  }

  const rawScore = sectorScore + capabilityScore + geographyScore + operationalScore;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  if (!reasons.length) reasons.push("Needs manual review.");

  const structuredReasons: MatchReason = {
    summary: reasons.slice(0, 4),
    matchedSectors: matchedSectors.slice(0, 4),
    matchedCapabilities: matchedCapabilities.slice(0, 5),
    matchedKeywords: matchedKeywords.slice(0, 5),
    procurement: {
      opportunityType: tender.opportunity_type,
      sourceName: tender.source_name,
      sourceUrl: tender.source_url,
      sectorLabel: tender.sector,
      estimatedValue: tender.estimated_value,
    },
    geographyAlignment: {
      userCountries: countries,
      tenderCountry: tender.country,
      mode: geo.mode,
    },
    scoreBreakdown: {
      sector: sectorScore,
      capabilities: capabilityScore,
      geography: geographyScore,
      agency: operationalScore,
    },
    evidenceQuality: capabilityHits.length || serviceHits.length || directSector ? "rich" : "thin",
    confidence: confidenceFor(score, caveats),
    caveats: caveats.slice(0, 4),
  };

  return {
    companyId: Number(company.id),
    score,
    matchReasons: reasons.slice(0, 5),
    structuredReasons,
  };
}

export async function discoverNetworkProspectsForTender(
  tenderId: number,
  opts: { threshold?: number; limit?: number; scanLimit?: number } = {},
): Promise<TenderNetworkDiscoveryResult | null> {
  await ensureNetworkMatchingColumns();

  const threshold = Math.max(1, Math.min(100, Math.round(opts.threshold ?? TENDER_NETWORK_DISCOVERY_THRESHOLD)));
  const limit = Math.max(1, Math.min(100, Math.round(opts.limit ?? TENDER_NETWORK_DISCOVERY_LIMIT)));
  const scanLimit = Math.max(limit, Math.min(5000, Math.round(opts.scanLimit ?? TENDER_NETWORK_DISCOVERY_SCAN_LIMIT)));

  const tenderRows = (await sql`
    SELECT
      id, title, description, agency, country, sector, deadline, estimated_value,
      source_url, source_name, opportunity_type, eligibility_summary,
      required_registrations, requirements
    FROM tenders
    WHERE id = ${tenderId}
    LIMIT 1
  `) as TenderDiscoveryRow[];
  const tender = tenderRows[0];
  if (!tender) return null;

  const companies = (await sql`
    SELECT
      id, name, website, services_text, countries, sectors, org_type,
      ai_analysis, contact_email, contact_linkedin, ungm_status
    FROM network_companies
    WHERE is_active = TRUE
      AND profile_status = 'ready'
      AND ai_analysis IS NOT NULL
    ORDER BY last_matched_at ASC NULLS FIRST, updated_at DESC, id DESC
    LIMIT ${scanLimit}
  `) as NetworkCompanyDiscoveryRow[];

  const qualified = companies
    .map((company) => scoreNetworkCompanyForTender(tender, company))
    .filter((match): match is ScoredNetworkCompany => match !== null && match.score >= threshold)
    .sort((a, b) => b.score - a.score || b.companyId - a.companyId)
    .slice(0, limit);

  const existingRows = await sql`
    SELECT network_company_id
    FROM network_company_matches
    WHERE tender_id = ${tender.id}
  `;
  const existingIds = new Set(existingRows.map((row) => Number(row.network_company_id)));

  let inserted = 0;
  let refreshed = 0;

  for (const match of qualified) {
    const isExisting = existingIds.has(match.companyId);
    await sql`
      INSERT INTO network_company_matches (
        network_company_id, tender_id, score, structured_reasons,
        match_reasons, status, last_scored_at
      ) VALUES (
        ${match.companyId}, ${tender.id}, ${match.score},
        ${JSON.stringify(match.structuredReasons)}::jsonb,
        ${JSON.stringify(match.matchReasons)}::jsonb,
        'new', NOW()
      )
      ON CONFLICT (network_company_id, tender_id) DO UPDATE SET
        score = EXCLUDED.score,
        structured_reasons = EXCLUDED.structured_reasons,
        match_reasons = EXCLUDED.match_reasons,
        last_scored_at = NOW(),
        updated_at = NOW()
    `;
    if (isExisting) refreshed += 1;
    else inserted += 1;
  }

  const companyIds = qualified.map((match) => match.companyId);
  if (companyIds.length) {
    await sql`
      UPDATE network_companies
      SET last_matched_at = NOW(), updated_at = NOW()
      WHERE id = ANY(${companyIds}::int[])
    `;
  }

  const result = {
    tenderId: tender.id,
    scanned: companies.length,
    qualified: qualified.length,
    inserted,
    refreshed,
    threshold,
    limit,
  };

  console.info("[network:discover:tender]", result);
  return result;
}
