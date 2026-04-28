/**
 * AFD — Agence Française de Développement.
 * Uses BOAMP (OpenDataSoft) public API, which covers AFD's institutional
 * French procurement (office supplies, IT, consultancies). Note: this does
 * NOT cover AFD's project-financed development tenders, which are published
 * through borrower country procurement portals. Low volume (~5-30 notices).
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const BOAMP_API =
  "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";
const PLACE_SEARCH_URL =
  "https://www.marches-publics.gouv.fr/index.php?page=Entreprise.EntrepriseAdvancedSearch&AllCons&id=0&orgAcronyme=c8v";
const PLACE_BASE_URL = "https://www.marches-publics.gouv.fr";
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

interface BOAMPRecord {
  idweb?: string;
  objet?: string;
  nomacheteur?: string;
  datelimitereponse?: string;
  descripteur_code?: string;
  descripteur_libelle?: string[];
  famille_libelle?: string;
  type_marche?: string[];
  procedure_libelle?: string;
  nature?: string;
  nature_libelle?: string;
  urlweb?: string;
  lieu?: string;
  donnees?: string;
}

interface BOAMPResponse {
  results?: BOAMPRecord[];
  total_count?: number;
}

interface PlaceRecord {
  id: string;
  reference: string | null;
  title: string;
  description: string | null;
  country: string | null;
  deadline: string | null;
  procedure: string | null;
  category: string | null;
  sourceUrl: string;
}

const FRENCH_MONTHS: Record<string, string> = {
  janvier: "01",
  fevrier: "02",
  février: "02",
  mars: "03",
  avril: "04",
  mai: "05",
  juin: "06",
  juillet: "07",
  aout: "08",
  août: "08",
  septembre: "09",
  octobre: "10",
  novembre: "11",
  decembre: "12",
  décembre: "12",
};

function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function parseBoampDate(raw: string): string | null {
  // "2026-05-15T00:00:00+00:00" or "2026-05-15"
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function findString(value: unknown, keyHints: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const entries = Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);

  for (const [key, child] of entries) {
    if (typeof child === "string" && keyHints.some((hint) => key.toLowerCase().includes(hint))) {
      const trimmed = child.trim();
      if (trimmed) return trimmed;
    }
    if (child && typeof child === "object") {
      const found = findString(child, keyHints);
      if (found) return found;
    }
  }
  return null;
}

function formatEstimatedValue(donnees: Record<string, unknown> | null): string | null {
  const raw = findString(donnees, ["valeur", "montant"]);
  if (!raw) return null;
  return raw.replace(/\s+/g, " ").slice(0, 120);
}

async function fetchPage(offset: number): Promise<BOAMPResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    where: `(nomacheteur like "%Agence Française de Développement%" or nomacheteur like "%AFD%") and datelimitereponse >= date'${today}'`,
    limit: String(PAGE_SIZE),
    offset: String(offset),
    order_by: "datelimitereponse desc",
    timezone: "UTC",
  });
  const url = `${BOAMP_API}?${params}`;
  const resp = await fetchWithTimeout(url, {
    headers: { Accept: "application/json" },
  }, 25000);
  if (!resp.ok) throw new Error(`BOAMP API HTTP ${resp.status}`);
  return resp.json() as Promise<BOAMPResponse>;
}

async function fetchPlaceSearch(): Promise<string> {
  const resp = await fetchWithTimeout(PLACE_SEARCH_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
    },
  }, 25000);
  if (!resp.ok) throw new Error(`PLACE AFD search HTTP ${resp.status}`);
  return resp.text();
}

function mapRecord(r: BOAMPRecord): RawTender {
  const title = r.objet ?? "Untitled";
  const donnees = parseJsonObject(r.donnees);
  const description =
    findString(donnees, ["description", "resume", "objet"]) ??
    [r.nature_libelle, r.procedure_libelle, r.descripteur_libelle?.join(", ")].filter(Boolean).join(" - ") ??
    null;
  const sectors = normalizeSector(
    r.descripteur_libelle?.join(" ") ?? r.famille_libelle ?? r.descripteur_code,
    title,
    description,
  );
  const url = r.urlweb
    ? r.urlweb
    : r.idweb
    ? `https://www.boamp.fr/avis/detail/${r.idweb}`
    : null;

  return {
    reference_id: `AFD-${r.idweb ?? `${title}-${r.datelimitereponse ?? ""}`.replace(/\W+/g, "-").slice(0, 90)}`,
    title,
    description,
    agency: r.nomacheteur ?? "AFD",
    country: findString(donnees, ["lieu", "pays"]) ?? (r.lieu ? r.lieu.trim() : "France"),
    country_code: null,
    region: null,
    sector: sectors[0] ?? null,
    deadline: r.datelimitereponse ? parseBoampDate(r.datelimitereponse) : null,
    estimated_value: formatEstimatedValue(donnees),
    source_url: url,
    opportunity_type: r.nature_libelle ?? r.nature ?? r.type_marche?.[0] ?? "RFP",
    eligibility_summary: null,
    experience_level: null,
    submission_language: "French",
    source_tier: 1,
    source_name: "AFD",
  };
}

function parsePlaceDeadline(block: string): string | null {
  const match = block.match(/cons_dateEnd[\s\S]*?<div class="day[^"]*">\s*<span>(\d{1,2})<\/span>[\s\S]*?<div class="month">\s*<span>([^<]+)<\/span>[\s\S]*?<div class="year">\s*<span>(\d{4})<\/span>/i);
  if (!match) return null;
  const month = FRENCH_MONTHS[match[2].trim().toLowerCase()];
  return month ? `${match[3]}-${month}-${match[1].padStart(2, "0")}` : null;
}

function parsePlaceRecords(html: string): PlaceRecord[] {
  const blocks = [...html.matchAll(/<div id="row-consultation-[\s\S]*?(?=<div id="row-consultation-|<div class="row pagination|$)/gi)]
    .map((match) => match[0]);
  const records: PlaceRecord[] = [];

  for (const block of blocks) {
    if (!/\bAFD\b|Agence fran[cç]aise de d[ée]veloppement/i.test(cleanText(block) ?? "")) continue;

    const id =
      block.match(/refCons"[^>]+value="(\d+)"/i)?.[1] ??
      block.match(/consultation\/(\d+)/i)?.[1];
    const title =
      cleanText(block.match(/panelBlocIntitule[\s\S]*?<span[^>]+title="([^"]+)"/i)?.[1]) ??
      cleanText(block.match(/<!-- BEGIN REFERENCE \| INTITULE -->([\s\S]*?)<!--END REFERENCE \| INTITULE-->/i)?.[1]);
    if (!id || !title) continue;

    const reference = cleanText(block.match(/<div class="small pull-left">\s*([\s\S]*?)<\/div>/i)?.[1]);
    const description = cleanText(block.match(/panelBlocObjet[\s\S]*?title="([^"]+)"/i)?.[1]);
    const country = cleanText(block.match(/panelBlocLieuxExec[\s\S]*?<span>\s*<i[^>]*><\/i>\s*<span>\s*([^<]+)<\/span>/i)?.[1]);
    const procedure = cleanText(block.match(/cons_procedure[\s\S]*?<abbr[^>]+title="([^"]+)"/i)?.[1]);
    const category = cleanText(block.match(/cons_categorie[\s\S]*?<span>([^<]+)<\/span>/i)?.[1]);
    const sourceUrl = `${PLACE_BASE_URL}/app.php/entreprise/consultation/${id}?orgAcronyme=c8v`;

    records.push({
      id,
      reference,
      title,
      description,
      country,
      deadline: parsePlaceDeadline(block),
      procedure,
      category,
      sourceUrl,
    });
  }

  return records;
}

function mapPlaceRecord(r: PlaceRecord): RawTender {
  const description = [
    r.description,
    r.reference ? `Reference: ${r.reference}.` : null,
    r.procedure ? `Procedure: ${r.procedure}.` : null,
    r.category ? `Category: ${r.category}.` : null,
    r.country ? `Geography: ${r.country}.` : null,
  ].filter(Boolean).join(" ");
  const sectors = normalizeSector(r.category, r.title, description);

  return {
    reference_id: `AFD-PLACE-${r.id}`,
    title: r.title.slice(0, 500),
    description: description || null,
    agency: "AFD - Agence française de développement",
    country: r.country ?? "France",
    country_code: null,
    region: null,
    sector: sectors[0] ?? null,
    deadline: r.deadline,
    estimated_value: null,
    source_url: r.sourceUrl,
    opportunity_type: r.procedure ?? r.category ?? "RFP",
    eligibility_summary: "Published on PLACE, the French State procurement platform used by AFD from 2025.",
    experience_level: null,
    submission_language: "French",
    source_tier: 1,
    source_name: "AFD",
  };
}

export async function crawlAFD(): Promise<CrawlResult> {
  const start = Date.now();
  const errors: string[] = [];
  try {
    const tenders: RawTender[] = [];

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await withRetry(() => fetchPage(page * PAGE_SIZE));
        const records = data.results ?? [];
        if (!records.length) break;
        tenders.push(...records.map(mapRecord));
        if (records.length < PAGE_SIZE) break;
      }
    } catch (err) {
      errors.push(`BOAMP: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const html = await withRetry(fetchPlaceSearch, 2);
      const today = new Date().toISOString().slice(0, 10);
      const placeTenders = parsePlaceRecords(html)
        .filter((record) => !record.deadline || record.deadline >= today)
        .map(mapPlaceRecord);
      tenders.push(...placeTenders);
    } catch (err) {
      errors.push(`PLACE: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (tenders.length === 0) {
      return {
        platform: "AFD", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: errors.length ? errors.join("; ") : "AFD/BOAMP and PLACE yielded 0 tenders",
      };
    }

    const seen = new Set<string>();
    const unique = tenders.filter((tender) => {
      const key = tender.source_url ?? tender.reference_id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      platform: "AFD",
      status: "success",
      tenders: unique,
      durationMs: Date.now() - start,
      error: errors.length ? errors.join("; ") : undefined,
    };
  } catch (err) {
    return {
      platform: "AFD", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
