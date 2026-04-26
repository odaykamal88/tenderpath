import type Stripe from "stripe";
import { sql } from "@/lib/db";

export const WORK_ORDER_PLANS = new Set(["proposal-draft", "roster-fast-track"]);

export function isWorkOrderPlan(plan: string | null | undefined): boolean {
  return !!plan && WORK_ORDER_PLANS.has(plan);
}

function cleanMeta(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

export async function createWorkOrderFromCheckout(
  session: Stripe.Checkout.Session,
  userId: number,
): Promise<void> {
  const plan = cleanMeta(session.metadata?.plan);
  if (!isWorkOrderPlan(plan)) return;

  const pipelineItemIdRaw = cleanMeta(session.metadata?.pipeline_item_id);
  const pipelineItemId = pipelineItemIdRaw && /^\d+$/.test(pipelineItemIdRaw)
    ? Number(pipelineItemIdRaw)
    : null;

  await sql`
    INSERT INTO work_orders (
      user_id, plan, status, payment_status,
      stripe_session_id, stripe_customer_id,
      amount_cents, currency, email,
      pipeline_item_id, tender_title, agency
    ) VALUES (
      ${userId}, ${plan}, 'new', ${session.payment_status ?? 'paid'},
      ${session.id}, ${typeof session.customer === "string" ? session.customer : null},
      ${session.amount_total ?? null}, ${session.currency ?? 'usd'},
      ${session.customer_email ?? session.customer_details?.email ?? null},
      ${pipelineItemId}, ${cleanMeta(session.metadata?.tender)}, ${cleanMeta(session.metadata?.agency)}
    )
    ON CONFLICT (stripe_session_id) DO UPDATE SET
      payment_status = EXCLUDED.payment_status,
      amount_cents = COALESCE(EXCLUDED.amount_cents, work_orders.amount_cents),
      currency = COALESCE(EXCLUDED.currency, work_orders.currency),
      email = COALESCE(EXCLUDED.email, work_orders.email),
      pipeline_item_id = COALESCE(EXCLUDED.pipeline_item_id, work_orders.pipeline_item_id),
      tender_title = COALESCE(EXCLUDED.tender_title, work_orders.tender_title),
      agency = COALESCE(EXCLUDED.agency, work_orders.agency),
      updated_at = NOW()
  `;
}
