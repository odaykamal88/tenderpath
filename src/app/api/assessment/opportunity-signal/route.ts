import { NextResponse } from "next/server";
import { getOpportunitySignal } from "@/lib/assessment/opportunity-signal";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/**
 * Public, unauthenticated endpoint that powers the live "opportunity signal"
 * strip in the assessment wizard. Reads two comma-separated query params —
 * `sectors` (human labels) and `countries` — and returns a coarse count of the
 * open-tender pond the user is fishing in. Never throws to the client: a quiet
 * 200 with `signal: null` lets the wizard hide the strip rather than error.
 */

function parseList(raw: string | null, max: number): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}

export async function GET(request: Request) {
  try {
    const limited = enforceRateLimit(request, {
      namespace: "assessment:opportunity-signal:ip",
      limit: 120,
      windowMs: 60 * 1000,
    });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const sectors = parseList(searchParams.get("sectors"), 16);
    const countries = parseList(searchParams.get("countries"), 40);

    if (sectors.length === 0 || countries.length === 0) {
      return NextResponse.json({ signal: null });
    }

    const signal = await getOpportunitySignal(sectors, countries);

    return NextResponse.json(
      { signal },
      {
        // Short cache: the pond changes slowly, and identical sector/country
        // combos recur heavily across wizard sessions.
        headers: { "Cache-Control": "public, max-age=120, stale-while-revalidate=600" },
      },
    );
  } catch (err) {
    console.warn("[tp:assessment:opportunity_signal_route_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ signal: null });
  }
}
