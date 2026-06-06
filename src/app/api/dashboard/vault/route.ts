import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import { linkExtractionToVaultDocument } from "@/lib/documents/extract";
import { applyAutoTagsForVaultDocument } from "@/lib/applicant-evidence/ingest";
import { enforceRateLimit } from "@/lib/security/rate-limit";

// Kept the original (narrow) form values. Sprint 10's canonical taxonomy
// in EVIDENCE_TYPES is broader; the auto-tagger upgrades "other" uploads
// to more specific types when it has strong filename/text signal.
const DOC_TYPES = ["certification", "financial", "cv", "past_performance", "other"] as const;
type DocType = (typeof DOC_TYPES)[number];
const isType = (v: unknown): v is DocType =>
  typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

function publicDocument(row: Record<string, unknown>) {
  return {
    ...row,
    download_url: `/api/dashboard/vault/${row.id}/download`,
    file_url: `/api/dashboard/vault/${row.id}/download`,
  };
}

function isAllowedStoredFileUrl(value: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(value);
}

async function fileUrlForUploadId(userId: number, uploadId: unknown): Promise<string | null> {
  const id = Number(uploadId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const rows = await sql`
    SELECT file_url
    FROM document_extractions
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  ` as unknown as Array<{ file_url: string }>;

  return rows[0]?.file_url ?? null;
}

export async function GET(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const rows = await sql`
    SELECT id, name, type, expiry_date, file_url, created_at, tags
    FROM vault_documents
    WHERE user_id = ${guard.user!.id}
    ORDER BY created_at DESC
  `;

  return NextResponse.json({ documents: rows.map((row) => publicDocument(row as Record<string, unknown>)) });
}

export async function POST(request: Request) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;

  const limited = enforceRateLimit(request, {
    namespace: "vault-save",
    limit: 60,
    windowMs: 60 * 60 * 1000,
    keyParts: [guard.user!.id],
  });
  if (limited) return limited;

  const body = await request.json();
  const { name, type, expiry_date = null, file_url, upload_id } = body ?? {};

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!isType(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }
  const resolvedFileUrl = typeof file_url === "string"
    ? file_url
    : await fileUrlForUploadId(guard.user!.id, upload_id);

  if (!resolvedFileUrl || !isAllowedStoredFileUrl(resolvedFileUrl)) {
    return NextResponse.json({ error: "valid file_url required" }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO vault_documents (user_id, name, type, expiry_date, file_url)
    VALUES (${guard.user!.id}, ${name}, ${type}, ${expiry_date}, ${resolvedFileUrl})
    RETURNING *
  `;

  await linkExtractionToVaultDocument({
    userId: guard.user!.id,
    vaultDocumentId: rows[0].id as number,
    fileUrl: resolvedFileUrl,
  }).catch((err) => {
    console.error("[tp:vault:extraction_link_failed]", {
      userId: guard.user!.id,
      documentId: rows[0].id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Sprint 10: auto-tag from filename + declared type at insert time. The
  // tagger re-runs after extraction completes with full text available.
  await applyAutoTagsForVaultDocument({
    userId: guard.user!.id,
    vaultDocumentId: rows[0].id as number,
  }).catch((err) => {
    console.error("[tp:vault:autotag_failed]", {
      userId: guard.user!.id,
      documentId: rows[0].id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json({ document: publicDocument(rows[0] as Record<string, unknown>) }, { status: 201 });
}
