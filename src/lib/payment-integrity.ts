import { sql } from "@/lib/db";

let ensurePromise: Promise<void> | null = null;

export async function ensurePaymentIntegritySchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS usdt_txid TEXT`;
      await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT`;
      await sql`ALTER TABLE work_orders ALTER COLUMN payment_status SET DEFAULT 'pending'`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS work_orders_usdt_txid_unique
        ON work_orders (usdt_txid)
        WHERE usdt_txid IS NOT NULL AND usdt_txid <> ''
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS purchase_logs_stripe_session_id_unique
        ON purchase_logs (stripe_session_id)
        WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> ''
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS bid_analyses_stripe_session_id_unique
        ON bid_analyses (stripe_session_id)
        WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> ''
      `;
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}
