import { NextResponse } from "next/server";
import { refreshStaleAssessmentMatches } from "@/lib/assessment/match";

export const maxDuration = 300;

// Daily bulk re-match of every active user's latest assessment so the matched-
// tender dashboards stay current — matchTenders only returns open, non-expired
// tenders, so re-running and persisting it is what stops a snapshot from
// drifting into an all-"Closed" list. Modeled on /api/cron/network-match:
// Bearer CRON_SECRET, and a 502 escalates to Vercel cron monitoring only when
// EVERY processed assessment errored (a single bad row shouldn't page).
// Scheduled in vercel.json at "0 9 * * *" — after the 06:00 crawl + 07:15
// grants land fresh tenders.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/refresh-matches] CRON_SECRET not configured — refusing request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await refreshStaleAssessmentMatches();
    const alert = summary.processed > 0 && summary.errors === summary.processed;
    return NextResponse.json(
      { ok: !alert, timestamp: new Date().toISOString(), ...summary },
      { status: alert ? 502 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/cron/refresh-matches] run failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
