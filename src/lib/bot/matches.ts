import { sql } from "@/lib/db";

/**
 * Actionable matches for a linked user, sourced from the same `pipeline_items`
 * the dashboard renders (so the bot and dashboard never disagree). Only rows
 * with a real `tender_id` are returned — inline Save/Dismiss need it — and
 * anything the user already marked `not_relevant` is excluded.
 */

export interface BotMatch {
  tenderId: number;
  pipelineItemId: number;
  title: string;
  agency: string | null;
  deadline: string | null;
  fitScore: number;
}

interface MatchRow {
  pipeline_item_id: number;
  tender_id: number;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  fit_score: number | null;
}

export async function loadLinkedMatches(userId: number, limit = 3): Promise<BotMatch[]> {
  const rows = await sql`
    SELECT pi.id AS pipeline_item_id, pi.tender_id, pi.tender_title, pi.tender_agency,
           pi.tender_deadline, pi.fit_score
    FROM pipeline_items pi
    LEFT JOIN user_tender_feedback f ON f.user_id = pi.user_id AND f.tender_id = pi.tender_id
    WHERE pi.user_id = ${userId}
      AND pi.tender_id IS NOT NULL
      AND (f.status IS NULL OR f.status <> 'not_relevant')
    ORDER BY pi.fit_score DESC NULLS LAST, pi.id
    LIMIT ${limit}
  `;
  return (rows as MatchRow[]).map((r) => ({
    tenderId: r.tender_id,
    pipelineItemId: r.pipeline_item_id,
    title: r.tender_title,
    agency: r.tender_agency,
    deadline: r.tender_deadline,
    fitScore: r.fit_score ?? 0,
  }));
}
