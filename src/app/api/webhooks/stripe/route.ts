import { NextResponse } from "next/server";
import { getStripe, tierFromPriceId } from "@/lib/stripe";
import { sql } from "@/lib/db";
import type Stripe from "stripe";
import { createWorkOrderFromCheckout } from "@/lib/work-orders";
import { notifyAdmin } from "@/lib/email/notifyAdmin";
import { track } from "@/lib/telemetry/funnel";

// Sprint 18. The webhook synchronously calls createWorkOrderFromCheckout
// which uses Next.js after() to kick off Bid/No-Bid generation. The
// after() continuation runs against the same function instance and the
// same maxDuration ceiling, so the default 10s budget would kill the
// generator mid-LLM-call on cold-start Stripe retries. 300s aligns with
// the dashboard generator routes and matches what we already grant
// proposals/generate.
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * FIX #1: Proper Stripe webhook with constructEvent verification.
 * Replaces broken client-side-only payment recording from Polsia build.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(invoice);
      break;
    }
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const email = session.customer_email ?? session.customer_details?.email;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  const isSubscriptionCheckout = session.mode === "subscription" && Boolean(subscriptionId);

  if (!email) {
    console.error("[tp:webhook:missing_email]", {
      sessionId: session.id,
      mode: session.mode,
      plan: session.metadata?.plan,
      amountTotal: session.amount_total,
    });
    notifyAdmin(
      "Payment received — no email on session",
      `Stripe session ${session.id} completed with no customer email.\nPlan: ${session.metadata?.plan ?? "unknown"}\nAmount: ${session.amount_total ?? 0} ${session.currency ?? ""}\nNo work order was created. Investigate in Stripe dashboard.`
    ).catch(() => {});
    return;
  }

  // Resolve tier from line items
  const stripe = getStripe();
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const priceId = lineItems.data[0]?.price?.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;
  const plan = session.metadata?.plan ?? tier ?? "unknown";

  const users = isSubscriptionCheckout
    ? await sql`
      INSERT INTO users (email, stripe_customer_id, stripe_subscription_id, tier, subscription_status)
      VALUES (${email}, ${customerId}, ${subscriptionId}, ${tier}, 'active')
      ON CONFLICT (email) DO UPDATE SET
        stripe_customer_id = COALESCE(${customerId}, users.stripe_customer_id),
        stripe_subscription_id = COALESCE(${subscriptionId}, users.stripe_subscription_id),
        tier = COALESCE(${tier}, users.tier),
        subscription_status = 'active',
        updated_at = NOW()
      RETURNING id
    `
    : await sql`
      INSERT INTO users (email, stripe_customer_id)
      VALUES (${email}, ${customerId})
      ON CONFLICT (email) DO UPDATE SET
        stripe_customer_id = COALESCE(${customerId}, users.stripe_customer_id),
        updated_at = NOW()
      RETURNING id
    `;

  const userId = users[0]?.id as number;

  // Stripe can retry webhook delivery. Keep purchase logging idempotent even
  // though older databases may not have a unique index on stripe_session_id.
  const existingPurchase = await sql`
    SELECT id FROM purchase_logs
    WHERE stripe_session_id = ${session.id}
    LIMIT 1
  `;

  if (!existingPurchase.length) {
    await sql`
      INSERT INTO purchase_logs (plan, stripe_session_id, stripe_customer_id, user_id, amount_cents, currency)
      VALUES (${plan}, ${session.id}, ${customerId}, ${userId}, ${session.amount_total ?? 0}, ${session.currency ?? 'usd'})
    `;
  }

  await createWorkOrderFromCheckout(session, userId);

  await track(
    "payment_succeeded",
    {
      plan,
      stripe_session_id: session.id,
      amount_cents: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      is_subscription: isSubscriptionCheckout,
      tier: tier ?? null,
    },
    { userId },
  );

  // Create subscription record
  if (isSubscriptionCheckout && tier) {
    await sql`
      INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status)
      VALUES (${userId}, ${tier}, ${customerId}, ${subscriptionId}, 'active')
      ON CONFLICT (user_id, tier) DO UPDATE SET
        stripe_customer_id = ${customerId},
        stripe_subscription_id = ${subscriptionId},
        status = 'active',
        updated_at = NOW()
    `;
  }
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;
  const status = sub.status === "active" ? "active"
    : sub.status === "trialing" ? "trialing"
    : sub.status === "past_due" ? "past_due"
    : "canceled";

  // Extract period end — property location varies by Stripe SDK version
  const rawPeriodEnd = (sub as unknown as Record<string, unknown>)["current_period_end"] as number | undefined;
  const periodEnd = rawPeriodEnd
    ? new Date(rawPeriodEnd * 1000).toISOString()
    : null;

  const priceId = sub.items.data[0]?.price?.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;

  await sql`
    UPDATE users SET
      subscription_status = ${status},
      tier = COALESCE(${tier}, tier),
      subscription_expires_at = ${periodEnd},
      updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
  `;

  await sql`
    UPDATE subscriptions SET
      status = ${status},
      current_period_end = ${periodEnd},
      updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
  `;
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = sub.customer as string;

  await sql`
    UPDATE users SET
      subscription_status = 'canceled',
      updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
  `;

  await sql`
    UPDATE subscriptions SET
      status = 'canceled',
      updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
  `;
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  await sql`
    UPDATE users SET
      subscription_status = 'past_due',
      updated_at = NOW()
    WHERE stripe_customer_id = ${customerId}
  `;
}
