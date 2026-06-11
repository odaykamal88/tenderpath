/* Ops fulfillment queue — paid submission orders, live from the vendor
 * dashboard (admin console 03b). KPI buckets: new intakes (paid, drafting not
 * started) · in production (drafting/qa/revisions) · with client
 * (review/final) · SLA at risk (60-min draft promise running low). */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { listOrdersForAdmin } from "@/lib/submissions/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;
  try {
    const orders = await listOrdersForAdmin();
    const counts: Record<string, number> = {
      all: orders.length,
      intake: 0,
      drafting: 0,
      qa: 0,
      revisions: 0,
      review: 0,
      final: 0,
      submitted: 0,
    };
    let slaAtRisk = 0;
    const now = Date.now();
    for (const o of orders) {
      counts[o.stage] = (counts[o.stage] ?? 0) + 1;
      if ((o.stage === "intake" || o.stage === "drafting") && o.paidAt) {
        const elapsedMin = (now - new Date(o.paidAt).getTime()) / 60_000;
        if (elapsedMin > o.slaMins * 0.75) slaAtRisk += 1;
      }
    }
    return NextResponse.json({
      orders,
      counts,
      kpis: {
        newIntakes: counts.intake,
        inProduction: counts.drafting + counts.qa + counts.revisions,
        withClient: counts.review + counts.final,
        slaAtRisk,
      },
    });
  } catch (err) {
    console.error("[tp:submissions:admin_list_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not load the queue." }, { status: 500 });
  }
}
