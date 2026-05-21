import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";

export const runtime = "nodejs";
export const maxDuration = 30;

// Post-upload extraction. The browser uploads to Blob storage directly via
// the @vercel/blob/client SDK (bypassing the 4.5 MB function body limit).
// Once that completes, the client POSTs here with the Blob URL so we can
// download it, run text extraction, and write the metadata row.
//
// Auth: Bearer via requireDashboardAccess (same as the rest of the dashboard
// API surface).
export async function POST(req: NextRequest) {
  const guard = await requireDashboardAccess(req);
  if (!guard.authorized) return guard.response!;

  let url: string;
  let name: string;
  let mimeType: string;
  try {
    const body = await req.json();
    url = String(body.url ?? "");
    name = String(body.name ?? "");
    mimeType = String(body.mimeType ?? "");
    if (!url || !name) throw new Error("missing url/name");
  } catch {
    console.warn("[vault:extract:bad_request]", { userId: guard.user!.id });
    return NextResponse.json({ error: "url and name required" }, { status: 400 });
  }

  // Only accept URLs from our own Vercel Blob storage. Prevents someone from
  // pointing this endpoint at an arbitrary external resource and forcing the
  // function to download large blobs / SSRF target.
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
    console.warn("[vault:extract:unsafe_url]", {
      userId: guard.user!.id,
      urlPrefix: url.slice(0, 60),
    });
    return NextResponse.json({ error: "URL must be a Vercel Blob URL" }, { status: 400 });
  }

  let stage = "fetch_blob";
  try {
    stage = "fetch_blob";
    const blobRes = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!blobRes.ok) {
      console.warn("[vault:extract:fetch_blob_failed]", {
        userId: guard.user!.id,
        status: blobRes.status,
      });
      return NextResponse.json(
        { error: `Could not fetch the uploaded file (${blobRes.status})` },
        { status: 502 },
      );
    }
    const buffer = Buffer.from(await blobRes.arrayBuffer());

    stage = "extract_text";
    const extraction = await extractDocumentText({
      buffer,
      mimeType: mimeType || blobRes.headers.get("content-type") || "application/octet-stream",
      fileName: name,
    });

    stage = "persist_extraction";
    const persisted = await persistDocumentExtraction({
      userId: guard.user!.id,
      fileName: name,
      fileUrl: url,
      mimeType: mimeType || blobRes.headers.get("content-type") || "application/octet-stream",
      result: extraction,
    });

    return NextResponse.json({
      url,
      name,
      extraction: persisted,
    });
  } catch (err) {
    console.error("[vault:extract:failed]", {
      userId: guard.user?.id,
      stage,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: `Extraction failed at ${stage}. ${err instanceof Error ? err.message : "Unknown error"}`,
        stage,
      },
      { status: 500 },
    );
  }
}
