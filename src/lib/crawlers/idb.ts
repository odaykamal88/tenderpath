/**
 * IDB — Inter-American Development Bank project procurement notices.
 * Uses the official IDB Open Data CKAN datastore API, avoiding the public
 * procurement page's Cloudflare block while preserving primary IDB document
 * URLs and project provenance.
 */
import { normalizeSector } from "./sector-map";
import { type CrawlResult, type RawTender, fetchWithTimeout, withRetry } from "./types";

const RESOURCE_ID = "856aabfd-2c6a-48fb-a8b8-19f3ff443618";
const API_URL = "https://data.iadb.org/api/action/datastore_search_sql";
const LIMIT = 100;

interface IDBRecord {
  _id?: number;
  noticeid?: string;
  type?: string;
  countryname?: string;
  projectnumber?: string;
  proyecturl?: string;
  loannumber?: string;
  noticetitle?: string;
  documenturl?: string;
  projectname?: string;
  publicationdate?: string;
  deadline?: string;
  sectorenglnm?: string;
  projectstatus?: string;
  procurement_id?: string;
  process_id?: string;
  category_nm?: string;
  prcrmnt_mthd_engl_nm?: string;
  process_nm?: string;
  process_desc?: string;
}

interface IDBResponse {
  success?: boolean;
  result?: {
    records?: IDBRecord[];
  };
  error?: {
    message?: string;
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function mapOpportunityType(record: IDBRecord): string {
  const raw = `${record.type ?? ""} ${record.category_nm ?? ""} ${record.prcrmnt_mthd_engl_nm ?? ""}`.toLowerCase();
  if (raw.includes("expression") || raw.includes("eoi")) return "EOI";
  if (raw.includes("consult")) return "Consultancy";
  if (raw.includes("works")) return "Works";
  if (raw.includes("goods")) return "Goods";
  if (raw.includes("rfq")) return "RFQ";
  if (raw.includes("specific")) return "Specific Procurement Notice";
  if (raw.includes("general")) return "General Procurement Notice";
  return record.type ?? "Procurement Notice";
}

function buildSql(): string {
  return [
    `SELECT * FROM "${RESOURCE_ID}"`,
    `WHERE deadline >= '${todayISO()}'`,
    "ORDER BY deadline ASC",
    `LIMIT ${LIMIT}`,
  ].join(" ");
}

async function fetchRecords(): Promise<IDBRecord[]> {
  const url = new URL(API_URL);
  url.searchParams.set("sql", buildSql());
  const resp = await fetchWithTimeout(url.toString(), { headers: { Accept: "application/json" } }, 25000);
  if (!resp.ok) throw new Error(`IDB datastore HTTP ${resp.status}`);
  const data = (await resp.json()) as IDBResponse;
  if (!data.success) throw new Error(`IDB datastore error: ${data.error?.message ?? "unknown"}`);
  return data.result?.records ?? [];
}

function mapRecord(record: IDBRecord): RawTender | null {
  const title = cleanText(record.noticetitle ?? record.process_nm);
  if (!title) return null;

  const project = cleanText(record.projectname);
  const processDescription = cleanText(record.process_desc);
  const method = cleanText(record.prcrmnt_mthd_engl_nm);
  const description = [
    processDescription,
    project ? `Project: ${project}.` : null,
    record.projectnumber ? `Project number: ${record.projectnumber}.` : null,
    method ? `Procurement method: ${method}.` : null,
  ].filter(Boolean).join(" ");
  const sectors = normalizeSector(record.sectorenglnm, title, description);
  const id = record.procurement_id || record.process_id || record.noticeid || String(record._id ?? title);

  return {
    reference_id: `IDB-${id}`.replace(/\s+/g, "-"),
    title: title.slice(0, 500),
    description: description || null,
    agency: "Inter-American Development Bank",
    country: cleanText(record.countryname) ?? "Latin America and the Caribbean",
    country_code: null,
    region: "Latin America and the Caribbean",
    sector: sectors[0] ?? null,
    deadline: parseDate(record.deadline),
    estimated_value: null,
    source_url: cleanText(record.documenturl) ?? cleanText(record.proyecturl),
    opportunity_type: mapOpportunityType(record),
    eligibility_summary: "Follow the notice instructions and executing-agency procurement documents.",
    experience_level: null,
    submission_language: "Spanish/English",
    source_tier: 1,
    source_name: "IDB",
    category: cleanText(record.category_nm),
  };
}

export async function crawlIDB(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const records = await withRetry(fetchRecords, 2);
    const tenders = records.map(mapRecord).filter((t): t is RawTender => t !== null);
    if (!tenders.length) {
      return {
        platform: "IDB",
        status: "failure",
        tenders: [],
        durationMs: Date.now() - start,
        error: "IDB datastore returned no active procurement notices",
      };
    }
    return { platform: "IDB", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "IDB",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
