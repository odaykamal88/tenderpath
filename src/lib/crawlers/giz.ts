/**
 * GIZ — Deutsche Gesellschaft für Internationale Zusammenarbeit (German
 * development agency, ~€3B/yr procurement). Uses the public eVergabe
 * tender portal. No API — scraped from the results table. Cloudflare-
 * protected, so routed through the browser Worker.
 *
 * Portal: https://ausschreibungen.giz.de/Satellite/company/welcome.do
 * Sort: publication date desc so newest notices land on page 1.
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";
import { fetchViaBrowser, browserAvailable } from "./_browser";

const BASE = "https://ausschreibungen.giz.de/Satellite/company/welcome.do";
const SORT = "&method=showTable&fromSearch=1&tableSortPROJECT_RESULT=1&tableSortAttributePROJECT_RESULT=publicationDate";
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pageUrl(page: number): string {
  // page is 1-indexed on GIZ side.
  return `${BASE}?selectedTablePagePROJECT_RESULT=${page}${SORT}`;
}

async function fetchPage(page: number): Promise<string> {
  const resp = await fetchViaBrowser(pageUrl(page), {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
      Referer: BASE,
    },
    warmupUrl: BASE,
    waitMs: 5000,
  });
  if (!resp.ok) throw new Error(`GIZ page ${page} ${resp.status}: ${resp.body.slice(0, 200)}`);
  return resp.body;
}

interface ParsedRow {
  pid: string;
  published: string;
  deadline: string;
  titleRaw: string;
  type: string;
  agency: string;
}

// Grab every <tr>…</tr> that contains a projectForwarding.do?pid= link.
// Portal markup is stable but class names drift, so we anchor on the link
// pattern instead of table class — that's the one thing they can't move.
function parseRows(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  const pidRe = /projectForwarding\.do\?pid=(\d+)/i;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const inner = rowMatch[1];
    const pidMatch = pidRe.exec(inner);
    if (!pidMatch) continue;

    const cells: string[] = [];
    cellRe.lastIndex = 0;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(inner)) !== null) cells.push(cellMatch[1]);
    if (cells.length < 5) continue;

    rows.push({
      pid: pidMatch[1],
      published: cleanText(cells[0]),
      deadline: cleanText(cells[1]),
      titleRaw: cleanText(cells[2]),
      type: cleanText(cells[3]),
      agency: cleanText(cells[4]) || "Deutsche Gesellschaft für Internationale Zusammenarbeit (GIZ) GmbH",
    });
  }
  return rows;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
  "&nbsp;": " ", "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü",
  "&Auml;": "Ä", "&Ouml;": "Ö", "&Uuml;": "Ü", "&szlig;": "ß",
};

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-zA-Z]+;|&#39;/g, (m) => ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "16.04.2026" → "2026-04-16". Returns null if unparseable.
function toISO(dmy: string): string | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(dmy);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Split leading ref# prefix: "10018005 - Customization of…" → {ref, title}.
// Keep the full title if no dash-separated numeric prefix is found.
function splitRef(titleRaw: string): { ref: string | null; title: string } {
  const m = /^(\d{5,10})\s*[-–]\s*(.+)$/.exec(titleRaw);
  if (m) return { ref: m[1], title: m[2].trim() };
  return { ref: null, title: titleRaw };
}

function mapType(t: string): string {
  const s = t.toLowerCase();
  if (s.includes("teilnahme")) return "EOI";
  if (s.includes("vergabe") || s.includes("ausschreibung")) return "RFP";
  return "RFP";
}

function mapRow(r: ParsedRow): RawTender | null {
  if (!r.titleRaw) return null;
  const { ref, title } = splitRef(r.titleRaw);
  const deadline = toISO(r.deadline);
  return {
    reference_id: `GIZ-${ref ?? r.pid}`,
    title: title.slice(0, 500),
    description: null,
    agency: r.agency,
    country: "Germany",
    country_code: "DE",
    region: null,
    sector: null,
    deadline,
    estimated_value: null,
    source_url: `https://ausschreibungen.giz.de/Satellite/public/company/projectForwarding.do?pid=${r.pid}`,
    opportunity_type: mapType(r.type),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "German",
    source_tier: 1,
    source_name: "GIZ",
  };
}

export async function crawlGIZ(): Promise<CrawlResult> {
  const start = Date.now();
  if (!browserAvailable()) {
    return {
      platform: "GIZ",
      status: "failure",
      tenders: [],
      durationMs: 0,
      error: "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — GIZ sits behind Cloudflare",
    };
  }
  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (page > 1) await sleep(PAGE_DELAY_MS);
      const html = await withRetry(() => fetchPage(page));
      const rows = parseRows(html);
      if (!rows.length) break;
      let added = 0;
      for (const r of rows) {
        const t = mapRow(r);
        if (!t || seen.has(t.reference_id)) continue;
        seen.add(t.reference_id);
        tenders.push(t);
        added++;
      }
      // No new rows on this page → pagination has looped or we've hit the end.
      if (added === 0) break;
    }
    return { platform: "GIZ", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "GIZ",
      status: "failure",
      tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
