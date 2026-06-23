/* POST /api/dashboard/bid-no-bid/consume — claim one instant bid/no-bid credit.
 *
 * The match-seeded Paste path renders its verdict from data we already hold (no
 * LLM round-trip), so it can't piggyback on /paste-analyze's metering. It calls
 * this endpoint first to consume a credit under the same freemium cap: free
 * accounts get BID_NO_BID_FREE_MONTHLY verdicts per calendar month, Pro is
 * unlimited. Returns the post-claim usage, or 402 BID_NO_BID_LIMIT at the cap so
 * the modal can show the subscribe prompt. Auth-only (the dashboard is free). */

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/access";
import { canRunBidNoBid, recordBidNoBidUse, bidNoBidLimitResponse } from "@/lib/bid-no-bid-usage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const guard = await requireAuth(request);
  if (!guard.authorized) return guard.response!;

  const { allowed, usage } = await canRunBidNoBid(guard.user!);
  if (!allowed) {
    console.log("[bid-no-bid:consume:cap_reached]", { userId: guard.user!.id, used: usage.used, limit: usage.limit });
    return NextResponse.json(bidNoBidLimitResponse(usage), { status: 402 });
  }

  const after = await recordBidNoBidUse(guard.user!);
  return NextResponse.json({ ok: true, usage: after });
}
