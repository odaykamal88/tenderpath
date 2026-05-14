import { sql } from "@/lib/db";
import type { MatchedTender } from "@/lib/types";

export type SeedableTender = MatchedTender & { fit_score?: number };

export interface PipelineSeedResult {
  created: number;
  updated: number;
  skipped: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function sourceUrlFor(tender: SeedableTender): string | null {
  const structured = asRecord(tender.structured_reasons);
  const procurement = asRecord(structured?.procurement);
  return cleanText(tender.source_url, 1000) ?? cleanText(procurement?.sourceUrl, 1000);
}

function matchReasonsFor(tender: SeedableTender): Record<string, unknown> | null {
  const structured = asRecord(tender.structured_reasons);
  if (structured) return structured;
  if (Array.isArray(tender.match_reasons) && tender.match_reasons.length > 0) {
    return {
      summary: tender.match_reasons.filter((item): item is string => typeof item === "string"),
      confidence: tender.confidence ?? null,
      procurement: {
        sourceUrl: tender.source_url ?? null,
        sourceName: tender.source_name ?? null,
        sourceProvenance: tender.source_provenance ?? null,
        opportunityType: tender.opportunity_type ?? null,
        category: tender.procurement_category ?? null,
      },
    };
  }
  return null;
}

export function normalizeAssessmentTenders(rawTenders: unknown): SeedableTender[] {
  if (!Array.isArray(rawTenders)) return [];
  return rawTenders
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object" && !Array.isArray(t))
    .map((t) => ({
      ...(t as unknown as MatchedTender),
      fit_score: (t.fit_score as number | undefined) ?? (t.score as number | undefined),
    }));
}

export async function seedPipelineItems(
  userId: number,
  assessmentId: number,
  tenders: SeedableTender[],
  limit = 20,
): Promise<PipelineSeedResult> {
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const t of tenders.slice(0, limit)) {
    if (!t.title) {
      skipped++;
      continue;
    }

    const existing = t.id != null
      ? await sql`
          SELECT id, stage
          FROM pipeline_items
          WHERE user_id = ${userId} AND tender_id = ${t.id}
          ORDER BY id ASC
          LIMIT 1
        `
      : await sql`
          SELECT id, stage
          FROM pipeline_items
          WHERE user_id = ${userId}
            AND assessment_id = ${assessmentId}
            AND tender_title = ${t.title}
          ORDER BY id ASC
          LIMIT 1
        `;

    const matchReasons = matchReasonsFor(t);
    const matchReasonsJson = matchReasons ? JSON.stringify(matchReasons) : null;
    const sourceUrl = sourceUrlFor(t);
    const value = typeof t.estimated_value === "string" ? t.estimated_value : null;
    const fitScore = t.fit_score ?? t.score ?? 0;

    if (existing.length) {
      await sql`
        UPDATE pipeline_items SET
          assessment_id = COALESCE(assessment_id, ${assessmentId}),
          tender_title = ${t.title},
          tender_agency = COALESCE(${t.agency ?? null}, tender_agency),
          tender_deadline = COALESCE(${t.deadline ?? null}, tender_deadline),
          tender_value = COALESCE(${value}, tender_value),
          source_url = COALESCE(${sourceUrl}, source_url),
          fit_score = GREATEST(fit_score, ${fitScore}),
          match_reasons = COALESCE(${matchReasonsJson}::jsonb, match_reasons),
          updated_at = NOW()
        WHERE id = ${existing[0].id as number}
      `;
      updated++;
      continue;
    }

    await sql`
      INSERT INTO pipeline_items
        (user_id, tender_id, assessment_id, tender_title, tender_agency, tender_deadline,
         tender_value, source_url, fit_score, stage, match_reasons)
      VALUES
        (${userId}, ${t.id ?? null}, ${assessmentId}, ${t.title}, ${t.agency ?? null},
         ${t.deadline ?? null}, ${value}, ${sourceUrl},
         ${fitScore}, 'matched', ${matchReasonsJson}::jsonb)
    `;
    created++;
  }

  return { created, updated, skipped };
}
