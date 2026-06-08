/* GET /api/dashboard/transactions — the viewer's billing history.
 *
 * Real records only: paid per-submission/service work orders + subscription
 * purchase logs, merged and sorted. Powers the Account → Billing tab (table +
 * CSV export). Detailed invoices/PDFs live in the Stripe billing portal
 * (see /api/dashboard/billing-portal) — we don't re-render Stripe invoices. */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAuth } from "@/lib/subscription-guard";

export interface WbTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  kind: "service" | "subscription";
}

function serviceLabel(slug: string | null, plan: string | null): string {
  switch (slug) {
    case "proposal-draft":
      return "Proposal submission";
    case "bid-no-bid":
      return "Bid / No-Bid analysis";
    case "roster-fast-track":
      return "Roster fast-track";
    default:
      return plan ?? "Service";
  }
}

export async function GET(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  const userId = guard.user!.id;

  try {
    const [orders, subs] = await Promise.all([
      sql`
        SELECT id, service_slug, plan, status, amount_cents, currency, tender_title, created_at
        FROM work_orders
        WHERE user_id = ${userId} AND payment_status = 'paid'
        ORDER BY created_at DESC
        LIMIT 100
      `,
      sql`
        SELECT id, plan, tier, amount_cents, currency, created_at
        FROM purchase_logs
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        LIMIT 100
      `,
    ]);

    const txns: WbTransaction[] = [];
    for (const o of orders) {
      const label = serviceLabel((o.service_slug as string | null) ?? null, (o.plan as string | null) ?? null);
      const title = o.tender_title as string | null;
      txns.push({
        id: `WO-${o.id}`,
        date: String(o.created_at),
        description: title ? `${label} — ${title}` : label,
        amount: o.amount_cents != null ? Number(o.amount_cents) / 100 : 0,
        currency: ((o.currency as string | null) ?? "usd").toUpperCase(),
        status: "paid",
        kind: "service",
      });
    }
    for (const s of subs) {
      txns.push({
        id: `SUB-${s.id}`,
        date: String(s.created_at),
        description: `TenderPath subscription — ${(s.tier as string | null) ?? (s.plan as string | null) ?? "plan"}`,
        amount: s.amount_cents != null ? Number(s.amount_cents) / 100 : 0,
        currency: ((s.currency as string | null) ?? "usd").toUpperCase(),
        status: "paid",
        kind: "subscription",
      });
    }
    txns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ transactions: txns });
  } catch (err) {
    console.error("[workbench:transactions:query_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ transactions: [] });
  }
}
