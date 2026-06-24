//
// Server-side assembler for the public, read-only prospect briefing (/n/<token>).
//
// ISOLATION INVARIANT (do not break): like the rest of the Network subsystem,
// this NEVER writes anything, never queues email, and never fires funnel
// telemetry. It only READS network_companies + tenders to render a prospect's
// own capability picture against public opportunities. It must never touch the
// `assessments` table, email_queue, sendAssessmentEmail, or track().
//
// What a prospect is allowed to see: their own company analysis (strengths,
// insightful gaps, sectors) + public tender data. NOT: contact details, private
// operator notes, dismiss reasons, internal match status, or any other company.
//

import { sql } from "@/lib/db";
import type { AIAnalysis, Gap } from "@/lib/types";
import { isUngmAgency } from "@/lib/tenders/submission-portals";
import { ensureNetworkMatchingColumns } from "./schema";
import {
  selectInsightfulGaps,
  ungmReadiness,
  type ProspectUngmStatus,
  type UngmReadiness,
} from "./outreach";

export type FitBand = "Excellent fit" | "Strong fit" | "Good fit";

export interface BriefingTender {
  id: number;
  title: string;
  agency: string | null;
  country: string | null;
  sector: string | null;
  deadline: string | null;
  value: string | null;
  source_url: string | null;
  reasons: string[];
  isUngm: boolean;
  fitBand: FitBand;
}

export interface ProspectBriefing {
  companyName: string;
  website: string | null;
  industry: string | null;
  sectors: string[];
  countries: string[];
  summary: string | null;
  strengths: string[];
  gaps: Gap[]; // insightful only — boilerplate already filtered
  tenders: BriefingTender[];
  ungm: UngmReadiness;
  /** When the matches were last refreshed (network_companies.last_matched_at). */
  lastMatchedAt: string | null;
}

/** Qualitative band so we never expose the raw internal score to a prospect. */
function fitBand(score: number): FitBand {
  if (score >= 85) return "Excellent fit";
  if (score >= 75) return "Strong fit";
  return "Good fit";
}

/** Same normalization the worklist dedup uses — collapses cross-posted copies. */
function dedupKey(t: { title: string | null; agency: string | null; deadline: string | null }): string {
  const norm = (s: string | null) =>
    (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const day = t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : "";
  return `${norm(t.title)}|${norm(t.agency)}|${day}`;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

/** Only surface a value that looks meaningful — mirrors outreach.meaningfulValue. */
function cleanValue(raw: unknown): string | null {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  if (/^(n\/?a|tbd|unknown|none|null|0)$/i.test(s)) return null;
  if (/not\s*(specified|disclosed|available|provided)/i.test(s)) return null;
  return s;
}

const MAX_TENDERS = 8;
const MIN_BRIEFING_SCORE = 70; // only show strong matches to a prospect

/**
 * Load and assemble a prospect briefing by its share token. Returns null when
 * the token is unknown, the company is inactive, or its profile isn't ready —
 * the page turns that into a 404 so a deactivated/unprofiled prospect can't be
 * viewed. Reads only; no side effects.
 */
export async function loadProspectBriefing(token: string): Promise<ProspectBriefing | null> {
  const t = (token ?? "").trim();
  if (!t) return null;

  // Self-heal the share_token / ungm_status columns in case a cold instance
  // serves a briefing before any admin request has run the migration.
  await ensureNetworkMatchingColumns();

  const rows = await sql`
    SELECT id, name, website, sectors, countries, ai_analysis, ungm_status, last_matched_at
    FROM network_companies
    WHERE share_token = ${t} AND is_active = TRUE AND profile_status = 'ready'
    LIMIT 1
  `;
  const company = rows[0];
  if (!company) return null;

  const ai = (company.ai_analysis as AIAnalysis | null) ?? null;

  const matchRows = await sql`
    SELECT
      m.score, m.match_reasons,
      t.id AS tender_id, t.title, t.agency, t.country, t.sector, t.deadline,
      t.estimated_value, t.source_url
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    WHERE m.network_company_id = ${company.id}
      AND m.status IN ('new', 'seen', 'contacted')
      AND m.score >= ${MIN_BRIEFING_SCORE}
      AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
      AND t.deadline >= CURRENT_DATE
    ORDER BY m.score DESC, t.deadline ASC NULLS LAST
  `;

  // Collapse cross-posted duplicates (same opportunity under different
  // reference_ids → separate tenders rows), keeping the highest-scoring copy.
  const seen = new Set<string>();
  const tenders: BriefingTender[] = [];
  for (const r of matchRows) {
    const key = dedupKey({
      title: r.title as string | null,
      agency: r.agency as string | null,
      deadline: r.deadline as string | null,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    tenders.push({
      id: Number(r.tender_id),
      title: String(r.title ?? "Untitled opportunity"),
      agency: (r.agency as string | null) ?? null,
      country: (r.country as string | null) ?? null,
      sector: (r.sector as string | null) ?? null,
      deadline: r.deadline ? new Date(r.deadline as string).toISOString() : null,
      value: cleanValue(r.estimated_value),
      source_url: (r.source_url as string | null) ?? null,
      reasons: toStringArray(r.match_reasons).slice(0, 3),
      isUngm: isUngmAgency(r.agency as string | null),
      fitBand: fitBand(Number(r.score) || 0),
    });
    if (tenders.length >= MAX_TENDERS) break;
  }

  return {
    companyName: String(company.name),
    website: (company.website as string | null) ?? null,
    industry: ai?.detected_industry ?? null,
    sectors: toStringArray(company.sectors),
    countries: toStringArray(company.countries),
    summary: ai?.summary ?? null,
    strengths: toStringArray(ai?.strengths).slice(0, 4),
    gaps: selectInsightfulGaps(ai?.gaps, 4),
    tenders,
    ungm: ungmReadiness(
      tenders.map((x) => ({ tender_agency: x.agency })),
      (company.ungm_status as ProspectUngmStatus | null) ?? "unknown",
    ),
    lastMatchedAt: company.last_matched_at ? new Date(company.last_matched_at as string).toISOString() : null,
  };
}
