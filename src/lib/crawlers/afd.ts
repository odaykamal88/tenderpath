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
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

interface BOAMPRecord {
  idweb?: string;
  objet?: string;
  nomacheteur?: string;
  datelimitereponse?: string;
  descripteur_code?: string;
  famille_libelle?: string;
  nature?: string;
  urlweb?: string;
  lieu?: string;
}

interface BOAMPResponse {
  results?: BOAMPRecord[];
  total_count?: number;
}

function parseBoampDate(raw: string): string | null {
  // "2026-05-15T00:00:00+00:00" or "2026-05-15"
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function fetchPage(offset: number): Promise<BOAMPResponse> {
  const params = new URLSearchParams({
    where: `nomacheteur like "%Agence Française de Développement%" or nomacheteur like "%AFD%"`,
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

function mapRecord(r: BOAMPRecord): RawTender {
  const title = r.objet ?? "Untitled";
  const sectors = normalizeSector(r.famille_libelle ?? r.descripteur_code, title);
  const url = r.urlweb
    ? r.urlweb
    : r.idweb
    ? `https://www.boamp.fr/avis/detail/${r.idweb}`
    : null;

  return {
    reference_id: `AFD-${r.idweb ?? Math.random().toString(36).slice(2)}`,
    title,
    description: null,
    agency: r.nomacheteur ?? "AFD",
    country: r.lieu ? r.lieu.trim() : "France",
    country_code: "FR",
    region: null,
    sector: sectors[0] ?? null,
    deadline: r.datelimitereponse ? parseBoampDate(r.datelimitereponse) : null,
    estimated_value: null,
    source_url: url,
    opportunity_type: r.nature ?? "RFP",
    eligibility_summary: null,
    experience_level: null,
    submission_language: "French",
    source_tier: 1,
    source_name: "AFD",
  };
}

export async function crawlAFD(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await withRetry(() => fetchPage(page * PAGE_SIZE));
      const records = data.results ?? [];
      if (!records.length) break;
      tenders.push(...records.map(mapRecord));
      if (records.length < PAGE_SIZE) break;
    }

    if (tenders.length === 0) {
      return {
        platform: "AFD", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "AFD/BOAMP yielded 0 tenders",
      };
    }

    return { platform: "AFD", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "AFD", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
