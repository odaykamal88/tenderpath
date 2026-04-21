/**
 * UNDP — standalone procurement notices portal.
 * UN agencies post to UNGM by mandate, but UNDP also runs its own portal
 * with a few unique notices (esp. country-office direct procurement).
 * Static HTML scrape; no API.
 */
import { type RawTender, type CrawlResult, withRetry, fetchWithTimeout } from "./types";

const UNDP_URL = "https://procurement-notices.undp.org/";

interface RowFields { [k: string]: string }

function extractCells(block: string): RowFields {
  const out: RowFields = {};
  const cellRe = /<div class="vacanciesTable__cell__label">\s*([^<]+?)\s*<\/div>\s*<span>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(block)) !== null) {
    const label = m[1].replace(/\s+/g, " ").trim();
    const value = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out[label] = value;
  }
  return out;
}

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseDate(raw: string): string | null {
  // Format: "21-Apr-26" or "21-Apr-26 01:00 PM (New York time)"
  const m = raw.match(/(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const mo = MONTHS[m[2]];
  if (!mo) return null;
  const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yr}-${mo}-${day}`;
}

function mapProcess(p?: string): string {
  const t = (p ?? "").toLowerCase();
  if (t.includes("rfq") || t.includes("quotation")) return "RFQ";
  if (t.includes("eoi") || t.includes("expression")) return "EOI";
  if (t.includes("itb") || t.includes("invitation to bid")) return "ITB";
  if (t.includes("rfp") || t.includes("proposal")) return "RFP";
  if (t.includes("ican") || t.includes("ica")) return "Consultancy";
  return "RFP";
}

function parseHTML(html: string): RawTender[] {
  const tenders: RawTender[] = [];
  // UNDP listing uses two link patterns — older notices go through
  //   view_notice.cfm?notice_id=N
  // while newer country-office RFPs (the majority, ~97%) go through
  //   view_negotiation.cfm?nego_id=N
  // We accept either; the numeric id stays unique across both spaces so we
  // keep using it as the reference-id fallback.
  const rowRe = /<a\s+href="((?:view_notice\.cfm\?notice_id|view_negotiation\.cfm\?nego_id)=(\d+))"[^>]*class="[^"]*vacanciesTableLink[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const href = m[1];
    const id = m[2];
    const block = m[3];
    const cells = extractCells(block);
    const title = cells["Title"];
    if (!title) continue;
    const office = cells["UNDP Office/Country"] ?? "";
    // Country lives after the slash, fully-uppercased
    const countryRaw = office.split("/").pop()?.trim() ?? "";
    const country = countryRaw
      ? countryRaw.charAt(0) + countryRaw.slice(1).toLowerCase()
      : "Global";

    tenders.push({
      reference_id: `UNDP-${cells["Ref No"] ?? id}`,
      title: title.slice(0, 500),
      description: null,
      agency: office.split("/")[0]?.trim() || "UNDP",
      country,
      country_code: null,
      region: null,
      sector: null,
      deadline: parseDate(cells["Deadline"] ?? ""),
      estimated_value: null,
      source_url: `https://procurement-notices.undp.org/${href}`,
      opportunity_type: mapProcess(cells["Process"]),
      eligibility_summary: null,
      experience_level: null,
      submission_language: "English",
      source_tier: 1,
      source_name: "UNDP",
    });
  }
  return tenders;
}

export async function crawlUNDP(): Promise<CrawlResult> {
  const start = Date.now();
  try {
    const html = await withRetry(async () => {
      const resp = await fetchWithTimeout(UNDP_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!resp.ok) throw new Error(`UNDP ${resp.status}`);
      return resp.text();
    });
    const tenders = parseHTML(html);
    return { platform: "UNDP", status: "success", tenders, durationMs: Date.now() - start };
  } catch (err) {
    return {
      platform: "UNDP", status: "failure", tenders: [], durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
