/**
 * UNRWA — UN Relief and Works Agency for Palestine Refugees.
 * Scrapes the public procurement listing at /procurement.
 * Volume is modest (~50–150 open notices) but high-relevance for
 * MENA-focused suppliers — this is the source that surfaces
 * Gaza/West Bank/Jordan/Lebanon/Syria opportunities that UNGM
 * often mirrors late.
 *
 * Override `UNRWA_PROCUREMENT_URL` to swap the base if the
 * layout gets moved under /business-with-us/procurement or similar.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const BASE = process.env.UNRWA_PROCUREMENT_URL ?? "https://www.unrwa.org/procurement";

async function fetchList(): Promise<string> {
  const resp = await fetchWithTimeout(BASE, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0 (compatible; TenderPath/1.0; +https://tenderpath.io)",
    },
  });
  if (!resp.ok) throw new Error(`UNRWA ${resp.status}`);
  return resp.text();
}

interface ParsedNotice {
  id: string;
  title: string;
  url: string;
  country: string;
  deadline: string | null;
  noticeType: string;
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

// UNRWA procurement lists each tender inside <article> or <div.views-row>
// with a link pattern /procurement/<slug> or /tenders/<slug>. We anchor on
// any link containing "/procurement/" or "/tenders/" that isn't the list page.
function parseNotices(html: string): ParsedNotice[] {
  const out: ParsedNotice[] = [];
  const seen = new Set<string>();

  const blockRe = /<(article|div|tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const linkRe = /href="([^"#]*\/(?:procurement|tenders)\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/i;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) {
    const inner = m[2];
    const link = linkRe.exec(inner);
    if (!link) continue;
    const rawHref = link[1];
    const title = cleanText(link[2]);
    // Skip the listing page itself, which matches the link pattern.
    if (!title || /^procurement$/i.test(title)) continue;
    const idMatch = /\/(?:procurement|tenders)\/([^/?#]+)/.exec(rawHref);
    if (!idMatch) continue;
    const id = idMatch[1];
    // "procurement" itself or pager anchors like page-1 get filtered.
    if (/^page[-_]?\d+$/i.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    const country = pickField(inner, /(?:Country|Duty Station)[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? pickField(inner, /(?:Country|Duty Station)\s*:\s*([^<|\n]+?)(?:\s*[|<])/i)
      ?? "";
    const deadlineRaw = pickField(inner, /(?:Closing|Deadline|Submission)[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? pickField(inner, /(?:Closing|Deadline|Submission)\s*:\s*([^<|\n]+?)(?:\s*[|<])/i)
      ?? "";
    const noticeType = pickField(inner, /(?:Type|Reference)[^<>]{0,20}<\/[^>]+>\s*<[^>]+>([^<]+)</i)
      ?? "";

    const url = rawHref.startsWith("http") ? rawHref : `https://www.unrwa.org${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;

    out.push({
      id,
      title,
      url,
      country: country || "Palestine",
      deadline: toISO(deadlineRaw),
      noticeType,
    });
  }
  return out;
}

function pickField(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  if (!m) return null;
  return cleanText(m[1]);
}

function toISO(raw: string): string | null {
  if (!raw) return null;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  let m = /(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/.exec(raw);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(raw);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

const UNRWA_COUNTRY_ISO: Record<string, string> = {
  "palestine": "PS", "west bank": "PS", "gaza": "PS", "gaza strip": "PS",
  "jordan": "JO", "lebanon": "LB", "syria": "SY", "syrian arab republic": "SY",
};

function isoFor(country: string): string | null {
  return UNRWA_COUNTRY_ISO[country.trim().toLowerCase()] ?? null;
}

function mapType(notice: string, title: string): string {
  const s = `${notice} ${title}`.toLowerCase();
  if (s.includes("expression of interest") || s.includes("eoi")) return "EOI";
  if (s.includes("invitation to bid") || s.includes("itb")) return "ITB";
  if (s.includes("request for quotation") || s.includes("rfq")) return "RFQ";
  if (s.includes("consultant") || s.includes("consulting")) return "Consultancy";
  if (s.includes("request for proposal") || s.includes("rfp")) return "RFP";
  return "RFP";
}

function mapNotice(n: ParsedNotice): RawTender {
  return {
    reference_id: `UNRWA-${n.id}`,
    title: n.title.slice(0, 500),
    description: null,
    agency: "UNRWA",
    country: n.country || "Palestine",
    country_code: isoFor(n.country || "Palestine"),
    region: "Middle East",
    sector: null,
    deadline: n.deadline,
    estimated_value: null,
    source_url: n.url,
    opportunity_type: mapType(n.noticeType, n.title),
    eligibility_summary: null,
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "UNRWA",
  };
}

export async function crawlUNRWA(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const html = await withRetry(() => fetchList());
    const rows = parseNotices(html);
    if (!rows.length) {
      return {
        platform: "UNRWA", status: "failure", tenders: [], durationMs: Date.now() - start,
        error: "UNRWA page parsed but yielded 0 rows — listing markup likely changed",
      };
    }
    const tenders = rows.map(mapNotice);
    return { platform: "UNRWA", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "UNRWA", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
