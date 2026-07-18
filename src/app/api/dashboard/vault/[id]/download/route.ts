import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireDashboardAccess } from "@/lib/access";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { getPrivateBlob, storedBlobAccess } from "@/lib/vault/storage";

function safeFileName(value: string): string {
  return value.replace(/[^\w.\- ]+/g, "_").trim().slice(0, 120) || "document";
}

function responseForDataUrl(dataUrl: string, name: string): Response | null {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const raw = match[3] ?? "";
  const bytes = isBase64
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf8");
  return new Response(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${safeFileName(name)}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireDashboardAccess(request);
  if (!guard.authorized) return guard.response!;
  await ensureCustomerPrivacySchema();

  const { id } = await ctx.params;
  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT name, file_url, storage_access
    FROM vault_documents
    WHERE id = ${docId} AND user_id = ${guard.user!.id}
    LIMIT 1
  ` as unknown as Array<{ name: string; file_url: string; storage_access: string }>;
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  const detectedAccess = storedBlobAccess(doc.file_url);
  if (detectedAccess === "invalid") {
    console.warn("[vault:download:blocked_url]", { userId: guard.user!.id, docId });
    return NextResponse.json({ error: "Stored document URL is not allowed" }, { status: 400 });
  }
  if (detectedAccess === "synthetic") {
    return NextResponse.json({ error: "This evidence record has no uploaded file." }, { status: 404 });
  }

  if (detectedAccess === "inline") {
    const response = responseForDataUrl(doc.file_url, doc.name);
    return response ?? NextResponse.json({ error: "Invalid stored document data" }, { status: 400 });
  }

  if (detectedAccess === "private") {
    try {
      const result = await getPrivateBlob(doc.file_url);
      if (!result || result.statusCode !== 200 || !result.stream) {
        return NextResponse.json({ error: "Stored document was not found" }, { status: 404 });
      }
      return new Response(result.stream, {
        headers: {
          "Content-Type": result.blob.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeFileName(doc.name)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.error("[vault:download:private_blob_failed]", {
        userId: guard.user!.id,
        docId,
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: "Private document storage is unavailable.", code: "PRIVATE_BLOB_UNAVAILABLE" },
        { status: 503 },
      );
    }
  }

  // Legacy public objects remain proxy-delivered only so customer-facing links
  // do not expose the raw URL. The migration script moves these into the
  // private store; the warning keeps the remaining count diagnosable.
  console.warn("[vault:download:legacy_public_object]", { userId: guard.user!.id, docId });
  const upstream = await fetch(doc.file_url, { signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch stored document" }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName(doc.name)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-TenderPath-Storage": "legacy-public-pending-migration",
    },
  });
}
