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
    work_order_id?: number;
  };

  const { pipeline_item_id, tender_title, work_order_id } = body;

  if (!pipeline_item_id) {
    return NextResponse.json({ error: "pipeline_item_id is required" }, { status: 400 });
  }

  const priceId = process.env.STRIPE_BIDNOBID_PRICE_ID;
  if (!priceId) {
    return NextResponse.json({ error: "Bid/no-bid card checkout is not configured yet." }, { status: 503 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[api/analysis/bid-no-bid/checkout] STRIPE_SECRET_KEY is not configured");
    return NextResponse.json({ error: "Bid/no-bid card checkout is not configured yet." }, { status: 503 });
  }

  const stripe = getStripe();
  const origin = request.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      // {CHECKOUT_SESSION_ID} is a Stripe template variable, not a JS template literal
      success_url: `${origin}/dashboard/analysis/${pipeline_item_id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/pipeline`,
      metadata: {
        userId: String(user.id),
        plan: "bid-no-bid",
        service: "bid-no-bid",
        pipeline_item_id: String(pipeline_item_id),
        product: "bid-no-bid",
        tender_title: tender_title ?? "",
        tender: tender_title ?? "",
        work_order_id: work_order_id ? String(work_order_id) : "",
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe checkout error";
    console.error("[api/analysis/bid-no-bid/checkout]", message);
    return NextResponse.json(
      { error: `Could not start bid/no-bid checkout: ${message}` },
      { status: 500 }
    );
  }
}
