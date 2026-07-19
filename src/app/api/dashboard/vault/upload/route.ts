import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { privateBlobConfigured, putPrivateBlob } from "@/lib/vault/storage";
import { tenderTitleTag } from "@/lib/documents/classify";
import { inferTenderDocumentRole } from "@/lib/tender-workspace/documents";
import {
  TENDER_DOCUMENT_ROLES,
  type TenderDocumentRole,
} from "@/lib/tender-workspace/types";

export const runtime = "nodejs";
export const maxDuration = 30;

function blobPathFor(userId: number, fileName: string): string {
  const ext = fileName.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase() ?? "";
  return `vault/${userId}/${crypto.randomUUID()}${ext}`;
}

// Stable [vault:upload:*] log tags on every error branch so the next failed
// upload tells us what's actually breaking — the previous route swallowed
// every failure as a generic 500 "Upload failed" with no structured log
// (launch-discipline: silent failures are launch blockers).
export async function POST(req: NextRequest) {
  const guard = await requireDashboardAccess(req);
  if (!guard.authorized) return guard.response!;

  const limited = enforceRateLimit(req, {
    namespace: "vault-upload",
    limit: 20,
    windowMs: 60 * 60 * 1000,
    keyParts: [guard.user!.id],
  });
  if (limited) return limited;

  let stage = "parse_form";
  try {
    await ensureCustomerPrivacySchema();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      console.warn("[vault:upload:no_file]", { userId: guard.user!.id });
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      console.warn("[vault:upload:too_large]", {
        userId: guard.user!.id,
        fileName: file.name,
        size: file.size,
      });
      return NextResponse.json({ error: "File too large. Maximum 10MB." }, { status: 400 });
    }

    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (!allowedTypes.includes(file.type)) {
      console.warn("[vault:upload:bad_type]", {
        userId: guard.user!.id,
        fileName: file.name,
        fileType: file.type,
      });
      return NextResponse.json(
        { error: `Unsupported file type "${file.type || "unknown"}". Please upload PDF, Word, Excel, or image files.` },
        { status: 400 }
      );
    }

    const rawTenderId = Number(formData.get("tenderId"));
    const tenderId = Number.isInteger(rawTenderId) && rawTenderId > 0 ? rawTenderId : null;
    const tenderTitleValue = formData.get("tenderTitle");
    const tenderTitle = typeof tenderTitleValue === "string" && tenderTitleValue.trim()
      ? tenderTitleValue.trim().slice(0, 500)
      : null;
    const requestedRole = formData.get("tenderRole");
    const tenderRole: TenderDocumentRole = TENDER_DOCUMENT_ROLES.includes(requestedRole as TenderDocumentRole)
      ? requestedRole as TenderDocumentRole
      : inferTenderDocumentRole(file.name);

    stage = "read_bytes";
    const bytes = Buffer.from(await file.arrayBuffer());

    stage = "blob_upload";
    let fileUrl: string;
    let blobPathname: string;

    try {
      const blob = await putPrivateBlob(blobPathFor(guard.user!.id, file.name), bytes, {
        addRandomSuffix: true,
        contentType: file.type,
      });
      fileUrl = blob.url;
      blobPathname = blob.pathname;
      await sql`
        INSERT INTO vault_upload_receipts (
          user_id, blob_url, blob_pathname, content_type
        ) VALUES (
          ${guard.user!.id}, ${blob.url}, ${blob.pathname}, ${file.type}
        )
        ON CONFLICT (blob_url) DO UPDATE SET
          blob_pathname = EXCLUDED.blob_pathname,
          content_type = EXCLUDED.content_type,
          expires_at = NOW() + INTERVAL '24 hours'
        WHERE vault_upload_receipts.user_id = EXCLUDED.user_id
      `;
    } catch (blobErr) {
      console.error("[vault:upload:blob_failed]", {
        userId: guard.user!.id,
        fileName: file.name,
        fileSize: file.size,
        errorName: blobErr instanceof Error ? blobErr.name : "unknown",
        errorMessage: blobErr instanceof Error ? blobErr.message : String(blobErr),
        hasPrivateBlobToken: privateBlobConfigured(),
      });
      return NextResponse.json(
        { error: "Document storage is unavailable. Please try again shortly.", code: "BLOB_UPLOAD_FAILED" },
        { status: 503 },
      );
    }

    stage = "extract_text";
    const extraction = await extractDocumentText({
      buffer: bytes,
      mimeType: file.type,
      fileName: file.name,
    });

    stage = "vault_row";
    const purposeTag = tenderRole === "solicitation" || tenderRole === "tor" || tenderRole === "guidelines"
      ? "bid-no-bid-tender"
      : "bid-no-bid-supporting";
    const titleTag = tenderTitleTag(tenderTitle);
    const tags = [
      purposeTag,
      titleTag,
      tenderId ? `tender-pack:${tenderId}` : null,
      tenderId ? "tender-pack:user-upload" : null,
      `tender-role:${tenderRole}`,
    ].filter(Boolean) as string[];
    const inserted = (await sql`
      INSERT INTO vault_documents (
        user_id, name, type, file_url, tags, storage_access, blob_pathname
      ) VALUES (
        ${guard.user!.id}, ${file.name}, 'other', ${fileUrl}, ${tags}::text[],
        'private', ${blobPathname}
      )
      RETURNING id
    `) as unknown as Array<{ id: number }>;
    const vaultDocumentId = inserted[0]?.id;
    if (!vaultDocumentId) throw new Error("vault row was not created");

    stage = "persist_extraction";
    const persisted = await persistDocumentExtraction({
      userId: guard.user!.id,
      vaultDocumentId,
      fileName: file.name,
      fileUrl,
      mimeType: file.type,
      result: extraction,
    });
    await sql`
      UPDATE vault_upload_receipts
      SET claimed_at = COALESCE(claimed_at, NOW())
      WHERE user_id = ${guard.user!.id} AND blob_url = ${fileUrl}
    `;

    return NextResponse.json({
      upload_id: persisted.id,
      url: `/api/dashboard/vault/${vaultDocumentId}/download`,
      vaultDocumentId,
      name: file.name,
      tenderRole,
      extraction: persisted,
      storedVia: "private_blob",
      blobPathname,
    });
  } catch (err) {
    console.error("[vault:upload:failed]", {
      userId: guard.user?.id,
      stage,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: (err as { code?: string | number })?.code,
    });
    return NextResponse.json(
      {
        error: "TenderPath could not finish processing this document. Please try again.",
        code: "DOCUMENT_PROCESSING_FAILED",
        stage,
      },
      { status: 500 }
    );
  }
}
