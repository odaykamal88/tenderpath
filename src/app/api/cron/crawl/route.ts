import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { upsertTenders, expireAllOverdue } from "@/lib/crawlers/sync";
import { syncAllGrants } from "@/lib/crawlers/grants-sync";
import { crawlUNGM } from "@/lib/crawlers/ungm";
import { crawlUNDP } from "@/lib/crawlers/undp";
import { crawlUNDPAtlas } from "@/lib/crawlers/undp-atlas";
import { crawlReliefWeb } from "@/lib/crawlers/reliefweb";
import { crawlTED } from "@/lib/crawlers/ted-eu";
import { crawlUKFTS } from "@/lib/crawlers/uk-fts";
import { crawlWorldBank } from "@/lib/crawlers/world-bank";
import { crawlSAMGov } from "@/lib/crawlers/sam-gov";
import { crawlGIZ } from "@/lib/crawlers/giz";
import type { CrawlResult } from "@/lib/crawlers/types";

export const maxDuration = 300;

type SourceSummary = {
  source: string;
  notices_added: number;
  notices_updated: number;
  notices_expired: number;
  duration_ms: number;
  status: "success" | "failure" | "partial";
  error?: string;
};

const TENDER_CRAWLERS: Array<() => Promise<CrawlResult>> = [
  crawlUNGM,
  crawlReliefWeb,
  crawlTED,
  crawlUKFTS,
  crawlWorldBank,
  crawlSAMGov,
  crawlGIZ,
  crawlUNDP,
  crawlUNDPAtlas,
];

async function logSource(s: SourceSummary): Promise<void> {
  await sql`
    INSERT INTO crawl_logs (
      platform, status, duration_ms,
      tenders_added, tenders_updated, tenders_expired
    ) VALUES (
      ${s.source}, ${s.status}, ${s.duration_ms},
      ${s.notices_added}, ${s.notices_updated}, ${s.notices_expired}
    )
  `;
}

async function runCrawl(): Promise<object> {
  const sources: SourceSummary[] = [];
  const globalStart = Date.now();

  // Sequential — avoid hammering proxies with concurrent requests
  for (const crawl of TENDER_CRAWLERS) {
    let result: CrawlResult;
    try {
      result = await crawl();
    } catch (err) {
      const summary: SourceSummary = {
        source: "unknown",
        notices_added: 0, notices_updated: 0, notices_expired: 0,
        duration_ms: 0, status: "failure",
        error: err instanceof Error ? err.message : String(err),
      };
      await logSource(summary);
      sources.push(summary);
      continue;
    }

    if (result.status === "failure") {
      const summary: SourceSummary = {
        source: result.platform,
        notices_added: 0, notices_updated: 0, notices_expired: 0,
        duration_ms: result.durationMs, status: "failure",
        error: result.error,
      };
      await logSource(summary);
      sources.push(summary);
      continue;
    }

    // Flush immediately — partial results survive timeout
    const { added, updated } = await upsertTenders(result.tenders);
    const summary: SourceSummary = {
      source: result.platform,
      notices_added: added, notices_updated: updated, notices_expired: 0,
      duration_ms: result.durationMs, status: "success",
    };
    await logSource(summary);
    sources.push(summary);
  }

  const expired = await expireAllOverdue();

  // Grants crawlers (sequential internally)
  const grants = await syncAllGrants();
  for (const p of grants.platforms) {
    const summary: SourceSummary = {
      source: p.platform,
      notices_added: p.added, notices_updated: p.updated, notices_expired: 0,
      duration_ms: p.durationMs, status: p.status,
      error: p.error,
    };
    await logSource(summary);
    sources.push(summary);
  }

  const durationMs = Date.now() - globalStart;
  const failures = sources.filter((s) => s.status === "failure");
  const overallStatus =
    failures.length === 0 ? "success" :
    failures.length === sources.length ? "failure" : "partial";

  const totalAdded = sources.reduce((s, r) => s + r.notices_added, 0);
  const totalUpdated = sources.reduce((s, r) => s + r.notices_updated, 0);

  await sql`
    INSERT INTO crawl_logs (
      platform, status, duration_ms,
      tenders_added, tenders_updated, tenders_expired
    ) VALUES (
      'SUMMARY', ${overallStatus}, ${durationMs},
      ${totalAdded}, ${totalUpdated}, ${expired}
    )
  `;

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    status: overallStatus,
    duration_ms: durationMs,
    total_added: totalAdded,
    total_updated: totalUpdated,
    total_expired: expired,
    sources,
  };
}

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runCrawl());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
