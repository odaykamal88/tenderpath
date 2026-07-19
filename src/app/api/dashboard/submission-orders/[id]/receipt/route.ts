/* Printable receipt for a submission order (SPEC §9: every order exposes a
 * Receipt download in the drawer header — vendors expense these). Serves a
 * clean printable HTML page (browser print → PDF) and links the Stripe-hosted
 * card receipt when one can be resolved. $0 free-credit orders get the same
 * receipt with the credit line spelled out. */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getOrderForUser } from "@/lib/submissions/store";
import { flowFor } from "@/lib/submissions/flows";

export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const { id: idRaw } = await ctx.params;
  if (!/^\d+$/.test(idRaw)) return NextResponse.json({ error: "Bad order id." }, { status: 400 });

  try {
    const order = await getOrderForUser(guard.user!.id, Number(idRaw));
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (!order.paidAt) return NextResponse.json({ error: "This order has no payment yet." }, { status: 409 });

    // Best-effort Stripe-hosted receipt link via the billing work order.
    let stripeReceiptUrl: string | null = null;
    let sessionId: string | null = null;
    if (order.workOrderId) {
      try {
        const rows = await sql`
          SELECT stripe_session_id
          FROM work_orders
          WHERE id = ${order.workOrderId} AND user_id = ${guard.user!.id}
          LIMIT 1
        `;
        sessionId = (rows[0]?.stripe_session_id as string | null) ?? null;
        if (sessionId && !sessionId.startsWith("free-submission:") && process.env.STRIPE_SECRET_KEY) {
          const stripe = getStripe();
          const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ["payment_intent.latest_charge"],
          });
          const pi = session.payment_intent;
          if (pi && typeof pi !== "string") {
            const charge = pi.latest_charge;
            if (charge && typeof charge !== "string" && charge.receipt_url) {
              stripeReceiptUrl = charge.receipt_url;
            }
          }
        }
      } catch (err) {
        console.warn("[tp:submissions:receipt_stripe_lookup_failed]", {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const flow = flowFor(order.type);
    const isFree = order.priceCents === 0 || Boolean(sessionId?.startsWith("free-submission:"));
    const amount = isFree ? "USD 0.00 — first-submission credit applied" : `${order.currency.toUpperCase()} ${(order.priceCents / 100).toFixed(2)}`;
    const paidDate = new Date(order.paidAt).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>Receipt · ${esc(order.ref)}</title>
<style>
  body{font-family:Georgia,serif;color:#0f1620;background:#fff;max-width:640px;margin:40px auto;padding:0 24px;}
  .mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9c6b1f;}
  h1{font-weight:400;font-size:30px;margin:6px 0 2px;}
  table{width:100%;border-collapse:collapse;margin:26px 0;font-size:14px;font-family:system-ui,sans-serif;}
  td{padding:10px 0;border-bottom:1px solid #e4ddcb;vertical-align:top;}
  td:first-child{font-family:ui-monospace,Menlo,monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b6557;width:200px;}
  .total td{border-bottom:2px solid #0f1620;font-weight:600;}
  .foot{font-family:system-ui,sans-serif;font-size:12px;color:#6b6557;margin-top:30px;line-height:1.6;}
  a{color:#9c6b1f;}
  @media print{body{margin:0 auto;} .noprint{display:none;}}
</style></head><body>
  <div class="mono">TenderPath · Receipt</div>
  <h1>Submission order ${esc(order.ref)}</h1>
  <table>
    <tr><td>Service</td><td>${esc(order.type)} — ${esc(flow.name)} · drafting, compliance QA, agreed review rounds, final pack</td></tr>
    <tr><td>Opportunity</td><td>${esc(order.tender)}${order.agency ? ` · ${esc(order.agency)}` : ""}</td></tr>
    <tr><td>Order placed</td><td>${esc(paidDate)}</td></tr>
    <tr><td>Payment</td><td>${stripeReceiptUrl ? "Card (Stripe)" : isFree ? "First-submission credit" : "Recorded on your TenderPath account"}</td></tr>
    <tr class="total"><td>Amount paid</td><td>${esc(amount)}</td></tr>
  </table>
  ${stripeReceiptUrl ? `<p class="foot noprint">Card statement receipt: <a href="${esc(stripeReceiptUrl)}" rel="noopener noreferrer">Stripe receipt →</a></p>` : ""}
  <p class="foot">Guarantee: draft late, or rejected for a compliance error we made — full refund, no questions.<br/>
  TenderPath · tenderpath.me · info@tenderpath.me</p>
  <p class="foot noprint"><a href="javascript:window.print()">Print / save as PDF</a></p>
</body></html>`;

    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("[tp:submissions:receipt_failed]", {
      orderId: idRaw,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not build the receipt." }, { status: 500 });
  }
}
