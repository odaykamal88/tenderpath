import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const user = guard.user!;

  const body = await request.json() as {
    pipeline_item_id?: number;
    tender_title?: string;
  };

  const { pipeline_item_id, tender_title } = body;

  if (!pipeline_item_id) {
    return NextResponse.json({ error: "pipeline_item_id is required" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_BIDNOBID_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "STRIPE_BIDNOBID_PRICE_ID is not configured" }, { status: 500 });
  }

  const stripe = getStripe();
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    // {CHECKOUT_SESSION_ID} is a Stripe template variable, not a JS template literal
    success_url: `${origin}/dashboard/analysis/${pipeline_item_id}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/pipeline`,
    metadata: {
      userId: String(user.id),
      pipeline_item_id: String(pipeline_item_id),
      product: "bid-no-bid",
      tender_title: tender_title ?? "",
    },
  });

  return NextResponse.json({ url: session.url });
}
