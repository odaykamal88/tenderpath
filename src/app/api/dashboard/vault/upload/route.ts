import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const guard = await requireDashboardAccess(req);
  if (!guard.authorized) return guard.response!;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Maximum 10MB." }, { status: 400 });
    }

    // Validate file type
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
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, Word, Excel, or image files." },
        { status: 400 }
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());

    // Try Vercel Blob first, fall back to base64 data URL
    let fileUrl: string;

    try {
      // Attempt to use @vercel/blob if available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { put } = require("@vercel/blob");
      const blob = await put(`vault/${guard.user!.id}/${Date.now()}-${file.name}`, bytes, {
        access: "public",
        addRandomSuffix: true,
        contentType: file.type,
      });
      fileUrl = blob.url;
    } catch {
      // Fallback: encode as base64 data URL (for dev / no blob token)
      const base64 = bytes.toString("base64");
      fileUrl = `data:${file.type};base64,${base64}`;
    }

    const extraction = await extractDocumentText({
      buffer: bytes,
      mimeType: file.type,
      fileName: file.name,
    });
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
    });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
