/**
 * JICA — Japan International Cooperation Agency.
 *
 * Primary public listings are Japanese-only. Contract pages link directly to
 * JICA-hosted PDF notice documents, so this crawler preserves the PDF notice
 * URL as the source and degrades safely where deadlines are not exposed in
 * machine-readable HTML.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";
import { normalizeSector } from "./sector-map";

const LISTING_BASE = "https://www2.jica.go.jp/ja/announce/index.php";
const CONTRACT_TYPES = [
  { id: "1", label: "Consulting services contract" },
  { id: "4", label: "Individual consulting services contract" },
  { id: "5", label: "Field-based consulting services contract" },
] as const;
const MAX_PAGES_PER_CONTRACT = 1;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0)",
  Accept: "text/html",
};

function parseJicaDate(raw: string): string | null {
  const jp = raw.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (jp) return `${jp[1]}-${jp[2].padStart(2, "0")}-${jp[3].padStart(2, "0")}`;
  const slash = raw.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  return null;
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(raw: string): string {
  return raw.startsWith("http") ? raw : new URL(raw, LISTING_BASE).toString();
}

function parseRows(html: string, contractLabel: string): RawTender[] {
  const rows = [...html.matchAll(/<tr>\s*([\s\S]*?)\s*<\/tr>/gi)];
  const tenders: RawTender[] = [];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*class="p-search-result-table__td"[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((m) => m[1]);
    if (cells.length < 5) continue;

    const published = parseJicaDate(cleanHtml(cells[0]));
    const country = cleanHtml(cells[1]) || "Global";
    const title = cleanHtml(cells[2]);
    const remarks = cleanHtml(cells[3]);
    const noticeLink = cells[4].match(/href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const sourceUrl = noticeLink ? absoluteUrl(noticeLink[1] ?? noticeLink[2] ?? noticeLink[3]) : null;
    if (!title || !sourceUrl) continue;

    const id = sourceUrl.match(/\/pdf\/([^/?#]+)\.pdf/i)?.[1] ?? `${contractLabel}-${title}`.replace(/\W+/g, "-").slice(0, 80);
    const description = [
      `JICA ${contractLabel}.`,
      published ? `Published ${published}.` : null,
      country ? `Geography: ${country}.` : null,
      remarks && remarks !== "-" ? `Notes: ${remarks}` : null,
    ].filter(Boolean).join(" ");
    const sectors = normalizeSector(null, title, description);

    tenders.push({
      reference_id: `JICA-${id}`,
      title,
      description,
      agency: "JICA",
      country,
      country_code: null,
      region: null,
      sector: sectors[0] ?? null,
      deadline: null,
      estimated_value: null,
      source_url: sourceUrl,
      opportunity_type: contractLabel,
      eligibility_summary: "Supplier registration may be required through JICA/PARTNER depending on contract type.",
      experience_level: null,
      submission_language: "Japanese",
      source_tier: 1,
      source_name: "JICA",
    });
  }

  return tenders;
}

async function fetchListing(contract: string, page: number): Promise<string> {
  const params = new URLSearchParams({ contract });
  if (page > 1) params.set("p", String(page));
  const resp = await fetchWithTimeout(`${LISTING_BASE}?${params}`, { headers: HEADERS }, 25000);
  if (!resp.ok) throw new Error(`JICA listing contract=${contract} page=${page} HTTP ${resp.status}`);
  return resp.text();
}

export async function crawlJICA(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();

    for (const contract of CONTRACT_TYPES) {
      for (let page = 1; page <= MAX_PAGES_PER_CONTRACT; page++) {
        let html: string;
        try {
          html = await withRetry(() => fetchListing(contract.id, page), 2);
        } catch (err) {
          console.error(`[jica] listing contract=${contract.id} page=${page} failed:`, err instanceof Error ? err.message : err);
          break;
        }
        const parsed = parseRows(html, contract.label);
        for (const tender of parsed) {
          if (seen.has(tender.reference_id)) continue;
          seen.add(tender.reference_id);
          tenders.push(tender);
        }
        if (parsed.length === 0) break;
      }
    }

    if (tenders.length === 0) {
      return {
        platform: "JICA", status: "failure", tenders: [],
        durationMs: Date.now() - start,
        error: "JICA listings returned no PDF notice rows",
      };
    }

    return { platform: "JICA", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "JICA", status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
