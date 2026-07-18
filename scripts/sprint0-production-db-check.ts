import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const expectedTables = [
  "vault_upload_receipts",
  "customer_access_grants",
  "customer_access_events",
  "private_blob_migrations",
] as const;

const expectedColumns = [
  ["vault_documents", "storage_access"],
  ["vault_documents", "blob_pathname"],
  ["proposal_packages", "artifact_access"],
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const sql = neon(databaseUrl);
  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables as unknown as string[]})
    ORDER BY table_name
  ` as unknown as Array<{ table_name: string }>;
  const columns = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'vault_documents' AND column_name IN ('storage_access', 'blob_pathname'))
        OR (table_name = 'proposal_packages' AND column_name = 'artifact_access')
      )
    ORDER BY table_name, column_name
  ` as unknown as Array<{ table_name: string; column_name: string }>;

  const foundTables = new Set(tables.map((row) => row.table_name));
  const foundColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const missingTables = expectedTables.filter((table) => !foundTables.has(table));
  const missingColumns = expectedColumns
    .map(([table, column]) => `${table}.${column}`)
    .filter((column) => !foundColumns.has(column));

  if (missingTables.length || missingColumns.length) {
    console.error(JSON.stringify({ ok: false, missingTables, missingColumns }));
    process.exitCode = 1;
    return;
  }

  const [legacyVault] = await sql`
    SELECT COUNT(*)::int AS count
    FROM vault_documents
    WHERE file_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  ` as unknown as Array<{ count: number }>;
  const [legacyArtifacts] = await sql`
    SELECT COUNT(*)::int AS count
    FROM proposal_packages
    WHERE pdf_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  ` as unknown as Array<{ count: number }>;
  const [legacyPaymentProofs] = await sql`
    SELECT COUNT(*)::int AS count
    FROM work_orders
    WHERE payment_proof_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  ` as unknown as Array<{ count: number }>;
  const [activeGrants] = await sql`
    SELECT COUNT(*)::int AS count
    FROM customer_access_grants
    WHERE revoked_at IS NULL AND expires_at > NOW()
  ` as unknown as Array<{ count: number }>;

  console.log(JSON.stringify({
    ok: true,
    schema: { tables: expectedTables.length, columns: expectedColumns.length },
    legacyPublicObjects: {
      vault: legacyVault.count,
      artifacts: legacyArtifacts.count,
      paymentProofs: legacyPaymentProofs.count,
    },
    activeCustomerSupportGrants: activeGrants.count,
  }));
}

main().catch((error) => {
  console.error("[sprint0:production-db-check-failed]", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
