import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type PaymentConfig = {
  stripeSecretKey: boolean;
  stripeWebhookSecret: boolean;
  prices: Record<string, boolean>;
  resendApiKey: boolean;
  resendFromEmail: boolean;
  opsEmail: boolean;
};

function configured(key: string): boolean {
  const value = process.env[key]?.trim();
  return Boolean(value && value !== "\"\"" && value !== "''");
}

function paymentConfig(): PaymentConfig {
  return {
    stripeSecretKey: configured("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: configured("STRIPE_WEBHOOK_SECRET"),
    prices: {
      bidNoBid: configured("STRIPE_BIDNOBID_PRICE_ID"),
      tenderIntelligence: configured("STRIPE_PRICE_TENDER_INTELLIGENCE"),
      submissionPackage: configured("STRIPE_PRICE_SUBMISSION_PACKAGE"),
      strategicPartnership: configured("STRIPE_PRICE_STRATEGIC_PARTNERSHIP"),
    },
    resendApiKey: configured("RESEND_API_KEY"),
    resendFromEmail: configured("RESEND_FROM_EMAIL"),
    opsEmail: configured("WORK_ORDER_OPS_EMAIL") || configured("OPS_EMAIL"),
  };
}

function missingConfig(config: PaymentConfig): string[] {
  const missing: string[] = [];
  if (!config.stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
  if (!config.stripeWebhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!config.prices.bidNoBid) missing.push("STRIPE_BIDNOBID_PRICE_ID");
  if (!config.resendApiKey) missing.push("RESEND_API_KEY");
  if (!config.resendFromEmail) missing.push("RESEND_FROM_EMAIL");
  return missing;
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const config = paymentConfig();
  const missing = missingConfig(config);

  const [purchaseRows, workOrderRows, recentPurchases, recentWorkOrders] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session,
        COUNT(DISTINCT stripe_session_id) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS distinct_stripe_sessions
      FROM purchase_logs
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
        COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session
      FROM work_orders
    `,
    sql`
      SELECT id, plan, stripe_session_id, amount_cents, currency, created_at
      FROM purchase_logs
      ORDER BY created_at DESC
      LIMIT 5
    `,
    sql`
      SELECT id, plan, service_slug, status, payment_status, stripe_session_id, amount_cents, currency, updated_at
      FROM work_orders
      ORDER BY updated_at DESC
      LIMIT 5
    `,
  ]);

  const purchaseSummary = purchaseRows[0] ?? {};
  const duplicatePurchaseSessions = Number(purchaseSummary.with_stripe_session ?? 0)
    - Number(purchaseSummary.distinct_stripe_sessions ?? 0);

  return NextResponse.json({
    ok: missing.length === 0 && duplicatePurchaseSessions === 0,
    checkedAt: new Date().toISOString(),
    config,
    missing,
    purchaseLogs: {
      ...purchaseSummary,
      duplicate_stripe_sessions: duplicatePurchaseSessions,
      recent: recentPurchases,
    },
    workOrders: {
      ...(workOrderRows[0] ?? {}),
      recent: recentWorkOrders,
    },
  });
}
