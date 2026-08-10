import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { crawlerWorkerEndpoints } from "@/lib/crawlers/worker-endpoints";

export const dynamic = "force-dynamic";

// Sources we expect to produce fresh tenders inside the listed window.
// Kept in sync with EXPECTED_PLATFORMS in /api/admin/source-health; copied here
// to avoid pulling the admin module (which depends on auth) into a public route.
const STALE_AFTER_HOURS: Record<string, number> = {
  UNGM: 26,
  "World Bank": 36,
  "TED EU": 36,
  "UK Find a Tender": 48,
  "SAM.gov": 36,
  "UNDP Atlas": 36,
  IDB: 48,
  ReliefWeb: 48,
  KfW: 72,
  GIZ: 72,
  AFD: 72,
  ADA: 72,
  JICA: 72,
  NRC: 72,
  UNDP: 48,
  "DevelopmentAid NPO": 72,
};

interface ShallowHealth {
  status: "ok" | "degraded";
  db: "connected" | "disconnected";
  timestamp: string;
}

interface DeepHealth extends ShallowHealth {
  open_tenders: number;
  stale_sources: string[];
  fresh_sources: string[];
  worker?: { status: "ok" | "unreachable" | "unconfigured"; latency_ms?: number; error?: string };
}

async function deepHealth(): Promise<{ body: DeepHealth; httpStatus: number }> {
  const timestamp = new Date().toISOString();

  // Step 1 — DB
  let dbOk = false;
  try {
    await sql`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  if (!dbOk) {
    return {
      body: {
        status: "degraded",
        db: "disconnected",
        timestamp,
        open_tenders: 0,
        stale_sources: [],
        fresh_sources: [],
      },
      httpStatus: 503,
    };
  }

  // Step 2 — open-tender count and freshness per source.
  // We base "stale" on the latest successful crawl_logs row per platform.
  const [tenderCountRows, latestCrawls] = await Promise.all([
    sql`
      SELECT COUNT(*) AS open_tenders
      FROM tenders
      WHERE status = 'open'
        AND (deadline IS NULL OR deadline >= CURRENT_DATE)
    ` as unknown as Promise<Array<{ open_tenders: string | number | null }>>,
    sql`
      SELECT
        platform,
        MAX(created_at) FILTER (WHERE status IN ('success', 'success_empty')) AS last_success
      FROM crawl_logs
      WHERE platform <> 'SUMMARY'
      GROUP BY platform
    ` as unknown as Promise<Array<{ platform: string; last_success: string | null }>>,
  ]);

  const openTenders = Number(tenderCountRows[0]?.open_tenders ?? 0);
  const nowMs = Date.now();
  const stale: string[] = [];
  const fresh: string[] = [];

  for (const [platform, staleAfterHours] of Object.entries(STALE_AFTER_HOURS)) {
    const row = latestCrawls.find((r) => r.platform === platform);
    if (!row?.last_success) {
      stale.push(platform);
      continue;
    }
    const ageHours = (nowMs - new Date(row.last_success).getTime()) / 36e5;
    if (ageHours > staleAfterHours) {
      stale.push(platform);
    } else {
      fresh.push(platform);
    }
  }

  // Step 3 — best-effort browser-worker ping (only if configured).
  let workerEndpoint: string | null = null;
  let workerConfigError: string | null = null;
  try {
    workerEndpoint = crawlerWorkerEndpoints()?.health ?? null;
  } catch (err) {
    workerConfigError = err instanceof Error ? err.message : String(err);
    console.error("[health:worker:invalid_config]", { error: workerConfigError });
  }
  const workerKey = process.env.CRAWLER_WORKER_KEY;
  let worker: DeepHealth["worker"];
  if (workerEndpoint && workerKey) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 4_000);
      let res: Response;
      try {
        res = await fetch(workerEndpoint, {
          headers: { "X-Crawler-Key": workerKey },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(t);
      }
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; browser?: string; error?: string };
      worker = res.ok && body.ok === true && body.browser === "ok"
        ? { status: "ok", latency_ms: Date.now() - start }
        : {
            status: "unreachable",
            latency_ms: Date.now() - start,
            error: body.error ?? `HTTP ${res.status}`,
          };
    } catch (err) {
      const message = err instanceof Error ? err.message : "fetch failed";
      console.error("[health:worker:unreachable]", { endpoint: workerEndpoint, error: message });
      worker = {
        status: "unreachable",
        latency_ms: Date.now() - start,
        error: message,
      };
    }
  } else {
    worker = {
      status: "unconfigured",
      error: workerConfigError ?? "CRAWLER_WORKER_URL / CRAWLER_WORKER_KEY not set",
    };
  }

  // A deep-health response is "degraded" if any of the load-bearing sources is
  // stale or the browser worker is unreachable. Vercel routes that consume this
  // can treat 503 as a yellow light.
  const loadBearing = new Set(["UNGM", "World Bank", "TED EU"]);
  const loadBearingStale = stale.some((s) => loadBearing.has(s));
  const degraded = loadBearingStale || worker.status !== "ok" || openTenders === 0;

  return {
    body: {
      status: degraded ? "degraded" : "ok",
      db: "connected",
      timestamp,
      open_tenders: openTenders,
      stale_sources: stale,
      fresh_sources: fresh,
      worker,
    },
    httpStatus: degraded ? 503 : 200,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const deep = url.searchParams.get("deep") === "1";

  if (!deep) {
    try {
      await sql`SELECT 1`;
      return NextResponse.json<ShallowHealth>({
        status: "ok",
        db: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      return NextResponse.json<ShallowHealth>(
        { status: "degraded", db: "disconnected", timestamp: new Date().toISOString() },
        { status: 503 },
      );
    }
  }

  const { body, httpStatus } = await deepHealth();
  return NextResponse.json(body, { status: httpStatus });
}
