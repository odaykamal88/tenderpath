import { sql } from "@/lib/db";

/**
 * Sprint 5 activation funnel. Append-only event log so we can answer:
 * "for every N assessments started, how many reach a paid deliverable?"
 *
 * Telemetry must never block production paths — every helper here swallows
 * its own errors and logs a structured warning. Callers do not need to
 * try/catch around track() calls.
 */

export const FUNNEL_EVENTS = [
  "assessment_started",
  "assessment_completed",
  "dashboard_landed",
  "tender_clicked",
  "paid_intent_clicked",
  "payment_succeeded",
  "deliverable_ready",
  // Sprint 11: emitted when the Proposal Draft compliance gate holds the
  // bundle because >=1 mandatory item is needs_action. The output is
  // persisted (dashboard renders the remediation panel) but no ZIP is
  // produced and no "ready" email is sent.
  "deliverable_blocked",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === "string" && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

let _tableEnsured = false;
async function ensureFunnelEventsTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS funnel_events (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        anon_id TEXT,
        event TEXT NOT NULL,
        props JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS funnel_events_event_created
        ON funnel_events (event, created_at DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS funnel_events_user_created
        ON funnel_events (user_id, created_at DESC)
    `;
    _tableEnsured = true;
  } catch (err) {
    console.warn("[telemetry:ensure_table_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record one funnel event. Never throws. Pass userId when known; pass anonId
 * for unauthenticated client-side events so we can still count distinct
 * users in the top-of-funnel.
 */
export async function track(
  event: FunnelEvent,
  props: Record<string, unknown> = {},
  identity: { userId?: number | null; anonId?: string | null } = {},
): Promise<void> {
  try {
    await ensureFunnelEventsTable();
    await sql`
      INSERT INTO funnel_events (user_id, anon_id, event, props)
      VALUES (${identity.userId ?? null}, ${identity.anonId ?? null}, ${event}, ${JSON.stringify(props)}::jsonb)
    `;
  } catch (err) {
    console.warn("[telemetry:track_failed]", {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface FunnelDailyRow {
  day: string;
  event: FunnelEvent;
  count: number;
  distinct_users: number;
}

export async function getFunnelDaily(days = 7): Promise<FunnelDailyRow[]> {
  await ensureFunnelEventsTable();
  const rows = await sql`
    SELECT
      to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
      event,
      COUNT(*)::int AS count,
      COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int AS distinct_users
    FROM funnel_events
    WHERE created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY day, event
    ORDER BY day DESC, event ASC
  `;
  return rows.map((r) => ({
    day: r.day as string,
    event: r.event as FunnelEvent,
    count: r.count as number,
    distinct_users: r.distinct_users as number,
  }));
}

/**
 * Snapshot of total counts per event over a window. Useful for the daily
 * digest one-liner: "started=X completed=Y dashboards=Z paid=W deliverables=V".
 */
export async function getFunnelTotals(
  days = 7,
): Promise<Record<FunnelEvent, number>> {
  await ensureFunnelEventsTable();
  const rows = await sql`
    SELECT event, COUNT(*)::int AS count
    FROM funnel_events
    WHERE created_at >= NOW() - (${days} || ' days')::interval
    GROUP BY event
  `;
  const totals = Object.fromEntries(
    FUNNEL_EVENTS.map((e) => [e, 0] as const),
  ) as Record<FunnelEvent, number>;
  for (const row of rows) {
    const evt = row.event as FunnelEvent;
    if ((FUNNEL_EVENTS as readonly string[]).includes(evt)) {
      totals[evt] = row.count as number;
    }
  }
  return totals;
}
