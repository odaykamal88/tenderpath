import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";

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

    // Try Vercel Blob first, fall back to base64 data URL
    let fileUrl: string;

    try {
      // Attempt to use @vercel/blob if available
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { put } = require("@vercel/blob");
      const blob = await put(`vault/${guard.user!.id}/${Date.now()}-${file.name}`, file, {
        access: "public",
        addRandomSuffix: true,
      });
      fileUrl = blob.url;
    } catch {
      // Fallback: encode as base64 data URL (for dev / no blob token)
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      fileUrl = `data:${file.type};base64,${base64}`;
    }

    return NextResponse.json({ url: fileUrl, name: file.name });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
