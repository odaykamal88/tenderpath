/**
 * EBRD — European Bank for Reconstruction and Development.
 * Procurement notices live on ECEPP (Electronic Contract Opportunities Portal):
 *   https://ecepp.ebrd.com/delta/noticeSearchResults.html
 * Public search results render to HTML; each notice link is:
 *   /delta/viewNotice.html?displayNoticeId=<id>
 *
 * Volume: ~1–2k open notices, focus on Central/Eastern Europe, Central Asia,
 * North Africa, Eastern Mediterranean — the EBRD's 38 countries of operations.
 *
 * Override `EBRD_NOTICES_URL` to point at a mirror if ECEPP is blocked.
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";
import { normalizeSector } from "./sector-map";

const BASE = process.env.EBRD_NOTICES_URL ?? "https://ecepp.ebrd.com/delta/noticeSearchResults.html";

async function fetchList(): Promise<string> {
  const res = await fetch(BASE, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "TenderPathBot/1.0 (+https://www.tenderpath.me)",
      Referer: "https://ecepp.ebrd.com/",
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`EBRD search results ${res.status}: ${body.slice(0, 200)}`);
  if (res.url.includes("/cas/login") || /<form[^>]+login|name="username"|cas\/login/i.test(body)) {
    throw new Error(
      `EBRD public notice search redirected to login (${res.url}) — public ECEPP search access changed`,
    );
  }
  return body;
}

interface ParsedNotice {
  id: string;
  title: string;
  country: string;
  noticeType: string;
  procurementTitle: string;
  published: string | null;
  deadline: string | null;
  status: string;
  description: string;
  sector: string | null;
  procurementCategory: string;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
  "&#039;": "'", "&#39;": "'", "&nbsp;": " ",
};

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ECEPP renders a public table. Visible cells contain title/type/dates/status;
// the final hidden cell contains searchable metadata such as project, country,
// client, department/sector, and procurement method.
function parseNotices(html: string): ParsedNotice[] {
  const out: ParsedNotice[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkRe = /href="[^"]*viewNotice\.html\?displayNoticeId=(\d+)"[^>]*>([\s\S]*?)<\/a>/i;
  const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const inner = m[1];
    const link = linkRe.exec(inner);
    if (!link) continue;
    const id = link[1];
    if (seen.has(id)) continue;

    const title = cleanText(link[2]);
    if (!title) continue;
    seen.add(id);

    const cells: string[] = [];
    cellRe.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(inner)) !== null) cells.push(cleanText(c[1]));

    const metadata = parseMetadata(cells[cells.length - 1] ?? "");
    const noticeType = cells[1] || metadata.noticeType || "";
    const procurementTitle = cells[2] || metadata.procurementTitle || title;
    const deadlineRaw = cells[4] || "";
    const publishedRaw = cells[3] || "";
    const status = cells[5] || "";
    const country = metadata.country || countryFromTitle(title) || "EBRD Region";
    const description = [
      "EBRD ECEPP procurement notice.",
      metadata.project ? `Project: ${metadata.project}.` : null,
      metadata.client ? `Client: ${metadata.client}.` : null,
      metadata.procurementCategory ? `Category: ${metadata.procurementCategory}.` : null,
      metadata.procurementMethod ? `Method: ${metadata.procurementMethod}.` : null,
      metadata.sector ? `Sector: ${metadata.sector}.` : null,
      status ? `Status: ${status}.` : null,
    ].filter(Boolean).join(" ");
    const sectors = normalizeSector(metadata.sector || metadata.procurementCategory, title, description);

    out.push({
      id,
      title,
      country,
      noticeType,
      procurementTitle,
      published: toISO(publishedRaw),
      deadline: toISO(deadlineRaw),
      status,
      description,
      sector: sectors[0] ?? null,
      procurementCategory: metadata.procurementCategory,
    });
  }
  return out;
}

function parseMetadata(raw: string): {
  project: string;
  projectId: string;
  country: string;
  procurementTitle: string;
  noticeId: string;
  procurementCategory: string;
  procurementMethod: string;
  client: string;
  sector: string;
  noticeType: string;
} {
  const stripped = raw.replace(/^\[/, "").replace(/\]$/, "");
  const parts = stripped.split(",").map((p) => p.trim()).filter(Boolean);
  const noticeType = parts.at(-1) ?? "";
  const sector = parts.at(-2) ?? "";
  const client = parts.at(-3) ?? "";
  const hasExerciseId = /^\d+$/.test(parts[4] ?? "");
  const procurementTitle = hasExerciseId ? (parts[3] ?? "") : "";
  const noticeId = hasExerciseId ? (parts[4] ?? "") : "";
  const procurementCategory = hasExerciseId
    ? (parts[5] ?? "")
    : parts.slice(3, Math.max(3, parts.length - 3)).join(", ");
  const procurementMethod = hasExerciseId
    ? parts.slice(6, Math.max(6, parts.length - 3)).join(", ")
    : "";
  return {
    project: parts[0] ?? "",
    projectId: parts[1] ?? "",
    country: parts[2] ?? "",
    procurementTitle,
    noticeId,
    procurementCategory,
    procurementMethod,
    client,
    sector,
    noticeType,
  };
}

function countryFromTitle(title: string): string | null {
  const m = /^([^:]{2,80}):/.exec(title);
  return m ? m[1].trim() : null;
}

// ECEPP deadlines are "31-Dec-2026" or "31/12/2026 14:00" — cover both.
function toISO(raw: string): string | null {
  if (!raw) return null;
  raw = raw.replace(/\bUK Time\b/i, "").trim();
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  let m = /(\d{1,2})[-/\s]([A-Za-z]{3})\w*[-/\s](\d{4})/.exec(raw);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function mapType(notice: string): string {
  const s = notice.toLowerCase();
  if (s.includes("expression of interest") || s.includes("eoi")) return "EOI";
  if (s.includes("invitation for tender") || s.includes("ift") || s.includes("itb")) return "ITB";
  if (s.includes("request for quotation") || s.includes("rfq")) return "RFQ";
  if (s.includes("consultant") || s.includes("consulting")) return "Consultancy";
  if (s.includes("prequalification") || s.includes("pre-qualif")) return "EOI";
  return "RFP";
}

function mapNotice(n: ParsedNotice): RawTender {
  return {
    reference_id: `EBRD-${n.id}`,
    title: n.title.slice(0, 500),
    description: n.description || null,
    agency: "European Bank for Reconstruction and Development",
    country: n.country || "EBRD Region",
    country_code: null,
    region: null,
    sector: n.sector,
    deadline: n.deadline,
    // ECEPP listing rows don't include contract value; it appears only on
    // individual notice detail pages (JSF SPA, requires a separate browser
    // render per notice). Not fetched here to avoid multiplying worker calls.
    estimated_value: null,
    source_url: `https://ecepp.ebrd.com/delta/viewNotice.html?displayNoticeId=${n.id}`,
    opportunity_type: mapType(n.noticeType),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "EBRD",
  };
}

export async function crawlEBRD(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const html = await withRetry(fetchList, 2);
    const tenders = parseNotices(html)
      .filter((notice) => !/^closed$/i.test(notice.status))
      .map(mapNotice);
    if (!tenders.length) {
      return {
        platform: "EBRD", status: "failure", tenders: [], durationMs: Date.now() - start,
        error: "EBRD public search results parsed but yielded 0 rows — ECEPP markup likely changed",
      };
    }
    return { platform: "EBRD", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "EBRD", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
