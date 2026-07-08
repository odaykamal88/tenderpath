//
// Pure spreadsheet parsing + column mapping for bulk-importing network/bizdev
// contacts (the outbound CRM) from a CSV/TSV/XLSX export. No side effects, no DB.
//
// Two responsibilities:
//   1. Turn a delimited-text paste/file into a 2-D table (parseCsv/detectDelimiter).
//      XLSX files are parsed server-side (exceljs) and arrive here already as a
//      table, so this module stays dependency-free and runs in the browser.
//   2. Detect the header row, auto-map columns onto CRM fields, and build the
//      per-row payloads for POST /api/admin/network-companies/bulk.
//
// The mapping is a *best guess* the operator confirms in the UI — every column
// can be re-pointed by hand — so auto-map favours predictable, explainable
// choices over cleverness. The one case it must get right unaided is the
// company-vs-contact-person split (a sheet with both a "Name" person column and
// a "Company" column), because getting it wrong silently imports people as
// companies.
//

export type FieldKey =
  | "name"
  | "contact_name"
  | "contact_title"
  | "contact_email"
  | "contact_email_status"
  | "contact_linkedin"
  | "country"
  | "city"
  | "sector"
  | "un_buyer"
  | "website"
  | "notes";

export interface FieldDef {
  key: FieldKey;
  label: string;
  required?: boolean;
  aliases: string[];
}

// Order here is the order shown in the mapping UI.
export const FIELD_DEFS: FieldDef[] = [
  { key: "name", label: "Company", required: true, aliases: ["company", "company name", "organisation", "organization", "org", "firm", "business", "vendor", "supplier", "account"] },
  { key: "contact_name", label: "Contact name", aliases: ["contact name", "contact", "full name", "person", "owner name", "name", "contact person", "primary contact"] },
  { key: "contact_title", label: "Title / role", aliases: ["title", "role", "position", "job title", "contact title", "designation"] },
  { key: "contact_email", label: "Email", aliases: ["email", "contact email", "e mail", "email address", "work email"] },
  { key: "contact_email_status", label: "Email status", aliases: ["email status", "email verification", "verification", "verified"] },
  { key: "contact_linkedin", label: "LinkedIn", aliases: ["linkedin", "linkedin url", "linkedin profile", "profile url"] },
  { key: "country", label: "Country", aliases: ["country", "countries", "nation"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "sector", label: "Sector", aliases: ["sector", "sectors", "industry", "category", "vertical"] },
  { key: "un_buyer", label: "UN buyer", aliases: ["un buyer", "un buyer awarded", "un agency", "un client", "buyer", "awarded by", "agency"] },
  { key: "website", label: "Website", aliases: ["website", "website url", "url", "web", "site", "domain", "homepage"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks", "description", "details"] },
];

// Company-ish headers used to decide whether a lone "Name" column means the
// company (no dedicated company column) or the contact person (company column
// present elsewhere).
const COMPANY_HEADER_ALIASES = new Set(["company", "company name", "organisation", "organization", "org", "firm", "business", "vendor", "supplier", "account"]);

// Tokens that mark a row as a plausible header row (vs. a title/spacer row).
const HEADER_KEYWORDS = ["name", "company", "email", "website", "country", "sector", "title", "contact", "linkedin", "city", "phone", "buyer", "notes"];

export interface ImportRow {
  name: string;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_email_status: string | null;
  contact_linkedin: string | null;
  countries: string;   // comma-joined (usually a single country)
  city: string | null;
  sectors: string;     // comma-joined
  un_buyer: string | null;
  website: string | null;
  notes: string | null;
  services_text: string | null;   // derived — gives the matcher something to score
}

export type ColumnMapping = Partial<Record<FieldKey, number>>;

export interface TableAnalysis {
  headerRowIndex: number;
  headers: string[];
  mapping: ColumnMapping;
}

export interface BuildResult {
  rows: ImportRow[];
  total: number;          // data rows encountered (after the header row)
  skippedNoName: number;  // rows dropped for having no company name
}

/** Normalize a header/alias for comparison: lowercase, non-alphanumerics → spaces, collapse. */
export function normalizeHeader(raw: string): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Pick the most likely delimiter from the header line. Lets the importer accept
 * a CSV export (comma), a paste copied straight from Google Sheets / Excel (TAB),
 * or a European-locale CSV (semicolon) without the user converting first.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/\r\n/g, "\n").split("\n").find((l) => l.trim()) ?? "";
  const candidates = [",", "\t", ";"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = firstLine.split(d).length - 1;
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

/** RFC4180-ish CSV/TSV parser: handles quoted fields, embedded delimiters, escaped quotes and newlines. */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function parseDelimited(text: string): string[][] {
  return parseCsv(text, detectDelimiter(text));
}

/**
 * Find the header row. Real-world exports (this one included) put a merged title
 * cell or blank spacer rows above the header, so we can't assume row 0. Pick the
 * first row that has ≥2 non-empty cells AND contains a recognizable header token.
 * Fall back to the first non-empty row.
 */
export function detectHeaderRow(table: string[][]): number {
  let firstNonEmpty = -1;
  for (let i = 0; i < table.length; i++) {
    const cells = table[i] ?? [];
    const nonEmpty = cells.filter((c) => (c ?? "").trim()).length;
    if (nonEmpty === 0) continue;
    if (firstNonEmpty === -1) firstNonEmpty = i;
    const hasKeyword = cells.some((c) => HEADER_KEYWORDS.includes(normalizeHeader(c)));
    if (nonEmpty >= 2 && hasKeyword) return i;
  }
  return firstNonEmpty === -1 ? 0 : firstNonEmpty;
}

/** Score how well a header matches a target alias. 0 = no match. */
function scoreHeaderAlias(header: string, alias: string): number {
  const h = normalizeHeader(header);
  const a = normalizeHeader(alias);
  if (!h || !a) return 0;
  if (h === a) return 100;
  if (a.length >= 3 && (h.startsWith(a + " ") || h.endsWith(" " + a))) return 80;
  if (a.length >= 3 && h.includes(a)) return 60;
  if (h.length >= 3 && a.includes(h)) return 55;
  return 0;
}

/**
 * Auto-map columns → CRM fields by greedy best-score assignment (each header used
 * once, each field once). Then the company-vs-person fallback: if no company
 * column mapped but a lone "Name"-style column went to contact_name AND the sheet
 * has no company-ish header at all, that column is really the company.
 */
export function autoMap(headers: string[]): ColumnMapping {
  const candidates: Array<{ field: FieldKey; col: number; score: number }> = [];
  FIELD_DEFS.forEach((def) => {
    headers.forEach((header, col) => {
      let best = 0;
      for (const alias of def.aliases) best = Math.max(best, scoreHeaderAlias(header, alias));
      if (best > 0) candidates.push({ field: def.key, col, score: best });
    });
  });
  candidates.sort((x, y) => y.score - x.score);

  const mapping: ColumnMapping = {};
  const usedCols = new Set<number>();
  const usedFields = new Set<FieldKey>();
  for (const c of candidates) {
    if (usedCols.has(c.col) || usedFields.has(c.field)) continue;
    mapping[c.field] = c.col;
    usedCols.add(c.col);
    usedFields.add(c.field);
  }

  if (mapping.name === undefined) {
    const hasCompanyHeader = headers.some((h) => COMPANY_HEADER_ALIASES.has(normalizeHeader(h)));
    if (!hasCompanyHeader && mapping.contact_name !== undefined) {
      // Lone "Name" column IS the company (older single-column sheets).
      mapping.name = mapping.contact_name;
      delete mapping.contact_name;
    }
  }
  return mapping;
}

export function analyzeTable(table: string[][]): TableAnalysis {
  const headerRowIndex = detectHeaderRow(table);
  const headers = (table[headerRowIndex] ?? []).map((h) => (h ?? "").trim());
  return { headerRowIndex, headers, mapping: autoMap(headers) };
}

function cell(row: string[], col: number | undefined): string {
  if (col === undefined || col < 0 || col >= row.length) return "";
  return (row[col] ?? "").trim();
}

/**
 * Build import payloads from a table + an explicit column mapping. Rows without a
 * company name are skipped (counted, not silently dropped). services_text is
 * derived from sector + notes + UN-buyer history so a website-less contact still
 * gets a usable match profile downstream.
 */
export function buildRows(table: string[][], headerRowIndex: number, mapping: ColumnMapping): BuildResult {
  const rows: ImportRow[] = [];
  let total = 0;
  let skippedNoName = 0;

  for (let k = headerRowIndex + 1; k < table.length; k++) {
    const r = table[k] ?? [];
    if (!r.some((c) => (c ?? "").trim())) continue; // skip blank rows entirely
    total++;
    const name = cell(r, mapping.name);
    if (!name) { skippedNoName++; continue; }

    const sector = cell(r, mapping.sector);
    const notes = cell(r, mapping.notes);
    const unBuyer = cell(r, mapping.un_buyer);
    const services = [
      sector,
      notes,
      unBuyer ? `Has won UN contracts with ${unBuyer}.` : "",
    ].filter(Boolean).join(". ").slice(0, 4000) || null;

    rows.push({
      name: name.slice(0, 200),
      contact_name: cell(r, mapping.contact_name) || null,
      contact_title: cell(r, mapping.contact_title) || null,
      contact_email: cleanEmail(cell(r, mapping.contact_email)),
      contact_email_status: cell(r, mapping.contact_email_status).slice(0, 40) || null,
      contact_linkedin: cell(r, mapping.contact_linkedin) || null,
      countries: cell(r, mapping.country),
      city: cell(r, mapping.city) || null,
      sectors: sector,
      un_buyer: unBuyer || null,
      website: cell(r, mapping.website) || null,
      notes: notes || null,
      services_text: services,
    });
  }
  return { rows, total, skippedNoName };
}

// Spreadsheet email cells are often placeholders ("—", "n/a") or mailto: links.
function cleanEmail(raw: string): string | null {
  const s = raw.replace(/^mailto:/i, "").trim();
  if (!s || !s.includes("@")) return null;
  return s.slice(0, 320);
}
