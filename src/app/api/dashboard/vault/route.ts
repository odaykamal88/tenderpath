import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import { linkExtractionToVaultDocument } from "@/lib/documents/extract";

const DOC_TYPES = ["certification", "financial", "cv", "past_performance", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];
const isType = (v: unknown): v is DocType =>
  typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const rows = await sql`
    SELECT
      vd.id,
      vd.name,
      vd.type,
      vd.expiry_date,
      vd.file_url,
      vd.created_at,
      de.status AS extraction_status,
      de.char_count AS extraction_char_count,
      de.error AS extraction_error
    FROM vault_documents vd
    LEFT JOIN LATERAL (
      SELECT status, char_count, error
      FROM document_extractions
      WHERE user_id = vd.user_id
        AND (vault_document_id = vd.id OR file_url = vd.file_url)
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    ) de ON TRUE
    WHERE vd.user_id = ${guard.user!.id}
    ORDER BY vd.created_at DESC
  `;

  return NextResponse.json({ documents: rows });
}

export async function POST(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const body = await request.json();
  const { name, type, expiry_date = null, file_url } = body ?? {};

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isType(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  if (!file_url || typeof file_url !== "string" || !/^(https?:\/\/|data:)/.test(file_url)) {
    return NextResponse.json({ error: "valid file_url required" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO vault_documents (user_id, name, type, expiry_date, file_url)
    VALUES (${guard.user!.id}, ${name}, ${type}, ${expiry_date}, ${file_url})
    RETURNING *
  `;

  await linkExtractionToVaultDocument({
    userId: guard.user!.id,
    vaultDocumentId: rows[0].id as number,
    fileUrl: file_url,
  }).catch((err) => {
    console.error("[tp:vault:extraction_link_failed]", {
      userId: guard.user!.id,
      documentId: rows[0].id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({ document: rows[0] }, { status: 201 });
}
