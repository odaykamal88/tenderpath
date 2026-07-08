import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireAdmin } from "@/lib/subscription-guard";
import { analyzeTable, parseDelimited, type TableAnalysis } from "@/lib/network/importMap";

// Parsing a spreadsheet is CPU-only (no crawl/AI) — a short budget is plenty.
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024; // 8MB — contact lists are tiny; this is an abuse guard.
const MAX_ROWS = 5000;
const MAX_COLS = 60;

const GENERIC_LINK_LABELS = new Set([
  "view profile", "view", "profile", "link", "open", "linkedin", "website", "email", "click here", "url", "see profile",
]);

/** Flatten an exceljs cell value to a plain string, preferring hyperlink URLs over
 *  useless display labels ("View profile") and normalising dates/formulas. */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.hyperlink) {
      const label = typeof v.text === "string" ? v.text.trim() : "";
      const link = String(v.hyperlink).replace(/^mailto:/i, "").trim();
      return label && !GENERIC_LINK_LABELS.has(label.toLowerCase()) ? label : link;
    }
    if (Array.isArray(v.richText)) return v.richText.map((rt) => (rt as { text?: string }).text ?? "").join("").trim();
    if (typeof v.text === "string") return v.text.trim();
    if ("result" in v) return cellText(v.result);
    return "";
  }
  return String(value);
}

function worksheetToTable(ws: ExcelJS.Worksheet): string[][] {
  const rowCount = Math.min(ws.rowCount || 0, MAX_ROWS);
  const colCount = Math.min(ws.columnCount || 0, MAX_COLS);
  const table: string[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c).value));
    table.push(cells);
  }
  return table;
}

// Prefer the sheet whose auto-mapping resolves the most fields (and, decisively,
// the required company column) — skips "Summary"/cover sheets automatically.
function scoreAnalysis(a: TableAnalysis): number {
  const mapped = Object.keys(a.mapping).length;
  return mapped + (a.mapping.name !== undefined ? 100 : 0);
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded (expected multipart form field 'file')." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).` }, { status: 413 });
  }

  const name = file.name.toLowerCase();
  const requestedSheet = new URL(request.url).searchParams.get("sheet");

  try {
    // CSV/TSV: parse as text (matches the client-side path, but lets a user drop a
    // .csv into the same picker without special-casing).
    if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt") || file.type.startsWith("text/")) {
      const text = await file.text();
      const table = parseDelimited(text).slice(0, MAX_ROWS);
      const analysis = analyzeTable(table);
      return NextResponse.json({ sheets: [], sheet: null, table, ...analysis });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);

    const sheets = wb.worksheets.map((ws) => ws.name);
    if (sheets.length === 0) {
      return NextResponse.json({ error: "The workbook has no sheets." }, { status: 400 });
    }

    let chosen: ExcelJS.Worksheet | undefined;
    if (requestedSheet) chosen = wb.worksheets.find((ws) => ws.name === requestedSheet);
    if (!chosen) {
      // Auto-pick the best-scoring sheet.
      let bestScore = -1;
      for (const ws of wb.worksheets) {
        const score = scoreAnalysis(analyzeTable(worksheetToTable(ws)));
        if (score > bestScore) { bestScore = score; chosen = ws; }
      }
    }
    if (!chosen) chosen = wb.worksheets[0];

    const table = worksheetToTable(chosen);
    const analysis = analyzeTable(table);
    return NextResponse.json({ sheets, sheet: chosen.name, table, ...analysis });
  } catch (err) {
    console.error("[network:import:parse_failed]", { name, error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Couldn't read that file. Make sure it's a valid .xlsx, .xls, or .csv export." },
      { status: 422 },
    );
  }
}
