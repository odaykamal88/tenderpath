/* Exports (SPEC §4, prototype Deliverables/sub-tracker.jsx):
 *   ?deliverable=i — single document PDF, available from client review onward
 *                    (the reader's Download button).
 *   ?envelope=technical|financial|forms|all — per-envelope ZIPs, FINAL/SUBMITTED
 *                    only ("Export — envelopes stay separate"). "all" nests the
 *                    per-envelope ZIPs in one wrapper — never a merged document.
 * Deliverables whose fmt includes XLSX (priced line schedule / BoQ) get a real
 * workbook alongside the PDF, built from the same intake lines; fmt DOCX
 * deliverables (EOI cover letter, RFP technical) get a real .docx from the
 * same block model. */

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAuth } from "@/lib/subscription-guard";
import { getOrderForUser } from "@/lib/submissions/store";
import { docContent, type DeliverableDoc, type DocCompany } from "@/lib/submissions/doc-content";
import { renderSubmissionDeliverableDocx } from "@/lib/submissions/docx";
import { renderSubmissionDeliverablePdf } from "@/lib/proposal-package/pdfDocs";
import type { EnvelopeKey, PricedLine, SubmissionOrder } from "@/lib/submissions/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const READ_STAGES = new Set(["review", "revisions", "final", "submitted"]);
const EXPORT_STAGES = new Set(["final", "submitted"]);
const ENVELOPES: EnvelopeKey[] = ["technical", "financial", "forms"];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function stampFor(order: SubmissionOrder, revision?: number): string {
  return order.stage === "final" || order.stage === "submitted"
    ? "FINAL · SUBMISSION COPY"
    : `DRAFT · QA PASSED${revision ? ` · REVISION ${revision}` : ""}`;
}

/** XLSX for the priced-lines deliverables, built from the intake lines. */
async function renderLinesXlsx(order: SubmissionOrder, doc: DeliverableDoc): Promise<Buffer | null> {
  if (!/xlsx/i.test(doc.fmt)) return null;
  const fields = order.intakeFields as { lines?: PricedLine[]; currency?: string; fields?: Record<string, string> };
  const lines = Array.isArray(fields.lines) ? fields.lines : [];
  if (lines.length === 0) return null;
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(doc.name.slice(0, 28));
  ws.columns = [
    { header: "Line item", key: "desc", width: 52 },
    { header: "Spec ref", key: "spec", width: 12 },
    { header: "Qty", key: "qty", width: 8 },
    { header: "Unit", key: "unit", width: 8 },
    { header: `Unit price (${fields.currency ?? "USD"})`, key: "price", width: 16 },
    { header: "Line total", key: "total", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  let total = 0;
  for (const l of lines) {
    const lt = (l.unitPrice ?? 0) * (l.qty || 0);
    total += lt;
    ws.addRow({ desc: l.desc, spec: l.specRef ?? "", qty: l.qty, unit: l.unit, price: l.unitPrice ?? null, total: lt || null });
  }
  const taxTreatment = fields.fields?.tax?.trim() || "tax treatment per solicitation";
  const totalRow = ws.addRow({ desc: `Total · ${fields.currency ?? "USD"} · ${taxTreatment}`, total });
  totalRow.font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function envelopeZip(
  order: SubmissionOrder,
  docs: DeliverableDoc[],
  envelope: EnvelopeKey,
  company: DocCompany,
): Promise<{ zip: Buffer; count: number }> {
  const zip = new JSZip();
  const inEnvelope = docs.filter((d) => d.envelope === envelope);
  const stamp = stampFor(order);
  const generatedAt = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const doc of inEnvelope) {
    n += 1;
    const base = `${order.ref}_${envelope}_${String(n).padStart(2, "0")}_${slug(doc.name)}`;
    const pdf = await renderSubmissionDeliverablePdf(doc, { companyName: company.name, ref: order.ref, stamp, generatedAt });
    zip.file(`${base}.pdf`, pdf);
    const xlsx = await renderLinesXlsx(order, doc);
    if (xlsx) zip.file(`${base}.xlsx`, xlsx);
    if (/docx/i.test(doc.fmt)) {
      const docxBuf = await renderSubmissionDeliverableDocx(doc, { companyName: company.name, ref: order.ref, stamp });
      zip.file(`${base}.docx`, docxBuf);
    }
  }
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return { zip: buf, count: inEnvelope.length };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  if (!/^\d+$/.test(idRaw)) return NextResponse.json({ error: "Bad order id." }, { status: 400 });

  const url = new URL(request.url);
  const deliverableRaw = url.searchParams.get("deliverable");
  const versionRaw = url.searchParams.get("version");
  const which = (url.searchParams.get("envelope") ?? (deliverableRaw == null ? "all" : "")).toLowerCase();

  try {
    const order = await getOrderForUser(guard.user!.id, Number(idRaw));
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const company: DocCompany = {
      name: guard.user!.business_name?.trim() || guard.user!.name?.trim() || guard.user!.email,
      signatory: guard.user!.name?.trim() || guard.user!.email,
    };
    const requestedVersion = versionRaw && /^\d+$/.test(versionRaw)
      ? order.artifactVersions.find((version) => version.revision === Number(versionRaw)) ?? null
      : null;
    if (versionRaw && !requestedVersion) {
      return NextResponse.json({ error: "Unknown draft version." }, { status: 404 });
    }
    const currentVersion = requestedVersion ?? order.artifactVersions.at(-1) ?? null;
    const docs = currentVersion?.documents ?? docContent(order, company, order.generatedProse);
    const exportOrder = currentVersion
      ? { ...order, intakeFields: currentVersion.intakeFields }
      : order;

    // Single-deliverable PDF — the reader's Download, available from review on.
    if (deliverableRaw != null) {
      if (!READ_STAGES.has(order.stage)) {
        return NextResponse.json({ error: "Downloads unlock when the draft reaches your review." }, { status: 409 });
      }
      const i = /^\d+$/.test(deliverableRaw) ? Number(deliverableRaw) : -1;
      const doc = docs[i];
      if (!doc) return NextResponse.json({ error: "Unknown deliverable." }, { status: 404 });
      const stamp = stampFor(order, currentVersion?.revision);
      const generatedAt = (currentVersion?.generatedAt ?? new Date().toISOString()).slice(0, 10);
      const pdf = await renderSubmissionDeliverablePdf(doc, { companyName: company.name, ref: order.ref, stamp, generatedAt });
      const xlsx = await renderLinesXlsx(exportOrder, doc);
      const docxBuf = /docx/i.test(doc.fmt)
        ? await renderSubmissionDeliverableDocx(doc, { companyName: company.name, ref: order.ref, stamp })
        : null;
      // Multi-format deliverables ship every format together; PDF-only stays bare.
      if (xlsx || docxBuf) {
        const zip = new JSZip();
        const base = `${order.ref}_r${currentVersion?.revision ?? order.round + 1}_${slug(doc.name)}`;
        zip.file(`${base}.pdf`, pdf);
        if (xlsx) zip.file(`${base}.xlsx`, xlsx);
        if (docxBuf) zip.file(`${base}.docx`, docxBuf);
        const buf = await zip.generateAsync({ type: "nodebuffer" });
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            "content-type": "application/zip",
            "content-disposition": `attachment; filename="${base}.zip"`,
          },
        });
      }
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="${order.ref}_r${currentVersion?.revision ?? order.round + 1}_${slug(doc.name)}.pdf"`,
        },
      });
    }

    // Envelope ZIPs — final/submitted only (the prototype keeps review in-app).
    if (!EXPORT_STAGES.has(order.stage)) {
      return NextResponse.json(
        { error: "Envelope exports unlock with the final pack — read and approve the draft in-app first." },
        { status: 409 },
      );
    }
    if (which !== "all" && !ENVELOPES.includes(which as EnvelopeKey)) {
      return NextResponse.json({ error: "Unknown envelope." }, { status: 400 });
    }

    if (which !== "all") {
      const { zip, count } = await envelopeZip(order, docs, which as EnvelopeKey, company);
      if (count === 0) return NextResponse.json({ error: "No documents in this envelope." }, { status: 404 });
      return new NextResponse(new Uint8Array(zip), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${order.ref}_${which}-envelope.zip"`,
        },
      });
    }

    const wrapper = new JSZip();
    let envelopes = 0;
    for (const env of ENVELOPES) {
      const { zip, count } = await envelopeZip(order, docs, env, company);
      if (count > 0) {
        envelopes += 1;
        wrapper.file(`${order.ref}_${env}-envelope.zip`, zip);
      }
    }
    wrapper.file(
      `${order.ref}_READ-FIRST.txt`,
      [
        `${order.ref} · ${order.type} — ${order.tender}`,
        "",
        `This pack contains ${envelopes} separate envelope ZIPs.`,
        "Upload each ZIP's contents to its own slot on the portal — never merge",
        "envelopes into one upload. Financial files must not travel with the",
        "technical envelope.",
        "",
        "Sign at every marked signature point before submitting.",
        "You submit; we guide — TenderPath does not file on your behalf.",
      ].join("\n"),
    );
    const buf = await wrapper.generateAsync({ type: "nodebuffer" });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${order.ref}_submission-pack.zip"`,
      },
    });
  } catch (err) {
    console.error("[tp:submissions:export_failed]", {
      orderId: idRaw,
      envelope: which,
      deliverable: deliverableRaw,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Export failed — try again." }, { status: 500 });
  }
}
