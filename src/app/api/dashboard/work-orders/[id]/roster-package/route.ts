import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { generateRosterFastTrack } from "@/lib/proposal-package/generate-roster";
import { ROSTER_PLAN, MAX_ATTEMPTS } from "@/lib/proposal-package/types";
import { AGENCY_PACKAGES, findAgencyPackage } from "@/lib/proposal-package/roster-packages";

export const runtime = "nodejs";
export const maxDuration = 300;

interface WorkOrderRow {
  id: number;
  user_id: number | null;
  email: string | null;
  status: string;
  payment_status: string | null;
  plan: string;
  service_slug: string | null;
  intake: Record<string, unknown> | null;
  agency: string | null;
}

interface PackageRow {
  id: number;
  output: unknown;
  pdf_url: string | null;
  generation_status: string | null;
  generation_attempts: number | null;
  error_message: string | null;
  agency: string | null;
  created_at: string;
}

async function ensureOwnedRosterOrder(
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
    SELECT id, user_id, email, status, payment_status, plan, service_slug, intake, agency
    FROM work_orders
    WHERE id = ${numericId} AND (user_id = ${guard.user!.id} OR email = ${guard.user!.email})
    LIMIT 1
  ` as unknown as Array<WorkOrderRow>;

  const order = rows[0];
  if (!order) {
    return { ok: false, response: NextResponse.json({ error: "Work order not found" }, { status: 404 }) };
  }
  if (order.plan !== ROSTER_PLAN && order.service_slug !== "lta-roster") {
    return { ok: false, response: NextResponse.json({ error: "Not a roster fast-track work order" }, { status: 400 }) };
  }
  return { ok: true, order };
}

async function loadPackage(workOrderId: number): Promise<PackageRow | null> {
  const rows = await sql`
    SELECT id, output, pdf_url, generation_status, generation_attempts, error_message, agency, created_at
    FROM proposal_packages
    WHERE work_order_id = ${workOrderId} AND plan = ${ROSTER_PLAN}
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
  const result = await ensureOwnedRosterOrder(request, id);
  if (!result.ok) return result.response;

  const pkg = await loadPackage(result.order.id);
  const intakeSlug = typeof result.order.intake?.agency_slug === "string" ? result.order.intake.agency_slug : null;
  const selectedAgency = findAgencyPackage(intakeSlug);

  return NextResponse.json({
    exists: !!pkg,
    package: pkg ?? null,
    payment_status: result.order.payment_status,
    work_order_status: result.order.status,
    max_attempts: MAX_ATTEMPTS,
    remaining_regenerations: pkg ? Math.max(0, MAX_ATTEMPTS - (pkg.generation_attempts ?? 1)) : MAX_ATTEMPTS,
    selected_agency: selectedAgency,
    available_agencies: AGENCY_PACKAGES.map((a) => ({
      slug: a.slug,
      label: a.label,
      why: a.why,
    })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedRosterOrder(request, id);
  if (!result.ok) return result.response;

  if (result.order.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not confirmed yet for this work order." }, { status: 402 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const body = await request.json().catch(() => ({})) as { agency_slug?: string };

  // If the user is choosing an agency now (no inferred match at payment time),
  // persist it on the intake JSONB before kicking off generation.
  if (body.agency_slug) {
    const agency = findAgencyPackage(body.agency_slug);
    if (!agency) {
      return NextResponse.json(
        { error: `Unknown agency. Choose one of: ${AGENCY_PACKAGES.map((a) => a.slug).join(", ")}` },
        { status: 400 },
      );
    }
    await sql`
      UPDATE work_orders SET
        intake = COALESCE(intake, '{}'::jsonb) || ${JSON.stringify({ agency_slug: agency.slug })}::jsonb,
        agency = COALESCE(agency, ${agency.label}),
        updated_at = NOW()
      WHERE id = ${result.order.id}
    `;
  }

  const generation = await generateRosterFastTrack({
    workOrderId: result.order.id,
    force,
    silent: false,
  });

  if (!generation.ok) {
    if (generation.skippedReason === "max_attempts") {
      return NextResponse.json(
        { error: `You've used all ${MAX_ATTEMPTS} generation attempts.` },
        { status: 429 },
      );
    }
    if (generation.skippedReason === "no_agency") {
      return NextResponse.json(
        { error: "Pick a target agency first.", available_agencies: AGENCY_PACKAGES.map((a) => ({ slug: a.slug, label: a.label })) },
        { status: 400 },
      );
    }
    if (generation.skippedReason === "not_paid") {
      return NextResponse.json({ error: "Payment not confirmed yet." }, { status: 402 });
    }
    return NextResponse.json({ error: generation.error ?? "Generation failed." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    skipped: generation.skippedReason ?? null,
    package_id: generation.packageId,
    zip_url: generation.zipUrl,
    agency: generation.agency ? { slug: generation.agency.slug, label: generation.agency.label } : null,
    attempts: generation.attempts,
    remaining_regenerations: Math.max(0, MAX_ATTEMPTS - generation.attempts),
  });
}

/**
 * Mark the work order as submitted by the user — moves status from
 * 'in_progress' (or 'new') to 'submitted'. This is the final founder-out-of-
 * the-loop milestone for roster fast-track.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await ensureOwnedRosterOrder(request, id);
  if (!result.ok) return result.response;

  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "mark_submitted") {
    return NextResponse.json({ error: "Unsupported action. Send { action: 'mark_submitted' }." }, { status: 400 });
  }

  await sql`
    UPDATE work_orders SET
      status = 'submitted',
      updated_at = NOW()
    WHERE id = ${result.order.id}
  `;

  return NextResponse.json({ ok: true, status: "submitted" });
}
