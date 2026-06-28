import { sql } from "../db";
import { type CrawlResult, type RawTender, dedupKey, verifyLink } from "./types";
import { crawlUNGM } from "./ungm";
import { crawlUNDP } from "./undp";
import { crawlUNDPAtlas } from "./undp-atlas";
// UN agencies consolidated into ungm.ts via residential proxy
// Covers: UNICEF, WFP, WHO, UNHCR, IOM, UNRWA, UNDP, and 50+ other UN bodies
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
import { crawlAfDB } from "./afdb";
import { crawlIDB } from "./idb";
import { crawlISDB } from "./isdb";
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
  /** Cross-posted duplicate rows folded onto a survivor this run (collapseDuplicateTenders). */
  totalCollapsed: number;
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
  IsDB: 75,
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
  const trimmed = country
    .trim()
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&uuml;/gi, "ü")
    .replace(/&amp;/gi, "&");
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
  const sourceVerifiedNoticeLink = (t: RawTender) => {
    const url = t.source_url ?? "";
    if (
      t.source_name === "UNGM" &&
      /^UNGM-/.test(t.reference_id) &&
      url.startsWith("https://www.ungm.org/Public/Notice/")
    ) {
      return true;
    }

    // UK FTS notice pages often return 403 to server-side HEAD/GET checks,
    // even though the OCDS API release is valid and browser-accessible. Trust
    // the official API-derived notice URL so the source is not marked empty.
    return (
      t.source_name === "UK Find a Tender" &&
      /^UKFTS-/.test(t.reference_id) &&
      url.startsWith("https://www.find-tender.service.gov.uk/Notice/")
    );
  };

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

let _dedupSchemaReady: Promise<void> | null = null;

/**
 * Idempotent runtime self-heal for the `dedup_key` column + its partial index.
 * Mirrors the tenders block in scripts/migrate.mjs (which does NOT auto-run on
 * Vercel — see ensureNetworkMatchingColumns / ensureBotRuntimeSchema). This is a
 * plain maintained column, not GENERATED: live `deadline` is timestamptz, and
 * timestamptz→text/date casts are timezone-sensitive enough that Postgres
 * rejects them in generated expressions.
 */
export async function ensureTenderDedupSchema(): Promise<void> {
  if (!_dedupSchemaReady) {
    _dedupSchemaReady = (async () => {
      await sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = 'tenders'
              AND column_name = 'dedup_key'
              AND is_generated <> 'NEVER'
          ) THEN
            DROP INDEX IF EXISTS tenders_dedup_key_open_idx;
            ALTER TABLE tenders DROP COLUMN dedup_key;
          END IF;
        END $$;
      `;
      await sql`ALTER TABLE tenders ADD COLUMN IF NOT EXISTS dedup_key TEXT`;
      await sql`
        UPDATE tenders
        SET dedup_key =
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
          COALESCE(deadline::date::text, '')
        WHERE dedup_key IS DISTINCT FROM (
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(title, '')),  '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
          LEFT(BTRIM(REGEXP_REPLACE(LOWER(COALESCE(agency, '')), '[^a-z0-9]+', ' ', 'g')), 120) || '|' ||
          COALESCE(deadline::date::text, '')
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS tenders_dedup_key_open_idx ON tenders (dedup_key) WHERE status = 'open'`;
    })().catch((err) => {
      _dedupSchemaReady = null;
      throw err;
    });
  }
  return _dedupSchemaReady;
}

export interface CollapseResult {
  /** Duplicate opportunity-groups found (a dedup_key shared by >1 open row). */
  groups: number;
  /** Loser rows superseded (or, in dry-run, that WOULD be). */
  collapsed: number;
  details: Array<{ dedupKey: string; survivorId: number; survivorSource: string | null; loserIds: number[] }>;
  dryRun: boolean;
}

type DupRow = {
  id: number;
  dedup_key: string;
  source_name: string | null;
  updated_at: string | null;
  match_count: number;
};

/** Lower = better survivor: primary source → most matches → most recent → highest id. */
function compareSurvivor(a: DupRow, b: DupRow): number {
  const pa = SOURCE_PRIORITY[a.source_name ?? ""] ?? 0;
  const pb = SOURCE_PRIORITY[b.source_name ?? ""] ?? 0;
  if (pa !== pb) return pb - pa;
  if (a.match_count !== b.match_count) return b.match_count - a.match_count;
  const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
  const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
  if (ta !== tb) return tb - ta;
  return b.id - a.id;
}

/**
 * Fold cross-posted duplicate tenders onto one canonical survivor. Overlapping
 * sources publish the same opportunity under different reference_ids and
 * upsertTenders() dedups ON CONFLICT (reference_id) only, so each copy persists as
 * its own row. This collapses any OPEN rows sharing dedupKey() (normalized
 * title+agency+deadline, via the maintained `dedup_key` column) down to the
 * highest-priority-source survivor:
 *   - repoints child rows (vendor/network matches, pipeline, feedback, bids,
 *     submissions) onto the survivor so nothing is orphaned, guarding the three
 *     UNIQUE(…, tender_id) tables against collisions; and
 *   - marks the losers status='superseded'. Every tender reader filters
 *     status='open', so they leave display AND matching at once. Reversible, and
 *     no re-crawl churn — a future ON CONFLICT (reference_id) just updates the
 *     hidden tombstone instead of re-inserting.
 *
 * Runs at the end of every sync (continuous prevention) and from
 * scripts/dedupe-tenders.ts (one-off backlog cleanup). Idempotent: a second run
 * finds zero groups. Does NOT touch upsertTenders / dedupeTenders / link verify.
 */
export async function collapseDuplicateTenders(opts: { dryRun?: boolean } = {}): Promise<CollapseResult> {
  const dryRun = opts.dryRun ?? false;
  await ensureTenderDedupSchema();

  // Every row in a duplicate group, with a match count so the copy already
  // carrying the most matches wins a source-priority tie. One query.
  const rows = (await sql`
    WITH dups AS (
      SELECT dedup_key
      FROM tenders
      WHERE status = 'open' AND COALESCE(title, '') <> '' AND dedup_key IS NOT NULL
      GROUP BY dedup_key
      HAVING COUNT(*) > 1
    )
    SELECT
      t.id, t.dedup_key, t.source_name, t.updated_at::text AS updated_at,
      (
        COALESCE((SELECT COUNT(*) FROM tender_vendor_matches m WHERE m.tender_id = t.id), 0)
        + COALESCE((SELECT COUNT(*) FROM network_company_matches n WHERE n.tender_id = t.id), 0)
      )::int AS match_count
    FROM tenders t
    JOIN dups d ON d.dedup_key = t.dedup_key
    WHERE t.status = 'open' AND COALESCE(t.title, '') <> ''
    ORDER BY t.dedup_key, t.id
  `) as DupRow[];

  const byKey = new Map<string, DupRow[]>();
  for (const r of rows) {
    const g = byKey.get(r.dedup_key) ?? [];
    g.push(r);
    byKey.set(r.dedup_key, g);
  }

  const details: CollapseResult["details"] = [];
  const loserIds: number[] = [];
  const survivorForLoser: number[] = []; // aligned 1:1 with loserIds

  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    const survivor = group.reduce((best, cur) => (compareSurvivor(cur, best) < 0 ? cur : best));
    const losers = group.filter((r) => r.id !== survivor.id);
    if (losers.length === 0) continue;
    details.push({ dedupKey: key, survivorId: survivor.id, survivorSource: survivor.source_name, loserIds: losers.map((l) => l.id) });
    for (const l of losers) {
      loserIds.push(l.id);
      survivorForLoser.push(survivor.id);
    }
  }

  const result: CollapseResult = { groups: details.length, collapsed: loserIds.length, details, dryRun };
  if (dryRun || loserIds.length === 0) return result;

  // Repoint children loser → survivor. unnest() zips the two aligned arrays into
  // (loser, survivor) pairs for one set-based UPDATE per table. The three tables
  // with UNIQUE(…, tender_id) get a NOT EXISTS guard so a repoint never collides
  // with a row the survivor already has; collided leftovers stay on the hidden
  // loser (harmless). Order children before the supersede.
  await sql`
    UPDATE tender_vendor_matches x SET tender_id = m.survivor
    FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor)
    WHERE x.tender_id = m.loser
      AND NOT EXISTS (SELECT 1 FROM tender_vendor_matches y WHERE y.tender_id = m.survivor AND y.assessment_id = x.assessment_id)
  `;
  await sql`
    UPDATE network_company_matches x SET tender_id = m.survivor
    FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor)
    WHERE x.tender_id = m.loser
      AND NOT EXISTS (SELECT 1 FROM network_company_matches y WHERE y.network_company_id = x.network_company_id AND y.tender_id = m.survivor)
  `;
  await sql`
    UPDATE user_tender_feedback x SET tender_id = m.survivor
    FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor)
    WHERE x.tender_id = m.loser
      AND NOT EXISTS (SELECT 1 FROM user_tender_feedback y WHERE y.user_id = x.user_id AND y.tender_id = m.survivor)
  `;
  // No UNIQUE(…, tender_id) — repoint freely to keep users' saved/pipeline continuity.
  await sql`UPDATE pipeline_items x SET tender_id = m.survivor FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor) WHERE x.tender_id = m.loser`;
  await sql`UPDATE bid_analyses x SET tender_id = m.survivor FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor) WHERE x.tender_id = m.loser`;
  await sql`UPDATE submission_orders x SET tender_id = m.survivor FROM unnest(${loserIds}::int[], ${survivorForLoser}::int[]) AS m(loser, survivor) WHERE x.tender_id = m.loser`;

  await sql`UPDATE tenders SET status = 'superseded', updated_at = NOW() WHERE id = ANY(${loserIds}::int[])`;

  return result;
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
  // covers UNICEF, WFP, WHO, UNHCR, IOM, UNRWA, UNDP, and 50+ other UN bodies.
  //
  // Blocked-source policy: ADB, AfDB, EBRD have been Cloudflare/CAS-blocked for
  // weeks (see docs/crawler-grant-debug-2026-05-03.md). Each consumes ~60s of
  // browser-worker budget for guaranteed-zero output. They are gated behind
  // ENABLE_BLOCKED_CRAWLERS so they can be re-enabled once a recovery path lands,
  // without restoring the silent budget drain in production.
  const includeBlocked = process.env.ENABLE_BLOCKED_CRAWLERS === "true";

  const activeCrawls = [
    crawlUNGM(),
    crawlReliefWeb(),
    crawlTED(),
    crawlUKFTS(),
    crawlWorldBank(),
    crawlSAMGov(),
    crawlGIZ(),
    crawlUNDP(),
    crawlUNDPAtlas(),
    crawlIDB(),
    crawlISDB(),
    crawlDevelopmentAidNPO(),
    crawlNRC(),
    crawlKfW(),
    crawlAFD(),
    crawlJICA(),
    crawlADA(),
    // crawlWFP(),    — disabled, posts to UNGM
    // crawlIOM(),    — disabled, notices are covered by UNGM and the direct page is bot-blocked
    // crawlUNRWA(),  — disabled, official UNRWA guidance points suppliers to UNGM notices
    // crawlUNOPS()  — disabled: already covered by UNGM (UNOPS posts to UNGM by mandate)
  ];

  if (includeBlocked) {
    activeCrawls.push(crawlADB(), crawlAfDB(), crawlEBRD());
  }

  const crawls = await Promise.allSettled(activeCrawls);

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

  // Durable cross-run dedup: fold cross-posted duplicate rows (same opportunity,
  // different reference_id) onto one survivor. Display and matching both filter
  // status='open', so the superseded copies vanish from both at once. Wrapped so
  // a dedup hiccup never fails the crawl (no silent failure: it logs a tagged line).
  let totalCollapsed = 0;
  try {
    const collapse = await collapseDuplicateTenders();
    totalCollapsed = collapse.collapsed;
    if (collapse.collapsed > 0) {
      await logCrawl({
        platform: "_dedup_collapse",
        status: "success",
        added: 0, updated: 0, expired: 0, brokenLinks: 0, durationMs: 0,
        metadata: { collapsedDuplicates: collapse.collapsed, duplicateGroups: collapse.groups },
      });
    }
  } catch (err) {
    console.error("[crawler:collapse_duplicates:failed]", err instanceof Error ? err.message : String(err));
  }

  const totalBrokenLinks = await verifyRecentLinks();

  return {
    results,
    totalAdded: results.reduce((s, r) => s + r.added, 0),
    totalUpdated: results.reduce((s, r) => s + r.updated, 0),
    totalExpired,
    totalDeduped: deduped,
    totalCollapsed,
    totalBrokenLinks,
  };
}
