import { sql } from "../db";
import { verifyLink } from "./types";
import { crawlGrantsGov, type RawGrant } from "./grants-gov";

export interface GrantsSyncSummary {
  platforms: Array<{
    platform: string;
    status: "success" | "failure";
    added: number;
    updated: number;
    broken: number;
    durationMs: number;
    error?: string;
  }>;
  totalAdded: number;
  totalUpdated: number;
  totalBroken: number;
  totalExpired: number;
}

async function filterLive(grants: RawGrant[], concurrency = 10): Promise<{ live: RawGrant[]; dropped: number }> {
  const live: RawGrant[] = [];
  let dropped = 0;
  let idx = 0;
  async function worker() {
    while (idx < grants.length) {
      const i = idx++;
      const g = grants[i];
      if (!g.source_url) { dropped++; continue; }
      const ok = await verifyLink(g.source_url);
      if (ok) live.push(g);
      else dropped++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, grants.length) }, worker));
  return { live, dropped };
}

async function upsert(grants: RawGrant[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  for (const g of grants) {
    if (!g.reference_id || !g.title) continue;
    const result = await sql`
      INSERT INTO grants (
        reference_id, title, agency, deadline, sector, description,
        themes, eligible_org_types, source_url, source_name, status, updated_at
      ) VALUES (
        ${g.reference_id}, ${g.title}, ${g.agency}, ${g.deadline}, ${g.sector},
        ${g.description}, ${JSON.stringify(g.themes)},
        ${JSON.stringify(g.eligible_org_types)}, ${g.source_url},
        ${g.source_name}, 'open', NOW()
      )
      ON CONFLICT (reference_id) DO UPDATE SET
        title = EXCLUDED.title,
        agency = EXCLUDED.agency,
        deadline = COALESCE(EXCLUDED.deadline, grants.deadline),
        description = COALESCE(EXCLUDED.description, grants.description),
        source_url = EXCLUDED.source_url,
        updated_at = NOW()
      RETURNING (xmax = 0) AS is_insert
    `;
    if (result[0]?.is_insert) added++;
    else updated++;
  }
  return { added, updated };
}

async function expireOverdue(): Promise<number> {
  const r = await sql`
    UPDATE grants
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < NOW()
    RETURNING id
  `;
  return r.length;
}

export async function syncAllGrants(): Promise<GrantsSyncSummary> {
  const crawls = await Promise.allSettled([crawlGrantsGov()]);
  const platforms: GrantsSyncSummary["platforms"] = [];

  for (const settled of crawls) {
    if (settled.status !== "fulfilled") {
      platforms.push({
        platform: "Grants.gov",
        status: "failure",
        added: 0, updated: 0, broken: 0, durationMs: 0,
        error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      });
      continue;
    }
    const c = settled.value;
    if (c.status === "failure") {
      platforms.push({
        platform: c.platform, status: "failure",
        added: 0, updated: 0, broken: 0, durationMs: c.durationMs, error: c.error,
      });
      continue;
    }
    const { live, dropped } = await filterLive(c.grants);
    const { added, updated } = await upsert(live);
    platforms.push({
      platform: c.platform, status: "success",
      added, updated, broken: dropped, durationMs: c.durationMs,
    });
  }

  const totalExpired = await expireOverdue();
  return {
    platforms,
    totalAdded: platforms.reduce((s, p) => s + p.added, 0),
    totalUpdated: platforms.reduce((s, p) => s + p.updated, 0),
    totalBroken: platforms.reduce((s, p) => s + p.broken, 0),
    totalExpired,
  };
}
