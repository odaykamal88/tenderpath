import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";

export const runtime = "nodejs";

function configured(key: string): boolean {
  const value = process.env[key]?.trim();
  return Boolean(value && value !== '""' && value !== "''");
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  await ensureCustomerPrivacySchema();

  const [proofRows, vaultRows, artifactRows, migrationRows, accessRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*) FILTER (WHERE payment_proof_url IS NOT NULL)::int AS total,
        COUNT(*) FILTER (
          WHERE payment_proof_url LIKE 'https://%.private.blob.vercel-storage.com/%'
        )::int AS private,
        COUNT(*) FILTER (
          WHERE payment_proof_url LIKE 'https://%.public.blob.vercel-storage.com/%'
        )::int AS legacy_public,
        COUNT(*) FILTER (WHERE payment_proof_url LIKE 'data:%')::int AS inline,
        COUNT(*) FILTER (
          WHERE payment_proof_url IS NOT NULL
            AND payment_proof_url NOT LIKE 'https://%.private.blob.vercel-storage.com/%'
            AND payment_proof_url NOT LIKE 'https://%.public.blob.vercel-storage.com/%'
            AND payment_proof_url NOT LIKE 'data:%'
        )::int AS unsupported
      FROM work_orders
    `,
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE file_url LIKE 'https://%.private.blob.vercel-storage.com/%'
        )::int AS private,
        COUNT(*) FILTER (
          WHERE file_url LIKE 'https://%.public.blob.vercel-storage.com/%'
        )::int AS legacy_public,
        COUNT(*) FILTER (WHERE file_url LIKE 'data:%')::int AS inline,
        COUNT(*) FILTER (WHERE file_url LIKE 'tenderpath://%')::int AS synthetic,
        COUNT(*) FILTER (
          WHERE file_url NOT LIKE 'https://%.private.blob.vercel-storage.com/%'
            AND file_url NOT LIKE 'https://%.public.blob.vercel-storage.com/%'
            AND file_url NOT LIKE 'data:%'
            AND file_url NOT LIKE 'tenderpath://%'
        )::int AS unsupported
      FROM vault_documents
    `,
    sql`
      SELECT
        COUNT(*) FILTER (WHERE pdf_url IS NOT NULL)::int AS total,
        COUNT(*) FILTER (
          WHERE pdf_url LIKE 'https://%.private.blob.vercel-storage.com/%'
        )::int AS private,
        COUNT(*) FILTER (
          WHERE pdf_url LIKE 'https://%.public.blob.vercel-storage.com/%'
        )::int AS legacy_public,
        COUNT(*) FILTER (
          WHERE pdf_url IS NOT NULL
            AND pdf_url NOT LIKE 'https://%.private.blob.vercel-storage.com/%'
            AND pdf_url NOT LIKE 'https://%.public.blob.vercel-storage.com/%'
        )::int AS unsupported
      FROM proposal_packages
    `,
    sql`
      SELECT
        COUNT(*)::int AS copied,
        COUNT(*) FILTER (WHERE source_deleted_at IS NULL)::int AS source_deletion_pending,
        MAX(migrated_at) AS latest_migration_at
      FROM private_blob_migrations
    `,
    sql`
      SELECT
        COUNT(*) FILTER (
          WHERE revoked_at IS NULL AND expires_at > NOW()
        )::int AS active_grants,
        (
          SELECT COUNT(*)::int
          FROM customer_access_events
          WHERE event_type = 'access_denied'
            AND occurred_at > NOW() - INTERVAL '24 hours'
        ) AS denied_last_24h
      FROM customer_access_grants
    `,
  ]);

  const privateTokenConfigured = configured("BLOB_READ_WRITE_TOKEN");
  const vault = vaultRows[0] ?? {};
  const artifacts = artifactRows[0] ?? {};
  const paymentProofs = proofRows[0] ?? {};
  const migration = migrationRows[0] ?? {};
  const access = accessRows[0] ?? {};
  const legacyObjects = Number(vault.legacy_public ?? 0)
    + Number(artifacts.legacy_public ?? 0)
    + Number(paymentProofs.legacy_public ?? 0);
  const unsupportedObjects = Number(vault.unsupported ?? 0)
    + Number(artifacts.unsupported ?? 0)
    + Number(paymentProofs.unsupported ?? 0);
  const sourceDeletionPending = Number(migration.source_deletion_pending ?? 0);
  const status = !privateTokenConfigured || legacyObjects > 0 || unsupportedObjects > 0
    ? "migration_required"
    : sourceDeletionPending > 0
      ? "source_deletion_required"
      : "ok";

  return NextResponse.json({
    status,
    checkedAt: new Date().toISOString(),
    config: {
      privateBlobToken: privateTokenConfigured,
      legacyPublicBlobToken: configured("LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN"),
    },
    vault,
    artifacts,
    paymentProofs,
    migration,
    access,
  });
}
