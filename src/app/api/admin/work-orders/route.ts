import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type WorkOrderRow = Record<string, unknown> & {
  status?: string | null;
  plan?: string | null;
  payment_status?: string | null;
  generation_status?: string | null;
  package_error_message?: string | null;
  package_pdf_url?: string | null;
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
  const hasPdf = !!text(row.package_pdf_url);

  if (status === "delivered") return "delivered";
  if (status === "waiting_on_client" || hasPackageError || generationStatus === "failed") return "blocked";
  if (generationStatus === "generating" || generationStatus === "pending") return "generating";
  if (generationStatus === "completed" && hasPdf) return "ready_to_review";
  if (!generationStatus) return "no_package";
  return "needs_review";
}

function publicWorkOrder(row: WorkOrderRow): WorkOrderRow {
  return {
    ...row,
    payment_proof_url: row.payment_proof_url
      ? `/api/admin/work-orders/${row.id}/payment-proof`
      : null,
  };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const status = cleanFilter(url.searchParams.get("status"));
  const plan = cleanFilter(url.searchParams.get("plan"));
  const paymentStatus = cleanFilter(url.searchParams.get("payment_status"));
  const generationStatus = cleanFilter(url.searchParams.get("generation_status"));
  const qaStatus = cleanFilter(url.searchParams.get("qa_status"));

  const rows = await sql`
    SELECT
      wo.*,
      u.email AS user_email,
      pi.tender_deadline,
      pi.fit_score,
      pi.stage AS pipeline_stage,
      pp.generation_status,
      pp.error_message AS package_error_message,
      pp.pdf_url AS package_pdf_url,
      pp.created_at AS package_created_at
    FROM work_orders wo
    LEFT JOIN users u ON u.id = wo.user_id
    LEFT JOIN pipeline_items pi ON pi.id = wo.pipeline_item_id
    LEFT JOIN LATERAL (
      SELECT generation_status, error_message, pdf_url, created_at
      FROM proposal_packages
      WHERE work_order_id = wo.id
      ORDER BY created_at DESC
      LIMIT 1
    ) pp ON TRUE
    ORDER BY wo.created_at DESC
    LIMIT 250
  `;

  const withQa = (rows as WorkOrderRow[]).map((row) => ({
    ...publicWorkOrder(row),
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
