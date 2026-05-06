import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { Resend } from "resend";

export const runtime = "nodejs";
export const maxDuration = 30;

async function sendOpsAlert(
  orderId: number,
  plan: string,
  email: string | null,
  proofUrl: string,
) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return;
  const from = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const ops = process.env.WORK_ORDER_OPS_EMAIL ?? process.env.OPS_EMAIL ?? "info@tenderpath.me";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";
  const resend = new Resend(key);
  const isDataUrl = proofUrl.startsWith("data:");
  await resend.emails.send({
    from,
    to: ops,
    subject: `Wire proof uploaded — work order #${orderId} (${plan})`,
    text: [
      `Work order #${orderId} — plan: ${plan}`,
      `Customer: ${email ?? "unknown"}`,
      isDataUrl ? "Proof: attached as base64 (no Blob token configured)" : `Proof URL: ${proofUrl}`,
      "",
      "Review and activate: " + appUrl + "/admin/work-orders",
    ].join("\n"),
  });
}

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const rawId = formData.get("work_order_id");
  const email = (formData.get("email") as string | null)?.trim() || null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large. Maximum 10 MB." }, { status: 400 });
  }

  const workOrderId = Number(rawId);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "Invalid work_order_id" }, { status: 400 });
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
  ];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Upload a screenshot (JPEG, PNG, WebP) or PDF." },
      { status: 400 },
    );
  }

  let proofUrl: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { put } = require("@vercel/blob");
    const blob = await put(
      `wire-proof/${workOrderId}/${Date.now()}-${file.name}`,
      file,
      { access: "public", addRandomSuffix: true },
    );
    proofUrl = blob.url as string;
  } catch {
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    proofUrl = `data:${file.type};base64,${base64}`;
  }

  const rows = await sql`
    UPDATE work_orders
    SET
      payment_proof_url = ${proofUrl},
      payment_status    = 'pending_verification',
      email             = COALESCE(email, ${email}),
      updated_at        = NOW()
    WHERE id = ${workOrderId}
    RETURNING id, plan, email, tender_title, agency
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const order = rows[0];
  sendOpsAlert(
    order.id as number,
    order.plan as string,
    (order.email as string | null) ?? email,
    proofUrl,
  ).catch((err) => console.error("[wire-proof] ops email failed", err));

  return NextResponse.json({ ok: true });
}
