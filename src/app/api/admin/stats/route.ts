import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";

type WorkerHealth = {
  configured: boolean;
  ok: boolean;
  status: "healthy" | "degraded" | "unconfigured" | "unreachable";
  endpoint?: string;
  browser?: string;
  browserError?: string | null;
  version?: string;
  checkedAt: string;
  durationMs?: number;
  error?: string;
};

type PlatformStatus = "healthy" | "degraded" | "down" | "never_run";

type ExpectedPlatform = {
  platform: string;
  role: "primary" | "supplement";
  staleAfterHours: number;
  minOpenTenders?: number;
};

type SourceHealth = {
  platform: string;
  role: "primary" | "supplement" | "observed";
  status: PlatformStatus;
  last_run: string | null;
  last_success: string | null;
  added_24h: number;
  updated_24h: number;
  failures_24h: number;
  open_tenders: number;
  message: string;
};

type SourceQuality = {
  platform: string;
  open_tenders: number;
  description_complete_pct: number;
  deadline_complete_pct: number;
  sector_complete_pct: number;
  source_url_complete_pct: number;
  broken_link_pct: number;
  thin_descriptions: number;
  quality_status: "healthy" | "degraded" | "critical";
  message: string;
};

type UngmFamilyHealth = {
  status: "healthy" | "degraded" | "critical";
  message: string;
  agencies: Array<{
    agency: string;
    open_tenders: number;
  }>;
};

const EXPECTED_PLATFORMS: ExpectedPlatform[] = [
  { platform: "UNGM", role: "primary", staleAfterHours: 26, minOpenTenders: 20 },
  { platform: "World Bank", role: "primary", staleAfterHours: 36, minOpenTenders: 5 },
  { platform: "TED EU", role: "primary", staleAfterHours: 36, minOpenTenders: 5 },
  { platform: "SAM.gov", role: "primary", staleAfterHours: 36 },
  { platform: "UNDP Atlas", role: "primary", staleAfterHours: 36 },
  { platform: "ADB", role: "primary", staleAfterHours: 48 },
  { platform: "EBRD", role: "primary", staleAfterHours: 48 },
  { platform: "UNRWA", role: "primary", staleAfterHours: 48 },
  { platform: "ReliefWeb", role: "supplement", staleAfterHours: 48 },
  { platform: "DevelopmentAid NPO", role: "supplement", staleAfterHours: 72 },
  { platform: "NRC", role: "supplement", staleAfterHours: 72 },
  { platform: "KfW", role: "primary", staleAfterHours: 72 },
  { platform: "GIZ", role: "primary", staleAfterHours: 72 },
  { platform: "AFD", role: "primary", staleAfterHours: 72 },
  { platform: "ADA", role: "primary", staleAfterHours: 72 },
  { platform: "UNDP", role: "primary", staleAfterHours: 72 },
];

const UNGM_FAMILY_AGENCIES = [
  { agency: "UNICEF", patterns: ["UNICEF", "United Nations Children's Fund"] },
  { agency: "UNHCR", patterns: ["UNHCR", "United Nations High Commissioner for Refugees"] },
  { agency: "IOM", patterns: ["IOM", "International Organization for Migration"] },
  { agency: "ILO", patterns: ["ILO", "International Labour Organization", "International Labor Organization"] },
  { agency: "WFP", patterns: ["WFP", "World Food Programme", "World Food Program"] },
  { agency: "UNOPS", patterns: ["UNOPS", "United Nations Office for Project Services"] },
];

function workerHealthEndpoint(): string | null {
  const raw = process.env.CRAWLER_WORKER_URL;
  if (!raw) return null;
  return new URL("/health", raw).toString();
}

async function checkWorkerHealth(): Promise<WorkerHealth> {
  const endpoint = workerHealthEndpoint();
  const key = process.env.CRAWLER_WORKER_KEY;
  const checkedAt = new Date().toISOString();

  if (!endpoint || !key) {
    return {
      configured: false,
      ok: false,
      status: "unconfigured",
      checkedAt,
      error: "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "GET",
        headers: { "X-Crawler-Key": key },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = (await res.json().catch(() => ({}))) as Partial<WorkerHealth>;
    return {
      configured: true,
      ok: res.ok && body.ok === true,
      status: res.ok && body.ok === true ? "healthy" : "degraded",
      endpoint,
      browser: body.browser,
      browserError: body.browserError ?? null,
      version: body.version,
      checkedAt: body.checkedAt ?? checkedAt,
      durationMs: body.durationMs,
      error: res.ok ? body.error : `Worker health HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      status: "unreachable",
      endpoint,
      checkedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function hoursSince(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return (Date.now() - time) / 3_600_000;
}

function buildSourceHealth(
  logRows: Array<{
    platform: string;
    last_run: string | null;
    last_success: string | null;
    added_24h: number | string | null;
    updated_24h: number | string | null;
    failures_24h: number | string | null;
  }>,
  openRows: Array<{ platform: string; open_tenders: number | string | null }>,
): SourceHealth[] {
  const expectedByPlatform = new Map(EXPECTED_PLATFORMS.map((p) => [p.platform, p]));
  const logsByPlatform = new Map(logRows.map((r) => [r.platform, r]));
  const openByPlatform = new Map(openRows.map((r) => [r.platform, Number(r.open_tenders ?? 0)]));
  const allPlatforms = new Set([
    ...EXPECTED_PLATFORMS.map((p) => p.platform),
    ...logRows.map((r) => r.platform),
    ...openRows.map((r) => r.platform),
  ]);

  return [...allPlatforms].map((platform) => {
    const expected = expectedByPlatform.get(platform);
    const log = logsByPlatform.get(platform);
    const lastSuccess = log?.last_success ?? null;
    const lastRun = log?.last_run ?? null;
    const failures = Number(log?.failures_24h ?? 0);
    const openTenders = openByPlatform.get(platform) ?? 0;
    const staleHours = expected ? hoursSince(lastSuccess) : null;
    const minOpen = expected?.minOpenTenders ?? 0;

    let status: PlatformStatus = "healthy";
    let message = "Recent successful crawl.";

    if (!lastRun) {
      status = "never_run";
      message = expected ? "Expected source has no crawl log yet." : "Observed source has tenders but no crawl log.";
    } else if (!lastSuccess) {
      status = "down";
      message = "No successful crawl recorded.";
    } else if (failures > 0) {
      status = "degraded";
      message = `${failures} failure${failures === 1 ? "" : "s"} in the last 24h.`;
    } else if (staleHours != null && expected && staleHours > expected.staleAfterHours) {
      status = "degraded";
      message = `Last success is ${Math.round(staleHours)}h old; threshold is ${expected.staleAfterHours}h.`;
    } else if (openTenders < minOpen) {
      status = "degraded";
      message = `Only ${openTenders} open tender${openTenders === 1 ? "" : "s"}; expected at least ${minOpen}.`;
    }

    return {
      platform,
      role: expected?.role ?? ("observed" as const),
      status,
      last_run: lastRun,
      last_success: lastSuccess,
      added_24h: Number(log?.added_24h ?? 0),
      updated_24h: Number(log?.updated_24h ?? 0),
      failures_24h: failures,
      open_tenders: openTenders,
      message,
    };
  }).sort((a, b) => {
    const order: Record<PlatformStatus, number> = { down: 0, never_run: 1, degraded: 2, healthy: 3 };
    return order[a.status] - order[b.status] || a.platform.localeCompare(b.platform);
  });
}

function buildUngmFamilyHealth(
  rows: Array<{ agency: string; open_tenders: number | string | null }>,
): UngmFamilyHealth {
  const agencies = UNGM_FAMILY_AGENCIES.map(({ agency, patterns }) => {
    const openTenders = rows.reduce((sum, row) => {
      const rowAgency = row.agency.toLowerCase();
      const matched = patterns.some((pattern) => rowAgency.includes(pattern.toLowerCase()));
      return matched ? sum + Number(row.open_tenders ?? 0) : sum;
    }, 0);
    return { agency, open_tenders: openTenders };
  });
  const missing = agencies.filter((a) => a.open_tenders === 0);

  if (missing.length === agencies.length) {
    return {
      status: "critical",
      message: "No open tenders found for the tracked UN-family agencies inside UNGM coverage.",
      agencies,
    };
  }

  if (missing.length > 0) {
    return {
      status: "degraded",
      message: `No open tenders currently visible for ${missing.map((a) => a.agency).join(", ")}.`,
      agencies,
    };
  }

  return {
    status: "healthy",
    message: "Tracked UN-family agencies have open tender coverage.",
    agencies,
  };
}

function pct(value: number | string | null | undefined): number {
  return Math.round(Number(value ?? 0));
}

function buildSourceQuality(
  rows: Array<{
    platform: string;
    open_tenders: number | string | null;
    description_complete_pct: number | string | null;
    deadline_complete_pct: number | string | null;
    sector_complete_pct: number | string | null;
    source_url_complete_pct: number | string | null;
    broken_link_pct: number | string | null;
    thin_descriptions: number | string | null;
  }>,
): SourceQuality[] {
  return rows.map((row) => {
    const descriptionPct = pct(row.description_complete_pct);
    const deadlinePct = pct(row.deadline_complete_pct);
    const sectorPct = pct(row.sector_complete_pct);
    const sourceUrlPct = pct(row.source_url_complete_pct);
    const brokenPct = pct(row.broken_link_pct);
    const thinDescriptions = Number(row.thin_descriptions ?? 0);
    const weakFields: string[] = [];

    if (descriptionPct < 70) weakFields.push("descriptions");
    if (deadlinePct < 70) weakFields.push("deadlines");
    if (sectorPct < 70) weakFields.push("sectors");
    if (sourceUrlPct < 95) weakFields.push("source URLs");
    if (brokenPct > 10) weakFields.push("broken links");

    const qualityStatus: SourceQuality["quality_status"] =
      descriptionPct < 50 || deadlinePct < 50 || sourceUrlPct < 85 || brokenPct > 20
        ? "critical"
        : weakFields.length > 0
        ? "degraded"
        : "healthy";

    return {
      platform: row.platform,
      open_tenders: Number(row.open_tenders ?? 0),
      description_complete_pct: descriptionPct,
      deadline_complete_pct: deadlinePct,
      sector_complete_pct: sectorPct,
      source_url_complete_pct: sourceUrlPct,
      broken_link_pct: brokenPct,
      thin_descriptions: thinDescriptions,
      quality_status: qualityStatus,
      message: weakFields.length > 0
        ? `Weak field coverage: ${weakFields.join(", ")}.`
        : "Core matching fields look usable.",
    };
  }).sort((a, b) => {
    const order: Record<SourceQuality["quality_status"], number> = { critical: 0, degraded: 1, healthy: 2 };
    return order[a.quality_status] - order[b.quality_status] || a.platform.localeCompare(b.platform);
  });
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const [
    users,
    assessments,
    tenders,
    subscriptions,
    recentCrawls,
    platformLogRows,
    platformOpenRows,
    sourceQualityRows,
    ungmFamilyRows,
    workerHealth,
  ] = await Promise.all([
    sql`SELECT COUNT(*) as count FROM users`,
    sql`SELECT COUNT(*) as count FROM assessments`,
    sql`SELECT COUNT(*) as count FROM tenders WHERE status = 'open'`,
    sql`SELECT tier, COUNT(*) as count FROM subscriptions WHERE status = 'active' GROUP BY tier`,
    sql`
      SELECT
        id,
        created_at AS started_at,
        platform,
        COALESCE(status, 'unknown') AS status,
        duration_ms,
        tenders_added,
        tenders_updated,
        tenders_expired,
        broken_links,
        NULLIF(errors::text, '[]') AS error
      FROM crawl_logs
      ORDER BY created_at DESC
      LIMIT 10
    `,
    // Per-platform: last successful run time + last run time + 24h tender totals.
    // Lets ops answer "was UNGM healthy in the last 24 hours?" at a glance.
    sql`
      SELECT
        platform,
        MAX(created_at) AS last_run,
        MAX(CASE WHEN status = 'success' THEN created_at END) AS last_success,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_added ELSE 0 END) AS added_24h,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_updated ELSE 0 END) AS updated_24h,
        COUNT(CASE WHEN status = 'failure' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS failures_24h
      FROM crawl_logs
      GROUP BY platform
      ORDER BY platform
    `,
    sql`
      SELECT source_name AS platform, COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open' AND source_name IS NOT NULL
      GROUP BY source_name
    `,
    sql`
      SELECT
        source_name AS platform,
        COUNT(*) AS open_tenders,
        AVG(CASE WHEN description IS NOT NULL AND LENGTH(TRIM(description)) >= 120 THEN 100 ELSE 0 END) AS description_complete_pct,
        AVG(CASE WHEN deadline IS NOT NULL THEN 100 ELSE 0 END) AS deadline_complete_pct,
        AVG(CASE WHEN sector IS NOT NULL AND TRIM(sector) <> '' THEN 100 ELSE 0 END) AS sector_complete_pct,
        AVG(CASE WHEN source_url IS NOT NULL AND TRIM(source_url) <> '' THEN 100 ELSE 0 END) AS source_url_complete_pct,
        AVG(CASE WHEN has_broken_link IS TRUE THEN 100 ELSE 0 END) AS broken_link_pct,
        SUM(CASE WHEN description IS NULL OR LENGTH(TRIM(description)) < 120 THEN 1 ELSE 0 END) AS thin_descriptions
      FROM tenders
      WHERE status = 'open' AND source_name IS NOT NULL
      GROUP BY source_name
      HAVING COUNT(*) > 0
    `,
    sql`
      SELECT agency, COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open'
        AND source_name = 'UNGM'
        AND agency IS NOT NULL
      GROUP BY agency
      ORDER BY agency
    `,
    checkWorkerHealth(),
  ]);

  const platformHealth = buildSourceHealth(
    platformLogRows as Array<{
      platform: string;
      last_run: string | null;
      last_success: string | null;
      added_24h: number | string | null;
      updated_24h: number | string | null;
      failures_24h: number | string | null;
    }>,
    platformOpenRows as Array<{ platform: string; open_tenders: number | string | null }>,
  );
  const ungmFamilyHealth = buildUngmFamilyHealth(
    ungmFamilyRows as Array<{ agency: string; open_tenders: number | string | null }>,
  );
  const sourceQuality = buildSourceQuality(
    sourceQualityRows as Array<{
      platform: string;
      open_tenders: number | string | null;
      description_complete_pct: number | string | null;
      deadline_complete_pct: number | string | null;
      sector_complete_pct: number | string | null;
      source_url_complete_pct: number | string | null;
      broken_link_pct: number | string | null;
      thin_descriptions: number | string | null;
    }>,
  );

  return NextResponse.json({
    totalUsers: users[0]?.count ?? 0,
    totalAssessments: assessments[0]?.count ?? 0,
    openTenders: tenders[0]?.count ?? 0,
    activeSubscriptions: subscriptions,
    recentCrawls,
    platformHealth,
    sourceQuality,
    ungmFamilyHealth,
    workerHealth,
  });
}
