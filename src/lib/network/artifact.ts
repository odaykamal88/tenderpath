/**
 * Prospect match artifact (P0.3) — the live conversion surface for outreach.
 *
 * Assembles, for one network prospect, the shareable read: matched tenders each
 * annotated with a compliance read + contestability band + lite verdict. This is
 * the admin/founder-side generator: unlike the public briefing (which only reads),
 * it WRITES one calibration-corpus row per tender (P0.2) so every artifact we send
 * a prospect becomes labeled training data from day one.
 *
 * The per-tender annotation itself is the same pure function the public briefing
 * uses (annotateProspectTender) — the only difference here is the raw score (admin
 * sees it; the prospect gets a band) and the calibration write.
 */

import { sql } from "@/lib/db";
import type { AIAnalysis } from "@/lib/types";
import { isUngmAgency } from "@/lib/tenders/submission-portals";
import { ensureNetworkMatchingColumns } from "./schema";
import { ungmReadiness, briefingUrl, type ProspectUngmStatus, type UngmReadiness } from "./outreach";
import { annotateProspectTender, type ProspectTenderSignals } from "./prospect-signals";
import { recordCalibrationEvent, valueBand } from "@/lib/calibration/store";

const MAX_TENDERS = 8;
const MIN_ARTIFACT_SCORE = 70; // parity with the public briefing
const MIN_ARTIFACT_LEAD_DAYS = 10;

export interface ArtifactTender {
  id: number;
  matchId: number;
  title: string;
  agency: string | null;
  country: string | null;
  sector: string | null;
  deadline: string | null;
  value: string | null;
  source_url: string | null;
  reasons: string[];
  isUngm: boolean;
  /** Raw match score — admin-only; never rendered on the prospect surface. */
  score: number;
  signals: ProspectTenderSignals;
}

export interface ProspectArtifact {
  companyId: number;
  companyName: string;
  website: string | null;
  industry: string | null;
  sectors: string[];
  countries: string[];
  shareToken: string | null;
  briefingUrl: string | null;
  tenders: ArtifactTender[];
  ungm: UngmReadiness;
  generatedAt: string;
  /** Number of calibration-corpus rows written this generation. */
  logged: number;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
}

function cleanValue(raw: unknown): string | null {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return null;
  if (/^(n\/?a|tbd|unknown|none|null|0)$/i.test(s)) return null;
  if (/not\s*(specified|disclosed|available|provided)/i.test(s)) return null;
  return s;
}

/** Same normalization the worklist/briefing dedup uses. */
function dedupKey(t: { title: string | null; agency: string | null; deadline: string | null }): string {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const day = t.deadline ? new Date(t.deadline).toISOString().slice(0, 10) : "";
  return `${norm(t.title)}|${norm(t.agency)}|${day}`;
}

/** Coarse EOI/RFQ/ITB/RFP normalization for the calibration corpus. */
function normalizeTenderType(raw: string | null | undefined): string {
  const t = (raw ?? "").toLowerCase();
  if (/\beoi\b|expression\s+of\s+interest/.test(t)) return "EOI";
  if (/\brfq\b|request\s+for\s+quotation/.test(t)) return "RFQ";
  if (/\bitb\b|invitation\s+to\s+bid/.test(t)) return "ITB";
  if (/\brfp\b|request\s+for\s+proposal/.test(t)) return "RFP";
  if (/\blta\b|framework|long[-\s]?term\s+agreement/.test(t)) return "LTA";
  return raw && raw.trim() ? raw.trim().slice(0, 40) : "unknown";
}

/** Qualitative band (never expose the raw score to a prospect). */
function fitBand(score: number): "Excellent fit" | "Strong fit" | "Good fit" {
  if (score >= 85) return "Excellent fit";
  if (score >= 75) return "Strong fit";
  return "Good fit";
}

/**
 * Build the artifact for a prospect. When `log` is true (default), writes one
 * calibration row per tender. Returns null when the company is unknown, inactive,
 * or its profile isn't ready — same visibility rule as the public briefing.
 */
export async function buildProspectArtifact(
  companyId: number,
  opts: { log?: boolean; origin?: string | null } = {},
): Promise<ProspectArtifact | null> {
  await ensureNetworkMatchingColumns();

  const rows = await sql`
    SELECT id, name, website, sectors, countries, ai_analysis, ungm_status, share_token
    FROM network_companies
    WHERE id = ${companyId} AND is_active = TRUE AND profile_status = 'ready'
    LIMIT 1
  `;
  const company = rows[0];
  if (!company) return null;

  const ai = (company.ai_analysis as AIAnalysis | null) ?? null;

  const matchRows = await sql`
    SELECT
      m.id AS match_id, m.score, m.match_reasons,
      t.id AS tender_id, t.title, t.agency, t.country, t.sector, t.deadline,
      t.estimated_value, t.source_url, t.opportunity_type, t.description
    FROM network_company_matches m
    JOIN tenders t ON t.id = m.tender_id
    WHERE m.network_company_id = ${company.id}
      AND m.status IN ('new', 'seen', 'contacted')
      AND m.score >= ${MIN_ARTIFACT_SCORE}
      AND t.status = 'open' AND COALESCE(t.has_broken_link, false) = false
      AND t.deadline >= CURRENT_DATE + (${MIN_ARTIFACT_LEAD_DAYS})::int
    ORDER BY m.score DESC, t.deadline ASC NULLS LAST
  `;

  const seen = new Set<string>();
  const tenders: ArtifactTender[] = [];
  for (const r of matchRows) {
    const key = dedupKey({
      title: r.title as string | null,
      agency: r.agency as string | null,
      deadline: r.deadline as string | null,
    });
    if (seen.has(key)) continue;
    seen.add(key);

    const agency = (r.agency as string | null) ?? null;
    const deadline = r.deadline ? new Date(r.deadline as string).toISOString() : null;
    const score = Number(r.score) || 0;
    const isUngm = isUngmAgency(agency);

    const signals = annotateProspectTender({
      title: (r.title as string | null) ?? null,
      agency,
      deadline,
      opportunityType: (r.opportunity_type as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      isUngm,
      fit: { kind: "score", score },
    });

    tenders.push({
      id: Number(r.tender_id),
      matchId: Number(r.match_id),
      title: String(r.title ?? "Untitled opportunity"),
      agency,
      country: (r.country as string | null) ?? null,
      sector: (r.sector as string | null) ?? null,
      deadline,
      value: cleanValue(r.estimated_value),
      source_url: (r.source_url as string | null) ?? null,
      reasons: toStringArray(r.match_reasons).slice(0, 3),
      isUngm,
      score,
      signals,
    });
    if (tenders.length >= MAX_TENDERS) break;
  }

  let logged = 0;
  if (opts.log !== false) {
    for (const t of tenders) {
      await recordCalibrationEvent({
        networkCompanyId: company.id as number,
        source: "network_artifact",
        eventType: "match",
        tenderId: t.id,
        networkMatchId: t.matchId,
        agency: t.agency,
        tenderType: normalizeTenderType((matchRows.find((r) => Number(r.tender_id) === t.id)?.opportunity_type as string | null) ?? null),
        valueBand: valueBand(t.value),
        country: t.country,
        systemOutput: {
          merit: { score: t.score, band: fitBand(t.score) },
          contestability: {
            band: t.signals.contestability.band,
            basis: t.signals.contestability.basis,
            thinEvidence: t.signals.contestability.thinEvidence,
          },
          verdict: {
            recommendation: t.signals.verdict.recommendation,
            confidence: t.signals.verdict.confidence,
          },
          compliance: {
            portal: t.signals.compliance.portalName,
            registrationRisk: t.signals.compliance.registrationRisk,
            isUngm: t.signals.compliance.isUngm,
            ungmMinLevel: t.signals.compliance.ungmMinLevel,
          },
        },
        vendorAction: "pending",
        dedupKey: `network:${company.id}:${t.id}`,
      });
      logged += 1;
    }
  }

  return {
    companyId: company.id as number,
    companyName: String(company.name),
    website: (company.website as string | null) ?? null,
    industry: ai?.detected_industry ?? null,
    sectors: toStringArray(company.sectors),
    countries: toStringArray(company.countries),
    shareToken: (company.share_token as string | null) ?? null,
    briefingUrl: briefingUrl((company.share_token as string | null) ?? null, opts.origin ?? null),
    tenders,
    ungm: ungmReadiness(
      tenders.map((x) => ({ tender_agency: x.agency })),
      (company.ungm_status as ProspectUngmStatus | null) ?? "unknown",
    ),
    generatedAt: new Date().toISOString(),
    logged,
  };
}
