import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { ensureWorkOrderServiceContext } from "@/lib/service-context";
import { generateProposalPackage } from "@/lib/proposal-package/generate-proposal";
import { generateRosterFastTrack } from "@/lib/proposal-package/generate-roster";
import { PROPOSAL_PLAN, ROSTER_PLAN } from "@/lib/proposal-package/types";
import {
  evaluateServiceFulfillmentGate,
  markWorkOrderForFulfillmentGate,
} from "@/lib/service-fulfillment-gates";

export const runtime = "nodejs";
export const maxDuration = 300;

type WorkOrderForGeneration = {
  id: number;
  plan: string;
  service_slug: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
};

async function latestPackage(userId: number, workOrderId: number) {
  const rows = await sql`
    SELECT *
    FROM proposal_packages
    WHERE user_id = ${userId}
      AND work_order_id = ${workOrderId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function planFor(order: WorkOrderForGeneration): string {
  return order.plan || order.service_slug || "";
}

function isProposalPlan(plan: string): boolean {
  return plan === PROPOSAL_PLAN || plan.includes("proposal");
}

function isRosterPlan(plan: string): boolean {
  return plan === ROSTER_PLAN || plan.includes("roster") || plan.includes("lta");
}

/** GET - fetch existing proposal or roster package for a work order. */
export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const url = new URL(request.url);
  const workOrderId = Number(url.searchParams.get("work_order_id"));

  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  }

  const pkg = await latestPackage(user.id, workOrderId);
  if (!pkg) return NextResponse.json({ exists: false }, { status: 404 });
  return NextResponse.json({ exists: true, package: pkg });
}

async function loadWorkOrderForUser(userId: number, email: string | null, workOrderId: number): Promise<WorkOrderForGeneration | null> {
  const rows = await sql`
    SELECT id, plan, service_slug, payment_status, stripe_session_id
    FROM work_orders
    WHERE id = ${workOrderId}
      AND (user_id = ${userId} OR email = ${email})
    LIMIT 1
  ` as unknown as WorkOrderForGeneration[];
  return rows[0] ?? null;
}

async function ensurePaid(order: WorkOrderForGeneration, stripeSessionId: string | undefined): Promise<Response | null> {
  if (order.payment_status === "paid") return null;

  const sessionId = stripeSessionId || order.stripe_session_id || "";
  if (!sessionId) {
    return NextResponse.json({ error: "Payment required", code: "PAYMENT_REQUIRED" }, { status: 402 });
  }

  const stripe = getStripe();
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe session" }, { status: 400 });
  }

  if (session.payment_status !== "paid") {
    return NextResponse.json({ error: "Payment not completed" }, { status: 402 });
  }

  await sql`
    UPDATE work_orders
    SET payment_status = 'paid',
        stripe_session_id = ${sessionId},
        stripe_customer_id = ${typeof session.customer === "string" ? session.customer : null},
        amount_cents = ${session.amount_total ?? null},
        currency = ${session.currency ?? "usd"},
        updated_at = NOW()
    WHERE id = ${order.id}
  `;
  order.payment_status = "paid";
  order.stripe_session_id = sessionId;
  return null;
}

/** POST - verify payment and delegate to the production fulfillment pipeline. */
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json().catch(() => ({})) as {
    work_order_id?: number;
    stripe_session_id?: string;
    force?: boolean;
  };

  const workOrderId = Number(body.work_order_id);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  }

  const order = await loadWorkOrderForUser(user.id, user.email, workOrderId);
  if (!order) {
    return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  }

  const plan = planFor(order);
  if (!isProposalPlan(plan) && !isRosterPlan(plan)) {
    return NextResponse.json({ error: "This work order is not a proposal or roster service." }, { status: 400 });
  }

  const paymentError = await ensurePaid(order, body.stripe_session_id);
  if (paymentError) return paymentError;

  await ensureWorkOrderServiceContext(order.id, user.id);
  const gate = await evaluateServiceFulfillmentGate({
    plan,
    workOrderId: order.id,
    ensureContext: false,
  });
  if (!gate.auto_fulfill_allowed) {
    await markWorkOrderForFulfillmentGate(order.id, gate);
    return NextResponse.json(
      {
        error: gate.message,
        code: gate.code,
        missing_inputs: gate.missing_inputs,
        readiness: gate,
      },
      { status: gate.payment_allowed ? 409 : 402 },
    );
  }

  const result = isProposalPlan(plan)
    ? await generateProposalPackage({ workOrderId: order.id, force: Boolean(body.force), silent: true })
    : await generateRosterFastTrack({ workOrderId: order.id, force: Boolean(body.force), silent: true });

  const pkg = await latestPackage(user.id, order.id);
  if (!pkg) {
    const skipped = result.skippedReason ? ` (${result.skippedReason})` : "";
    return NextResponse.json(
      { error: result.error ?? `Package generation did not produce an artifact${skipped}.` },
      { status: result.skippedReason === "not_paid" ? 402 : 500 },
    );
  }

  return NextResponse.json({ package: pkg });
}
