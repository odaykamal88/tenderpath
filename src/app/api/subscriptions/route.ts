import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { getStripe } from "@/lib/stripe";

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;

  return NextResponse.json({
    tier: user.tier,
    status: user.subscription_status,
    expires_at: user.subscription_expires_at,
  });
}

/**
 * Create a Stripe Checkout session for a given tier.
 */
export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const user = guard.user!;
  const body = await request.json();
  const { tier } = body;

  const validTiers = ["tender-intelligence", "submission-package", "strategic-partnership"];
  if (!tier || !validTiers.includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const priceEnvMap: Record<string, string> = {
    "tender-intelligence": "STRIPE_PRICE_TENDER_INTELLIGENCE",
    "submission-package": "STRIPE_PRICE_SUBMISSION_PACKAGE",
    "strategic-partnership": "STRIPE_PRICE_STRATEGIC_PARTNERSHIP",
  };

  const priceId = process.env[priceEnvMap[tier]];
  if (!priceId) {
    return NextResponse.json({ error: "Price not configured" }, { status: 500 });
  }

  const stripe = getStripe();
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=canceled`,
    metadata: { userId: String(user.id), tier },
  });

  return NextResponse.json({ url: session.url });
}
