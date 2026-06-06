import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

function isAllowedStoredUrl(value: string): boolean {
  return /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(value)
    || value.startsWith("data:");
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
    SELECT payment_proof_url
    FROM work_orders
    WHERE id = ${workOrderId}
    LIMIT 1
  ` as unknown as Array<{ payment_proof_url: string | null }>;
  const proofUrl = rows[0]?.payment_proof_url;
  if (!proofUrl) return NextResponse.json({ error: "Payment proof not found" }, { status: 404 });
  if (!isAllowedStoredUrl(proofUrl)) {
    console.warn("[admin:payment-proof:blocked_url]", { workOrderId });
    return NextResponse.json({ error: "Stored payment proof URL is not allowed" }, { status: 400 });
  }

  const fileName = `wire-proof-${workOrderId}`;
  if (proofUrl.startsWith("data:")) {
    const response = responseForDataUrl(proofUrl, fileName);
    return response ?? NextResponse.json({ error: "Invalid stored payment proof data" }, { status: 400 });
  }

  const upstream = await fetch(proofUrl, { signal: AbortSignal.timeout(20_000) });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch stored payment proof" }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
