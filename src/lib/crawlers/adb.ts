/**
 * ADB — Asian Development Bank.
 * Scrapes the public procurement notices list at /projects/tenders.
 * Page is server-rendered HTML; each row anchors on a link of the form
 *   /projects/tenders/<slug>-<id>
 * which is what we pin the parser to (class names drift, link pattern doesn't).
 *
 * Volume: ~3–5k open notices, mostly Asia-Pacific. Good complement to
 * World Bank (which skips ADB-only borrowers).
 *
 * Override `ADB_TENDERS_URL` to point at a mirror if the main host is blocked.
 */
import { type RawTender, type CrawlResult, withRetry } from "./types";
import { fetchViaBrowser, browserAvailable } from "./_browser";
import { normalizeSector } from "./sector-map";

const BASE = process.env.ADB_TENDERS_URL ?? "https://www.adb.org/projects/tenders";
const CMS_URL = "https://selfservice.adb.org/OA_HTML/OA.jsp?OAFunc=XXCRS_CSRN_HOME_PAGE";
const MAX_PAGES = 3;
const PAGE_DELAY_MS = 1500;
const BROWSER_TIMEOUT_MS = 60000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ADB sits behind Cloudflare bot protection and returns 403 to plain fetch
// (even with a realistic UA). Route through the browser worker like UNGM/GIZ.
async function fetchPage(page: number): Promise<string> {
  const url = page === 0 ? BASE : `${BASE}?page=${page}`;
  const resp = await fetchViaBrowser(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: BASE,
    },
    warmupUrl: BASE,
    // ADB sits behind CF. DOM-fetch mode returned the 403 challenge page even
    // after warmup because the target-URL request itself needs the full JS
    // challenge to run in-context. Navigate mode goes through page.goto(),
    // so CF's JS challenge executes on the target URL and cf_clearance is
    // issued before we capture HTML. Anchor on the tenders table selector.
    mode: "navigate",
    waitForSelector: "a[href*='/projects/tenders/']",
    waitAfterNav: 500,
    waitMs: 2000,
    timeoutMs: BROWSER_TIMEOUT_MS,
  });
  if (!resp.ok) throw new Error(`ADB page ${page} ${resp.status}: ${resp.body.slice(0, 200)}`);
  if (/Just a moment|cf-challenge|Attention Required|Access denied|Cloudflare/i.test(resp.body)) {
    throw new Error(`ADB page ${page} returned challenge HTML; browser worker did not clear Cloudflare`);
  }
  return resp.body;
}

interface ParsedRow {
  id: string;
  slug: string;
  title: string;
  country: string;
  noticeType: string;
  sector: string | null;
  deadline: string | null;
}

interface ParsedCmsRow {
  id: string;
  title: string;
  projectUrl: string;
  expertise: string;
  consultantType: string;
  duration: string;
  published: string;
  deadline: string | null;
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

// ADB renders each notice as a <tr> or <div.views-row>; both wrap a link
// to /projects/tenders/<slug>-<id>. We anchor on the link then harvest
// whichever <td>/<div> children follow it.
function parseRows(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkRe = /href="(\/projects\/tenders\/[^"#?]+?-(\d{5,8}))"[^>]*>([\s\S]*?)<\/a>/i;
  const cellRe = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const inner = m[1];
    const link = linkRe.exec(inner);
    if (!link) continue;
    const slug = link[1];
    const id = link[2];
    if (seen.has(id)) continue;
    seen.add(id);

    const cells: string[] = [];
    cellRe.lastIndex = 0;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(inner)) !== null) cells.push(cleanText(c[1]));

    // Table columns (as of 2025): Title | Country | Notice Type | Deadline | ...
    const title = cleanText(link[3]) || cells[0] || "";
    const country = cells[1] || "Asia-Pacific";
    const noticeType = cells[2] || "";
    const deadlineRaw = cells[3] || "";
    const deadline = toISO(deadlineRaw);

    if (!title) continue;
    rows.push({ id, slug, title, country, noticeType, sector: null, deadline });
  }

  if (!rows.length) {
    const cardLinkRe = /href="(?:https:\/\/www\.adb\.org)?(\/node\/(\d+))"[^>]*>([\s\S]{10,900}?)<\/a>/gi;
    let link: RegExpExecArray | null;
    while ((link = cardLinkRe.exec(html)) !== null) {
      const slug = link[1];
      const id = link[2];
      if (seen.has(id)) continue;
      const title = cleanText(link[3]);
      if (!title || !/^\d{4,6}-\d{3}:|Loan|Grant|Consulting|Procurement|Project/i.test(title)) continue;

      const nearby = cleanText(html.slice(Math.max(0, link.index - 900), link.index + link[0].length + 1600));
      const deadlineRaw = pickText(nearby, /Deadline:\s*([^:]+?)(?:Country\/Economy:|Sector:|Posting Date:|Notice Type:|Status:|$)/i);
      const country = pickText(nearby, /Country\/Economy:\s*([^:]+?)(?:Sector:|Posting Date:|Notice Type:|Approval Number:|Status:|Deadline:|$)/i)
        ?? "Asia-Pacific";
      const sector = pickText(nearby, /Sector:\s*([^:]+?)(?:Posting Date:|Notice Type:|Approval Number:|Status:|Deadline:|Country\/Economy:|$)/i);
      const noticeType = pickText(nearby, /Notice Type:\s*([^:]+?)(?:Approval Number:|Status:|Deadline:|Country\/Economy:|Sector:|Posting Date:|$)/i)
        ?? "";

      seen.add(id);
      rows.push({
        id,
        slug,
        title,
        country: country === "Regional" ? "Asia-Pacific" : country,
        noticeType,
        sector,
        deadline: toISO(deadlineRaw ?? ""),
      });
    }
  }
  return rows;
}

function pickText(text: string | null, re: RegExp): string | null {
  if (!text) return null;
  const match = re.exec(text);
  return match ? cleanText(match[1]) : null;
}

async function fetchCms(): Promise<string> {
  const res = await fetch(CMS_URL, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "TenderPathBot/1.0 (+https://www.tenderpath.me)",
      Referer: "https://selfservice.adb.org/OA_HTML/adb/adbpos/jsp/ADBCMSHomepage.jsp",
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`ADB CMS ${res.status}: ${body.slice(0, 200)}`);
  if (!/Consulting Services Recruitment Notices|id="atResults:Content"/i.test(body)) {
    throw new Error("ADB CMS consulting opportunities page loaded but did not include CSRN results");
  }
  return body;
}

function parseCmsRows(html: string): ParsedCmsRow[] {
  const rows: ParsedCmsRow[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const projectRe = /<a[^>]+id="atResults:mstProject:(\d+)"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const inner = m[1];
    const project = projectRe.exec(inner);
    if (!project) continue;
    const rowId = project[1];
    const projectUrl = project[2].replace(/&amp;/g, "&");
    const title = cleanText(project[3]);
    const projectNumber = /\/projects\/([^/]+)\/main/.exec(projectUrl)?.[1] ?? rowId;
    const deadline = pickSpan(inner, new RegExp(`id="atResults:mstDeadline:${rowId}"[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
    const expertise = pickSpan(inner, new RegExp(`id="atResults:mstExpertise2:${rowId}"[^>]*>([\\s\\S]*?)<\\/span>`, "i")) ?? "";
    const consultantType = pickSpan(inner, new RegExp(`id="atResults:mcConsType:${rowId}"[\\s\\S]*?<span[^>]*>([\\s\\S]*?)<\\/span>`, "i")) ?? "";
    const duration = pickSpan(inner, new RegExp(`id="atResults:mstDuration1:${rowId}"[^>]*>([\\s\\S]*?)<\\/span>`, "i")) ?? "";
    const published = pickSpan(inner, new RegExp(`id="atResults:mstPublished:${rowId}"[^>]*>([\\s\\S]*?)<\\/span>`, "i")) ?? "";
    const id = `${projectNumber}-${rowId}`;
    if (!title || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      title,
      projectUrl,
      expertise,
      consultantType,
      duration,
      published,
      deadline: toISO(deadline ?? ""),
    });
  }
  return rows;
}

function pickSpan(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? cleanText(m[1]) : null;
}

// ADB uses "31 Dec 2026" or "2026-12-31" depending on locale. Handle both.
function toISO(raw: string): string | null {
  if (!raw) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  m = /(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/.exec(raw);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  m = /(\d{1,2})-([A-Za-z]{3})\w*-(\d{4})/.exec(raw);
  if (m) {
    const mm = MONTHS[m[2].toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function mapCmsRow(r: ParsedCmsRow): RawTender {
  const countryCodeRaw = /(?:TA|LOAN|GRANT)[-\s]*\d+(?:-\d+)?\s+([A-Z]{3})\b/i.exec(r.title)?.[1]?.toUpperCase() ?? null;
  const countryCode = countryCodeRaw === "REG" ? null : countryCodeRaw;
  const description = [
    "ADB Consultant Management System consulting opportunity.",
    r.expertise ? `Expertise: ${r.expertise}.` : null,
    r.consultantType ? `Consultant type: ${r.consultantType}.` : null,
    r.duration ? `Engagement period: ${r.duration} months.` : null,
    r.published ? `Published: ${r.published}.` : null,
  ].filter(Boolean).join(" ");
  const sectors = normalizeSector(r.expertise, r.title, description);

  return {
    reference_id: `ADB-CMS-${r.id}`,
    title: r.title.slice(0, 500),
    description,
    agency: "Asian Development Bank",
    country: countryCode ?? "Asia-Pacific",
    country_code: countryCode,
    region: "Asia-Pacific",
    sector: sectors[0] ?? null,
    deadline: r.deadline,
    estimated_value: null,
    source_url: r.projectUrl,
    opportunity_type: "Consultancy",
    eligibility_summary: "Consulting opportunity from ADB CMS. Review the linked project and CSRN details in ADB CMS.",
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "ADB",
  };
}

function mapType(notice: string): string {
  const s = notice.toLowerCase();
  if (s.includes("expression of interest") || s.includes("eoi")) return "EOI";
  if (s.includes("invitation for bid") || s.includes("ifb") || s.includes("itb")) return "ITB";
  if (s.includes("request for quotation") || s.includes("rfq")) return "RFQ";
  if (s.includes("consultant") || s.includes("csrn")) return "Consultancy";
  if (s.includes("request for proposal") || s.includes("rfp")) return "RFP";
  return "RFP";
}

function mapRow(r: ParsedRow): RawTender {
  const description = [
    "Asian Development Bank procurement notice.",
    r.noticeType ? `Notice type: ${r.noticeType}.` : null,
    r.country ? `Geography: ${r.country}.` : null,
    r.sector ? `Sector: ${r.sector}.` : null,
  ].filter(Boolean).join(" ");
  const sectors = normalizeSector(r.sector, r.title, description);

  return {
    reference_id: `ADB-${r.id}`,
    title: r.title.slice(0, 500),
    description,
    agency: "Asian Development Bank",
    country: r.country || "Asia-Pacific",
    country_code: null,
    region: "Asia-Pacific",
    sector: sectors[0] ?? null,
    deadline: r.deadline,
    estimated_value: null,
    source_url: `https://www.adb.org${r.slug.startsWith("/") ? "" : "/"}${r.slug}`,
    opportunity_type: mapType(r.noticeType),
    eligibility_summary: "Follow the ADB notice and borrower procurement instructions.",
    experience_level: null,
    submission_language: "English",
    source_tier: 1,
    source_name: "ADB",
  };
}

export async function crawlADB(): Promise<CrawlResult> {
  const start = Date.now();
  const errors: string[] = [];
  if (!browserAvailable()) {
    errors.push("CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set — ADB projects/tenders sits behind Cloudflare");
  }
  try {
    const tenders: RawTender[] = [];
    const seen = new Set<string>();
    if (browserAvailable()) {
      for (let page = 0; page < MAX_PAGES; page++) {
        if (page > 0) await sleep(PAGE_DELAY_MS);
        const html = await withRetry(() => fetchPage(page), 1);
        const rows = parseRows(html);
        if (!rows.length) break;
        let added = 0;
        for (const r of rows) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          tenders.push(mapRow(r));
          added++;
        }
        if (added === 0) break;
      }
    }
    if (!tenders.length) {
      throw new Error("ADB projects/tenders yielded 0 rows — primary page blocked or markup changed");
    }
    return { platform: "ADB", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    try {
      const html = await withRetry(fetchCms, 2);
      const tenders = parseCmsRows(html).map(mapCmsRow);
      if (!tenders.length) {
        throw new Error("ADB CMS fallback parsed but yielded 0 CSRN rows");
      }
      return { platform: "ADB", status: "success", tenders, durationMs: Date.now() - start };
    } catch (cmsErr) {
      errors.push(cmsErr instanceof Error ? cmsErr.message : String(cmsErr));
    }
    return {
      platform: "ADB", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: errors.join(" | "),
    };
  }
}
