import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { getFunnelDaily, getFunnelTotals } from "@/lib/telemetry/funnel";

export const runtime = "nodejs";

/**
 * Admin-only funnel snapshot. Returns:
 *   - daily: per-day per-event counts and distinct users
 *   - totals: per-event totals across the window
 *
 * Default window is 7 days. Pass ?days=N to override (1-90 valid range).
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const daysParam = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isFinite(daysParam) ? Math.min(90, Math.max(1, Math.trunc(daysParam))) : 7;

  const [daily, totals] = await Promise.all([getFunnelDaily(days), getFunnelTotals(days)]);

  return NextResponse.json({
    window_days: days,
    totals,
    daily,
  });
}
