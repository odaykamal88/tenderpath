import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { deleteStoredBlob, storedBlobAccess } from "@/lib/vault/storage";

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;
  await ensureCustomerPrivacySchema();

  const { id } = await ctx.params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, file_url
    FROM vault_documents
    WHERE id = ${docId} AND user_id = ${guard.user!.id}
    LIMIT 1
  ` as unknown as Array<{ id: number; file_url: string }>;
  const document = rows[0];
  if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  const access = storedBlobAccess(document.file_url);
  try {
    await deleteStoredBlob(document.file_url, access);
  } catch (error) {
    console.error("[vault:delete:blob_failed]", {
      userId: guard.user!.id,
      docId,
      access,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The stored file could not be deleted. Nothing was removed.", code: "BLOB_DELETE_FAILED" },
      { status: 503 },
    );
  }

  await sql`
    DELETE FROM document_extractions
    WHERE user_id = ${guard.user!.id}
      AND (vault_document_id = ${docId} OR file_url = ${document.file_url})
  `;
  await sql`
    DELETE FROM vault_upload_receipts
    WHERE user_id = ${guard.user!.id} AND blob_url = ${document.file_url}
  `;
  await sql`
    DELETE FROM vault_documents
    WHERE id = ${docId} AND user_id = ${guard.user!.id}
  `;

  return NextResponse.json({ ok: true });
}
