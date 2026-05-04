import { sql } from "../db";
import { type CrawlResult, type RawTender, dedupKey, verifyLink } from "./types";
import { crawlUNGM } from "./ungm";
import { crawlIOM } from "./iom";
import { crawlUNDP } from "./undp";
import { crawlUNDPAtlas } from "./undp-atlas";
// UN agencies consolidated into ungm.ts via residential proxy
// Covers: UNICEF, WFP, WHO, UNHCR, IOM, UNDP, and 50+ other UN bodies
// import { crawlWFP } from "./wfp"; // disabled — posts to UNGM
import { crawlReliefWeb } from "./reliefweb";
import { crawlTED } from "./ted-eu";
import { crawlUKFTS } from "./uk-fts";
import { crawlWorldBank } from "./world-bank";
import { crawlSAMGov } from "./sam-gov";
import { crawlGIZ } from "./giz";
import { crawlDevelopmentAidNPO } from "./developmentaid-npo";
import { crawlADB } from "./adb";
import { crawlEBRD } from "./ebrd";
import { crawlUNRWA } from "./unrwa";
import { crawlAfDB } from "./afdb";
import { crawlIDB } from "./idb";
import { crawlNRC } from "./nrc";
import { crawlKfW } from "./kfw";
import { crawlAFD } from "./afd";
import { crawlADA } from "./ada";
import { crawlJICA } from "./jica";
// crawlUNOPS — disabled: UNOPS posts to UNGM by mandate; already captured by crawlUNGM()

export interface PlatformSyncResult {
  platform: string;
  status: "success" | "success_empty" | "failure";
  added: number;
  updated: number;
  expired: number;
  brokenLinks: number;
  durationMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SyncSummary {
  results: PlatformSyncResult[];
  totalAdded: number;
  totalUpdated: number;
  totalExpired: number;
  totalDeduped: number;
  totalBrokenLinks: number;
}

/**
 * Source-priority order. When the same tender appears in multiple feeds,
 * we keep the entry from the highest-priority source.
 */
const SOURCE_PRIORITY: Record<string, number> = {
  UNGM: 100,
  IOM: 102,
  "World Bank": 95,
  "TED EU": 90,
  "SAM.gov": 85,
  "UK Find a Tender": 80,
  "UNDP Atlas": 75,
  ADB: 75,
  AfDB: 75,
  IDB: 75,
  EBRD: 75,
  UNRWA: 72,
  ReliefWeb: 70,
  NRC: 65,
  JICA: 65,
  KfW: 65,
  UNDP: 60,
  GIZ: 60,
  AFD: 60,
  ADA: 55,
  "DevelopmentAid NPO": 40,
};

function normalizeCountryName(country: string): string {
  const trimmed = country.trim();
  const key = trimmed.toLowerCase();
  if (["turkiye", "türkiye"].includes(key)) return "Turkey";
  if (key === "syrian arab republic") return "Syria";
  if (["usa", "u.s.a.", "united states of america"].includes(key)) return "United States";
  return trimmed;
}

function dedupeTenders(tenders: RawTender[]): { kept: RawTender[]; deduped: number } {
  const byKey = new Map<string, RawTender>();
  let deduped = 0;
  for (const t of tenders) {
    const key = dedupKey(t);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, t);
      continue;
    }
    deduped++;
    const newPri = SOURCE_PRIORITY[t.source_name] ?? 0;
    const oldPri = SOURCE_PRIORITY[existing.source_name] ?? 0;
    if (newPri > oldPri) byKey.set(key, t);
  }
  return { kept: [...byKey.values()], deduped };
}

function outputQuality(tenders: RawTender[]): Record<string, unknown> {
  const total = tenders.length;
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  const hasText = (value: string | null | undefined, min = 1) =>
    typeof value === "string" && value.trim().length >= min;

  const descriptions = tenders.filter((t) => hasText(t.description, 120)).length;
  const deadlines = tenders.filter((t) => hasText(t.deadline)).length;
  const sectors = tenders.filter((t) => hasText(t.sector)).length;
  const urls = tenders.filter((t) => hasText(t.source_url)).length;
  const values = tenders.filter((t) => hasText(t.estimated_value)).length;

  return {
    descriptionCompletePct: pct(descriptions),
    deadlineCompletePct: pct(deadlines),
    sectorCompletePct: pct(sectors),
    sourceUrlCompletePct: pct(urls),
    estimatedValueCompletePct: pct(values),
    thinDescriptions: total - descriptions,
    missingDeadlines: total - deadlines,
    missingSectors: total - sectors,
    missingSourceUrls: total - urls,
  };
}

/**
 * Verify source URLs concurrently before upsert. Tenders with unreachable
 * links are dropped — it's better to show fewer real tenders than surface
 * fake URLs that 404 when the user clicks them. Concurrency is bounded so
 * we don't hammer providers.
 */
async function filterLiveLinks(tenders: RawTender[], concurrency = 10): Promise<{ live: RawTender[]; dropped: number }> {
  const live: RawTender[] = [];
  let dropped = 0;
  let idx = 0;
  const sourceVerifiedNoticeLink = (t: RawTender) =>
    t.source_name === "UNGM" &&
    /^UNGM-/.test(t.reference_id) &&
    (t.source_url?.startsWith("https://www.ungm.org/Public/Notice/") ?? false);

  async function worker() {
    while (idx < tenders.length) {
      const i = idx++;
      const t = tenders[i];
      if (!t.source_url) { live.push(t); continue; }
      if (sourceVerifiedNoticeLink(t)) { live.push(t); continue; }
      const ok = await verifyLink(t.source_url);
      if (ok) live.push(t);
      else dropped++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tenders.length) }, worker));
  return { live, dropped };
}

export async function upsertTenders(tenders: RawTender[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  for (const t of tenders) {
    if (!t.reference_id || !t.title) continue;
    const country = normalizeCountryName(t.country);

    const result = await sql`
      INSERT INTO tenders (
        reference_id, title, description, agency, country, country_code,
        region, sector, deadline, estimated_value, source_url, status,
        source_tier, source_name, opportunity_type, eligibility_summary,
        experience_level, submission_language, updated_at
      ) VALUES (
        ${t.reference_id}, ${t.title}, ${t.description}, ${t.agency},
        ${country}, ${t.country_code}, ${t.region}, ${t.sector},
        ${t.deadline}, ${t.estimated_value}, ${t.source_url}, 'open',
        ${t.source_tier}, ${t.source_name}, ${t.opportunity_type},
        ${t.eligibility_summary}, ${t.experience_level ?? 'any'},
        ${t.submission_language}, NOW()
      )
      ON CONFLICT (reference_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = COALESCE(EXCLUDED.description, tenders.description),
        deadline = COALESCE(EXCLUDED.deadline, tenders.deadline),
        source_url = COALESCE(EXCLUDED.source_url, tenders.source_url),
        country = EXCLUDED.country,
        sector = COALESCE(EXCLUDED.sector, tenders.sector),
        opportunity_type = EXCLUDED.opportunity_type,
        estimated_value = COALESCE(EXCLUDED.estimated_value, tenders.estimated_value),
        eligibility_summary = COALESCE(EXCLUDED.eligibility_summary, tenders.eligibility_summary),
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert
    `;

    if (result[0]?.is_insert) added++;
    else updated++;
  }

  return { added, updated };
}

export async function expireAllOverdue(): Promise<number> {
  const result = await sql`
    UPDATE tenders
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < CURRENT_DATE
    RETURNING id
  `;
  return result.length;
}

/**
 * Sample-verify recent source URLs. Bounded sample so we don't hammer providers.
 * Requires `last_link_check TIMESTAMP` and `has_broken_link BOOLEAN` columns.
 */
async function verifyRecentLinks(sampleSize = 30): Promise<number> {
  const rows = (await sql`
    SELECT id, source_url
    FROM tenders
    WHERE status = 'open'
      AND source_url IS NOT NULL
      AND (last_link_check IS NULL OR last_link_check < NOW() - INTERVAL '7 days')
    ORDER BY updated_at DESC
    LIMIT ${sampleSize}
  `) as Array<{ id: number; source_url: string }>;

  let broken = 0;
  await Promise.all(rows.map(async (r) => {
    const ok = await verifyLink(r.source_url);
    if (!ok) broken++;
    await sql`
      UPDATE tenders
      SET has_broken_link = ${!ok}, last_link_check = NOW()
      WHERE id = ${r.id}
    `;
  }));
  return broken;
}

async function logCrawl(r: PlatformSyncResult): Promise<void> {
  const errors = r.error
    ? JSON.stringify([{ status: r.status, error: r.error, durationMs: r.durationMs, metadata: r.metadata ?? {} }])
    : null;
  const metadata = JSON.stringify(r.metadata ?? {});

  await sql`
    ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'
  `;

  await sql`
    INSERT INTO crawl_logs (
      platform, status, duration_ms,
      tenders_added, tenders_updated, tenders_expired, broken_links, errors, metadata
    ) VALUES (
      ${r.platform}, ${r.status}, ${r.durationMs},
      ${r.added}, ${r.updated}, ${r.expired}, ${r.brokenLinks}, ${errors}, ${metadata}
    )
  `;
}

export async function syncAllTenders(): Promise<SyncSummary> {
  // Tier-1 free APIs first; legacy HTML scrapers kept as fallback fillers.
  // UN agencies consolidated into ungm.ts via residential proxy —
  // covers UNICEF, WFP, WHO, UNHCR, IOM, UNDP, and 50+ other UN bodies.
  const crawls = await Promise.allSettled([
    crawlUNGM(),
    crawlIOM(),
    crawlReliefWeb(),
    crawlTED(),
    crawlUKFTS(),
    crawlWorldBank(),
    crawlSAMGov(),
    crawlGIZ(),
    crawlUNDP(),
    crawlUNDPAtlas(),
    crawlADB(),
    crawlAfDB(),
    crawlIDB(),
    crawlEBRD(),
    crawlUNRWA(),
    crawlDevelopmentAidNPO(),
    crawlNRC(),
    crawlKfW(),
    crawlAFD(),
    crawlJICA(),
    crawlADA(),
    // crawlWFP(),    — disabled, posts to UNGM
    // crawlUNOPS()  — disabled: already covered by UNGM (UNOPS posts to UNGM by mandate)
  ]);

  const settledResults: CrawlResult[] = [];
  const results: PlatformSyncResult[] = [];

  for (const settled of crawls) {
    if (settled.status === "fulfilled") {
      settledResults.push(settled.value);
    } else {
      const errResult: PlatformSyncResult = {
        platform: "unknown", status: "failure",
        added: 0, updated: 0, expired: 0, brokenLinks: 0, durationMs: 0,
        error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      };
      await logCrawl(errResult);
      results.push(errResult);
    }
  }

  // Cross-source dedup before any DB writes.
  const allTenders = settledResults.flatMap((c) => c.status === "success" ? c.tenders : []);
  const { kept, deduped } = dedupeTenders(allTenders);
  const keptKeys = new Set(kept.map(dedupKey));

  for (const crawl of settledResults) {
    if (crawl.status === "failure") {
      const r: PlatformSyncResult = {
        platform: crawl.platform, status: "failure",
        added: 0, updated: 0, expired: 0, brokenLinks: 0,
        durationMs: crawl.durationMs, error: crawl.error,
        metadata: {
          crawlerStatus: crawl.status,
          rawTenders: crawl.tenders.length,
          outputQuality: outputQuality(crawl.tenders),
        },
      };
      await logCrawl(r);
      results.push(r);
      continue;
    }

    const survivors = crawl.tenders.filter((t) => keptKeys.has(dedupKey(t)));
    const { live, dropped } = await filterLiveLinks(survivors);
    const { added, updated } = await upsertTenders(live);
    const producedUsefulRecords = live.length > 0 || added > 0 || updated > 0;

    const r: PlatformSyncResult = {
      platform: crawl.platform,
      status: producedUsefulRecords ? "success" : "success_empty",
      added, updated, expired: 0, brokenLinks: dropped,
      durationMs: crawl.durationMs,
      metadata: {
        rawTenders: crawl.tenders.length,
        dedupedSurvivors: survivors.length,
        liveTenders: live.length,
        droppedBrokenLinks: dropped,
        outputQuality: outputQuality(live),
      },
    };
    await logCrawl(r);
    results.push(r);
  }

  const totalExpired = await expireAllOverdue();
  const totalBrokenLinks = await verifyRecentLinks();

  return {
    results,
    totalAdded: results.reduce((s, r) => s + r.added, 0),
    totalUpdated: results.reduce((s, r) => s + r.updated, 0),
    totalExpired,
    totalDeduped: deduped,
    totalBrokenLinks,
  };
}
