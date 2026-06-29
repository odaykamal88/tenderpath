import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { discoverExternalProspectsForTender } from "@/lib/network/externalDiscovery";

export const maxDuration = 90;

export async function POST(
  request: Request,
  context: { params: Promise<{ tenderId: string }> },
) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const { tenderId: rawId } = await context.params;
  const tenderId = Number(rawId);
  if (!Number.isInteger(tenderId) || tenderId <= 0) {
    return NextResponse.json({ error: "Invalid tender id" }, { status: 400 });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const limit = Number.isFinite(Number(b.limit)) ? Number(b.limit) : 8;

  try {
    const run = await discoverExternalProspectsForTender(tenderId, {
      limit,
      createdBy: guard.user?.id ?? null,
    });
    if (!run) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[matching:external-discovery:failed]", { tenderId, err });
    return NextResponse.json({ error: "Failed to discover external prospects" }, { status: 500 });
  }
}
