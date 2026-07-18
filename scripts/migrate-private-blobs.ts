/**
 * Sprint 0 — migrate customer vault files and generated artifacts from the
 * legacy public Vercel Blob store into the dedicated private store.
 *
 * Safe by default: without --apply this only reports counts. Source objects
 * are never deleted unless --delete-source is also supplied after verification.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { del, put } from "@vercel/blob";

config({ path: ".env.local" });
config();

const apply = process.argv.includes("--apply");
const deleteSource = process.argv.includes("--delete-source");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "document";
}

async function download(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Legacy download failed (${response.status})`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
  };
}

async function main() {
  const databaseUrl = required("DATABASE_URL");
  const privateToken = apply ? required("BLOB_READ_WRITE_TOKEN") : "";
  const legacyToken = apply && deleteSource ? required("LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN") : null;
  const sql = neon(databaseUrl);

  const vaultRows = await sql`
    SELECT id, user_id, name, file_url
    FROM vault_documents
    WHERE file_url LIKE 'https://%.public.blob.vercel-storage.com/%'
    ORDER BY id
  ` as unknown as Array<{ id: number; user_id: number; name: string; file_url: string }>;
  const artifactRows = await sql`
    SELECT id, work_order_id, plan, pdf_url, pdf_pathname
    FROM proposal_packages
    WHERE pdf_url LIKE 'https://%.public.blob.vercel-storage.com/%'
    ORDER BY id
  ` as unknown as Array<{ id: number; work_order_id: number | null; plan: string; pdf_url: string; pdf_pathname: string | null }>;
  const paymentProofRows = await sql`
    SELECT id, user_id, payment_proof_url
    FROM work_orders
    WHERE payment_proof_url LIKE 'https://%.public.blob.vercel-storage.com/%'
    ORDER BY id
  ` as unknown as Array<{ id: number; user_id: number | null; payment_proof_url: string }>;
  if (!apply) {
    console.log(JSON.stringify({
      mode: "plan",
      deleteSource: false,
      vaultObjects: vaultRows.length,
      artifactObjects: artifactRows.length,
      paymentProofObjects: paymentProofRows.length,
    }));
    console.log("Re-run with --apply after verifying that BLOB_READ_WRITE_TOKEN belongs to a private store.");
    return;
  }

  await sql`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS storage_access TEXT NOT NULL DEFAULT 'legacy_public'`;
  await sql`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS blob_pathname TEXT`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS artifact_access TEXT NOT NULL DEFAULT 'legacy_public'`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;
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
  const pendingDeletionRows = await sql`
    SELECT id, source_url
    FROM private_blob_migrations
    WHERE source_deleted_at IS NULL
    ORDER BY id
  ` as unknown as Array<{ id: number; source_url: string }>;
  console.log(JSON.stringify({
    mode: "apply",
    deleteSource,
    vaultObjects: vaultRows.length,
    artifactObjects: artifactRows.length,
    paymentProofObjects: paymentProofRows.length,
    migratedSourcesPendingDeletion: pendingDeletionRows.length,
  }));

  let migratedVault = 0;
  let migratedArtifacts = 0;
  let migratedPaymentProofs = 0;
  for (const row of vaultRows) {
    const source = await download(row.file_url);
    const pathname = `migrated/vault/${row.user_id}/${row.id}-${safeName(row.name)}`;
    const uploaded = await put(pathname, source.bytes, {
      access: "private",
      token: privateToken,
      contentType: source.contentType,
      addRandomSuffix: true,
    });

    const updatedVault = await sql`
      UPDATE vault_documents
      SET file_url = ${uploaded.url}, storage_access = 'private', blob_pathname = ${uploaded.pathname}
      WHERE id = ${row.id} AND user_id = ${row.user_id} AND file_url = ${row.file_url}
      RETURNING id
    `;
    if (!updatedVault.length) {
      throw new Error(`Vault row ${row.id} changed during migration; source was not recorded for deletion`);
    }
    await sql`
      UPDATE document_extractions
      SET file_url = ${uploaded.url}, updated_at = NOW()
      WHERE user_id = ${row.user_id} AND file_url = ${row.file_url}
    `;
    const pattern = `%${row.file_url}%`;
    await sql`
      UPDATE work_orders
      SET intake = REPLACE(intake::text, ${row.file_url}, ${uploaded.url})::jsonb, updated_at = NOW()
      WHERE user_id = ${row.user_id} AND intake::text LIKE ${pattern}
    `;
    await sql`
      UPDATE proposal_packages
      SET intake = REPLACE(intake::text, ${row.file_url}, ${uploaded.url})::jsonb, updated_at = NOW()
      WHERE user_id = ${row.user_id} AND intake::text LIKE ${pattern}
    `;
    await sql`
      UPDATE submission_orders
      SET intake_fields = REPLACE(intake_fields::text, ${row.file_url}, ${uploaded.url})::jsonb, updated_at = NOW()
      WHERE user_id = ${row.user_id} AND intake_fields::text LIKE ${pattern}
    `;
    await sql`
      INSERT INTO private_blob_migrations (
        object_kind, source_row_id, source_url, destination_url, destination_pathname
      ) VALUES (
        'vault_document', ${row.id}, ${row.file_url}, ${uploaded.url}, ${uploaded.pathname}
      )
      ON CONFLICT (source_url) DO NOTHING
    `;
    migratedVault += 1;
    console.log(`[private-blob:migrated_vault] ${migratedVault}/${vaultRows.length} vault_document=${row.id}`);
  }

  for (const row of artifactRows) {
    const source = await download(row.pdf_url);
    const originalName = row.pdf_pathname?.split("/").pop() ?? `${row.plan}-${row.id}`;
    const pathname = `migrated/artifacts/${row.work_order_id ?? "unlinked"}/${row.id}-${safeName(originalName)}`;
    const uploaded = await put(pathname, source.bytes, {
      access: "private",
      token: privateToken,
      contentType: source.contentType,
      addRandomSuffix: true,
    });
    const updatedArtifact = await sql`
      UPDATE proposal_packages
      SET pdf_url = ${uploaded.url}, pdf_pathname = ${uploaded.pathname},
          artifact_access = 'private', updated_at = NOW()
      WHERE id = ${row.id} AND pdf_url = ${row.pdf_url}
      RETURNING id
    `;
    if (!updatedArtifact.length) {
      throw new Error(`Proposal artifact ${row.id} changed during migration; source was not recorded for deletion`);
    }
    await sql`
      INSERT INTO private_blob_migrations (
        object_kind, source_row_id, source_url, destination_url, destination_pathname
      ) VALUES (
        'proposal_artifact', ${row.id}, ${row.pdf_url}, ${uploaded.url}, ${uploaded.pathname}
      )
      ON CONFLICT (source_url) DO NOTHING
    `;
    migratedArtifacts += 1;
    console.log(`[private-blob:migrated_artifact] ${migratedArtifacts}/${artifactRows.length} proposal_package=${row.id}`);
  }

  for (const row of paymentProofRows) {
    const source = await download(row.payment_proof_url);
    const pathname = `migrated/payment-proofs/${row.user_id ?? "unassigned"}/${row.id}`;
    const uploaded = await put(pathname, source.bytes, {
      access: "private",
      token: privateToken,
      contentType: source.contentType,
      addRandomSuffix: true,
    });
    const updatedProof = await sql`
      UPDATE work_orders
      SET payment_proof_url = ${uploaded.url}, updated_at = NOW()
      WHERE id = ${row.id} AND payment_proof_url = ${row.payment_proof_url}
      RETURNING id
    `;
    if (!updatedProof.length) {
      throw new Error(`Payment proof ${row.id} changed during migration; source was not recorded for deletion`);
    }
    await sql`
      INSERT INTO private_blob_migrations (
        object_kind, source_row_id, source_url, destination_url, destination_pathname
      ) VALUES (
        'payment_proof', ${row.id}, ${row.payment_proof_url}, ${uploaded.url}, ${uploaded.pathname}
      )
      ON CONFLICT (source_url) DO NOTHING
    `;
    migratedPaymentProofs += 1;
    console.log(`[private-blob:migrated_payment_proof] ${migratedPaymentProofs}/${paymentProofRows.length} work_order=${row.id}`);
  }

  let deletedSources = 0;
  if (deleteSource && legacyToken) {
    const sources = await sql`
      SELECT id, source_url
      FROM private_blob_migrations
      WHERE source_deleted_at IS NULL
      ORDER BY id
    ` as unknown as Array<{ id: number; source_url: string }>;
    for (const source of sources) {
      if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(source.source_url)) {
        throw new Error(`Refusing to delete non-public-Blob migration source at ledger ${source.id}`);
      }
      await del(source.source_url, { token: legacyToken });
      await sql`
        UPDATE private_blob_migrations
        SET source_deleted_at = NOW()
        WHERE id = ${source.id} AND source_deleted_at IS NULL
      `;
      deletedSources += 1;
      console.log(`[private-blob:deleted_legacy_source] ${deletedSources}/${sources.length} ledger=${source.id}`);
    }
  }

  const remainingVault = await sql`
    SELECT COUNT(*)::int AS count FROM vault_documents
    WHERE file_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  `;
  const remainingArtifacts = await sql`
    SELECT COUNT(*)::int AS count FROM proposal_packages
    WHERE pdf_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  `;
  const remainingPaymentProofs = await sql`
    SELECT COUNT(*)::int AS count FROM work_orders
    WHERE payment_proof_url LIKE 'https://%.public.blob.vercel-storage.com/%'
  `;
  console.log(JSON.stringify({
    migratedVault,
    migratedArtifacts,
    migratedPaymentProofs,
    remainingVault: Number(remainingVault[0]?.count ?? 0),
    remainingArtifacts: Number(remainingArtifacts[0]?.count ?? 0),
    remainingPaymentProofs: Number(remainingPaymentProofs[0]?.count ?? 0),
    deletedSources,
  }));
}

main().catch((error) => {
  console.error("[private-blob:migration_failed]", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
