import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getUserFromRequest } from "@/lib/auth";
import { track } from "@/lib/telemetry/funnel";
import { evaluateServiceFulfillmentGate } from "@/lib/service-fulfillment-gates";

const SLUG_TO_PRICE_ENV: Record<string, string> = {
  "bid-no-bid":              "STRIPE_BIDNOBID_PRICE_ID",
  "grants-tenders-matching": "STRIPE_PRICE_TENDER_INTELLIGENCE",
  "proposal-draft":          "STRIPE_PRICE_SUBMISSION_PACKAGE",
  "roster-fast-track":       "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
  "founding-member":         "STRIPE_PRICE_FOUNDING_MEMBER",
};

const SUBSCRIPTION_PLANS = new Set(["grants-tenders-matching", "founding-member"]);

function metadataValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 500);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    plan?: string;
    tender?: string | null;
    agency?: string | null;
    pipeline_item_id?: string | number | null;
    work_order_id?: string | number | null;
  };
  const { plan } = body;

  if (!plan) {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }

  const priceEnvKey = SLUG_TO_PRICE_ENV[plan];
  if (!priceEnvKey) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
  }

  const priceId = process.env[priceEnvKey];
  if (!priceId) {
    return NextResponse.json(
      { error: "Card payments for this plan are not yet configured. Please use USDT or wire transfer." },
      { status: 503 }
    );
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[api/pay/checkout] STRIPE_SECRET_KEY is not configured");
    return NextResponse.json(
      { error: "Card payments are not configured yet. Please use USDT or wire transfer." },
      { status: 503 }
    );
  }

  try {
    const stripe = getStripe();
    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    const tender = metadataValue(body.tender);
    const agency = metadataValue(body.agency);
    const pipelineItemId = metadataValue(String(body.pipeline_item_id ?? ""));
    const workOrderId = metadataValue(String(body.work_order_id ?? ""));
    const parsedWorkOrderId = workOrderId && /^\d+$/.test(workOrderId) ? Number(workOrderId) : null;

    const gate = await evaluateServiceFulfillmentGate({
      plan,
      workOrderId: parsedWorkOrderId,
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

    const returnParams = new URLSearchParams({ plan });
    if (tender) returnParams.set("tender", tender);
    if (agency) returnParams.set("agency", agency);
    if (pipelineItemId) returnParams.set("pipeline_item_id", pipelineItemId);
    if (workOrderId) returnParams.set("work_order_id", workOrderId);

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded_page",
      mode: SUBSCRIPTION_PLANS.has(plan) ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      return_url: `${origin}/pay/success?${returnParams.toString()}`,
      metadata: {
        plan,
        tender,
        agency,
        pipeline_item_id: pipelineItemId,
        work_order_id: workOrderId,
        ...gate.metadata,
      },
    });

    const user = await getUserFromRequest(request);
    await track(
      "paid_intent_clicked",
      {
        plan,
        is_subscription: SUBSCRIPTION_PLANS.has(plan),
        work_order_id: workOrderId || null,
        pipeline_item_id: pipelineItemId || null,
        stripe_session_id: session.id,
        fulfillment_mode: gate.mode,
        readiness_code: gate.code,
        readiness_score: gate.score_0_10,
      },
      { userId: user?.id ?? null },
    );

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown checkout error";
    console.error("[api/pay/checkout]", message);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${message}` },
      { status: 500 }
    );
  }
}
