/**
 * Weekly learning report from dashboard behavior.
 *
 * Reads manual additions, feedback, no-match assessments, and work-order intake
 * context. Does not mutate production data.
 *
 * Usage:
 *   npx tsx scripts/weekly-learning-review.ts
 *   npx tsx scripts/weekly-learning-review.ts --days=14
 */
import fs from "node:fs";
import { sql } from "../src/lib/db";

try {
  const env = fs.readFileSync(".env.local", "utf-8");
  for (const line of env.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) {
      process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
} catch {}

const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
const days = Math.min(90, Math.max(1, Number(daysArg?.split("=")[1] ?? 7)));

type Row = Record<string, unknown>;

function hostname(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.trim()).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function groupDomains(rows: Row[], key: string): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const domain = hostname(row[key]);
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

function statusCounts(rows: Row[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const status = String(row.status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    ) AS exists
  `;
  return Boolean(rows[0]?.exists);
}

async function main() {
  const pipelineHasSourceUrl = await hasColumn("pipeline_items", "source_url");

  const manualPipelineItems = pipelineHasSourceUrl
    ? await sql`
        SELECT id, user_id, tender_title, tender_agency, source_url, stage, created_at, updated_at
        FROM pipeline_items
        WHERE tender_id IS NULL
          AND source_url IS NOT NULL
          AND TRIM(source_url) <> ''
          AND created_at >= NOW() - (${days}::int * INTERVAL '1 day')
        ORDER BY created_at DESC
        LIMIT 100
      `
    : [];

  const grantFeedback = await sql`
    SELECT f.status, f.reason, f.updated_at, g.id AS grant_id, g.title, g.agency,
           g.source_url, g.source_name, g.country, g.region, g.sector
    FROM user_grant_feedback f
    LEFT JOIN grants g ON g.id = f.grant_id
    WHERE f.updated_at >= NOW() - (${days}::int * INTERVAL '1 day')
    ORDER BY f.updated_at DESC
    LIMIT 200
  `;

  const tenderFeedback = await sql`
    SELECT f.status, f.reason, f.updated_at, t.id AS tender_id, t.title, t.agency,
           t.source_url, t.source_name, t.country, t.sector
    FROM user_tender_feedback f
    LEFT JOIN tenders t ON t.id = f.tender_id
    WHERE f.updated_at >= NOW() - (${days}::int * INTERVAL '1 day')
    ORDER BY f.updated_at DESC
    LIMIT 200
  `;

  const noMatchAssessments = await sql`
    SELECT id, company_name, website, countries, org_type, assessment_status,
           assessment_error, created_at, assessment_completed_at
    FROM assessments
    WHERE created_at >= NOW() - (${days}::int * INTERVAL '1 day')
      AND assessment_status = 'completed'
      AND COALESCE(jsonb_array_length(COALESCE(matched_tenders, '[]'::jsonb)), 0) = 0
      AND COALESCE(jsonb_array_length(COALESCE(matched_grants, '[]'::jsonb)), 0) = 0
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const workOrderSources = await sql`
    SELECT id, tender_title, agency, tender_url, pipeline_item_id, created_at
    FROM work_orders
    WHERE tender_url IS NOT NULL
      AND TRIM(tender_url) <> ''
      AND created_at >= NOW() - (${days}::int * INTERVAL '1 day')
    ORDER BY created_at DESC
    LIMIT 100
  `;

  const positiveGrantFeedback = grantFeedback.filter((row) =>
    ["saved", "pursuing", "applied"].includes(String(row.status))
  );
  const negativeGrantFeedback = grantFeedback.filter((row) => String(row.status) === "not_relevant");
  const positiveTenderFeedback = tenderFeedback.filter((row) =>
    ["saved", "evaluating", "preparing", "submitted", "in_progress", "applied"].includes(String(row.status))
  );
  const negativeTenderFeedback = tenderFeedback.filter((row) => String(row.status) === "not_relevant");

  const report = {
    window_days: days,
    generated_at: new Date().toISOString(),
    schema: {
      pipeline_items_source_url: pipelineHasSourceUrl ? "available" : "missing",
    },
    counts: {
      manual_pipeline_items_with_urls: manualPipelineItems.length,
      grant_feedback: grantFeedback.length,
      tender_feedback: tenderFeedback.length,
      no_match_assessments: noMatchAssessments.length,
      work_order_source_urls: workOrderSources.length,
    },
    domains: {
      manual_pipeline: groupDomains(manualPipelineItems as Row[], "source_url"),
      positive_grant_feedback: groupDomains(positiveGrantFeedback as Row[], "source_url"),
      negative_grant_feedback: groupDomains(negativeGrantFeedback as Row[], "source_url"),
      positive_tender_feedback: groupDomains(positiveTenderFeedback as Row[], "source_url"),
      negative_tender_feedback: groupDomains(negativeTenderFeedback as Row[], "source_url"),
      work_orders: groupDomains(workOrderSources as Row[], "tender_url"),
    },
    feedback_status_counts: {
      grants: statusCounts(grantFeedback as Row[]),
      tenders: statusCounts(tenderFeedback as Row[]),
    },
    samples: {
      manual_pipeline_items: manualPipelineItems.slice(0, 15),
      positive_grants: positiveGrantFeedback.slice(0, 15),
      negative_grants: negativeGrantFeedback.slice(0, 15),
      no_match_assessments: noMatchAssessments.slice(0, 15),
      work_order_sources: workOrderSources.slice(0, 15),
    },
    operator_next_steps: [
      "Prioritize repeated official domains in manual_pipeline and work_orders as source-recovery candidates.",
      "Inspect positive feedback domains that are absent from crawler coverage or appear with thin descriptions.",
      "Inspect negative feedback clusters for over-broad sectors, weak geography, or generic global grant filler.",
      "Convert high-confidence misses into regression fixtures before changing scorer weights.",
      "Treat missing source_url persistence as a data-quality blocker if schema.pipeline_items_source_url is missing.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
