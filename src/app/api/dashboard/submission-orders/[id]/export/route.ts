/* Per-envelope export (SPEC §4): deliverables grouped by envelope — one ZIP
 * per envelope, or "all" = the per-envelope ZIPs nested in one wrapper.
 * NEVER a single merged document: each ZIP maps to one portal upload slot.
 * Files are named per a stable convention ({ref}_{envelope}_{nn}_{slug}.pdf)
 * so the slot mapping is obvious.
 *
 * Available from client review onward — the exported PDF renders the same
 * block model the in-app reader shows, stamped DRAFT · QA PASSED until
 * approval and FINAL · SUBMISSION COPY after. */

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAuth } from "@/lib/subscription-guard";
import { getOrderForUser } from "@/lib/submissions/store";
import { docContent, type DeliverableDoc } from "@/lib/submissions/doc-content";
import { renderSubmissionDeliverablePdf } from "@/lib/proposal-package/pdfDocs";
import type { EnvelopeKey, SubmissionOrder } from "@/lib/submissions/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EXPORTABLE_STAGES = new Set(["review", "revisions", "final", "submitted"]);
const ENVELOPES: EnvelopeKey[] = ["technical", "financial", "forms"];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

function stampFor(order: SubmissionOrder): string {
  return order.stage === "final" || order.stage === "submitted"
    ? "FINAL · SUBMISSION COPY"
    : "DRAFT · QA PASSED";
}

async function envelopeZip(
  order: SubmissionOrder,
  docs: DeliverableDoc[],
  envelope: EnvelopeKey,
  company: string,
): Promise<{ zip: Buffer; count: number }> {
  const zip = new JSZip();
  const inEnvelope = docs.filter((d) => d.envelope === envelope);
  const stamp = stampFor(order);
  const generatedAt = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const doc of inEnvelope) {
    n += 1;
    const pdf = await renderSubmissionDeliverablePdf(doc, {
      companyName: company,
      ref: order.ref,
      stamp,
      generatedAt,
    });
    zip.file(`${order.ref}_${envelope}_${String(n).padStart(2, "0")}_${slug(doc.name)}.pdf`, pdf);
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
  const which = (url.searchParams.get("envelope") ?? "all").toLowerCase();
  if (which !== "all" && !ENVELOPES.includes(which as EnvelopeKey)) {
    return NextResponse.json({ error: "Unknown envelope." }, { status: 400 });
  }

  try {
    const order = await getOrderForUser(guard.user!.id, Number(idRaw));
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (!EXPORTABLE_STAGES.has(order.stage)) {
      return NextResponse.json(
        { error: "Exports unlock when the draft pack reaches your review." },
        { status: 409 },
      );
    }

    const company = guard.user!.business_name?.trim() || guard.user!.name?.trim() || guard.user!.email;
    const docs = docContent(order, company);

    if (which !== "all") {
      const { zip, count } = await envelopeZip(order, docs, which as EnvelopeKey, company);
      if (count === 0) {
        return NextResponse.json({ error: "No documents in this envelope." }, { status: 404 });
      }
      return new NextResponse(new Uint8Array(zip), {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${order.ref}_${which}-envelope.zip"`,
        },
      });
    }

    // "All" — the per-envelope ZIPs nested in one wrapper, never merged.
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
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Export failed — try again." }, { status: 500 });
  }
}
