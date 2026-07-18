import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";

type WorkOrderRow = Record<string, unknown> & {
  status?: string | null;
  plan?: string | null;
  payment_status?: string | null;
  generation_status?: string | null;
  package_error_message?: string | null;
  package_has_artifact?: boolean | null;
  qa_status?: string;
};

function cleanFilter(value: string | null): string | null {
  if (!value || value === "all") return null;
  return value;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function qaStatusFor(row: WorkOrderRow): string {
  const status = text(row.status);
  const generationStatus = text(row.generation_status);
  const hasPackageError = !!text(row.package_error_message);
  const hasPdf = row.package_has_artifact === true;

  if (status === "delivered") return "delivered";
  if (status === "waiting_on_client" || hasPackageError || generationStatus === "failed") return "blocked";
  if (generationStatus === "generating" || generationStatus === "pending") return "generating";
  if (generationStatus === "completed" && hasPdf) return "ready_to_review";
  if (!generationStatus) return "no_package";
  return "needs_review";
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  await ensureCustomerPrivacySchema();

  const url = new URL(request.url);
  const status = cleanFilter(url.searchParams.get("status"));
  const plan = cleanFilter(url.searchParams.get("plan"));
  const paymentStatus = cleanFilter(url.searchParams.get("payment_status"));
  const generationStatus = cleanFilter(url.searchParams.get("generation_status"));
  const qaStatus = cleanFilter(url.searchParams.get("qa_status"));

  const rows = await sql`
    SELECT
      wo.id, wo.user_id, wo.plan, wo.status, wo.payment_status,
      wo.amount_cents, wo.currency, wo.email, wo.service_slug,
      wo.pipeline_item_id, wo.tender_title, wo.agency, wo.tender_url,
      wo.created_at, wo.updated_at,
      u.email AS user_email,
      pi.tender_deadline,
      pi.fit_score,
      pi.stage AS pipeline_stage,
      pp.generation_status,
      pp.has_artifact AS package_has_artifact,
      pp.error_message AS package_error_message,
      pp.created_at AS package_created_at,
      grant_row.expires_at AS content_access_expires_at
    FROM work_orders wo
    LEFT JOIN users u ON u.id = wo.user_id
    LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
    LEFT JOIN LATERAL (
      SELECT generation_status, error_message, (pdf_url IS NOT NULL) AS has_artifact, created_at
      FROM proposal_packages
      WHERE work_order_id = wo.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pp ON TRUE
    LEFT JOIN LATERAL (
      SELECT expires_at
      FROM customer_access_grants
      WHERE owner_user_id = wo.user_id
        AND work_order_id = wo.id
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY granted_at DESC
      LIMIT 1
    ) grant_row ON TRUE
    ORDER BY wo.created_at DESC
    LIMIT 250
  `;

  const withQa = (rows as WorkOrderRow[]).map((row) => ({
    ...row,
    intake: null,
    fulfillment_notes: null,
    payment_proof_url: null,
    package_pdf_url: null,
    has_content_access: Boolean(row.content_access_expires_at),
    qa_status: qaStatusFor(row),
  }));
  const filtered = withQa.filter((row) => {
    if (status && row.status !== status) return false;
    if (plan && row.plan !== plan) return false;
    if (paymentStatus && (row.payment_status ?? "") !== paymentStatus) return false;
    if (generationStatus && (row.generation_status ?? "none") !== generationStatus) return false;
    if (qaStatus && row.qa_status !== qaStatus) return false;
    return true;
  });

  return NextResponse.json({
    workOrders: filtered.slice(0, 100),
    total: filtered.length,
    filters: { status, plan, payment_status: paymentStatus, generation_status: generationStatus, qa_status: qaStatus },
  });
}
