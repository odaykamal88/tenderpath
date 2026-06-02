import { sql } from "@/lib/db";
import { fetchEuFundingGrants, type EuFundingGrant } from "@/lib/grants/eu-funding-tenders";
import { fetchGrantsGovGrants, type GrantsGovGrant } from "@/lib/grants/grants-gov";
import { fetchIfadGrants, type IfadGrant } from "@/lib/grants/ifad";
import { fetchMenaFunderGrants, type MenaFunderGrant } from "@/lib/grants/mena-funders";
import { fetchUndpCfpGrants, type UndpCfpGrant } from "@/lib/grants/undp-cfp";
import { fetchUnWomenCfpGrants, type UnWomenCfpGrant } from "@/lib/grants/unwomen-cfp";

type GrantSourceRow = EuFundingGrant | UndpCfpGrant | UnWomenCfpGrant | IfadGrant | GrantsGovGrant | MenaFunderGrant;

export type GrantRefreshOptions = {
  dryRun?: boolean;
  euLimit?: number;
  euPages?: number;
  euPageSize?: number;
  undpLimit?: number;
  unWomenLimit?: number;
  ifadLimit?: number;
  grantsGovLimit?: number;
  graceDays?: number;
};

export type GrantRefreshSourceResult = {
  source: string;
  status: "success" | "failure";
  scanned: number;
  mapped: number;
  upserted: number;
  error?: string;
};

export type GrantRefreshResult = {
  ok: boolean;
  dryRun: boolean;
  timestamp: string;
  durationMs: number;
  expired: number;
  sources: GrantRefreshSourceResult[];
  quality: {
    open: number;
    futureOpen: number;
    staleOpen: number;
    richDescriptions: number;
    themes: number;
    eligibleOrgTypes: number;
    sourceUrls: number;
  };
};

async function ensureGrantReferenceIndex() {
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS grants_reference_id_unique ON grants (reference_id)`;
}

async function upsertGrant(grant: GrantSourceRow) {
  await sql`
    INSERT INTO grants (
      reference_id, title, agency, deadline, sector, themes, eligible_org_types,
      countries, description, value_range, country, region, source_name,
      source_url, status, created_at, updated_at
    )
    VALUES (
      ${grant.reference_id}, ${grant.title}, ${grant.agency}, ${grant.deadline}::timestamptz,
      ${grant.sector}, ${JSON.stringify(grant.themes)}::jsonb,
      ${JSON.stringify(grant.eligible_org_types)}::jsonb,
      ${JSON.stringify(grant.countries)}::jsonb, ${grant.description},
      ${grant.value_range}, ${grant.country}, ${grant.region}, ${grant.source_name},
      ${grant.source_url}, ${grant.status}, NOW(), NOW()
    )
    ON CONFLICT (reference_id) DO UPDATE SET
      title = EXCLUDED.title,
      agency = EXCLUDED.agency,
      deadline = EXCLUDED.deadline,
      sector = EXCLUDED.sector,
      themes = EXCLUDED.themes,
      eligible_org_types = EXCLUDED.eligible_org_types,
      countries = EXCLUDED.countries,
      description = COALESCE(EXCLUDED.description, grants.description),
      value_range = COALESCE(EXCLUDED.value_range, grants.value_range),
      country = EXCLUDED.country,
      region = EXCLUDED.region,
      source_name = EXCLUDED.source_name,
      source_url = EXCLUDED.source_url,
      status = EXCLUDED.status,
      updated_at = NOW()
  `;
}

async function expireStaleGrants(graceDays: number, dryRun: boolean): Promise<number> {
  const rows = await sql`
    SELECT id
    FROM grants
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < NOW() - (${graceDays}::int * INTERVAL '1 day')
  `;
  if (dryRun || rows.length === 0) return rows.length;

  const result = await sql`
    UPDATE grants
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'open'
      AND deadline IS NOT NULL
      AND deadline < NOW() - (${graceDays}::int * INTERVAL '1 day')
    RETURNING id
  `;
  return result.length;
}

async function importGrantSource(
  source: string,
  dryRun: boolean,
  load: () => Promise<{ grants: GrantSourceRow[]; scanned: number }>,
): Promise<GrantRefreshSourceResult> {
  try {
    const loaded = await load();
    let upserted = 0;
    if (!dryRun) {
      for (const grant of loaded.grants) {
        await upsertGrant(grant);
        upserted++;
      }
    }
    return {
      source,
      status: "success",
      scanned: loaded.scanned,
      mapped: loaded.grants.length,
      upserted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown grant import error";
    console.error("[tp:grants:source_failed]", { source, message });
    return { source, status: "failure", scanned: 0, mapped: 0, upserted: 0, error: message };
  }
}

// MENA/Africa-targeted EU text queries. The default deadline-sorted `*` pull tags
// most EU calls "Global" (generic pan-EU programmes); these surface the geo-specific
// EuropeAid / neighbourhood calls (e.g. "Support to Human Rights ... in Jordan",
// "Civil Society ... South Africa") that are the real MENA/Africa ICP value.
const EU_TARGETED_TEXT = [
  "Syria Lebanon Jordan Iraq Yemen Palestine",
  "Egypt Tunisia Morocco Libya Algeria Mauritania",
  "Africa Sahel",
  "Southern Neighbourhood Mediterranean",
];

async function loadEuGrants(options: Required<Pick<GrantRefreshOptions, "euLimit" | "euPages" | "euPageSize">>) {
  const byRef = new Map<string, EuFundingGrant>();
  let scanned = 0;

  for (let page = 1; page <= options.euPages; page++) {
    const batch = await fetchEuFundingGrants(options.euPageSize, page);
    scanned += batch.totalResults;
    for (const grant of batch.grants) {
      byRef.set(grant.reference_id, grant);
    }
    if (page * options.euPageSize >= batch.totalResults) break;
  }

  for (const text of EU_TARGETED_TEXT) {
    try {
      const batch = await fetchEuFundingGrants(40, 1, text);
      for (const grant of batch.grants) byRef.set(grant.reference_id, grant);
    } catch (err) {
      console.warn("[tp:grants:eu:targeted_pass_failed]", { text, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Keep geo-specific (non-Global) rows ahead of generic Global programmes so the
  // limit can't clip the MENA/Africa calls in favour of pan-EU ones.
  const isGlobal = (g: EuFundingGrant) => !g.region || g.region === "Global";
  return {
    grants: [...byRef.values()]
      .sort((a, b) => (Number(isGlobal(a)) - Number(isGlobal(b))) || (a.deadline ?? "").localeCompare(b.deadline ?? ""))
      .slice(0, options.euLimit),
    scanned,
  };
}

async function grantQualitySummary(): Promise<GrantRefreshResult["quality"]> {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'open')::int AS open,
      COUNT(*) FILTER (WHERE status = 'open' AND deadline IS NOT NULL AND deadline >= NOW())::int AS future_open,
      COUNT(*) FILTER (WHERE status = 'open' AND deadline IS NOT NULL AND deadline < NOW())::int AS stale_open,
      COUNT(*) FILTER (WHERE status = 'open' AND description IS NOT NULL AND LENGTH(TRIM(description)) >= 120)::int AS rich_descriptions,
      COUNT(*) FILTER (WHERE status = 'open' AND themes IS NOT NULL AND jsonb_array_length(COALESCE(themes, '[]'::jsonb)) > 0)::int AS themes,
      COUNT(*) FILTER (WHERE status = 'open' AND eligible_org_types IS NOT NULL AND jsonb_array_length(COALESCE(eligible_org_types, '[]'::jsonb)) > 0)::int AS eligible_org_types,
      COUNT(*) FILTER (WHERE status = 'open' AND source_url IS NOT NULL AND TRIM(source_url) <> '')::int AS source_urls
    FROM grants
  `;

  return {
    open: Number(row?.open ?? 0),
    futureOpen: Number(row?.future_open ?? 0),
    staleOpen: Number(row?.stale_open ?? 0),
    richDescriptions: Number(row?.rich_descriptions ?? 0),
    themes: Number(row?.themes ?? 0),
    eligibleOrgTypes: Number(row?.eligible_org_types ?? 0),
    sourceUrls: Number(row?.source_urls ?? 0),
  };
}

export async function refreshGrantInventory(options: GrantRefreshOptions = {}): Promise<GrantRefreshResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? false;
  const euLimit = Math.min(250, Math.max(1, options.euLimit ?? 200));
  const euPages = Math.min(5, Math.max(1, options.euPages ?? 5));
  const euPageSize = Math.min(100, Math.max(10, options.euPageSize ?? 100));
  const undpLimit = Math.min(75, Math.max(1, options.undpLimit ?? 25));
  const unWomenLimit = Math.min(50, Math.max(1, options.unWomenLimit ?? 25));
  const ifadLimit = Math.min(25, Math.max(1, options.ifadLimit ?? 12));
  const grantsGovLimit = Math.min(250, Math.max(1, options.grantsGovLimit ?? 100));
  const graceDays = Math.max(0, options.graceDays ?? 0);

  await ensureGrantReferenceIndex();
  const expired = await expireStaleGrants(graceDays, dryRun);

  const sources = await Promise.all([
    importGrantSource("EU Funding & Tenders", dryRun, () => loadEuGrants({ euLimit, euPages, euPageSize })),
    importGrantSource("UNDP CFP", dryRun, async () => {
      const result = await fetchUndpCfpGrants(undpLimit);
      return { grants: result.grants, scanned: result.totalScanned };
    }),
    importGrantSource("UN Women CFP", dryRun, async () => {
      const result = await fetchUnWomenCfpGrants(unWomenLimit);
      return { grants: result.grants, scanned: result.totalScanned };
    }),
    importGrantSource("IFAD", dryRun, async () => {
      const result = await fetchIfadGrants(ifadLimit);
      return { grants: result.grants, scanned: result.totalScanned };
    }),
    importGrantSource("Grants.gov", dryRun, async () => {
      const result = await fetchGrantsGovGrants(grantsGovLimit);
      return { grants: result.grants, scanned: result.totalScanned };
    }),
    importGrantSource("MENA Funders", dryRun, async () => {
      const result = await fetchMenaFunderGrants();
      return { grants: result.grants, scanned: result.totalScanned };
    }),
  ]);

  const quality = await grantQualitySummary();
  const durationMs = Date.now() - startedAt;
  const ok = sources.some((source) => source.status === "success");

  console.log("[tp:grants:refresh]", {
    ok,
    dryRun,
    expired,
    durationMs,
    sources: sources.map((source) => ({
      source: source.source,
      status: source.status,
      mapped: source.mapped,
      upserted: source.upserted,
      error: source.error,
    })),
    quality,
  });

  return {
    ok,
    dryRun,
    timestamp: new Date().toISOString(),
    durationMs,
    expired,
    sources,
    quality,
  };
}
