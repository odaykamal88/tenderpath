import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { SOURCE_COVERAGE } from "@/lib/crawlers/source-coverage";

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
  issue_class: "none" | "job_not_running" | "crawler_failure" | "empty_output" | "stale_success" | "low_inventory";
  likely_cause: string;
  next_action: string;
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

type SourceQualityThresholds = {
  descriptionMin: number;
  deadlineMin: number;
  sectorMin: number;
  sourceUrlMin: number;
  brokenLinkMax: number;
  criticalDescriptionMin: number;
  criticalDeadlineMin: number;
  criticalSectorMin: number;
  criticalSourceUrlMin: number;
  criticalBrokenLinkMax: number;
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
  { platform: "UK Find a Tender", role: "primary", staleAfterHours: 48 },
  { platform: "SAM.gov", role: "primary", staleAfterHours: 36 },
  { platform: "UNDP Atlas", role: "primary", staleAfterHours: 36 },
  { platform: "ADB", role: "primary", staleAfterHours: 48 },
  { platform: "AfDB", role: "primary", staleAfterHours: 72 },
  { platform: "IDB", role: "primary", staleAfterHours: 48 },
  { platform: "EBRD", role: "primary", staleAfterHours: 48 },
  { platform: "ReliefWeb", role: "supplement", staleAfterHours: 48 },
  { platform: "DevelopmentAid NPO", role: "supplement", staleAfterHours: 72 },
  { platform: "NRC", role: "supplement", staleAfterHours: 72 },
  { platform: "KfW", role: "primary", staleAfterHours: 72 },
  { platform: "GIZ", role: "primary", staleAfterHours: 72 },
  { platform: "AFD", role: "primary", staleAfterHours: 72 },
  { platform: "ADA", role: "primary", staleAfterHours: 72 },
  { platform: "JICA", role: "primary", staleAfterHours: 72 },
  { platform: "UNDP", role: "primary", staleAfterHours: 72 },
];

const UNGM_FAMILY_AGENCIES = [
  { agency: "UNICEF", patterns: ["UNICEF", "United Nations Children's Fund"] },
  { agency: "UNHCR", patterns: ["UNHCR", "United Nations High Commissioner for Refugees"] },
  { agency: "IOM", patterns: ["IOM", "International Organization for Migration"] },
  { agency: "ILO", patterns: ["ILO", "International Labour Organization", "International Labor Organization"] },
  { agency: "WFP", patterns: ["WFP", "World Food Programme", "World Food Program"] },
  { agency: "WHO", patterns: ["WHO", "World Health Organization"] },
  { agency: "UNOPS", patterns: ["UNOPS", "United Nations Office for Project Services"] },
  { agency: "FAO", patterns: ["FAO", "Food and Agriculture Organization"] },
  { agency: "UNFPA", patterns: ["UNFPA", "United Nations Population Fund"] },
  { agency: "UNESCO", patterns: ["UNESCO", "United Nations Educational, Scientific and Cultural Organization"] },
  { agency: "UN-Women", patterns: ["UN-Women", "UN Women", "United Nations Entity for Gender Equality"] },
  { agency: "UNIDO", patterns: ["UNIDO", "United Nations Industrial Development Organization"] },
  { agency: "IAEA", patterns: ["IAEA", "International Atomic Energy Agency"] },
  { agency: "UNRWA", patterns: ["UNRWA", "United Nations Relief and Works Agency"] },
];

const DEFAULT_QUALITY_THRESHOLDS: SourceQualityThresholds = {
  descriptionMin: 70,
  deadlineMin: 70,
  sectorMin: 70,
  sourceUrlMin: 95,
  brokenLinkMax: 10,
  criticalDescriptionMin: 50,
  criticalDeadlineMin: 50,
  criticalSectorMin: 35,
  criticalSourceUrlMin: 85,
  criticalBrokenLinkMax: 20,
};

const SOURCE_QUALITY_THRESHOLDS: Record<string, Partial<SourceQualityThresholds>> = {
  // UNGM listing fragments intentionally carry little description text. Sector
  // and deadline coverage are the more important launch health signals here.
  UNGM: { descriptionMin: 0, criticalDescriptionMin: 0, sectorMin: 45 },
  "TED EU": { descriptionMin: 50, criticalDescriptionMin: 25, sectorMin: 55 },
  "World Bank": { descriptionMin: 50, criticalDescriptionMin: 25, sectorMin: 55 },
  "SAM.gov": { descriptionMin: 50, criticalDescriptionMin: 25, sectorMin: 55 },
  "UK Find a Tender": { descriptionMin: 40, criticalDescriptionMin: 20 },
  ReliefWeb: { sectorMin: 45, criticalSectorMin: 20 },
  "DevelopmentAid NPO": { descriptionMin: 50, criticalDescriptionMin: 25, sectorMin: 55 },
};

const UNGM_COVERED_LEGACY_LOG_PLATFORMS = new Set(["IOM", "UNRWA"]);

function qualityThresholds(platform: string): SourceQualityThresholds {
  return { ...DEFAULT_QUALITY_THRESHOLDS, ...(SOURCE_QUALITY_THRESHOLDS[platform] ?? {}) };
}

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
    last_empty_success: string | null;
    added_24h: number | string | null;
    updated_24h: number | string | null;
    failures_24h: number | string | null;
    empty_successes_24h: number | string | null;
  }>,
  openRows: Array<{ platform: string; open_tenders: number | string | null }>,
): SourceHealth[] {
  const expectedByPlatform = new Map(EXPECTED_PLATFORMS.map((p) => [p.platform, p]));
  const logsByPlatform = new Map(logRows.map((r) => [r.platform, r]));
  const openByPlatform = new Map(openRows.map((r) => [r.platform, Number(r.open_tenders ?? 0)]));
  const allPlatforms = new Set([
    ...EXPECTED_PLATFORMS.map((p) => p.platform),
    ...logRows.map((r) => r.platform).filter((platform) => !UNGM_COVERED_LEGACY_LOG_PLATFORMS.has(platform)),
    ...openRows.map((r) => r.platform),
  ]);

  return [...allPlatforms].map((platform) => {
    const expected = expectedByPlatform.get(platform);
    const log = logsByPlatform.get(platform);
    const lastSuccess = log?.last_success ?? null;
    const lastEmptySuccess = log?.last_empty_success ?? null;
    const lastRun = log?.last_run ?? null;
    const failures = Number(log?.failures_24h ?? 0);
    const emptySuccesses = Number(log?.empty_successes_24h ?? 0);
    const openTenders = openByPlatform.get(platform) ?? 0;
    const staleHours = expected ? hoursSince(lastSuccess) : null;
    const minOpen = expected?.minOpenTenders ?? 0;

    let status: PlatformStatus = "healthy";
    let message = "Recent successful crawl.";
    let issueClass: SourceHealth["issue_class"] = "none";
    let likelyCause = "Crawler is producing usable records inside the expected freshness window.";
    let nextAction = "Keep monitoring source freshness and output quality.";

    if (!lastRun) {
      status = "never_run";
      message = expected ? "Expected source has no crawl log yet." : "Observed source has tenders but no crawl log.";
      issueClass = "job_not_running";
      likelyCause = expected ? "Crawler is implemented or expected but not being scheduled/logged." : "Tenders exist from another path, but this source name is not mapped to a crawl log.";
      nextAction = expected ? "Check syncAllTenders schedule and source inclusion." : "Map this observed source to its canonical crawler or document it as aggregator/derived coverage.";
    } else if (!lastSuccess && lastEmptySuccess) {
      status = "degraded";
      message = "Crawler runs, but the latest successful pass produced no useful tender records.";
      issueClass = "empty_output";
      likelyCause = "Crawler completed with zero usable records; selector, pagination, URL, or filtering may be too strict.";
      nextAction = "Run the source crawler directly and inspect metadata/outputQuality in crawl_logs.";
    } else if (!lastSuccess) {
      status = "down";
      message = "No successful crawl recorded.";
      issueClass = "crawler_failure";
      likelyCause = failures > 0 ? "Recent runs are failing before producing usable records." : "Crawler has run, but no run has been marked successful.";
      nextAction = "Open recent crawl log error/metadata and smoke-test the source-specific crawler.";
    } else if (failures > 0) {
      status = "degraded";
      message = `${failures} failure${failures === 1 ? "" : "s"} in the last 24h.`;
      issueClass = "crawler_failure";
      likelyCause = "Intermittent source or parsing failure in the last day.";
      nextAction = "Review recent crawl_logs.metadata/errors and add retry or selector fix if repeated.";
    } else if (emptySuccesses > 0) {
      status = "degraded";
      message = `${emptySuccesses} crawl${emptySuccesses === 1 ? "" : "s"} in the last 24h produced no useful tender records.`;
      issueClass = "empty_output";
      likelyCause = "Source fetch succeeded but parse/dedupe/filter yielded no records.";
      nextAction = "Check whether source HTML/API changed or whether filters dropped valid records.";
    } else if (staleHours != null && expected && staleHours > expected.staleAfterHours) {
      status = "degraded";
      message = `Last success is ${Math.round(staleHours)}h old; threshold is ${expected.staleAfterHours}h.`;
      issueClass = "stale_success";
      likelyCause = "The scheduled job has not produced a recent success.";
      nextAction = "Check cron execution, source timeout, and whether the freshness threshold is still appropriate.";
    } else if (openTenders < minOpen) {
      status = "degraded";
      message = `Only ${openTenders} open tender${openTenders === 1 ? "" : "s"}; expected at least ${minOpen}.`;
      issueClass = "low_inventory";
      likelyCause = "Crawler is healthy but current useful inventory is below launch expectations.";
      nextAction = "Verify source query coverage and whether recent opportunities moved to another portal.";
    }

    return {
      platform,
      role: expected?.role ?? ("observed" as const),
      status,
      issue_class: issueClass,
      likely_cause: likelyCause,
      next_action: nextAction,
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
    const thresholds = qualityThresholds(row.platform);
    const descriptionPct = pct(row.description_complete_pct);
    const deadlinePct = pct(row.deadline_complete_pct);
    const sectorPct = pct(row.sector_complete_pct);
    const sourceUrlPct = pct(row.source_url_complete_pct);
    const brokenPct = pct(row.broken_link_pct);
    const thinDescriptions = Number(row.thin_descriptions ?? 0);
    const weakFields: string[] = [];

    if (descriptionPct < thresholds.descriptionMin) weakFields.push("descriptions");
    if (deadlinePct < thresholds.deadlineMin) weakFields.push("deadlines");
    if (sectorPct < thresholds.sectorMin) weakFields.push("sectors");
    if (sourceUrlPct < thresholds.sourceUrlMin) weakFields.push("source URLs");
    if (brokenPct > thresholds.brokenLinkMax) weakFields.push("broken links");

    const qualityStatus: SourceQuality["quality_status"] =
      descriptionPct < thresholds.criticalDescriptionMin
        || deadlinePct < thresholds.criticalDeadlineMin
        || sectorPct < thresholds.criticalSectorMin
        || sourceUrlPct < thresholds.criticalSourceUrlMin
        || brokenPct > thresholds.criticalBrokenLinkMax
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

  await sql`ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`;

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
        NULLIF(errors::text, '[]') AS error,
        metadata
      FROM crawl_logs
      ORDER BY created_at DESC
      LIMIT 10
    `,
    // Per-platform: last successful run time + last run time + 24h tender totals.
    // Lets ops answer "was UNGM healthy in the last 24 hours?" at a glance.
    sql`
      SELECT
        CASE WHEN platform = 'UK FTS' THEN 'UK Find a Tender' ELSE platform END AS platform,
        MAX(created_at) AS last_run,
        MAX(CASE WHEN status = 'success' THEN created_at END) AS last_success,
        MAX(CASE WHEN status = 'success_empty' THEN created_at END) AS last_empty_success,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_added ELSE 0 END) AS added_24h,
        SUM(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN tenders_updated ELSE 0 END) AS updated_24h,
        COUNT(CASE WHEN status = 'failure' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS failures_24h,
        COUNT(CASE WHEN status = 'success_empty' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END) AS empty_successes_24h
      FROM crawl_logs
      GROUP BY CASE WHEN platform = 'UK FTS' THEN 'UK Find a Tender' ELSE platform END
      ORDER BY platform
    `,
    sql`
      SELECT
        CASE
          WHEN source_name IN ('UNICEF', 'WFP', 'WHO') THEN 'UNGM'
          WHEN source_name = 'EU' THEN 'TED EU'
          WHEN source_name = 'USAID/SAM.gov' THEN 'SAM.gov'
          WHEN source_name = 'FCDO' THEN 'UK Find a Tender'
          ELSE source_name
        END AS platform,
        COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open' AND source_name IS NOT NULL
      GROUP BY platform
    `,
    sql`
      SELECT
        CASE
          WHEN source_name IN ('UNICEF', 'WFP', 'WHO') THEN 'UNGM'
          WHEN source_name = 'EU' THEN 'TED EU'
          WHEN source_name = 'USAID/SAM.gov' THEN 'SAM.gov'
          WHEN source_name = 'FCDO' THEN 'UK Find a Tender'
          ELSE source_name
        END AS platform,
        COUNT(*) AS open_tenders,
        AVG(CASE WHEN description IS NOT NULL AND LENGTH(TRIM(description)) >= 120 THEN 100 ELSE 0 END) AS description_complete_pct,
        AVG(CASE WHEN deadline IS NOT NULL THEN 100 ELSE 0 END) AS deadline_complete_pct,
        AVG(CASE WHEN sector IS NOT NULL AND TRIM(sector) <> '' THEN 100 ELSE 0 END) AS sector_complete_pct,
        AVG(CASE WHEN source_url IS NOT NULL AND TRIM(source_url) <> '' THEN 100 ELSE 0 END) AS source_url_complete_pct,
        AVG(CASE WHEN has_broken_link IS TRUE THEN 100 ELSE 0 END) AS broken_link_pct,
        SUM(CASE WHEN description IS NULL OR LENGTH(TRIM(description)) < 120 THEN 1 ELSE 0 END) AS thin_descriptions
      FROM tenders
      WHERE status = 'open' AND source_name IS NOT NULL
      GROUP BY platform
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
      last_empty_success: string | null;
      added_24h: number | string | null;
      updated_24h: number | string | null;
      failures_24h: number | string | null;
      empty_successes_24h: number | string | null;
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
    sourceCoverage: SOURCE_COVERAGE,
    workerHealth,
  });
}
