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

export async function POST(request: Request) {
  const body = (await request.json()) as { plan?: string; email?: string };
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

  try {
    const stripe = getStripe();
    const origin =
      request.headers.get("origin") ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: SUBSCRIPTION_PLANS.has(plan) ? "subscription" : "payment",
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/pay/success?plan=${plan}`,
      cancel_url:  `${origin}/pay?plan=${plan}`,
      metadata: { plan, email },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[api/pay/checkout]", err);
    return NextResponse.json(
      { error: "Failed to create checkout session. Please try again." },
      { status: 500 }
    );
  }
}
