/**
 * DevelopmentAid — MENA Open tenders ingest (CSV-driven).
 *
 * Originally scoped to NPO-funded rows only (primary crawlers were assumed to
 * cover all IGO/UN-funder rows). That assumption broke for country-specific
 * Syria supply: UNGM lists the global/regional-HQ Syria tenders but not the
 * country-office postings for FAO / ILO / UNHCR / UNRWA / UNDP / UN-Habitat /
 * WHO etc. that DA surfaces. Cross-check with the user's Thunderbit exports
 * confirmed the gap. We now accept ALL known-funder rows in the CSV, not
 * just NPO, and canonicalize the agency name per funder so matchers see
 * "UNHCR" rather than the raw DA label.
 *
 * Dedup safety: sync.ts upserts ON CONFLICT (reference_id); DA rows use
 * `DA-<id>` refs which can't collide with UNGM/WB/UNDP/TED. Worst case we
 * double-list the same tender under two source names — still deduped by
 * title + deadline in the matcher pool via LIMIT.
 *
 * Why CSV ingest instead of scraping: DA gates its listings behind JS + a
 * cookie/session wall. Reverse-engineering is fragile. The user exports via
 * Thunderbit; this crawler reads the newest CSV from `data/developmentaid/`.
 *
 * Scoping rules:
 *   - Status must be "Open".
 *   - Location must intersect MENA (drops sub-Saharan spill-over from DA's
 *     regional search).
 *   - Funding Agency must match one of the known funders (NPO or any UN
 *     family agency — see FUNDER_AGENCY below). Rows with unknown/blank
 *     funders are skipped to keep noise down.
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

// DA labels funders with short codes or full names. Map to canonical agency
// strings that our matcher / sector map already know. Order matters for the
// first-match-wins resolver below: put the most specific tokens first.
const FUNDER_AGENCY: { re: RegExp; agency: string }[] = [
  { re: /\bUNHCR\b/i, agency: "UN Refugee Agency (UNHCR)" },
  { re: /\bUNRWA\b/i, agency: "UN Relief and Works Agency (UNRWA)" },
  { re: /\bUNICEF\b/i, agency: "UN Children's Fund (UNICEF)" },
  { re: /\bUNOPS\b/i, agency: "UN Office for Project Services (UNOPS)" },
  { re: /\bUNDP\b/i, agency: "UN Development Programme (UNDP)" },
  { re: /\bUN[- ]?Habitat\b|\bUNHABITAT\b/i, agency: "UN-Habitat" },
  { re: /\bUNFPA\b/i, agency: "UN Population Fund (UNFPA)" },
  { re: /\bUN ?Women\b/i, agency: "UN Women" },
  { re: /\bUNESCO\b/i, agency: "UNESCO" },
  { re: /\bUNIDO\b/i, agency: "UN Industrial Development Organization (UNIDO)" },
  { re: /\bUNEP\b/i, agency: "UN Environment Programme (UNEP)" },
  { re: /\bUNODC\b/i, agency: "UN Office on Drugs and Crime (UNODC)" },
  { re: /\bUN ?V\b|\bUNV\b/i, agency: "UN Volunteers" },
  { re: /\bOCHA\b/i, agency: "UN Office for Coordination of Humanitarian Affairs" },
  { re: /\bIOM\b/i, agency: "International Organization for Migration (IOM)" },
  { re: /\bWFP\b/i, agency: "World Food Programme (WFP)" },
  { re: /\bWHO\b/i, agency: "World Health Organization (WHO)" },
  { re: /\bFAO\b/i, agency: "Food and Agriculture Organization (FAO)" },
  { re: /\bILO\b/i, agency: "International Labour Organization (ILO)" },
  { re: /\bIFAD\b/i, agency: "International Fund for Agricultural Development (IFAD)" },
  { re: /\bIFRC\b/i, agency: "International Federation of Red Cross (IFRC)" },
  { re: /\bICRC\b/i, agency: "International Committee of the Red Cross (ICRC)" },
  { re: /\bWorld Bank\b|\bWB\b|\bIBRD\b|\bIDA\b/i, agency: "World Bank" },
  { re: /\bEU\b|\bEuropean Union\b|\bEC\b|\bECHO\b/i, agency: "European Union" },
  { re: /\bUSAID\b/i, agency: "USAID" },
  { re: /\bGIZ\b/i, agency: "GIZ" },
  { re: /\bSIDA\b/i, agency: "Sida (Sweden)" },
  { re: /\bDFID\b|\bFCDO\b/i, agency: "FCDO (UK)" },
  { re: /\bAFD\b/i, agency: "AFD (France)" },
  { re: /\bGAVI\b/i, agency: "Gavi" },
  { re: /\bGlobal Fund\b/i, agency: "The Global Fund" },
  // NPO = non-profit organization posting its own procurement (e.g. ACTED,
  // DRC, Première Urgence). DA's private-sector consulting filter; actual
  // NGO name isn't in the CSV.
  { re: /^NPO$/i, agency: "NGO (via DevelopmentAid)" },
];

function resolveAgency(funders: string[]): string | null {
  for (const f of funders) {
    for (const { re, agency } of FUNDER_AGENCY) {
      if (re.test(f)) return agency;
    }
  }
  return null;
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
    const resolvedAgency = resolveAgency(funders);
    if (!resolvedAgency) continue;

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
      agency: resolvedAgency,
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
