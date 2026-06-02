import { sql } from "@/lib/db";
import { matchTenders } from "@/lib/assessment/match";
import type { AIAnalysis } from "@/lib/types";
import { ensureNetworkMatchingColumns } from "./schema";
import { suppressByDismissalFeedback } from "./feedback";

// Match cutoff. 55 mirrors the assessment's "strategic" floor
// (opportunityBucketForTender in src/lib/assessment/match.ts) — high enough to
// be worth a bizdev outreach, low enough to surface the strategic tier the
// assessment shows. NB: geography is ~30 of ~100 points, so companies added
// WITHOUT countries score much lower and surface far fewer matches — set the
// company's countries for assessment-parity results. Tunable.
export const NETWORK_MATCH_THRESHOLD = 55;

export interface NetworkMatchRunResult {
  companyId: number;
  scored: number; // tenders the engine returned
  qualified: number; // >= threshold
  newMatches: number; // freshly inserted rows (status defaults to 'new')
  suppressed?: number; // new candidates dropped by the dismissal-feedback AI pass
  skipped?: string; // reason, if the company was skipped
}

/**
 * Score one network company against all open tenders and persist qualifying
 * matches. Reuses matchTenders (pure SQL + text scoring, no LLM) with
 * skipEnrichment so the batch stays cheap. Upserts preserve the operator's
 * match status — an already-seen/contacted/dismissed tender never reverts to
 * 'new'; only its score/reasons refresh.
 */
export async function matchNetworkCompany(
  companyId: number,
  opts: { threshold?: number } = {},
): Promise<NetworkMatchRunResult> {
  await ensureNetworkMatchingColumns();
  const threshold = opts.threshold ?? NETWORK_MATCH_THRESHOLD;

  const rows = await sql`
    SELECT id, ai_analysis, countries, org_type, profile_status
    FROM network_companies
    WHERE id = ${companyId}
    LIMIT 1
  `;
  const company = rows[0];
  if (!company) return { companyId, scored: 0, qualified: 0, newMatches: 0, skipped: "not_found" };
  if (company.profile_status !== "ready" || !company.ai_analysis) {
    return { companyId, scored: 0, qualified: 0, newMatches: 0, skipped: "profile_not_ready" };
  }

  const analysis = company.ai_analysis as AIAnalysis;
  const countries = Array.isArray(company.countries) ? (company.countries as string[]) : [];

  const matched = await matchTenders(analysis, countries, {
    orgType: (company.org_type as string | null) ?? null,
    // Consultancy / M&E RFPs are admitted ONLY when the company's own industry is
    // consulting — matchTenders gates that on detected_industry, exactly like the
    // assessment. Do NOT force includeConsultancies on: it floods logistics / IT /
    // construction companies with M&E consultancy tenders that aren't their trade.
    skipEnrichment: true,
  });

  const qualified = matched.filter((t) => typeof t.id === "number" && t.score >= threshold);

  // Pre-load existing tender_ids so we can count genuinely-new matches without
  // relying on the xmax-after-upsert idiom.
  const existingRows = await sql`
    SELECT tender_id FROM network_company_matches WHERE network_company_id = ${companyId}
  `;
  const existingIds = new Set(existingRows.map((r) => Number(r.tender_id)));

  // Incorporate the operator's dismissal reasons: only the genuinely-new
  // candidates go past the AI feedback suppressor; already-stored matches keep
  // the operator's status untouched. No-op (and no LLM call) without feedback.
  const newCandidates = qualified.filter((t) => !existingIds.has(t.id));
  const existingCandidates = qualified.filter((t) => existingIds.has(t.id));
  const { kept, suppressed } = await suppressByDismissalFeedback(companyId, analysis, newCandidates);
  const toUpsert = [...existingCandidates, ...kept];

  let newMatches = 0;
  for (const t of toUpsert) {
    const isNew = !existingIds.has(t.id);
    const reasons = Array.isArray(t.match_reasons) ? t.match_reasons : [];
    await sql`
      INSERT INTO network_company_matches (
        network_company_id, tender_id, score, structured_reasons, match_reasons, status, last_scored_at
      ) VALUES (
        ${companyId}, ${t.id}, ${Math.round(t.score)},
        ${JSON.stringify(t.structured_reasons ?? null)}::jsonb,
        ${JSON.stringify(reasons)}::jsonb,
        'new', NOW()
      )
      ON CONFLICT (network_company_id, tender_id) DO UPDATE SET
        score = EXCLUDED.score,
        structured_reasons = EXCLUDED.structured_reasons,
        match_reasons = EXCLUDED.match_reasons,
        last_scored_at = NOW(),
        updated_at = NOW()
    `;
    if (isNew) newMatches += 1;
  }

  // Keep the worklist honest: drop any 'new' match this run did NOT re-affirm
  // (now below threshold, filtered as a consultancy for a non-consulting company,
  // or suppressed by dismissal feedback). Only 'new' — never remove a match the
  // operator acted on (seen/contacted/dismissed/won/lost). Safe because a network
  // company's relevant-tender pool is far smaller than matchTenders' candidate caps.
  const keepArr = toUpsert.map((t) => t.id);
  await sql`
    DELETE FROM network_company_matches
    WHERE network_company_id = ${companyId}
      AND status = 'new'
      AND tender_id <> ALL(${keepArr.length ? keepArr : [-1]}::int[])
  `;

  await sql`
    UPDATE network_companies SET last_matched_at = NOW(), updated_at = NOW() WHERE id = ${companyId}
  `;

  return { companyId, scored: matched.length, qualified: qualified.length, newMatches, suppressed };
}

/**
 * Run the matcher across every active, profiled company. Used by the cron and
 * available for a manual "match all" trigger.
 */
export async function matchAllActiveNetworkCompanies(
  opts: { threshold?: number } = {},
): Promise<{ companies: number; newMatches: number; suppressed: number; errors: number; results: NetworkMatchRunResult[] }> {
  await ensureNetworkMatchingColumns();
  const companies = await sql`
    SELECT id FROM network_companies
    WHERE is_active = TRUE AND profile_status = 'ready'
    ORDER BY last_matched_at ASC NULLS FIRST, id ASC
  `;

  const results: NetworkMatchRunResult[] = [];
  let errors = 0;
  for (const row of companies) {
    try {
      results.push(await matchNetworkCompany(Number(row.id), opts));
    } catch (err) {
      errors += 1;
      console.error("[network:match:company_failed]", { companyId: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const newMatches = results.reduce((sum, r) => sum + r.newMatches, 0);
  const suppressed = results.reduce((sum, r) => sum + (r.suppressed ?? 0), 0);
  return { companies: companies.length, newMatches, suppressed, errors, results };
}
