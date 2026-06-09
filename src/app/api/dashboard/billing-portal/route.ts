/* POST /api/dashboard/billing-portal — open the Stripe customer billing portal.
 *
 * The secure, PCI-correct way to let a user manage their payment method, view
 * invoices, and cancel/change their subscription — we never handle card data
 * ourselves. Returns { url } to redirect to. 400s honestly when the user has no
 * Stripe customer yet (they've never subscribed/paid). */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const userId = guard.user!.id;

  const rows = await sql`SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1`;
  const customer = rows[0]?.stripe_customer_id as string | null | undefined;
  if (!customer) {
    return NextResponse.json(
      { error: "no_customer", message: "No billing account yet — it's created when you subscribe or buy a submission." },
      { status: 400 },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer,
      return_url: `${origin}/dashboard/account`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[workbench:billing_portal:create_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "portal_failed", message: "Couldn't open the billing portal. Please try again." }, { status: 502 });
  }
}
