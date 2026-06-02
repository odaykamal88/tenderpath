import { NextResponse } from "next/server";
import { matchAllActiveNetworkCompanies } from "@/lib/network/match";

export const maxDuration = 300;

// Every-couple-of-days bizdev matcher: re-scores every active, profiled
// network company against open tenders and flags fresh high-fit matches as
// 'new'. Modeled on /api/cron/crawl — Bearer CRON_SECRET, 502 escalates to
// Vercel cron monitoring only when EVERY company errored (a single bad company
// shouldn't page). Scheduled in vercel.json at "0 9 */2 * *".
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/network-match] CRON_SECRET not configured — refusing request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { results, ...summary } = await matchAllActiveNetworkCompanies();
    void results; // per-company detail intentionally omitted from the response
    const alert = summary.companies > 0 && summary.errors === summary.companies;
    return NextResponse.json(
      { ok: !alert, timestamp: new Date().toISOString(), ...summary },
      { status: alert ? 502 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[api/cron/network-match] run failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
