//
// Pure CSV parsing + column mapping for bulk-importing network/bizdev prospects
// from a spreadsheet export into the Network tab. No side effects, no DB.
//
// Maps the operator's prospect-sheet columns onto the create payload accepted by
// POST /api/admin/network-companies. Tolerant of column order and minor header
// naming differences; folds Sector + Notes into services_text so website-less
// prospects still get a usable match profile.
//

export interface ImportPayload {
  name: string;
  website: string | null;
  countries: string;
  sectors: string;
  services_text: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  notes: string | null;
}

export interface ParseResult {
  rows: ImportPayload[];
  total: number;          // data rows encountered (excluding header)
  skippedNoName: number;  // rows dropped for having no company name
  headers: string[];
}

/**
 * Pick the most likely delimiter from the header line. Lets the importer accept
 * a file/CSV export (comma), a paste copied straight from Google Sheets / Excel
 * (TAB), or a European-locale CSV (semicolon) without the user converting first.
 */
export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/\r\n/g, "\n").split("\n")[0] ?? "";
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

const ALIASES: Record<string, string[]> = {
  name: ["company name", "name", "company"],
  website: ["website url", "website", "url"],
  country: ["country", "countries"],
  sector: ["sector", "industry"],
  contact_name: ["contact name", "contact"],
  contact_email: ["contact email", "email"],
  contact_linkedin: ["contact linkedin", "linkedin", "linkedin url"],
  title: ["contact title", "title"],
  notes: ["notes", "note"],
  usaid: ["usaid partner", "usaid"],
};

function indexOf(headers: string[], key: string): number {
  const aliases = ALIASES[key] ?? [];
  return headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
}

export function parseProspects(text: string): ParseResult {
  const delimiter = detectDelimiter(text);
  const table = parseCsv(text, delimiter).filter((r) => r.some((c) => (c ?? "").trim()));
  if (table.length === 0) return { rows: [], total: 0, skippedNoName: 0, headers: [] };

  const headers = table[0].map((h) => (h ?? "").trim());
  const ci = {
    name: indexOf(headers, "name"),
    website: indexOf(headers, "website"),
    country: indexOf(headers, "country"),
    sector: indexOf(headers, "sector"),
    cname: indexOf(headers, "contact_name"),
    cemail: indexOf(headers, "contact_email"),
    cli: indexOf(headers, "contact_linkedin"),
    title: indexOf(headers, "title"),
    notes: indexOf(headers, "notes"),
    usaid: indexOf(headers, "usaid"),
  };
  const get = (r: string[], i: number) => (i >= 0 && i < r.length ? (r[i] ?? "").trim() : "");

  const rows: ImportPayload[] = [];
  let skippedNoName = 0;
  let total = 0;
  for (let k = 1; k < table.length; k++) {
    const r = table[k];
    total++;
    const name = get(r, ci.name);
    if (!name) { skippedNoName++; continue; }
    const sector = get(r, ci.sector);
    const sheetNotes = get(r, ci.notes);
    const services = [sector, sheetNotes].filter(Boolean).join(". ").slice(0, 4000) || null;
    const title = get(r, ci.title);
    const usaid = get(r, ci.usaid).toLowerCase() === "yes";
    const noteParts = [title, usaid ? "USAID partner" : ""].filter(Boolean);
    rows.push({
      name,
      website: get(r, ci.website) || null,
      countries: get(r, ci.country),
      sectors: sector,
      services_text: services,
      contact_name: get(r, ci.cname) || null,
      contact_email: get(r, ci.cemail) || null,
      contact_linkedin: get(r, ci.cli) || null,
      notes: noteParts.join(" · ") || null,
    });
  }
  return { rows, total, skippedNoName, headers };
}
