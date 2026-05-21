import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 30;

// Stable [vault:upload:*] log tags on every error branch so the next failed
// upload tells us what's actually breaking — the previous route swallowed
// every failure as a generic 500 "Upload failed" with no structured log
// (launch-discipline: silent failures are launch blockers).
export async function POST(req: NextRequest) {
  const guard = await requireDashboardAccess(req);
  if (!guard.authorized) return guard.response!;

  let stage = "parse_form";
  try {
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

    stage = "read_bytes";
    const bytes = Buffer.from(await file.arrayBuffer());

    stage = "blob_upload";
    let fileUrl: string;
    let storedVia: "blob" | "base64" = "blob";

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { put } = require("@vercel/blob");
      const blob = await put(`vault/${guard.user!.id}/${Date.now()}-${file.name}`, bytes, {
        access: "public",
        addRandomSuffix: true,
        contentType: file.type,
      });
      fileUrl = blob.url;
    } catch (blobErr) {
      // Fallback: encode as base64 data URL. Surfaces enough context that the
      // next prod failure tells us whether it's a missing BLOB_READ_WRITE_TOKEN
      // (the most common cause — observed during the Sprint 4 bid-no-bid PDF
      // pipeline) or a real upload error.
      console.warn("[vault:upload:blob_fallback]", {
        userId: guard.user!.id,
        fileName: file.name,
        fileSize: file.size,
        errorName: blobErr instanceof Error ? blobErr.name : "unknown",
        errorMessage: blobErr instanceof Error ? blobErr.message : String(blobErr),
        hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      });
      const base64 = bytes.toString("base64");
      fileUrl = `data:${file.type};base64,${base64}`;
      storedVia = "base64";
    }

    stage = "extract_text";
    const extraction = await extractDocumentText({
      buffer: bytes,
      mimeType: file.type,
      fileName: file.name,
    });

    stage = "persist_extraction";
    const persisted = await persistDocumentExtraction({
      userId: guard.user!.id,
      fileName: file.name,
      fileUrl,
      mimeType: file.type,
      result: extraction,
    });

    return NextResponse.json({
      url: fileUrl,
      name: file.name,
      extraction: persisted,
      storedVia,
    });
  } catch (err) {
    console.error("[vault:upload:failed]", {
      userId: guard.user?.id,
      stage,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
      errorCode: (err as { code?: string | number })?.code,
    });
    // Surface the failing stage in the body so the UI can show a more useful
    // message than "Upload failed." for the user to retry against.
    return NextResponse.json(
      {
        error: `Upload failed at ${stage}. ${err instanceof Error ? err.message : "Unknown error"}`,
        stage,
      },
      { status: 500 }
    );
  }
}
