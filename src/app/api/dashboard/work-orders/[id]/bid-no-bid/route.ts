import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { generateBidNoBid, BID_PLAN, MAX_ATTEMPTS } from "@/lib/bid-no-bid/generate";
import { withOwnerArtifactUrl } from "@/lib/proposal-package/public-artifact";
import { authenticatedArtifactUrl } from "@/lib/vault/storage";

export const runtime = "nodejs";
export const maxDuration = 120;

interface WorkOrderRow {
  id: number;
  user_id: number | null;
  email: string | null;
  payment_status: string | null;
  plan: string;
  service_slug: string | null;
}

interface PackageRow {
  id: number;
  output: unknown;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  created_at: string;
}

async function ensureOwnedWorkOrder(
  request: Request,
  rawId: string,
): Promise<
  | { ok: true; order: WorkOrderRow }
  | { ok: false; response: NextResponse }
> {
  const guard = await requireAuth(request);
  if (!guard.authorized) return { ok: false, response: guard.response! };

  const numericId = Number(rawId);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return { ok: false, response: NextResponse.json({ error: "Invalid work order id" }, { status: 400 }) };
  }

  const rows = await sql`
    SELECT id, user_id, email, payment_status, plan, service_slug
    FROM work_orders
    WHERE id = ${numericId}
      AND (
        user_id = ${guard.user!.id}
        OR (user_id IS NULL AND email IS NOT NULL AND LOWER(email) = LOWER(${guard.user!.email}))
      )
    LIMIT 1
  ` as unknown as Array<WorkOrderRow>;

  const order = rows[0];
  if (!order) {
    return { ok: false, response: NextResponse.json({ error: "Work order not found" }, { status: 404 }) };
  }
  if (order.plan !== BID_PLAN && order.service_slug !== BID_PLAN) {
    return { ok: false, response: NextResponse.json({ error: "Not a bid-no-bid work order" }, { status: 400 }) };
  }
  return { ok: true, order };
}

async function loadPackage(workOrderId: number): Promise<PackageRow | null> {
  const rows = await sql`
    SELECT id, output, pdf_url, generation_status, generation_attempts, error_message, created_at
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${BID_PLAN}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as Array<PackageRow>;
  return rows[0] ?? null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedWorkOrder(request, id);
  if (!result.ok) return result.response;

  const pkg = await loadPackage(result.order.id);
  if (!pkg) {
    return NextResponse.json({
      exists: false,
      payment_status: result.order.payment_status,
      max_attempts: MAX_ATTEMPTS,
    });
  }
  return NextResponse.json({
    exists: true,
    package: withOwnerArtifactUrl(pkg, result.order.id),
    payment_status: result.order.payment_status,
    max_attempts: MAX_ATTEMPTS,
    remaining_regenerations: Math.max(0, MAX_ATTEMPTS - (pkg.generation_attempts ?? 1)),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedWorkOrder(request, id);
  if (!result.ok) return result.response;

  if (result.order.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment not confirmed yet for this work order." },
      { status: 402 },
    );
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  const generation = await generateBidNoBid({
    workOrderId: result.order.id,
    force,
    silent: false,
  });

  if (!generation.ok) {
    if (generation.skippedReason === "max_attempts") {
      return NextResponse.json(
        { error: `You've used all ${MAX_ATTEMPTS} generation attempts on this work order. Reply to your bid-ready email if something is off.` },
        { status: 429 },
      );
    }
    if (generation.skippedReason === "not_paid") {
      return NextResponse.json({ error: "Payment not confirmed yet." }, { status: 402 });
    }
    return NextResponse.json(
      { error: generation.error ?? "Generation failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    skipped: generation.skippedReason ?? null,
    package_id: generation.packageId,
    pdf_url: generation.pdfUrl ? authenticatedArtifactUrl(result.order.id) : null,
    attempts: generation.attempts,
    remaining_regenerations: Math.max(0, MAX_ATTEMPTS - generation.attempts),
  });
}
