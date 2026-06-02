/**
 * /api/admin/grant-health — the grant-source monitor.
 *
 * The grants pipeline was the one subsystem with no health view (mirrors
 * source-health for tenders + proposal-health for the $299 pipeline). That blind
 * spot is exactly how Grants.gov silently decayed (rows expiring, nothing
 * refreshing) and how the data/ file-tracing bug would have produced zero rows
 * unnoticed. This surfaces, per source: open count, future-vs-stale split,
 * whether the last cron actually refreshed it, and field quality — so a source
 * dropping to zero or going stale is visible instead of silent.
 *
 * Read-only, admin-only. AGENTS.md: silent failures are launch blockers.
 */
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

export const runtime = "nodejs";

// Sources that should ALWAYS have open rows; emptiness here is a real incident.
// IFAD (browser-worker / posting-cadence dependent) and the per-funder MENA
// Funders rows can legitimately be zero, so their emptiness is informational.
const ALWAYS_ON = ["EU Funding & Tenders", "UNDP CFP", "UN Women CFP", "Grants.gov"];
const STALE_HOURS = 36; // daily cron + grace for one missed run

type SourceHealth = "ok" | "stale" | "all_past" | "empty" | "missing";

interface SourceRow {
  source: string;
  open: number;
  futureOpen: number;
  staleOpen: number;
  refreshedRecently: number;
  lastRefresh: string | null;
  qualityPct: { richDesc: number; themes: number; eligibility: number; sourceUrl: number };
  health: SourceHealth;
  flags: string[];
}

interface DbRow {
  source_name: string | null;
  open: number;
  future_open: number;
  stale_open: number;
  refreshed_recently: number;
  last_refresh: string | null;
  rich_desc: number;
  themes: number;
  eligible_org_types: number;
  source_urls: number;
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function classify(r: DbRow): { health: SourceHealth; flags: string[] } {
  const flags: string[] = [];
  if (r.open === 0) return { health: "empty", flags: ["0 open grants"] };
  if (r.future_open === 0) {
    flags.push("every open grant is past its deadline — expiry not running or source is dead");
    return { health: "all_past", flags };
  }
  if (r.refreshed_recently === 0) {
    flags.push(`no rows touched in the last ${STALE_HOURS}h — the source stopped importing`);
    return { health: "stale", flags };
  }
  if (pct(r.themes, r.open) < 50) flags.push("under half of open rows have themes");
  if (pct(r.source_urls, r.open) < 90) flags.push("missing source URLs");
  return { health: "ok", flags };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const rows = (await sql`
    SELECT
      source_name,
      COUNT(*) FILTER (WHERE status = 'open')::int AS open,
      COUNT(*) FILTER (WHERE status = 'open' AND deadline IS NOT NULL AND deadline >= NOW())::int AS future_open,
      COUNT(*) FILTER (WHERE status = 'open' AND deadline IS NOT NULL AND deadline < NOW())::int AS stale_open,
      COUNT(*) FILTER (WHERE status = 'open' AND updated_at >= NOW() - (${STALE_HOURS}::int * INTERVAL '1 hour'))::int AS refreshed_recently,
      MAX(updated_at) FILTER (WHERE status = 'open') AS last_refresh,
      COUNT(*) FILTER (WHERE status = 'open' AND description IS NOT NULL AND LENGTH(TRIM(description)) >= 120)::int AS rich_desc,
      COUNT(*) FILTER (WHERE status = 'open' AND themes IS NOT NULL AND jsonb_array_length(COALESCE(themes, '[]'::jsonb)) > 0)::int AS themes,
      COUNT(*) FILTER (WHERE status = 'open' AND eligible_org_types IS NOT NULL AND jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) > 0)::int AS eligible_org_types,
      COUNT(*) FILTER (WHERE status = 'open' AND source_url IS NOT NULL AND TRIM(source_url) <> '')::int AS source_urls
    FROM grants
    WHERE source_name IS NOT NULL
    GROUP BY source_name
    ORDER BY open DESC, source_name ASC
  `) as unknown as DbRow[];

  const byName = new Map(rows.map((r) => [r.source_name ?? "", r]));
  const sources: SourceRow[] = rows.map((r) => {
    const { health, flags } = classify(r);
    return {
      source: r.source_name ?? "(unknown)",
      open: r.open,
      futureOpen: r.future_open,
      staleOpen: r.stale_open,
      refreshedRecently: r.refreshed_recently,
      lastRefresh: r.last_refresh,
      qualityPct: {
        richDesc: pct(r.rich_desc, r.open),
        themes: pct(r.themes, r.open),
        eligibility: pct(r.eligible_org_types, r.open),
        sourceUrl: pct(r.source_urls, r.open),
      },
      health,
      flags,
    };
  });

  // Surface always-on sources that never produced any rows as explicit "missing".
  for (const name of ALWAYS_ON) {
    if (!byName.has(name)) {
      sources.push({
        source: name, open: 0, futureOpen: 0, staleOpen: 0, refreshedRecently: 0, lastRefresh: null,
        qualityPct: { richDesc: 0, themes: 0, eligibility: 0, sourceUrl: 0 },
        health: "missing", flags: ["expected source has never produced a row"],
      });
    }
  }

  const totals = sources.reduce(
    (acc, s) => ({ open: acc.open + s.open, futureOpen: acc.futureOpen + s.futureOpen, staleOpen: acc.staleOpen + s.staleOpen }),
    { open: 0, futureOpen: 0, staleOpen: 0 },
  );

  const degraded =
    sources.some((s) => s.health === "stale" || s.health === "all_past") ||
    ALWAYS_ON.some((name) => (byName.get(name)?.open ?? 0) === 0);

  return NextResponse.json({
    status: degraded ? "degraded" : "ok",
    generatedAt: new Date().toISOString(),
    totals: { sources: sources.length, ...totals },
    alwaysOn: ALWAYS_ON,
    sources: sources.sort((a, b) => b.open - a.open),
  });
}
