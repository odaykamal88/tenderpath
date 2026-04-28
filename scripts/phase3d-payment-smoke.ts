/**
 * Phase 3D payment readiness smoke.
 *
 * Usage:
 *   npx tsx scripts/phase3d-payment-smoke.ts
 *
 * This is intentionally read-only. It reports whether local Stripe/Resend config
 * is present and whether recent payment/work-order records look retry-safe.
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
} catch {}

const REQUIRED_ENV = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BIDNOBID_PRICE_ID",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
];

function isSet(key: string): boolean {
  const value = process.env[key]?.trim();
  return Boolean(value && value !== "\"\"" && value !== "''");
}

async function main() {
  const missing = REQUIRED_ENV.filter((key) => !isSet(key));
  const purchaseRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session,
      COUNT(DISTINCT stripe_session_id) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS distinct_stripe_sessions
    FROM purchase_logs
  `;
  const workOrderRows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
      COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE stripe_session_id IS NOT NULL)::int AS with_stripe_session
    FROM work_orders
  `;
  const recentWorkOrders = await sql`
    SELECT id, plan, service_slug, status, payment_status, stripe_session_id, amount_cents, currency, updated_at
    FROM work_orders
    ORDER BY updated_at DESC
    LIMIT 5
  `;

  const purchaseSummary = purchaseRows[0] ?? {};
  const duplicateStripeSessions = Number(purchaseSummary.with_stripe_session ?? 0)
    - Number(purchaseSummary.distinct_stripe_sessions ?? 0);

  console.log(JSON.stringify({
    ok: missing.length === 0 && duplicateStripeSessions === 0,
    missing,
    config: Object.fromEntries(REQUIRED_ENV.map((key) => [key, isSet(key)])),
    purchaseLogs: {
      ...purchaseSummary,
      duplicate_stripe_sessions: duplicateStripeSessions,
    },
    workOrders: workOrderRows[0] ?? {},
    recentWorkOrders,
  }, null, 2));

  if (missing.length || duplicateStripeSessions > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[phase3d-payment-smoke] failed", err);
  process.exit(1);
});
