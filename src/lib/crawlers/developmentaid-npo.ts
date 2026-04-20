/**
 * DevelopmentAid — NPO-funded slice only.
 *
 * Why this crawler exists: our primary-source crawlers (UNGM, World Bank,
 * UNDP, TED, etc.) collectively hit 90–100% coverage for the IGO/funder
 * tenders DA lists. The only slice they DON'T cover is NPO-funded notices —
 * individual NGOs (ACTED, DRC, Première Urgence, etc.) posting their own
 * procurement directly. Those surface only on DA and each NGO's private
 * portal. See `scripts/_developmentaid-diff.ts` output.
 *
 * Why CSV ingest instead of scraping: DA gates its listings behind JS + a
 * cookie/session wall. Reverse-engineering is fragile. The user is already
 * exporting via Thunderbit, so this crawler reads the newest CSV from
 * `data/developmentaid/` and filters to NPO Open MENA rows only. Drop a
 * new CSV in that folder and the next cron run picks it up.
 *
 * Scoping rules (intentional):
 *   - Funding Agency must contain "NPO" (case-insensitive, split on comma).
 *   - Status must be "Open".
 *   - Location must intersect MENA (drops sub-Saharan spill-over from DA's
 *     regional search).
 * Non-NPO rows are ignored here on purpose — our primary crawlers handle
 * those and adding them would re-introduce the aggregator-of-aggregator
 * problem.
 */
import fs from "node:fs";
import path from "node:path";
import { type CrawlResult, type RawTender } from "./types";

const DATA_DIR = path.resolve(process.cwd(), "data/developmentaid");
const SOURCE_NAME = "DevelopmentAid NPO";

const MENA = new Set([
  "algeria","bahrain","egypt","iran","iraq","israel","jordan","kuwait",
  "lebanon","libya","morocco","oman","palestine","state of palestine",
  "qatar","saudi arabia","sudan","syria","syrian arab republic",
  "tunisia","uae","united arab emirates","yemen","west bank","gaza",
]);

// ISO-style country code fallback when the Location cell lists the country.
const COUNTRY_CODE: Record<string, string> = {
  algeria:"DZA", bahrain:"BHR", egypt:"EGY", iran:"IRN", iraq:"IRQ",
  israel:"ISR", jordan:"JOR", kuwait:"KWT", lebanon:"LBN", libya:"LBY",
  morocco:"MAR", oman:"OMN", palestine:"PSE", "state of palestine":"PSE",
  qatar:"QAT", "saudi arabia":"SAU", sudan:"SDN", syria:"SYR",
  "syrian arab republic":"SYR", tunisia:"TUN", uae:"ARE",
  "united arab emirates":"ARE", yemen:"YEM",
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c === "\r") { /* skip */ }
      else cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.length > 0));
}

function splitFunders(raw: string): string[] {
  return raw.split(/[,/;]+/).map((s) => s.trim()).filter(Boolean);
}

function splitLocations(raw: string): string[] {
  return raw.split(/[,/;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

// DA exports deadlines as "MM/DD/YY". Returns ISO "YYYY-MM-DD" or null.
function parseDeadline(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yy}-${mm}-${dd}`;
}

// URL form: https://www.developmentaid.org/tenders/view/1638443/slug — we
// take the numeric id as the reference.
function extractId(url: string): string | null {
  const m = url.match(/\/tenders\/view\/(\d+)/);
  return m ? `DA-${m[1]}` : null;
}

function pickNewestCsv(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files.length ? path.join(dir, files[0].name) : null;
}

export async function crawlDevelopmentAidNPO(): Promise<CrawlResult> {
  const start = Date.now();

  const csvPath = pickNewestCsv(DATA_DIR);
  if (!csvPath) {
    // No CSV present — benign no-op. Keeps cron green until next drop.
    return { platform: SOURCE_NAME, status: "success", tenders: [], durationMs: Date.now() - start };
  }

  let grid: string[][];
  try {
    const raw = fs.readFileSync(csvPath, "utf-8");
    grid = parseCsv(raw);
  } catch (e) {
    return {
      platform: SOURCE_NAME, status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (grid.length < 2) {
    return { platform: SOURCE_NAME, status: "success", tenders: [], durationMs: Date.now() - start };
  }

  const header = grid[0].map((h) => h.trim());
  const ix = (name: string): number => header.findIndex((h) => h === name);
  const iTitle = ix("Tender Title");
  const iUrl = ix("Tender URL");
  const iFund = ix("Funding Agency");
  const iCat = ix("Category");
  const iStatus = ix("Status");
  const iLoc = ix("Location");
  const iDeadline = ix("Deadline");

  if (iTitle < 0 || iUrl < 0 || iFund < 0 || iStatus < 0) {
    return {
      platform: SOURCE_NAME, status: "failure", tenders: [],
      durationMs: Date.now() - start,
      error: `CSV missing required columns (got: ${header.join(",")})`,
    };
  }

  const seen = new Set<string>();
  const tenders: RawTender[] = [];

  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const url = (r[iUrl] ?? "").trim();
    const title = (r[iTitle] ?? "").trim();
    const status = (r[iStatus] ?? "").trim();
    if (!url || !title || !/open/i.test(status)) continue;

    const refId = extractId(url);
    if (!refId || seen.has(refId)) continue;

    const funders = splitFunders(r[iFund] ?? "");
    const isNpo = funders.some((f) => /^NPO$/i.test(f));
    if (!isNpo) continue;

    const locations = splitLocations(r[iLoc] ?? "");
    const menaHit = locations.find((l) => MENA.has(l));
    if (!menaHit) continue;

    seen.add(refId);

    const country =
      menaHit.replace(/\b\w/g, (c) => c.toUpperCase());
    const deadline = parseDeadline(r[iDeadline] ?? "");
    const category = (r[iCat] ?? "").trim() || null;

    tenders.push({
      reference_id: refId,
      title,
      description: null,
      // Funders is literally ["NPO"] — the actual NGO name isn't in the CSV.
      // Keep the agency as "NGO (via DevelopmentAid)" so matchers don't
      // mistake it for a UN body.
      agency: "NGO (via DevelopmentAid)",
      country,
      country_code: COUNTRY_CODE[menaHit] ?? null,
      region: "MENA",
      sector: category,
      deadline,
      estimated_value: null,
      source_url: url,
      opportunity_type: "tender",
      eligibility_summary: null,
      experience_level: "any",
      submission_language: "en",
      source_tier: 3,
      source_name: SOURCE_NAME,
      category,
    });
  }

  return {
    platform: SOURCE_NAME,
    status: "success",
    tenders,
    durationMs: Date.now() - start,
  };
}
