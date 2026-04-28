import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

// Maps frontend plan slugs to Stripe price env var names
const SLUG_TO_PRICE_ENV: Record<string, string> = {
  "bid-no-bid":              "STRIPE_BIDNOBID_PRICE_ID",
  "grants-tenders-matching": "STRIPE_PRICE_TENDER_INTELLIGENCE",
  "proposal-draft":          "STRIPE_PRICE_SUBMISSION_PACKAGE",
  "roster-fast-track":       "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
};

// These plans are recurring subscriptions; the rest are one-time payments
const SUBSCRIPTION_PLANS = new Set(["grants-tenders-matching"]);

function metadataValue(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 500);
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    plan?: string;
    email?: string;
    tender?: string | null;
    agency?: string | null;
    pipeline_item_id?: string | number | null;
    work_order_id?: string | number | null;
  };
  const { plan, email } = body;

  if (!plan || !email) {
    return NextResponse.json({ error: "plan and email are required" }, { status: 400 });
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
    const contextParams = new URLSearchParams({ plan });
    const tender = metadataValue(body.tender);
    const agency = metadataValue(body.agency);
    const pipelineItemId = metadataValue(String(body.pipeline_item_id ?? ""));
    const workOrderId = metadataValue(String(body.work_order_id ?? ""));
    if (tender) contextParams.set("tender", tender);
    if (agency) contextParams.set("agency", agency);
    if (pipelineItemId) contextParams.set("pipeline_item_id", pipelineItemId);
    if (workOrderId) contextParams.set("work_order_id", workOrderId);

    const session = await stripe.checkout.sessions.create({
      mode: SUBSCRIPTION_PLANS.has(plan) ? "subscription" : "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pay/success?${contextParams.toString()}`,
      cancel_url:  `${origin}/pay?${contextParams.toString()}`,
      metadata: {
        plan,
        email,
        tender,
        agency,
        pipeline_item_id: pipelineItemId,
        work_order_id: workOrderId,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown checkout error";
    console.error("[api/pay/checkout]", message);
    return NextResponse.json(
      { error: `Failed to create checkout session: ${message}` },
      { status: 500 }
    );
  }
}
