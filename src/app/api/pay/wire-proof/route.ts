import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { Resend } from "resend";
import { requireAuth } from "@/lib/subscription-guard";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

interface WorkOrderPaymentRow {
  id: number;
  plan: string;
  service_slug: string | null;
  email: string | null;
  payment_status: string | null;
}

function workOrderPlanMatches(order: WorkOrderPaymentRow, plan: string): boolean {
  return order.plan === plan
    || order.service_slug === plan
    || (plan === PROPOSAL_PLAN && order.service_slug === "proposal")
    || (plan === ROSTER_PLAN && order.service_slug === "lta-roster");
}

function proofBlobPath(workOrderId: number, fileName: string): string {
  const ext = fileName.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase() ?? "";
  return `wire-proof/${workOrderId}/${crypto.randomUUID()}${ext}`;
}

async function sendOpsAlert(
  orderId: number,
  plan: string,
  email: string | null,
) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return;
  const from = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const ops = process.env.WORK_ORDER_OPS_EMAIL ?? process.env.OPS_EMAIL ?? "info@tenderpath.me";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";
  const resend = new Resend(key);
  await resend.emails.send({
    from,
    to: ops,
    subject: `Wire proof uploaded — work order #${orderId} (${plan})`,
    text: [
      `Work order #${orderId} — plan: ${plan}`,
      `Customer: ${email ?? "unknown"}`,
      `Proof URL: ${appUrl}/api/admin/work-orders/${orderId}/payment-proof`,
      "",
      "Review and activate: " + appUrl + "/admin/work-orders",
    ].join("\n"),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  const rawId = formData.get("work_order_id");
  const plan = (formData.get("plan") as string | null)?.trim() || null;

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

  const userLimit = enforceRateLimit(req, {
    namespace: "pay:wire-proof:user",
    limit: 8,
    windowMs: 10 * 60 * 1000,
    keyParts: [user.id, workOrderId],
  });
  if (userLimit) return userLimit;

  const ownedRows = await sql`
    SELECT id, plan, service_slug, email, payment_status
    FROM work_orders
    WHERE id = ${workOrderId}
      AND (
        user_id = ${user.id}
        OR (email IS NOT NULL AND LOWER(email) = LOWER(${user.email}))
      )
    LIMIT 1
  ` as unknown as WorkOrderPaymentRow[];
  const ownedOrder = ownedRows[0];
  if (!ownedOrder) {
    console.warn("[wire-proof:ownership_blocked]", { workOrderId, userId: user.id });
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }
  if (plan && !workOrderPlanMatches(ownedOrder, plan)) {
    return NextResponse.json({ error: "This payment plan does not match the work order." }, { status: 409 });
  }
  if (ownedOrder.payment_status === "paid") {
    return NextResponse.json({ error: "This work order is already marked paid." }, { status: 409 });
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
      proofBlobPath(workOrderId, file.name),
      file,
      { access: "public", addRandomSuffix: true },
    );
    proofUrl = blob.url as string;
  } catch (err) {
    console.error("[wire-proof:blob_failed]", {
      workOrderId,
      userId: user.id,
      fileName: file.name,
      fileSize: file.size,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
    return NextResponse.json(
      { error: "Payment proof storage is unavailable. Please try again shortly.", code: "BLOB_UPLOAD_FAILED" },
      { status: 503 },
    );
  }

  const rows = await sql`
    UPDATE work_orders
    SET
      payment_proof_url = ${proofUrl},
      payment_status    = 'pending_verification',
      email             = COALESCE(email, ${user.email}),
      updated_at        = NOW()
    WHERE id = ${workOrderId}
      AND (
        user_id = ${user.id}
        OR (email IS NOT NULL AND LOWER(email) = LOWER(${user.email}))
      )
      AND payment_status IS DISTINCT FROM 'paid'
    RETURNING id, plan, email, tender_title, agency
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: "Work order not found." }, { status: 404 });
  }

  const order = rows[0];
  sendOpsAlert(
    order.id as number,
    order.plan as string,
    (order.email as string | null) ?? user.email,
  ).catch((err) => console.error("[wire-proof] ops email failed", err));

  return NextResponse.json({ ok: true });
}
