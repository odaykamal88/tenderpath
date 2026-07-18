import { sql } from "@/lib/db";

let ensurePromise: Promise<void> | null = null;

/**
 * Runtime self-heal for the Sprint 0 confidentiality boundary.
 *
 * Keep this in lockstep with scripts/migrate.mjs. Vercel deploys do not run
 * migrations automatically, so the first privacy-sensitive request must be
 * able to land safely against the previous schema.
 */
export async function ensureCustomerPrivacySchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        ALTER TABLE vault_documents
        ADD COLUMN IF NOT EXISTS storage_access TEXT NOT NULL DEFAULT 'legacy_public'
      `;
      await sql`
        ALTER TABLE vault_documents
        ADD COLUMN IF NOT EXISTS blob_pathname TEXT
      `;
      await sql`
        ALTER TABLE proposal_packages
        ADD COLUMN IF NOT EXISTS artifact_access TEXT NOT NULL DEFAULT 'legacy_public'
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS vault_upload_receipts (
          id BIGSERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          blob_url TEXT NOT NULL UNIQUE,
          blob_pathname TEXT NOT NULL,
          content_type TEXT,
          claimed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS vault_upload_receipts_owner_idx
        ON vault_upload_receipts (user_id, created_at DESC)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS customer_access_grants (
          id BIGSERIAL PRIMARY KEY,
          owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          purpose TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS customer_access_grants_active_idx
        ON customer_access_grants (owner_user_id, work_order_id, expires_at DESC)
        WHERE revoked_at IS NULL
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS customer_access_events (
          id BIGSERIAL PRIMARY KEY,
          owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
          actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          purpose TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS customer_access_events_owner_idx
        ON customer_access_events (owner_user_id, occurred_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS customer_access_events_work_order_idx
        ON customer_access_events (work_order_id, occurred_at DESC)
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS private_blob_migrations (
          id BIGSERIAL PRIMARY KEY,
          object_kind TEXT NOT NULL,
          source_row_id INTEGER NOT NULL,
          source_url TEXT NOT NULL UNIQUE,
          destination_url TEXT NOT NULL,
          destination_pathname TEXT NOT NULL,
          migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source_deleted_at TIMESTAMPTZ
        )
      `;
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }

  return ensurePromise;
}
