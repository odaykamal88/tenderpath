import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import {
  discoverNetworkProspectsForTender,
  TENDER_NETWORK_DISCOVERY_LIMIT,
  TENDER_NETWORK_DISCOVERY_THRESHOLD,
} from "@/lib/network/tenderDiscovery";

export const maxDuration = 60;

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
  const threshold = Number.isFinite(Number(b.threshold))
    ? Number(b.threshold)
    : TENDER_NETWORK_DISCOVERY_THRESHOLD;
  const limit = Number.isFinite(Number(b.limit))
    ? Number(b.limit)
    : TENDER_NETWORK_DISCOVERY_LIMIT;

  try {
    const run = await discoverNetworkProspectsForTender(tenderId, { threshold, limit });
    if (!run) return NextResponse.json({ error: "Tender not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    console.error("[matching:network-discovery:failed]", { tenderId, err });
    return NextResponse.json({ error: "Failed to discover network prospects" }, { status: 500 });
  }
}
