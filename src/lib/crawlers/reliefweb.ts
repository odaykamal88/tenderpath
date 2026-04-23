/**
 * ReliefWeb — OCHA's humanitarian information service.
 * Aggregates procurement notices from UN agencies + hundreds of NGOs.
 * Free, no API key. Closest free alternative to Devex/DevelopmentAid.
 * Docs: https://apidoc.reliefweb.int/
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

// ReliefWeb v2 wants an appname GET param to identify the caller. Any non-empty
// unique string works — registration at apidoc.reliefweb.int/parameters#appname
// is courtesy not gate. Default to our domain so the crawler is live out of the
// box; override RELIEFWEB_APPNAME once we've registered if we ever get
// throttled.
const APP_NAME = process.env.RELIEFWEB_APPNAME ?? "tenderpath.me";
const ENDPOINT = `https://api.reliefweb.int/v2/jobs?appname=${APP_NAME}`;
const REPORTS_ENDPOINT = `https://api.reliefweb.int/v2/reports?appname=${APP_NAME}`;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

interface RWFile { url?: string }
interface RWNamed { name?: string }

interface RWReportFields {
  title?: string;
  body?: string;
  date?: { created?: string; original?: string; changed?: string };
  primary_country?: RWNamed;
  country?: RWNamed[];
  source?: RWNamed[];
  url?: string;
  url_alias?: string;
  format?: RWNamed[];
  theme?: RWNamed[];
  language?: RWNamed[];
  file?: RWFile[];
}

interface RWJobFields {
  title?: string;
  body?: string;
  date?: { closing?: string; created?: string };
  country?: RWNamed[];
  source?: RWNamed[];
  url?: string;
  url_alias?: string;
  type?: RWNamed[];
  career_categories?: RWNamed[];
  experience?: RWNamed[];
  theme?: RWNamed[];
}

interface RWItem<F> { id?: string | number; fields?: F }
interface RWResponse<F> { data?: RWItem<F>[] }

async function searchReports(offset: number): Promise<RWItem<RWReportFields>[]> {
  const body = {
    offset,
    limit: PAGE_SIZE,
    fields: {
      include: ["title", "body", "date", "primary_country", "country",
        "source", "url", "url_alias", "format", "theme", "language", "file"],
    },
    filter: {
      operator: "AND",
      conditions: [
        { field: "format.name", value: ["Appeal", "Other"] },
        { field: "title", value: "(tender OR procurement OR \"request for proposal\" OR RFP OR RFQ OR EOI OR \"expression of interest\")" },
      ],
    },
    sort: ["date.created:desc"],
  };

  const resp = await fetchWithTimeout(REPORTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`ReliefWeb reports ${resp.status}`);
  const data = (await resp.json()) as RWResponse<RWReportFields>;
  return data.data ?? [];
}

async function searchConsultancies(offset: number): Promise<RWItem<RWJobFields>[]> {
  // Consultancies are individual contracts — closest "tender" equivalent on the jobs feed.
  const body = {
    offset,
    limit: PAGE_SIZE,
    fields: {
      include: ["title", "body", "date", "country", "source", "url",
        "url_alias", "type", "career_categories", "experience", "theme"],
    },
    filter: {
      operator: "AND",
      conditions: [
        { field: "type.name", value: ["Consultancy"] },
      ],
    },
    sort: ["date.closing:asc"],
  };

  const resp = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`ReliefWeb jobs ${resp.status}`);
  const data = (await resp.json()) as RWResponse<RWJobFields>;
  return data.data ?? [];
}

const ISO: Record<string, string> = {
  Kenya: "KE", Uganda: "UG", Tanzania: "TZ", Ethiopia: "ET", Rwanda: "RW",
  Somalia: "SO", "South Sudan": "SS", Sudan: "SD", Nigeria: "NG", Ghana: "GH",
  Yemen: "YE", Syria: "SY", Iraq: "IQ", Afghanistan: "AF", Bangladesh: "BD",
  Myanmar: "MM", Ukraine: "UA", Venezuela: "VE", Haiti: "HT",
};

function mapReport(item: RWItem<RWReportFields>): RawTender | null {
  const f = item.fields;
  if (!f?.title || !item.id) return null;
  const country = f.primary_country?.name ?? f.country?.[0]?.name ?? "Global";
  const lang = f.language?.[0]?.name ?? "English";
  return {
    reference_id: `RW-R-${item.id}`,
    title: f.title.slice(0, 500),
    description: stripHtml(f.body ?? "").slice(0, 3000) || null,
    agency: f.source?.[0]?.name ?? "ReliefWeb",
    country,
    country_code: ISO[country] ?? null,
    region: null,
    sector: f.theme?.[0]?.name ?? null,
    deadline: null, // reports don't carry deadline; will need detail-page enrichment
    estimated_value: null,
    source_url: f.url_alias ?? f.url ?? f.file?.[0]?.url ?? null,
    opportunity_type: detectType(f.title, f.body),
    eligibility_summary: null,
    experience_level: null,
    submission_language: lang,
    source_tier: 1,
    source_name: "ReliefWeb",
    category: "NGO",
  };
}

function mapConsultancy(item: RWItem<RWJobFields>): RawTender | null {
  const f = item.fields;
  if (!f?.title || !item.id) return null;
  const country = f.country?.[0]?.name ?? "Global";
  const exp = f.experience?.[0]?.name?.toLowerCase() ?? "";
  let level: string = "any";
  if (exp.includes("0-2") || exp.includes("entry")) level = "junior";
  else if (exp.includes("3-4") || exp.includes("mid")) level = "mid";
  else if (exp.includes("5-9") || exp.includes("10+") || exp.includes("senior")) level = "senior";
  return {
    reference_id: `RW-J-${item.id}`,
    title: f.title.slice(0, 500),
    description: stripHtml(f.body ?? "").slice(0, 3000) || null,
    agency: f.source?.[0]?.name ?? "ReliefWeb",
    country,
    country_code: ISO[country] ?? null,
    region: null,
    sector: f.career_categories?.[0]?.name ?? f.theme?.[0]?.name ?? null,
    deadline: f.date?.closing?.slice(0, 10) ?? null,
    estimated_value: null,
    source_url: f.url_alias ?? f.url ?? null,
    opportunity_type: "Consultancy",
    eligibility_summary: null,
    experience_level: level,
    submission_language: "English",
    source_tier: 1,
    source_name: "ReliefWeb",
    category: "NGO",
  };
}

function detectType(title?: string, body?: string): string {
  const text = `${title ?? ""} ${body ?? ""}`.toLowerCase();
  if (text.includes("request for quotation") || /\brfq\b/.test(text)) return "RFQ";
  if (text.includes("expression of interest") || /\beoi\b/.test(text)) return "EOI";
  if (text.includes("invitation to bid") || /\bitb\b/.test(text)) return "ITB";
  if (text.includes("request for proposal") || /\brfp\b/.test(text)) return "RFP";
  return "RFP";
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function crawlReliefWeb(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];

    for (let p = 0; p < MAX_PAGES; p++) {
      const offset = p * PAGE_SIZE;
      const [reports, jobs] = await Promise.all([
        withRetry(() => searchReports(offset)).catch(() => []),
        withRetry(() => searchConsultancies(offset)).catch(() => []),
      ]);
      let added = 0;
      for (const r of reports) { const t = mapReport(r); if (t) { tenders.push(t); added++; } }
      for (const j of jobs)    { const t = mapConsultancy(j); if (t) { tenders.push(t); added++; } }
      if (reports.length < PAGE_SIZE && jobs.length < PAGE_SIZE) break;
      if (added === 0) break;
    }

    return { platform: "ReliefWeb", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "ReliefWeb", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
