/**
 * IOM — International Organization for Migration procurement opportunities.
 * The public Drupal listing is server-rendered and includes current bid rows
 * with reference, title, attachments, category, country, publication date, and
 * closing date.
 */
import { normalizeSector, type SectorSlug } from "./sector-map";
import { type CrawlResult, type RawTender, fetchWithTimeout, withRetry } from "./types";

const BASE_URL = "https://www.iom.int";
const LISTING_URL = `${BASE_URL}/procurement-opportunities`;
const MAX_PAGES = 5;

interface IomRow {
  reference: string;
  title: string;
  path: string;
  description: string | null;
  category: string | null;
  country: string | null;
  published: string | null;
  deadline: string | null;
  attachments: string[];
}

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

function cleanText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : new URL(path, BASE_URL).toString();
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function field(block: string, label: string): string | null {
  const re = new RegExp(`<span[^>]+data-preamble="${label}"[^>]*>([\\s\\S]*?)<\\/span>`, "i");
  return cleanText(block.match(re)?.[1]);
}

function parseRows(html: string): IomRow[] {
  const blocks = [...html.matchAll(/<ul class="table-row">([\s\S]*?)<\/ul>\s*<\/div>/gi)].map((m) => m[1]);
  const rows: IomRow[] = [];

  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    const reference = cleanText(block.match(/<h3[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const title = cleanText(link?.[2]);
    const path = link?.[1];
    if (!reference || !title || !path) continue;

    const attachmentNames = [...block.matchAll(/<div class="data"[^>]+data-preamble="Attachment"[\s\S]*?<a[^>]+href="[^"]+"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => cleanText(m[1]))
      .filter((name): name is string => !!name)
      .slice(0, 6);
    const descriptionBlock = block.match(/<strong>\s*Brief Project Description:\s*<\/strong>([\s\S]*?)(?=<\/div>\s*<\/li>\s*<li data-label="Details")/i)?.[1];
    const description = cleanText(descriptionBlock);

    rows.push({
      reference,
      title,
      path,
      description,
      category: field(block, "Category"),
      country: field(block, "Country"),
      published: parseDate(field(block, "Publication Date")),
      deadline: parseDate(field(block, "Closing Date")),
      attachments: attachmentNames,
    });
  }

  return rows;
}

function mapType(row: IomRow): string {
  const raw = `${row.reference} ${row.title} ${row.attachments.join(" ")}`.toLowerCase();
  if (raw.includes("rfp") || raw.includes("request for proposal")) return "RFP";
  if (raw.includes("rfq") || raw.includes("request for quotation")) return "RFQ";
  if (raw.includes("itb") || raw.includes("invitation to bid")) return "ITB";
  if (raw.includes("eoi") || raw.includes("expression of interest")) return "EOI";
  return row.category ?? "Procurement Notice";
}

function sourceSector(row: IomRow, description: string): SectorSlug | null {
  const text = `${row.title} ${description}`.toLowerCase();
  if (/water|sanitation|wash\b|hygiene/.test(text)) return "water_sanitation";
  if (/laptop|desktop|computer|server|software|ict|information technolog|it equipment/.test(text)) return "it";
  if (/agricultur|agricol|elevage|livestock|farm/.test(text)) return "agriculture";
  if (/vehicle|vehicule|transport|logistic|delivery/.test(text)) return "logistics";
  if (/audit|evaluation|assessment|proposal|consult/.test(text)) return "consulting";
  return null;
}

function mapRow(row: IomRow): RawTender {
  const description = [
    row.description,
    row.published ? `Published ${row.published}.` : null,
    row.category ? `Category: ${row.category}.` : null,
    row.country ? `Geography: ${row.country}.` : null,
    row.attachments.length ? `Attachments: ${row.attachments.join("; ")}.` : null,
  ].filter(Boolean).join(" ");
  const sourceHint = sourceSector(row, description);
  const sectors = normalizeSector(row.category, row.title, description);

  return {
    reference_id: `IOM-${row.reference}`.replace(/\s+/g, "-"),
    title: row.title.slice(0, 500),
    description: description || null,
    agency: "International Organization for Migration",
    country: row.country ?? "Global",
    country_code: null,
    region: null,
    sector: sourceHint ?? sectors[0] ?? null,
    deadline: row.deadline,
    estimated_value: null,
    source_url: absoluteUrl(row.path),
    opportunity_type: mapType(row),
    eligibility_summary: "Follow the IOM notice instructions and supplier registration requirements.",
    experience_level: null,
    submission_language: "English/French",
    source_tier: 1,
    source_name: "IOM",
    category: row.category,
  };
}

async function fetchPage(page: number): Promise<string> {
  const url = page === 0 ? LISTING_URL : `${LISTING_URL}?page=${page}`;
  const resp = await fetchWithTimeout(url, { headers: HEADERS }, 25000);
  if (!resp.ok) throw new Error(`IOM procurement page ${page} HTTP ${resp.status}`);
  return resp.text();
}

export async function crawlIOM(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows: IomRow[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const html = await withRetry(() => fetchPage(page), 2);
      const parsed = parseRows(html);
      if (!parsed.length) break;
      for (const row of parsed) {
        if (seen.has(row.reference)) continue;
        seen.add(row.reference);
        rows.push(row);
      }
    }

    const tenders = rows
      .filter((row) => !row.deadline || row.deadline >= today)
      .map(mapRow);

    if (!tenders.length) {
      return {
        platform: "IOM",
        status: "failure",
        tenders: [],
        durationMs: Date.now() - start,
        error: "IOM procurement listing yielded 0 current tenders",
      };
    }

    return { platform: "IOM", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "IOM",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
