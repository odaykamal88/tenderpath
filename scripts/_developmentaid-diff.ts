/**
 * DevelopmentAid diff — ingest a Thunderbit CSV of MENA listings, dedupe,
 * filter to Open, split multi-funder cells, histogram by funder, flag which
 * funders we currently crawl, and for the ones we do crawl, fuzzy-match
 * titles against `tenders` to estimate coverage %.
 *
 * Output feeds the Sprint 2 backlog: "which primary-source crawler should
 * we build next?" ranked by missed notice count.
 *
 * Usage:  npx tsx scripts/_developmentaid-diff.ts <csv-path>
 */
import fs from "node:fs";
try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#"))
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
import { sql } from "../src/lib/db";

const CSV_PATH =
  process.argv[2] ??
  "/Users/odaykamal/Desktop/TENDERPATH/Thunderbit_f540c3_20260420_100332.csv";

// ─── Funders we already crawl (primary-source). Keep aliases loose — we
// normalize the CSV value to uppercase/trimmed before lookup. ────────────
const CRAWLED: Record<string, string> = {
  UNDP: "undp",
  UNICEF: "undp/ungm",
  WHO: "ungm",
  WFP: "ungm",
  UNOPS: "ungm",
  UNFPA: "ungm",
  "WORLD BANK": "world-bank",
  WB: "world-bank",
  "WORLD BANK GROUP": "world-bank",
  "SAM.GOV": "sam-gov",
  USAID: "sam-gov",
  "US GOVERNMENT": "sam-gov",
  "UK FTS": "uk-fts",
  FCDO: "uk-fts",
  UK: "uk-fts",
  EC: "ted-eu",
  "EUROPEAN COMMISSION": "ted-eu",
  EUROPEAID: "ted-eu",
  "EU DELEGATION": "ted-eu",
  GIZ: "giz",
  RELIEFWEB: "reliefweb",
  UN: "ungm",
  UNGM: "ungm",
};

// ─── Parse CSV (tolerant of commas inside quoted fields) ─────────────────
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

type Row = {
  title: string;
  url: string;
  funders: string[];
  category: string;
  posted: string;
  status: string;
  location: string;
  deadline: string;
};

function splitFunders(raw: string): string[] {
  return raw.split(/[,/;]+/).map((s) => s.trim()).filter(Boolean);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Token overlap similarity — cheap and good enough for "did we catch the
// same notice?" checks across slightly different titles.
function titleSim(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter((t) => t.length >= 4));
  const tb = new Set(norm(b).split(" ").filter((t) => t.length >= 4));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / Math.min(ta.size, tb.size);
}

(async () => {
  const raw = fs.readFileSync(CSV_PATH, "utf-8");
  const grid = parseCsv(raw);
  const header = grid[0];
  const ix = (name: string): number => header.findIndex((h) => h.trim() === name);
  const iTitle = ix("Tender Title");
  const iUrl = ix("Tender URL");
  const iFund = ix("Funding Agency");
  const iCat = ix("Category");
  const iPosted = ix("Posted Date");
  const iStatus = ix("Status");
  const iLoc = ix("Location");
  const iDeadline = ix("Deadline");

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const url = (r[iUrl] ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    rows.push({
      title: (r[iTitle] ?? "").trim(),
      url,
      funders: splitFunders(r[iFund] ?? ""),
      category: (r[iCat] ?? "").trim(),
      posted: (r[iPosted] ?? "").trim(),
      status: (r[iStatus] ?? "").trim(),
      location: (r[iLoc] ?? "").trim(),
      deadline: (r[iDeadline] ?? "").trim(),
    });
  }

  const open = rows.filter((r) => /open/i.test(r.status));

  console.log(`\n=== CSV: ${CSV_PATH} ===`);
  console.log(`raw rows: ${grid.length - 1}`);
  console.log(`unique by URL: ${rows.length}`);
  console.log(`status='Open': ${open.length}`);

  // ─── Status histogram (so we see what we dropped) ──────────────────────
  const statusHist = new Map<string, number>();
  for (const r of rows) statusHist.set(r.status, (statusHist.get(r.status) ?? 0) + 1);
  console.log(`\n=== Status breakdown ===`);
  console.table([...statusHist.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ status: k, n })));

  // ─── Funder histogram (Open only, split multi-funder cells) ────────────
  const funderHist = new Map<string, { n: number; examples: string[] }>();
  for (const r of open) {
    for (const f of r.funders) {
      const key = f.toUpperCase();
      const cur = funderHist.get(key) ?? { n: 0, examples: [] };
      cur.n++;
      if (cur.examples.length < 2) cur.examples.push(r.title.slice(0, 70));
      funderHist.set(key, cur);
    }
  }

  const funderRanked = [...funderHist.entries()]
    .map(([funder, v]) => ({
      funder,
      n: v.n,
      crawled: CRAWLED[funder] ?? "",
      example: v.examples[0] ?? "",
    }))
    .sort((a, b) => b.n - a.n);

  console.log(`\n=== Funders ranked by Open notice count (MENA, past week) ===`);
  console.table(funderRanked);

  // ─── Coverage check for funders we claim to crawl ──────────────────────
  // Fuzzy-match each DevelopmentAid title against our `tenders` table and
  // record whether we have it. Reports the coverage gap per funder.
  console.log(`\n=== Coverage check vs our tenders table ===`);
  const ourRows = (await sql`
    SELECT title, country FROM tenders
    WHERE status = 'open' AND deadline >= CURRENT_DATE - INTERVAL '14 days'`) as Array<{ title: string; country: string }>;
  console.log(`(comparing ${open.length} DA rows against ${ourRows.length} open notices in our DB)`);

  const coverage: Array<{
    funder: string;
    da_count: number;
    matched: number;
    coverage_pct: number;
    missed_examples: string;
  }> = [];

  for (const { funder, n, crawled } of funderRanked) {
    if (!crawled) continue;
    const daRows = open.filter((r) => r.funders.some((f) => f.toUpperCase() === funder));
    let matched = 0;
    const missed: string[] = [];
    for (const da of daRows) {
      const hit = ourRows.some((o) => titleSim(o.title, da.title) >= 0.5);
      if (hit) matched++;
      else if (missed.length < 2) missed.push(da.title.slice(0, 60));
    }
    coverage.push({
      funder,
      da_count: n,
      matched,
      coverage_pct: n ? Math.round((matched / n) * 100) : 0,
      missed_examples: missed.join(" | "),
    });
  }
  console.table(coverage);

  // ─── Sprint 2 backlog: funders we DON'T crawl, ranked by count ─────────
  console.log(`\n=== Sprint 2 backlog — uncrawled funders (by MENA Open count) ===`);
  const backlog = funderRanked
    .filter((f) => !f.crawled)
    .map(({ funder, n, example }) => ({ funder, missed_open_notices: n, example }));
  console.table(backlog);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
