import ExcelJS from "exceljs";
import type { ProposalOutput } from "./types";

const GOLD = "FFB08530";
const INK = "FF1A1A1A";
const RULE = "FFD8D0BD";
const HEADER_FILL = "FFF5F1E8";

interface XlsxContext {
  companyName: string;
  tenderTitle: string | null;
  agency: string | null;
  generatedAt: string;
}

/**
 * Render a financial proposal template the vendor can fill in.
 * The template uses formulas — total = sum(units × unit_cost), subtotal, contingency, grand total —
 * so the user only fills in line items and quantities, the rest computes itself.
 */
export async function renderFinancialTemplateXlsx(
  output: ProposalOutput,
  ctx: XlsxContext,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TenderPath";
  wb.created = new Date();
  wb.title = `Financial proposal — ${ctx.tenderTitle ?? ctx.companyName}`;

  const sheet = wb.addWorksheet("Financial proposal", {
    properties: { defaultColWidth: 18 },
    views: [{ state: "frozen", ySplit: 8, xSplit: 0 }],
  });

  sheet.columns = [
    { key: "ref", width: 8 },
    { key: "category", width: 22 },
    { key: "description", width: 42 },
    { key: "unit", width: 12 },
    { key: "qty", width: 10 },
    { key: "unit_cost", width: 14 },
    { key: "subtotal", width: 16 },
    { key: "notes", width: 32 },
  ];

  // Title
  sheet.mergeCells("A1:H1");
  const title = sheet.getCell("A1");
  title.value = ctx.tenderTitle ?? "Financial proposal";
  title.font = { name: "Calibri", size: 18, bold: true, color: { argb: INK } };
  title.alignment = { vertical: "middle" };
  sheet.getRow(1).height = 26;

  sheet.mergeCells("A2:H2");
  const meta = sheet.getCell("A2");
  meta.value = [ctx.agency, ctx.companyName, ctx.generatedAt].filter(Boolean).join("  ·  ");
  meta.font = { name: "Calibri", size: 10, color: { argb: "FF6B6B6B" } };

  // Instructions
  sheet.mergeCells("A4:H4");
  const inst = sheet.getCell("A4");
  inst.value = "Fill quantities and unit costs. Subtotal, contingency, and grand total compute automatically.";
  inst.font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF6B6B6B" } };

  // Header row
  const headerRow = sheet.getRow(7);
  headerRow.values = ["#", "Category", "Description", "Unit", "Qty", "Unit cost", "Subtotal", "Notes"];
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", size: 11, bold: true, color: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin", color: { argb: GOLD } } };
  });

  // Line-item rows seeded from the LLM's financial template notes — the user
  // can rename categories or insert/remove rows freely.
  const seedItems = output.financial_template_notes.length > 0
    ? output.financial_template_notes.map((note) => ({
        category: note.split(":")[0]?.slice(0, 30) ?? "Item",
        description: note,
      }))
    : [
        { category: "Personnel", description: "Senior project manager — full project duration" },
        { category: "Personnel", description: "Technical lead" },
        { category: "Personnel", description: "Field staff (n people × n months)" },
        { category: "Travel", description: "International / regional travel" },
        { category: "Travel", description: "Per diem" },
        { category: "Equipment", description: "Equipment and materials" },
        { category: "Operations", description: "Logistics, office overhead, communications" },
        { category: "Reporting", description: "Reports, monitoring & evaluation, audit" },
      ];

  let rowIdx = 8;
  for (let i = 0; i < seedItems.length; i++) {
    const row = sheet.getRow(rowIdx);
    row.getCell(1).value = i + 1;
    row.getCell(2).value = seedItems[i].category;
    row.getCell(3).value = seedItems[i].description;
    row.getCell(4).value = "month";
    row.getCell(5).value = null; // qty
    row.getCell(6).value = null; // unit cost
    row.getCell(7).value = {
      formula: `IF(AND(ISNUMBER(E${rowIdx}),ISNUMBER(F${rowIdx})),E${rowIdx}*F${rowIdx},"")`,
    };
    row.getCell(8).value = ""; // notes
    row.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: INK } };
      cell.alignment = { vertical: "top", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
    });
    row.getCell(6).numFmt = "#,##0.00";
    row.getCell(7).numFmt = "#,##0.00";
    row.getCell(7).font = { name: "Calibri", size: 11, bold: true, color: { argb: INK } };
    rowIdx++;
  }

  const lastItemRow = rowIdx - 1;
  rowIdx += 1;

  // Subtotal
  const subRow = sheet.getRow(rowIdx);
  subRow.getCell(2).value = "Subtotal";
  subRow.getCell(2).font = { name: "Calibri", size: 11, bold: true };
  subRow.getCell(7).value = { formula: `SUM(G8:G${lastItemRow})` };
  subRow.getCell(7).numFmt = "#,##0.00";
  subRow.getCell(7).font = { name: "Calibri", size: 11, bold: true };
  subRow.getCell(7).border = { top: { style: "thin", color: { argb: GOLD } } };
  rowIdx++;

  // Contingency (10% default)
  const contRow = sheet.getRow(rowIdx);
  contRow.getCell(2).value = "Contingency (10%)";
  contRow.getCell(6).value = 0.10;
  contRow.getCell(6).numFmt = "0%";
  contRow.getCell(7).value = { formula: `G${rowIdx - 1}*F${rowIdx}` };
  contRow.getCell(7).numFmt = "#,##0.00";
  rowIdx++;

  // Grand total
  const totalRow = sheet.getRow(rowIdx);
  totalRow.getCell(2).value = "Grand total (USD)";
  totalRow.getCell(2).font = { name: "Calibri", size: 13, bold: true, color: { argb: INK } };
  totalRow.getCell(7).value = { formula: `G${rowIdx - 2}+G${rowIdx - 1}` };
  totalRow.getCell(7).numFmt = "#,##0.00";
  totalRow.getCell(7).font = { name: "Calibri", size: 13, bold: true, color: { argb: INK } };
  totalRow.getCell(7).border = { top: { style: "double", color: { argb: GOLD } }, bottom: { style: "double", color: { argb: GOLD } } };

  // Notes sheet
  if (output.financial_template_notes.length > 0) {
    const notes = wb.addWorksheet("Pricing notes", { properties: { defaultColWidth: 90 } });
    notes.getCell("A1").value = "Pricing strategy notes";
    notes.getCell("A1").font = { name: "Calibri", size: 16, bold: true };
    output.financial_template_notes.forEach((n, i) => {
      const cell = notes.getCell(`A${i + 3}`);
      cell.value = `• ${n}`;
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.font = { name: "Calibri", size: 11 };
    });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
