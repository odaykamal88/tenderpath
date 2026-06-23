import { sql } from "@/lib/db";

/**
 * Investor data room metrics.
 *
 * Every number here is computed from a real table — no fabricated traction.
 * "Traffic" is honestly derived from the append-only funnel_events log
 * (distinct tracked visitors) plus demo_sessions; it is NOT a Google-Analytics
 * pageview count, and the provenance notes say so. MRR is forward-looking
 * (active Pro subscriptions × list price); revenue is realized cash from
 * purchase_logs. The two are kept separate, as is standard.
 *
 * Resilience: each query group is wrapped so a missing/empty table (e.g. a
 * preview env with no telemetry yet) degrades to zero instead of 500-ing the
 * investor-facing room.
 */

export interface KpiDelta {
  value: number;
  prev: number;
  /** Percent change vs the prior window; null = no prior baseline (treat as "new"). */
  deltaPct: number | null;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  value: number;
}

export interface DataRoomMetrics {
  generatedAt: string;
  headline: {
    totalUsers: number;
    newUsersThisMonth: number;
    totalAssessments: number;
    assessmentsThisMonth: number;
    avgReadiness: number | null;
    activeSubscriptions: number;
    mrrUsd: number;
    arrUsd: number;
    revenueUsd: number;
    payingCustomers: number;
    paidOrders: number;
    submissions: number;
    openTenders: number;
    openGrants: number;
    sources: number;
    networkCompanies: number;
  };
  momentum: {
    newUsers: KpiDelta;
    assessments: KpiDelta;
    revenueUsd: KpiDelta;
    paidOrders: KpiDelta;
  };
  series: {
    userSignups: MonthPoint[];
    userCumulative: MonthPoint[];
    assessments: MonthPoint[];
    revenueUsd: MonthPoint[];
    visitors: MonthPoint[];
  };
  revenueMix: Array<{ label: string; amountUsd: number; orders: number }>;
  subscriptionsByTier: Array<{ tier: string; label: string; count: number }>;
  funnel: Array<{ step: string; label: string; count: number }>;
  traffic: {
    trackedVisitors: number;
    trackedEvents: number;
    demoSessions: number;
  };
  provenance: string[];
}

type Row = Record<string, unknown>;

async function safeRows(p: Promise<unknown>, tag: string): Promise<Row[]> {
  try {
    return (await p) as Row[];
  } catch (err) {
    // No silent failures: an empty/missing table is fine (zeros), but it must be
    // diagnosable from logs rather than silently blank.
    console.warn(`[data-room:metrics:${tag}]`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

const TIER_LABELS: Record<string, string> = {
  "tender-intelligence": "Pro · Grants + Tenders",
  "submission-package": "Proposal Draft",
  "strategic-partnership": "Roster Fast-Track",
};

// Monthly-recurring list price per tier. Only the Pro subscription is recurring
// today; one-time products contribute to realized revenue, not MRR.
const MRR_PER_TIER: Record<string, number> = {
  "tender-intelligence": 49,
};

const PLAN_LABELS: Record<string, string> = {
  "grants-tenders-matching": "Pro · Grants + Tenders",
  "proposal-draft": "Proposal Draft",
  "roster-fast-track": "Roster Fast-Track",
  "bid-no-bid": "Bid / No-Bid",
};

function prettyPlan(plan: string | null): string {
  if (!plan) return "Other";
  return (
    PLAN_LABELS[plan] ??
    plan.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

const FUNNEL_STEPS: Array<{ event: string; label: string }> = [
  { event: "assessment_started", label: "Assessment started" },
  { event: "assessment_completed", label: "Assessment completed" },
  { event: "dashboard_landed", label: "Reached dashboard" },
  { event: "paid_intent_clicked", label: "Paid intent" },
  { event: "payment_succeeded", label: "Payment succeeded" },
];

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function fillSeries(rows: Row[], months: string[], valueKey = "value"): MonthPoint[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(String(r.month), Number(r[valueKey] ?? 0));
  return months.map((m) => ({ month: m, value: map.get(m) ?? 0 }));
}

function cumulative(points: MonthPoint[], baseline: number): MonthPoint[] {
  let acc = baseline;
  return points.map((p) => {
    acc += p.value;
    return { month: p.month, value: acc };
  });
}

function delta(value: number, prev: number): KpiDelta {
  const deltaPct = prev > 0 ? Math.round(((value - prev) / prev) * 100) : value > 0 ? null : 0;
  return { value, prev, deltaPct };
}

export async function getDataRoomMetrics(): Promise<DataRoomMetrics> {
  const months = lastNMonths(12);

  const [
    usersTotal,
    usersBaseline,
    userSignupRows,
    usersWindow,
    assessTotal,
    assessMonthly,
    assessWindow,
    avgReadiness,
    subsByTier,
    revenueTotal,
    revenueMonthly,
    revenueByPlan,
    revenueWindow,
    payingCustomers,
    paidOrdersTotal,
    paidOrdersWindow,
    submissionsTotal,
    openTenders,
    openGrants,
    sourcesCount,
    networkCount,
    visitorsMonthly,
    trafficTotals,
    demoTotal,
    funnelRows,
  ] = await Promise.all([
    safeRows(sql`SELECT COUNT(*)::int AS value FROM users`, "users_total"),
    safeRows(
      sql`SELECT COUNT(*)::int AS value FROM users WHERE created_at < date_trunc('month', NOW()) - INTERVAL '11 months'`,
      "users_baseline",
    ),
    safeRows(
      sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS value
        FROM users
        WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`,
      "user_signups",
    ),
    safeRows(
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last30,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days')::int AS prev30
        FROM users`,
      "users_window",
    ),
    safeRows(sql`SELECT COUNT(*)::int AS value FROM assessments`, "assess_total"),
    safeRows(
      sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COUNT(*)::int AS value
        FROM assessments
        WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`,
      "assess_monthly",
    ),
    safeRows(
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last30,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days')::int AS prev30
        FROM assessments`,
      "assess_window",
    ),
    safeRows(
      sql`SELECT ROUND(AVG(readiness_score))::int AS value FROM assessments WHERE readiness_score > 0`,
      "avg_readiness",
    ),
    safeRows(
      sql`SELECT tier, COUNT(*)::int AS count FROM subscriptions WHERE status = 'active' GROUP BY tier`,
      "subs_by_tier",
    ),
    safeRows(
      sql`SELECT COALESCE(SUM(amount_cents), 0)::bigint AS cents FROM purchase_logs`,
      "revenue_total",
    ),
    safeRows(
      sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, COALESCE(SUM(amount_cents), 0)::bigint AS cents
        FROM purchase_logs
        WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`,
      "revenue_monthly",
    ),
    safeRows(
      sql`SELECT plan, COALESCE(SUM(amount_cents), 0)::bigint AS cents, COUNT(*)::int AS orders FROM purchase_logs GROUP BY plan ORDER BY cents DESC`,
      "revenue_by_plan",
    ),
    safeRows(
      sql`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)::bigint AS last30,
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days'), 0)::bigint AS prev30
        FROM purchase_logs`,
      "revenue_window",
    ),
    safeRows(
      sql`SELECT COUNT(DISTINCT COALESCE(user_id::text, stripe_customer_id))::int AS value FROM purchase_logs`,
      "paying_customers",
    ),
    safeRows(
      sql`SELECT COUNT(*)::int AS value FROM work_orders WHERE payment_status = 'paid'`,
      "paid_orders_total",
    ),
    safeRows(
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS last30,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days' AND created_at < NOW() - INTERVAL '30 days')::int AS prev30
        FROM work_orders WHERE payment_status = 'paid'`,
      "paid_orders_window",
    ),
    safeRows(
      sql`SELECT COUNT(*)::int AS value FROM submission_orders WHERE paid_at IS NOT NULL`,
      "submissions_total",
    ),
    safeRows(sql`SELECT COUNT(*)::int AS value FROM tenders WHERE status = 'open'`, "open_tenders"),
    safeRows(sql`SELECT COUNT(*)::int AS value FROM grants WHERE status = 'open'`, "open_grants"),
    safeRows(
      sql`SELECT COUNT(DISTINCT source_name)::int AS value FROM tenders WHERE status = 'open' AND source_name IS NOT NULL`,
      "sources",
    ),
    safeRows(sql`SELECT COUNT(*)::int AS value FROM network_companies`, "network_companies"),
    safeRows(
      sql`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
               COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int AS value
        FROM funnel_events
        WHERE created_at >= date_trunc('month', NOW()) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1`,
      "visitors_monthly",
    ),
    safeRows(
      sql`SELECT COUNT(*)::int AS events, COUNT(DISTINCT COALESCE(user_id::text, anon_id))::int AS visitors FROM funnel_events`,
      "traffic_totals",
    ),
    safeRows(sql`SELECT COUNT(*)::int AS value FROM demo_sessions`, "demo_total"),
    safeRows(sql`SELECT event, COUNT(*)::int AS count FROM funnel_events GROUP BY event`, "funnel"),
  ]);

  const num = (rows: Row[], key = "value") => Number(rows[0]?.[key] ?? 0);

  const userSignups = fillSeries(userSignupRows, months);
  const userCumulative = cumulative(userSignups, num(usersBaseline));
  const assessments = fillSeries(assessMonthly, months);
  const revenueUsdSeries = fillSeries(revenueMonthly, months, "cents").map((p) => ({
    month: p.month,
    value: Math.round(p.value / 100),
  }));
  const visitors = fillSeries(visitorsMonthly, months);

  const subscriptionsByTier = subsByTier
    .map((r) => ({
      tier: String(r.tier),
      label: TIER_LABELS[String(r.tier)] ?? prettyPlan(String(r.tier)),
      count: Number(r.count ?? 0),
    }))
    .sort((a, b) => b.count - a.count);
  const activeSubscriptions = subscriptionsByTier.reduce((s, r) => s + r.count, 0);
  const mrrUsd = subscriptionsByTier.reduce(
    (s, r) => s + r.count * (MRR_PER_TIER[r.tier] ?? 0),
    0,
  );

  const revenueMix = revenueByPlan
    .map((r) => ({
      label: prettyPlan(r.plan as string | null),
      amountUsd: Math.round(Number(r.cents ?? 0) / 100),
      orders: Number(r.orders ?? 0),
    }))
    .filter((r) => r.amountUsd > 0 || r.orders > 0);

  const funnelMap = new Map<string, number>();
  for (const r of funnelRows) funnelMap.set(String(r.event), Number(r.count ?? 0));
  const funnel = FUNNEL_STEPS.map((s) => ({
    step: s.event,
    label: s.label,
    count: funnelMap.get(s.event) ?? 0,
  }));

  const newUsersThisMonth = userSignups[userSignups.length - 1]?.value ?? 0;
  const assessmentsThisMonth = assessments[assessments.length - 1]?.value ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    headline: {
      totalUsers: num(usersTotal),
      newUsersThisMonth,
      totalAssessments: num(assessTotal),
      assessmentsThisMonth,
      avgReadiness: avgReadiness[0]?.value != null ? Number(avgReadiness[0].value) : null,
      activeSubscriptions,
      mrrUsd,
      arrUsd: mrrUsd * 12,
      revenueUsd: Math.round(num(revenueTotal, "cents") / 100),
      payingCustomers: num(payingCustomers),
      paidOrders: num(paidOrdersTotal),
      submissions: num(submissionsTotal),
      openTenders: num(openTenders),
      openGrants: num(openGrants),
      sources: num(sourcesCount),
      networkCompanies: num(networkCount),
    },
    momentum: {
      newUsers: delta(num(usersWindow, "last30"), num(usersWindow, "prev30")),
      assessments: delta(num(assessWindow, "last30"), num(assessWindow, "prev30")),
      revenueUsd: delta(
        Math.round(num(revenueWindow, "last30") / 100),
        Math.round(num(revenueWindow, "prev30") / 100),
      ),
      paidOrders: delta(num(paidOrdersWindow, "last30"), num(paidOrdersWindow, "prev30")),
    },
    series: {
      userSignups,
      userCumulative,
      assessments,
      revenueUsd: revenueUsdSeries,
      visitors,
    },
    revenueMix,
    subscriptionsByTier,
    funnel,
    traffic: {
      trackedVisitors: num(trafficTotals, "visitors"),
      trackedEvents: num(trafficTotals, "events"),
      demoSessions: num(demoTotal),
    },
    provenance: [
      "Users / assessments / submissions / tenders / grants are live row counts from the production database.",
      "Realized revenue is SUM(purchase_logs.amount_cents) — every completed Stripe checkout. Paid orders count work_orders with payment_status = 'paid'.",
      `Est. MRR = active Pro subscriptions × $${MRR_PER_TIER["tender-intelligence"]}/mo list price; ARR = MRR × 12. Forward-looking, separate from realized revenue.`,
      "Tracked visitors / sessions come from the funnel_events activity log (distinct user_id or anonymous id) and demo_sessions — first-party event tracking, not third-party pageview analytics.",
      "Activation funnel counts are all-time funnel_events by step.",
    ],
  };
}
