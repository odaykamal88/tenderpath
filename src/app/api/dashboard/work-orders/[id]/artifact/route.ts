import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/access";
import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { getPrivateBlob, storedBlobAccess } from "@/lib/vault/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFileName(pathname: string | null, plan: string): string {
  const fallback = `${plan || "tenderpath-artifact"}.zip`;
  const name = pathname?.split("/").pop() || fallback;
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 140) || fallback;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;
  await ensureCustomerPrivacySchema();

  const { id } = await params;
  const workOrderId = Number(id);
  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    return NextResponse.json({ error: "Invalid work order id" }, { status: 400 });
  }

  try {
    const rows = await sql`
      SELECT pp.pdf_url, pp.pdf_pathname, pp.plan
      FROM work_orders wo
      JOIN LATERAL (
        SELECT pdf_url, pdf_pathname, plan, created_at
        FROM proposal_packages
        WHERE work_order_id = wo.id AND pdf_url IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) pp ON TRUE
      WHERE wo.id = ${workOrderId}
        AND (
          wo.user_id = ${guard.user!.id}
          OR (
            wo.user_id IS NULL
            AND wo.email IS NOT NULL
            AND LOWER(wo.email) = LOWER(${guard.user!.email})
          )
        )
      LIMIT 1
    ` as unknown as Array<{ pdf_url: string; pdf_pathname: string | null; plan: string }>;
    const artifact = rows[0];
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

    const access = storedBlobAccess(artifact.pdf_url);
    const fileName = safeFileName(artifact.pdf_pathname, artifact.plan);
    if (access === "private") {
      const result = await getPrivateBlob(artifact.pdf_url);
      if (!result || result.statusCode !== 200 || !result.stream) {
        return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
      }
      return new Response(result.stream, {
        headers: {
          "Content-Type": result.blob.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (access === "legacy_public") {
      console.warn("[artifact:download:legacy_public_object]", { userId: guard.user!.id, workOrderId });
      const upstream = await fetch(artifact.pdf_url, { signal: AbortSignal.timeout(20_000) });
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json({ error: "Could not fetch artifact" }, { status: 502 });
      }
      return new Response(upstream.body, {
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-TenderPath-Storage": "legacy-public-pending-migration",
        },
      });
    }

    return NextResponse.json({ error: "Stored artifact URL is not allowed" }, { status: 400 });
  } catch (error) {
    console.error("[artifact:download:failed]", {
      userId: guard.user!.id,
      workOrderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Artifact download is unavailable." }, { status: 503 });
  }
}
