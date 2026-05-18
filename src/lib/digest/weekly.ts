import { sql } from "@/lib/db";
import { matchGrants, matchTenders } from "@/lib/assessment/match";
import { sendWeeklyDigestEmail, EmailSuppressedError } from "@/lib/email/sendWeeklyDigest";
import { notifyAdmin } from "@/lib/email/notifyAdmin";
import type { AIAnalysis, MatchedTender, MatchReason } from "@/lib/types";

interface DigestSubscriber {
  id: number;
  email: string;
  name: string | null;
}

interface DigestAssessment {
  id: number;
  company_name: string | null;
  countries: string[];
  ai_analysis: AIAnalysis;
  org_type: string | null;
  dev_themes: string[];
  include_consultancies: boolean | null;
}

interface PipelineSeedResult {
  added: number;
  updated: number;
}

interface UserDigestResult {
  userId: number;
  email: string;
  status: "sent" | "failed" | "skipped" | "dry_run";
  assessmentId: number | null;
  tenderCount: number;
  grantCount: number;
  pipelineAdded: number;
  pipelineUpdated: number;
  error?: string;
}

export interface WeeklyDigestRunResult {
  ok: boolean;
  dryRun: boolean;
  subscriberCount: number;
  sent: number;
  dryRunCount: number;
  failed: number;
  skipped: number;
  results: UserDigestResult[];
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function loadSubscribers(limit: number): Promise<DigestSubscriber[]> {
  const rows = await sql`
    SELECT DISTINCT ON (u.id) u.id, u.email, u.name
    FROM users u
    LEFT JOIN subscriptions s ON s.user_id = u.id
    WHERE (
      (u.tier = 'tender-intelligence' AND u.subscription_status IN ('active', 'trialing'))
      OR (
        s.tier = 'tender-intelligence'
        AND s.status IN ('active', 'trialing')
        AND (s.current_period_end IS NULL OR s.current_period_end >= NOW())
      )
    )
    ORDER BY u.id
    LIMIT ${limit}
  `;

  return rows as unknown as DigestSubscriber[];
}

async function loadLatestAssessment(email: string): Promise<DigestAssessment | null> {
  const rows = await sql`
    SELECT id, company_name, countries, ai_analysis, org_type, dev_themes, include_consultancies
    FROM assessments
    WHERE email = ${email}
      AND ai_analysis IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id as number,
    company_name: (row.company_name as string | null) ?? null,
    countries: (row.countries as string[] | null) ?? [],
    ai_analysis: row.ai_analysis as AIAnalysis,
    org_type: (row.org_type as string | null) ?? null,
    dev_themes: (row.dev_themes as string[] | null) ?? [],
    include_consultancies: (row.include_consultancies as boolean | null) ?? null,
  };
}

function structuredReasonsFor(match: MatchedTender): MatchReason | null {
  if (match.structured_reasons) {
    return {
      ...match.structured_reasons,
      ...(match.opportunity_bucket ? {
        opportunityBucket: match.opportunity_bucket,
        opportunityBucketLabel: match.opportunity_bucket_label,
        opportunityBucketReason: match.opportunity_bucket_reason,
      } : {}),
    } as MatchReason;
  }

  if (!match.match_reasons?.length && !match.opportunity_bucket_reason) return null;
  return {
    summary: match.match_reasons?.slice(0, 3) ?? [match.opportunity_bucket_reason ?? "Matched to latest assessment profile."],
    confidence: "medium",
    ...(match.opportunity_bucket ? {
      opportunityBucket: match.opportunity_bucket,
      opportunityBucketLabel: match.opportunity_bucket_label,
      opportunityBucketReason: match.opportunity_bucket_reason,
    } : {}),
  } as MatchReason;
}

async function seedPipelineMatches(
  userId: number,
  assessmentId: number,
  matches: MatchedTender[],
): Promise<PipelineSeedResult> {
  let added = 0;
  let updated = 0;

  for (const match of matches) {
    const existing = await sql`
      SELECT id, stage
      FROM pipeline_items
      WHERE user_id = ${userId} AND tender_id = ${match.id}
      ORDER BY id ASC
      LIMIT 1
    `;
    const matchReasonsJson = structuredReasonsFor(match)
      ? JSON.stringify(structuredReasonsFor(match))
      : null;

    if (existing.length) {
      await sql`
        UPDATE pipeline_items SET
          assessment_id = COALESCE(assessment_id, ${assessmentId}),
          tender_title = ${match.title},
          tender_agency = ${match.agency},
          tender_deadline = ${match.deadline || null},
          tender_value = ${match.estimated_value ? String(match.estimated_value) : null},
          fit_score = ${Math.round(match.score)},
          match_reasons = ${matchReasonsJson}::jsonb,
          updated_at = NOW()
        WHERE id = ${existing[0].id as number}
      `;
      updated += 1;
      continue;
    }

    await sql`
      INSERT INTO pipeline_items (
        user_id, tender_id, assessment_id, tender_title, tender_agency,
        tender_deadline, tender_value, fit_score, stage, match_reasons
      ) VALUES (
        ${userId}, ${match.id}, ${assessmentId}, ${match.title}, ${match.agency},
        ${match.deadline || null}, ${match.estimated_value ? String(match.estimated_value) : null},
        ${Math.round(match.score)}, 'matched', ${matchReasonsJson}::jsonb
      )
    `;
    added += 1;
  }

  return { added, updated };
}

async function createLog(args: {
  userId: number;
  assessmentId: number | null;
  email: string;
  status?: string;
  error?: string;
}) {
  const rows = await sql`
    INSERT INTO weekly_digest_logs (user_id, assessment_id, email, status, error)
    VALUES (${args.userId}, ${args.assessmentId}, ${args.email}, ${args.status ?? "pending"}, ${args.error ?? null})
    RETURNING id
  `;
  return rows[0].id as number;
}

async function updateLog(id: number, patch: {
  status: string;
  tenderCount?: number;
  grantCount?: number;
  pipelineAdded?: number;
  pipelineUpdated?: number;
  provider?: string | null;
  error?: string | null;
  sent?: boolean;
}) {
  await sql`
    UPDATE weekly_digest_logs SET
      status = ${patch.status},
      tender_count = COALESCE(${patch.tenderCount ?? null}, tender_count),
      grant_count = COALESCE(${patch.grantCount ?? null}, grant_count),
      pipeline_added = COALESCE(${patch.pipelineAdded ?? null}, pipeline_added),
      pipeline_updated = COALESCE(${patch.pipelineUpdated ?? null}, pipeline_updated),
      provider = COALESCE(${patch.provider ?? null}, provider),
      error = ${patch.error ?? null},
      sent_at = CASE WHEN ${patch.sent ?? false} THEN NOW() ELSE sent_at END,
      updated_at = NOW()
    WHERE id = ${id}
  `;
}

export async function runWeeklyDigest(options: {
  dryRun?: boolean;
  limit?: number;
} = {}): Promise<WeeklyDigestRunResult> {
  const dryRun = options.dryRun ?? false;
  const subscribers = await loadSubscribers(options.limit ?? 100);
  const results: UserDigestResult[] = [];

  for (const subscriber of subscribers) {
    const assessment = await loadLatestAssessment(subscriber.email);
    if (!assessment) {
      if (!dryRun) {
        await createLog({
          userId: subscriber.id,
          assessmentId: null,
          email: subscriber.email,
          status: "skipped",
          error: "No assessment profile found for subscriber",
        });
      }
      results.push({
        userId: subscriber.id,
        email: subscriber.email,
        status: "skipped",
        assessmentId: null,
        tenderCount: 0,
        grantCount: 0,
        pipelineAdded: 0,
        pipelineUpdated: 0,
        error: "No assessment profile found for subscriber",
      });
      continue;
    }

    const logId = dryRun
      ? null
      : await createLog({
          userId: subscriber.id,
          assessmentId: assessment.id,
          email: subscriber.email,
        });

    try {
      const tenders = (await matchTenders(assessment.ai_analysis, assessment.countries, {
        userEmail: subscriber.email,
        orgType: assessment.org_type,
        includeConsultancies: assessment.include_consultancies ?? undefined,
      })).slice(0, 10);
      const grants = (await matchGrants(
        assessment.ai_analysis.sectors ?? [],
        assessment.org_type,
        assessment.dev_themes ?? [],
        assessment.countries,
      )).slice(0, 5);

      const pipeline = dryRun
        ? { added: 0, updated: 0 }
        : await seedPipelineMatches(subscriber.id, assessment.id, tenders);

      if (!dryRun) {
        await sendWeeklyDigestEmail({
          email: subscriber.email,
          companyName: assessment.company_name ?? subscriber.name ?? subscriber.email,
          tenders,
          grants,
          dashboardUrl: `${appUrl()}/dashboard`,
        });

        await updateLog(logId!, {
          status: "sent",
          tenderCount: tenders.length,
          grantCount: grants.length,
          pipelineAdded: pipeline.added,
          pipelineUpdated: pipeline.updated,
          provider: "resend",
          sent: true,
        });
      }

      results.push({
        userId: subscriber.id,
        email: subscriber.email,
        status: dryRun ? "dry_run" : "sent",
        assessmentId: assessment.id,
        tenderCount: tenders.length,
        grantCount: grants.length,
        pipelineAdded: pipeline.added,
        pipelineUpdated: pipeline.updated,
      });
    } catch (err) {
      // Suppressed users are an expected outcome, not a failure — log as
      // skipped so the audit trail is clean and ops doesn't get paged.
      if (err instanceof EmailSuppressedError) {
        if (logId) {
          await updateLog(logId, {
            status: "skipped_unsubscribed",
            provider: "resend",
            error: null,
          });
        }
        console.log("[tp:weekly-digest:skipped_unsubscribed]", {
          userId: subscriber.id,
          email: subscriber.email,
          assessmentId: assessment.id,
        });
        results.push({
          userId: subscriber.id,
          email: subscriber.email,
          status: "skipped",
          assessmentId: assessment.id,
          tenderCount: 0,
          grantCount: 0,
          pipelineAdded: 0,
          pipelineUpdated: 0,
          error: "unsubscribed",
        });
        continue;
      }

      const message = err instanceof Error ? err.message : String(err);
      if (logId) {
        await updateLog(logId, {
          status: "failed",
          provider: "resend",
          error: message,
        });
      }
      console.error("[tp:weekly-digest:failed]", {
        userId: subscriber.id,
        email: subscriber.email,
        assessmentId: assessment.id,
        error: message,
      });
      notifyAdmin(
        `Weekly digest failed — ${subscriber.email}`,
        `User ID: ${subscriber.id}\nEmail: ${subscriber.email}\nAssessment ID: ${assessment.id}\nError: ${message}`
      ).catch(() => {});
      results.push({
        userId: subscriber.id,
        email: subscriber.email,
        status: "failed",
        assessmentId: assessment.id,
        tenderCount: 0,
        grantCount: 0,
        pipelineAdded: 0,
        pipelineUpdated: 0,
        error: message,
      });
    }
  }

  return {
    ok: results.every((result) => result.status !== "failed"),
    dryRun,
    subscriberCount: subscribers.length,
    sent: results.filter((result) => result.status === "sent").length,
    dryRunCount: results.filter((result) => result.status === "dry_run").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    results,
  };
}
