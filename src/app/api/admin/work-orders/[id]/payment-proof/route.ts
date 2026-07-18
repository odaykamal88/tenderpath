import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { activeSupportAccess, recordSupportAccessEvent } from "@/lib/privacy/support-access";
import { getPrivateBlob, storedBlobAccess } from "@/lib/vault/storage";

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
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { id } = await ctx.params;
  const workOrderId = Number(id);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const rows = await sql`
    SELECT user_id, payment_proof_url
    FROM work_orders
    WHERE id = ${workOrderId}
    LIMIT 1
  ` as unknown as Array<{ user_id: number | null; payment_proof_url: string | null }>;
  const ownerUserId = rows[0]?.user_id == null ? null : Number(rows[0].user_id);
  if (!ownerUserId) return NextResponse.json({ error: "Work order not found" }, { status: 404 });
  const access = await activeSupportAccess(ownerUserId, workOrderId);
  if (!access) {
    await recordSupportAccessEvent({
      ownerUserId,
      workOrderId,
      actorUserId: guard.user!.id,
      eventType: "access_denied",
      purpose: "No active customer grant",
      metadata: { route: "payment_proof" },
    });
    return NextResponse.json(
      { error: "Customer content is locked.", code: "CUSTOMER_CONTENT_LOCKED" },
      { status: 403 },
    );
  }
  const proofUrl = rows[0]?.payment_proof_url;
  if (!proofUrl) return NextResponse.json({ error: "Payment proof not found" }, { status: 404 });
  const storageAccess = storedBlobAccess(proofUrl);
  if (storageAccess === "invalid") {
    console.warn("[admin:payment-proof:blocked_url]", { workOrderId });
    return NextResponse.json({ error: "Stored payment proof URL is not allowed" }, { status: 400 });
  }

  const fileName = `wire-proof-${workOrderId}`;
  const recordRead = () => recordSupportAccessEvent({
    ownerUserId,
    workOrderId,
    actorUserId: guard.user!.id,
    eventType: "content_read",
    purpose: access.purpose,
    metadata: { route: "payment_proof" },
  });
  if (storageAccess === "inline") {
    const response = responseForDataUrl(proofUrl, fileName);
    if (!response) return NextResponse.json({ error: "Invalid stored payment proof data" }, { status: 400 });
    await recordRead();
    return response;
  }

  if (storageAccess === "private") {
    const stored = await getPrivateBlob(proofUrl);
    if (!stored || stored.statusCode !== 200 || !stored.stream) {
      return NextResponse.json({ error: "Payment proof not found" }, { status: 404 });
    }
    await recordRead();
    return new Response(stored.stream, {
      headers: {
        "Content-Type": stored.blob.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const upstream = await fetch(proofUrl, { signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch stored payment proof" }, { status: 502 });
  }
  await recordRead();

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
