import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { isComingSoonTier } from "@/lib/pricing";
import { getStripe } from "@/lib/stripe";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";
import { assertTenderDeadlineIsLive } from "@/lib/tender-deadline-guard";

const PLAN_CONFIG: Record<string, { priceEnv: string; label: string }> = {
  "proposal-draft": {
    priceEnv: "STRIPE_PRICE_SUBMISSION_PACKAGE",
    label: "Proposal Package",
  },
  "roster-fast-track": {
    priceEnv: "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
    label: "Roster / LTA Package",
  },
};

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as {
    plan?: string;
    work_order_id?: number;
    pipeline_item_id?: number;
    tender_title?: string;
    agency?: string;
  };

  const { plan, work_order_id, pipeline_item_id, tender_title, agency } = body;

  if (!plan || !PLAN_CONFIG[plan]) {
    return NextResponse.json({ error: "Invalid plan. Expected proposal-draft or roster-fast-track." }, { status: 400 });
  }

  // Product-wide "coming soon" gate (e.g. Roster/LTA) — refuse to sell a
  // held-back tier even via direct API call.
  if (isComingSoonTier(plan)) {
    return NextResponse.json(
      { error: "This service is coming soon and isn't available for purchase yet.", code: "PLAN_COMING_SOON" },
      { status: 403 },
    );
  }

  if (!work_order_id) {
    return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  }

  // Block proposal-draft purchases when the underlying tender already closed
  // or is too close for a 48-72h delivery. Roster-fast-track has no
  // per-tender deadline so the guard returns null for it.
  if (plan === "proposal-draft") {
    const deadlineErr = await assertTenderDeadlineIsLive({
      pipelineItemId: pipeline_item_id ?? null,
      workOrderId: work_order_id,
      plan,
    });
    if (deadlineErr) {
      return NextResponse.json(
        { error: deadlineErr.message, code: deadlineErr.code, deadline_iso: deadlineErr.deadline_iso },
        { status: 409 },
      );
    }
  }

  const gate = await evaluateServiceFulfillmentGate({
    plan,
    workOrderId: work_order_id,
  });
  if (!gate.payment_allowed) {
    return NextResponse.json(
      {
        error: gate.message,
        code: gate.code,
        missing_inputs: gate.missing_inputs,
        readiness: gate,
      },
      { status: 409 },
    );
  }

  const config = PLAN_CONFIG[plan];
  const priceId = process.env[config.priceEnv];
  if (!priceId) {
    return NextResponse.json(
      { error: `${config.label} checkout is not available yet. Email info@tenderpath.me to arrange early access.` },
      { status: 503 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[api/proposals/checkout] STRIPE_SECRET_KEY is not configured");
    return NextResponse.json({ error: "Checkout is not configured yet." }, { status: 503 });
  }

  const stripe = getStripe();
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard/proposals/${work_order_id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/services`,
      metadata: {
        userId: String(user.id),
        plan,
        service: plan,
        work_order_id: String(work_order_id),
        pipeline_item_id: pipeline_item_id ? String(pipeline_item_id) : "",
        tender_title: tender_title ?? "",
        agency: agency ?? "",
        ...gate.metadata,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe checkout error";
    console.error("[api/proposals/checkout]", message);
    return NextResponse.json(
      { error: `Could not start ${config.label} checkout: ${message}` },
      { status: 500 }
    );
  }
}
