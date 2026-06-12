/* DOCX renderer for submission deliverables — the same DocBlock model the
 * in-app reader and the PDF export consume, so every format of a deliverable
 * says exactly the same thing. Used for deliverables whose fmt includes DOCX
 * (EOI cover letter, RFP technical proposal — the editable-by-design ones). */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { DeliverableDoc, DocBlock } from "./doc-content";

const INK = "1a1a1a";
const INK2 = "4a4a4a";
const INK3 = "6b6b6b";
const GOLD = "9c6b1f";

function para(text: string, opts?: { bold?: boolean; size?: number; color?: string; spacingBefore?: number }): Paragraph {
  return new Paragraph({
    spacing: { before: opts?.spacingBefore ?? 120, after: 120, line: 320 },
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        size: opts?.size ?? 22, // half-points: 22 = 11pt
        color: opts?.color ?? INK2,
        font: "Calibri",
      }),
    ],
  });
}

function tableOf(head: string[], rows: string[][], foot?: [string, string]): Table {
  const headerRow = new TableRow({
    children: head.map(
      (h) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: h.toUpperCase(), bold: true, size: 16, color: INK3, font: "Calibri" })],
            }),
          ],
        }),
    ),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: cell, size: 20, color: INK2, font: "Calibri" })] })],
            }),
        ),
      }),
  );
  const footRow = foot
    ? [
        new TableRow({
          children: [
            new TableCell({
              columnSpan: Math.max(1, head.length - 1),
              children: [new Paragraph({ children: [new TextRun({ text: foot[0].toUpperCase(), bold: true, size: 16, color: INK, font: "Calibri" })] })],
            }),
            new TableCell({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: foot[1], bold: true, size: 22, color: INK, font: "Calibri" })],
                }),
              ],
            }),
          ],
        }),
      ]
    : [];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows, ...footRow],
  });
}

function blockToDocx(b: DocBlock): (Paragraph | Table)[] {
  switch (b.b) {
    case "h1":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: INK } },
          children: [new TextRun({ text: b.text, size: 40, color: INK, font: "Georgia" })],
        }),
      ];
    case "h2":
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 80 },
          children: [new TextRun({ text: b.text, bold: true, size: 24, color: INK, font: "Calibri" })],
        }),
      ];
    case "p":
      return [para(b.text)];
    case "kv":
      return [
        tableOf(
          ["", ""],
          b.rows.map(([k, v]) => [k.toUpperCase(), v]),
        ),
        para("", { size: 8 }),
      ];
    case "list":
      return b.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 40, after: 40, line: 300 },
            children: [new TextRun({ text: item, size: 21, color: INK2, font: "Calibri" })],
          }),
      );
    case "table":
      return [tableOf(b.head, b.rows, b.foot), para("", { size: 8 })];
    case "note":
      return [para(`QA · ${b.text}`, { size: 18, color: GOLD })];
    case "sig":
      return [
        para("Yours faithfully,", { spacingBefore: 360 }),
        para("________________________________   (sign here)", { color: INK, spacingBefore: 240 }),
        para(b.name, { bold: true, color: INK, spacingBefore: 60 }),
        para(b.role, { size: 18, color: INK3 }),
      ];
    default:
      return [];
  }
}

export async function renderSubmissionDeliverableDocx(
  doc: DeliverableDoc,
  opts: { companyName: string; ref: string; stamp: string },
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `${opts.companyName} · prepared by TenderPath · ${opts.ref} · ${opts.stamp}`,
          size: 14,
          color: INK3,
          font: "Consolas",
        }),
      ],
    }),
    ...doc.blocks.flatMap(blockToDocx),
  ];
  const file = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(file);
}
