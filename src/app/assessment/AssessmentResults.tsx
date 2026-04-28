"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions, OpportunityBucket } from "@/lib/types";
import { TIER_INFO_BY_SLUG } from "@/lib/pricing";

interface AssessmentData {
  id: number;
  company_name: string;
  email: string;
  sector: string;
  sectors: string[];
  readiness_score: number;
  grant_readiness_score: number;
  recommended_tier: TierSlug;
  summary: string;
  strengths: string[];
  capabilities: string[];
  certifications_detected: string[];
  readiness_dimensions: ReadinessDimensions;
  gaps: Gap[];
  matched_tenders: MatchedTender[];
  matched_grants: MatchedGrant[];
}

interface Props {
  data: AssessmentData;
  onReset: () => void;
}

/* ── helpers ── */

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-green";
  if (score >= 50) return "bg-yellow-500";
  if (score >= 35) return "bg-orange-500";
  return "bg-red";
}

function isDeadlineSoon(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24) <= 30;
}

function matchBadge(score: number): { label: string; cls: string } {
  if (score >= 70) return { label: "High Fit", cls: "bg-green/20 text-green border border-green/30" };
  if (score >= 50) return { label: "Medium Fit", cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
  return { label: "Low Fit", cls: "bg-gray-500/20 text-gray-400 border border-gray-500/30" };
}

function readStoredFeedback(assessmentId: number): Record<number, FeedbackStatus> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(`tp_feedback_${assessmentId}`);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function severityColor(s: string): string {
  if (s === "high") return "bg-red/10 border-red/30";
  if (s === "medium") return "bg-orange-500/10 border-orange-500/30";
  return "bg-yellow-500/10 border-yellow-500/30";
}

function severityBadgeCls(s: string): string {
  if (s === "high") return "bg-red/20 text-red";
  if (s === "medium") return "bg-orange-500/20 text-orange-400";
  return "bg-yellow-500/20 text-yellow-400";
}

const TIER_INFO = TIER_INFO_BY_SLUG;

const DIMENSION_LABELS: { key: keyof ReadinessDimensions; label: string }[] = [
  { key: "technical_capability", label: "Technical" },
  { key: "compliance_readiness", label: "Compliance" },
  { key: "financial_stability", label: "Financial" },
  { key: "geographic_reach", label: "Geographic" },
  { key: "experience_relevance", label: "Experience" },
];

type GroupVariant = "act" | "high" | "medium" | "adjacent" | "geo" | "watch";

interface TenderGroup {
  label: string;
  sub?: string;
  tenders: MatchedTender[];
  variant: GroupVariant;
  priority: number;
}

const OPPORTUNITY_GROUPS: Record<OpportunityBucket, { label: string; sub: string; variant: GroupVariant; priority: number }> = {
  act_now: {
    label: "Act Now",
    sub: "High-fit opportunities with deadline pressure. These deserve bid/no-bid attention first.",
    variant: "act",
    priority: 1,
  },
  strong_fit: {
    label: "Strong Fit",
    sub: "Direct-fit tenders that match your profile and geography well.",
    variant: "high",
    priority: 2,
  },
  strategic: {
    label: "Strategic Expansion",
    sub: "Regional, global, or evidence-backed opportunities worth reviewing if capacity allows.",
    variant: "geo",
    priority: 3,
  },
  adjacent: {
    label: "Adjacent Bets",
    sub: "Near your core sectors — useful for partnerships, expansion, or market sensing.",
    variant: "adjacent",
    priority: 4,
  },
  watchlist: {
    label: "Watchlist",
    sub: "Potentially relevant, but verify evidence, scope, or fit before spending proposal time.",
    variant: "watch",
    priority: 5,
  },
};

function fallbackOpportunityBucket(t: MatchedTender): OpportunityBucket {
  if (t.is_adjacent) return "adjacent";
  if (t.score >= 70 && t.bucket === "country") return "strong_fit";
  if (t.bucket === "regional" || t.bucket === "global" || t.bucket === "remote") return "strategic";
  return t.score >= 50 ? "strategic" : "watchlist";
}

function groupTenders(tenders: MatchedTender[]): TenderGroup[] {
  const sorted = [...tenders].sort((a, b) => b.score - a.score);
  const byBucket = new Map<OpportunityBucket, MatchedTender[]>();
  for (const t of sorted) {
    const bucket = t.opportunity_bucket ?? fallbackOpportunityBucket(t);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), t]);
  }

  const groups = [...byBucket.entries()]
    .map(([bucket, bucketTenders]) => {
      const meta = OPPORTUNITY_GROUPS[bucket];
      return { ...meta, tenders: bucketTenders };
    })
    .sort((a, b) => a.priority - b.priority);

  if (!groups.length) groups.push({ label: "Matched Tenders", sub: "All matched tender opportunities.", tenders: sorted, variant: "medium", priority: 99 });
  return groups;
}

function groupGrants(grants: MatchedGrant[]): { label: string; sub: string; grants: MatchedGrant[]; variant: GroupVariant; priority: number }[] {
  const sorted = [...grants].sort((a, b) => b.score - a.score);
  const byBucket = new Map<OpportunityBucket, MatchedGrant[]>();
  for (const g of sorted) {
    const bucket = g.opportunity_bucket ?? (g.score >= 65 ? "strong_fit" : g.score >= 45 ? "strategic" : "watchlist");
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), g]);
  }

  const groups = [...byBucket.entries()]
    .map(([bucket, bucketGrants]) => {
      const meta = OPPORTUNITY_GROUPS[bucket];
      return { ...meta, grants: bucketGrants };
    })
    .sort((a, b) => a.priority - b.priority);

  if (!groups.length) groups.push({ label: "Matched Grants", sub: "All matched grant opportunities.", grants: sorted, variant: "medium", priority: 99 });
  return groups;
}

function formatAmount(val: string | number | null | undefined): string | null {
  if (val == null) return null;
  if (typeof val === "number") return val > 0 ? `$${val.toLocaleString()}` : null;
  const s = val.toString().trim();
  return s || null;
}

function parseSectorDisplay(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return trimmed || null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const labels = (parsed as { sector_description?: string; sector_code?: string }[])
        .map((s) => s.sector_description || s.sector_code || "")
        .filter(Boolean);
      return labels.join(", ") || null;
    }
    if (parsed && typeof parsed === "object") {
      const o = parsed as { sector_description?: string; sector_code?: string };
      return o.sector_description || o.sector_code || null;
    }
  } catch {}
  return trimmed || null;
}

type FeedbackStatus = "saved" | "not_relevant";

/* ── TenderCard (vertical, grid-ready) ── */

interface TenderCardProps {
  t: MatchedTender;
  gaps: Gap[];
  feedbackStatus?: FeedbackStatus;
  onFeedback: (id: number, status: FeedbackStatus) => void;
}

function TenderCard({ t, gaps, feedbackStatus, onFeedback }: TenderCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);

  const badge = matchBadge(t.score);
  const soon = isDeadlineSoon(t.deadline);
  const scoreBg = t.score >= 70 ? "bg-green/15" : t.score >= 50 ? "bg-amber-500/15" : "bg-gray-700/40";
  const scoreText = t.score >= 70 ? "text-green" : t.score >= 50 ? "text-amber-400" : "text-gray-400";
  const amount = formatAmount(t.estimated_value);

  const bucketLabel =
    t.is_adjacent ? "Adjacent"
    : t.bucket === "regional" ? "Regional"
    : t.bucket === "remote" ? "Remote"
    : t.bucket === "global" ? "Global"
    : null;

  const bucketCls =
    t.is_adjacent ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
    : "bg-purple-500/20 text-purple-300 border border-purple-500/30";

  const opportunityBucketCls =
    t.opportunity_bucket === "act_now" ? "bg-red/15 text-red border border-red/30"
    : t.opportunity_bucket === "strong_fit" ? "bg-green/15 text-green border border-green/30"
    : t.opportunity_bucket === "strategic" ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
    : t.opportunity_bucket === "adjacent" ? "bg-blue-500/15 text-blue-300 border border-blue-500/30"
    : "bg-gray-600/20 text-gray-300 border border-gray-600/30";

  const sr = t.structured_reasons;
  const summaryLines = sr?.summary?.length
    ? sr.summary.slice(0, 2)
    : (t.match_reasons?.slice(0, 2) ?? []);

  const highGaps = gaps.filter((g) => g.severity === "high").slice(0, 2);

  const confidenceCls =
    sr?.confidence === "high" ? "bg-green/20 text-green border-green/30"
    : sr?.confidence === "medium" ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : "bg-gray-600/20 text-gray-400 border-gray-600/30";

  const brief = t.decision_brief;
  const sourceConfidenceCls =
    brief?.source_confidence === "high" ? "bg-green/15 text-green border-green/25"
    : brief?.source_confidence === "medium" ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
    : "bg-gray-600/20 text-gray-300 border-gray-600/30";

  const geoModeLabel: Record<string, string> = {
    direct: "Direct — your target country",
    regional: "Regional — neighbouring country",
    "global-open": "Global — open to all countries",
    "auto-expanded": "Auto-expanded — limited local supply",
    unknown: "Geography unknown",
  };

  const handleWhyToggle = () => {
    const next = !whyOpen;
    setWhyOpen(next);
    if (next) console.log("[tp:panel:open]", { tenderId: t.id, score: t.score, confidence: sr?.confidence });
  };

  const handleFeedback = (status: FeedbackStatus) => {
    onFeedback(t.id, status);
    console.log("[tp:feedback]", { tenderId: t.id, status });
  };

  return (
    <div className={`rounded-xl bg-navy-light border p-4 flex flex-col gap-3 h-full ${t.is_adjacent ? "border-blue-500/25" : "border-white/10"}`}>
      {/* Score + badges row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
          {t.opportunity_bucket_label && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${opportunityBucketCls}`}>
              {t.opportunity_bucket_label}
            </span>
          )}
          {bucketLabel && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${bucketCls}`}>{bucketLabel}</span>
          )}
          {feedbackStatus === "saved" && (
            <span className="rounded bg-teal-500/20 text-teal-300 border border-teal-500/30 px-2 py-0.5 text-[10px] font-medium">✓ Saved</span>
          )}
        </div>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${scoreBg}`}>
          <span className={`text-xs font-bold leading-none ${scoreText}`}>{t.score}%</span>
        </div>
      </div>

      {/* Chips: country + sector */}
      <div className="flex flex-wrap gap-1">
        <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-gold uppercase">{t.country}</span>
        {parseSectorDisplay(t.sector) && (
          <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-gray-300">{parseSectorDisplay(t.sector)}</span>
        )}
        {t.reference_id && (
          <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-mono text-gray-500">{t.reference_id}</span>
        )}
      </div>

      {/* Title */}
      <h4 className="text-sm font-bold leading-snug">{t.title}</h4>

      {/* Meta */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <span className="truncate max-w-full">{t.agency}</span>
        {t.deadline && (
          <span className={`flex items-center gap-1 ${soon ? "text-red font-medium" : ""}`}>
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDate(t.deadline)}{soon && " — soon"}
          </span>
        )}
        {amount && (
          <span className="text-gray-300 font-medium">{amount}</span>
        )}
        {t.jv_allowed && <span className="text-blue-400">JV Allowed</span>}
      </div>

      {/* Summary snippet */}
      {summaryLines.length > 0 && (
        <p className="text-[11px] text-gray-400 italic line-clamp-2">
          {summaryLines.join(" · ")}
        </p>
      )}

      {brief && (
        <div className="rounded-lg bg-white/3 border border-white/8 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Decision Brief</span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase border ${sourceConfidenceCls}`}>
              {brief.source_confidence} source
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-300 line-clamp-3">{brief.headline}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {brief.reasons_to_act.length > 0 && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-green/70">Why Act</span>
                <ul className="mt-1 space-y-1">
                  {brief.reasons_to_act.slice(0, 2).map((reason) => (
                    <li key={reason} className="text-[10px] leading-snug text-gray-400">{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {brief.verify_before_bidding.length > 0 && (
              <div>
                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400/80">Verify</span>
                <ul className="mt-1 space-y-1">
                  {brief.verify_before_bidding.slice(0, 2).map((item) => (
                    <li key={item} className="text-[10px] leading-snug text-gray-400">{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <p className="text-[10px] font-semibold text-gold/80">{brief.recommended_action}</p>
        </div>
      )}

      {/* Why matched toggle */}
      <button
        onClick={handleWhyToggle}
        className="flex items-center gap-1 text-[11px] text-gold/80 hover:text-gold transition-colors self-start"
      >
        <svg className={`w-3 h-3 transition-transform ${whyOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        {whyOpen ? "Hide details" : "Why this match?"}
      </button>

      {/* Expandable why-matched panel */}
      {whyOpen && (
        <div className="rounded-lg bg-white/3 border border-white/8 p-3 space-y-3 text-[11px]">
          {sr?.matchedSectors?.length && (
            <div>
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Sectors</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {sr.matchedSectors.map((s) => (
                  <span key={s} className="rounded bg-blue-500/15 border border-blue-500/25 px-2 py-0.5 text-blue-300">{s}</span>
                ))}
              </div>
            </div>
          )}
          {sr?.matchedCapabilities?.length && (
            <div>
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Matched Capabilities</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {sr.matchedCapabilities.map((c) => (
                  <span key={c} className="rounded bg-green/10 border border-green/20 px-2 py-0.5 text-green/80">{c}</span>
                ))}
              </div>
            </div>
          )}
          {sr?.matchedKeywords?.length && (
            <div>
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Keywords</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {sr.matchedKeywords.map((k) => (
                  <span key={k} className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-gray-300">{k}</span>
                ))}
              </div>
            </div>
          )}
          {sr?.geographyAlignment && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Geography</span>
              <span className="text-gray-300">{geoModeLabel[sr.geographyAlignment.mode] ?? sr.geographyAlignment.mode}</span>
            </div>
          )}
          {sr?.confidence && (
            <div className="flex items-center gap-2">
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Confidence</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${confidenceCls}`}>
                {sr.confidence.charAt(0).toUpperCase() + sr.confidence.slice(1)}
              </span>
            </div>
          )}
          {brief && (
            <div className="space-y-1">
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Source Check</span>
              <p className="text-gray-400">{brief.source_confidence_reason}</p>
              {t.enriched_summary && <p className="text-gray-300">{t.enriched_summary}</p>}
            </div>
          )}
          {t.opportunity_bucket_reason && (
            <div className="space-y-1">
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Bucket Logic</span>
              <p className="text-gray-400">{t.opportunity_bucket_reason}</p>
            </div>
          )}
          {sr?.caveats?.length && (
            <div className="space-y-1">
              {sr.caveats.map((c, i) => (
                <p key={i} className="text-amber-400/80 flex items-start gap-1">
                  <span className="flex-shrink-0 mt-0.5">⚠</span>{c}
                </p>
              ))}
            </div>
          )}
          {/* EPIC C: Readiness blockers */}
          {highGaps.length > 0 && (
            <div>
              <span className="text-gray-500 uppercase tracking-wider text-[9px] font-bold">Readiness Blockers</span>
              <div className="mt-1 space-y-1">
                {highGaps.map((g, i) => (
                  <p key={i} className="text-red/80 flex items-start gap-1">
                    <span className="flex-shrink-0 mt-0.5">•</span>{g.gap}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions — pushed to bottom */}
      <div className="flex flex-wrap gap-2 mt-auto pt-1">
        {t.source_url ? (
          <a href={t.source_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-gold/90 border border-gold px-3 py-1.5 text-xs text-navy font-medium hover:bg-gold transition-colors">
            View Notice →
          </a>
        ) : (
          <a href={`https://www.google.com/search?q=${encodeURIComponent(t.agency + " " + (t.reference_id ?? t.title))}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-gold/15 border border-gold/30 px-3 py-1.5 text-xs text-gold hover:bg-gold/25 transition-colors">
            Search Procurement →
          </a>
        )}
        <button
          onClick={() => handleFeedback("saved")}
          className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition-colors ${feedbackStatus === "saved" ? "bg-teal-500/20 border-teal-500/40 text-teal-300" : "border-white/15 text-gray-400 hover:text-white hover:border-white/30"}`}
        >
          {feedbackStatus === "saved" ? "✓ Saved" : "Save"}
        </button>
        <button
          onClick={() => handleFeedback("not_relevant")}
          className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1.5 text-xs text-gray-500 hover:text-red/80 hover:border-red/30 transition-colors"
        >
          ✕ Skip
        </button>
      </div>
    </div>
  );
}

/* ── GrantCard (matches TenderCard style, teal accent) ── */

function GrantCard({ g }: { g: MatchedGrant }) {
  const badge = matchBadge(g.score);
  const soon = isDeadlineSoon(g.deadline);
  const amount = g.value_range ? g.value_range : null;
  const location = g.country ?? g.region ?? null;
  const opportunityBucketCls =
    g.opportunity_bucket === "act_now" ? "bg-red/15 text-red border border-red/30"
    : g.opportunity_bucket === "strong_fit" ? "bg-green/15 text-green border border-green/30"
    : g.opportunity_bucket === "strategic" ? "bg-purple-500/15 text-purple-300 border border-purple-500/30"
    : "bg-gray-600/20 text-gray-300 border border-gray-600/30";

  return (
    <div className="rounded-xl bg-navy-light border border-white/10 p-4 flex flex-col gap-3 h-full">
      {/* Score + badges row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
          <span className="rounded bg-teal-500/20 border border-teal-500/40 px-2 py-0.5 text-[10px] font-semibold text-teal-300 uppercase">Grant</span>
          {g.opportunity_bucket_label && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${opportunityBucketCls}`}>
              {g.opportunity_bucket_label}
            </span>
          )}
          {g.org_type_mismatch && (
            <span className="rounded bg-orange-500/15 border border-orange-500/40 px-2 py-0.5 text-[10px] font-medium text-orange-400">⚠ Check eligibility</span>
          )}
        </div>
        <div className="w-10 h-10 rounded-full bg-teal-500/15 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold leading-none text-teal-400">{g.score}%</span>
        </div>
      </div>

      {/* Chips: location + sector */}
      <div className="flex flex-wrap gap-1">
        {location && (
          <span className="rounded bg-teal-500/15 px-2 py-0.5 text-[10px] font-medium text-teal-300 uppercase">{location}</span>
        )}
        {parseSectorDisplay(g.sector) && (
          <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-gray-300">{parseSectorDisplay(g.sector)}</span>
        )}
      </div>

      {/* Title */}
      <h4 className="text-sm font-bold leading-snug">{g.title}</h4>

      {/* Meta */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
        <span className="truncate max-w-full">{g.agency}</span>
        {g.deadline && (
          <span className={`flex items-center gap-1 ${soon ? "text-red font-medium" : ""}`}>
            <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            {formatDate(g.deadline)}{soon && " — soon"}
          </span>
        )}
        {amount && (
          <span className="text-teal-300 font-medium">{amount}</span>
        )}
      </div>

      {/* Description */}
      {g.description && (
        <p className="text-[11px] text-gray-300 line-clamp-2">{g.description}</p>
      )}
      {g.opportunity_bucket_reason && (
        <div className="rounded-lg bg-white/3 border border-white/8 p-3">
          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">Bucket Logic</span>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{g.opportunity_bucket_reason}</p>
        </div>
      )}

      {/* Action — pushed to bottom */}
      <div className="mt-auto pt-1">
        {g.source_url ? (
          <a href={g.source_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-teal-500/20 border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/30 transition-colors">
            Apply / Learn More →
          </a>
        ) : (
          <span className="text-xs text-gray-500 italic">Contact {g.agency} directly for application details</span>
        )}
      </div>
    </div>
  );
}

/* ── BidNoBidCTA ── */

function BidNoBidCTA({ count }: { count: number }) {
  return (
    <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/8 p-5 mb-6">
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <div className="text-3xl flex-shrink-0 select-none">⚡</div>
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-1">
            {count} strong match{count > 1 ? "es" : ""} found
          </div>
          <h3 className="text-base font-bold text-white mb-2">
            Should you bid? Know before you spend 30 hours on a proposal.
          </h3>
          <p className="text-sm text-gray-300 mb-4">
            Our Bid/No-Bid Analyst reviews a specific tender against your profile and returns a win probability score, scoring criteria breakdown, and a clear go/no-go recommendation — so you only invest effort where it counts.
          </p>
          <a href="/assessment?plan=bid-no-bid"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-400 transition-colors">
            Analyze a tender — $39 →
          </a>
          <p className="text-[11px] text-gray-500 mt-2">One analysis per tender. No subscription required.</p>
        </div>
      </div>
    </div>
  );
}

/* ── Group header styles ── */

const GROUP_HEADER: Record<GroupVariant, string> = {
  act: "text-red",
  high: "text-green",
  medium: "text-gold",
  adjacent: "text-blue-400",
  geo: "text-purple-400",
  watch: "text-gray-400",
};

/* ── Action Plan with High/Medium/Low grouping ── */

interface ActionPlanProps {
  gaps: Gap[];
  expandedGaps: Set<number>;
  toggleGap: (i: number) => void;
}

const SEVERITY_GROUP_CONFIG = [
  { key: "high" as const, label: "High Priority", headerCls: "text-red", dotCls: "bg-red" },
  { key: "medium" as const, label: "Medium Priority", headerCls: "text-orange-400", dotCls: "bg-orange-400" },
  { key: "low" as const, label: "Low Priority", headerCls: "text-yellow-400", dotCls: "bg-yellow-400" },
] as const;

function ActionPlan({ gaps, expandedGaps, toggleGap }: ActionPlanProps) {
  const indexed = gaps.map((g, i) => ({ gap: g, idx: i }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {SEVERITY_GROUP_CONFIG.map((cfg) => {
        const items = indexed.filter(({ gap }) => gap.severity === cfg.key);
        return (
          <div key={cfg.key} className={`rounded-xl border p-4 ${cfg.key === "high" ? "border-red/20 bg-red/5" : cfg.key === "medium" ? "border-orange-500/20 bg-orange-500/5" : "border-yellow-500/20 bg-yellow-500/5"}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dotCls}`} />
              <h3 className={`text-xs font-bold uppercase tracking-wider ${cfg.headerCls}`}>
                {cfg.label}
              </h3>
              <span className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded ${severityBadgeCls(cfg.key)}`}>
                {items.length}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="text-xs text-gray-600 italic">No items</p>
            ) : (
              <div className="space-y-2">
                {items.map(({ gap: g, idx: i }) => (
                  <div key={i} className={`rounded-lg border ${severityColor(g.severity)}`}>
                    <button
                      onClick={() => toggleGap(i)}
                      className="w-full px-3 py-2.5 text-left flex items-center justify-between gap-2"
                    >
                      <span className="text-xs font-medium text-gray-200 min-w-0 truncate">{g.gap}</span>
                      <svg className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 transition-transform ${expandedGaps.has(i) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {expandedGaps.has(i) && (
                      <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
                        <p className="text-xs text-gray-300"><span className="text-gray-400 font-medium">Fix: </span>{g.fix}</p>
                        {g.action_steps?.length > 0 && (
                          <ol className="list-decimal list-inside space-y-1">
                            {g.action_steps.map((step, si) => (
                              <li key={si} className="text-[11px] text-gray-300">{step}</li>
                            ))}
                          </ol>
                        )}
                        <p className="text-[11px] text-gray-500">
                          Service: <span className="text-gold">{TIER_INFO[g.upsell_tier]?.name ?? g.upsell_tier}</span>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main component ── */

export default function AssessmentResults({ data, onReset }: Props) {
  const [activeTab, setActiveTab] = useState<"tenders" | "grants">("tenders");
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Record<number, FeedbackStatus>>(() => readStoredFeedback(data.id));

  useEffect(() => {
    const handle = window.setTimeout(() => setFeedback(readStoredFeedback(data.id)), 0);
    return () => window.clearTimeout(handle);
  }, [data.id]);

  const onFeedback = useCallback((tenderId: number, status: FeedbackStatus) => {
    setFeedback((prev) => {
      const next = { ...prev };
      if (next[tenderId] === status) {
        delete next[tenderId];
      } else {
        next[tenderId] = status;
      }
      try { localStorage.setItem(`tp_feedback_${data.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (token) {
      fetch("/api/dashboard/tender-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tender_id: tenderId, assessment_id: data.id, status }),
      }).catch(() => {});
    }
    console.log("[tp:feedback:confidence]", { tenderId, status });
  }, [data.id]);

  const toggleGap = (i: number) => {
    setExpandedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/assessment/${data.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const visibleTenders = data.matched_tenders.filter((t) => feedback[t.id] !== "not_relevant");
  const tenderGroups = groupTenders(visibleTenders);
  const grantGroups = groupGrants(data.matched_grants);
  const strongMatchCount = visibleTenders.filter((t) => t.score >= 50).length;
  const criticalGapCount = data.gaps.filter((g) => g.severity === "high").length;

  const grantTotal = data.grant_readiness_score;

  // Derive a sector display label for the "Next Step" copy
  const sectorLabel = data.sector || (data.sectors?.[0] ?? "your industry");
  const topGap = data.gaps.find((g) => g.severity === "high");

  return (
    <div className="mx-auto max-w-4xl px-6 pb-20" style={{ animation: "fadeIn 0.5s ease-out both" }}>
      {/* Header */}
      <h1 className="font-serif text-3xl font-bold text-center">Assessment Results</h1>
      <p className="text-center text-gray-400 text-sm mt-1 mb-4">{data.company_name}</p>

      {/* Email notice */}
      <div className="rounded-lg bg-green/15 border border-green/30 px-4 py-3 text-sm text-green mb-2 flex flex-wrap items-center gap-2">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <span>A copy of your report is on its way to <strong className="text-white">{data.email}</strong>.</span>
      </div>
      <div className="text-sm text-gray-400 mb-6 flex items-center gap-2">
        Bookmark or share this link:
        <button onClick={copyLink} className="inline-flex items-center gap-1 rounded bg-green/90 px-3 py-1 text-xs font-medium text-white hover:bg-green transition-colors">
          {copied ? "Copied!" : "Copy Results Link"}
        </button>
      </div>

      {/* Readiness Score */}
      <div className="rounded-xl bg-navy-light border border-white/10 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Readiness Score</h3>
          <div className="flex items-baseline gap-1">
            <span className={`text-3xl font-bold ${data.readiness_score >= 70 ? "text-green" : data.readiness_score >= 50 ? "text-yellow-400" : data.readiness_score >= 35 ? "text-orange-400" : "text-red"}`}>
              {data.readiness_score}
            </span>
            <span className="text-sm text-gray-500">/100</span>
          </div>
        </div>
        <div className="bg-gray-800 rounded-full h-2 overflow-hidden mb-4">
          <div className={`h-full rounded-full transition-all ${scoreColor(data.readiness_score)}`} style={{ width: `${data.readiness_score}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {DIMENSION_LABELS.map(({ key, label }) => {
            const val = data.readiness_dimensions[key];
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-gray-400">{label}</span>
                  <span className="text-[11px] font-semibold text-gray-300">{val}</span>
                </div>
                <div className="bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${scoreColor(val)}`} style={{ width: `${val}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Strengths */}
      {data.strengths.length > 0 && (
        <div className="mb-6 space-y-2">
          {data.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-300">{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grant Readiness Score */}
      {data.grant_readiness_score > 0 && (
        <div className="rounded-xl bg-navy-light border border-white/10 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Grant Readiness</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">Institutional &amp; donor grants</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-teal-400">{grantTotal}</span>
              <span className="text-sm text-gray-500">/100</span>
            </div>
          </div>
          <div className="bg-gray-800 rounded-full h-2 overflow-hidden mb-2">
            <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${grantTotal}%` }} />
          </div>
          <p className="text-[11px] text-gray-500">
            {grantTotal >= 70
              ? "Strong — tailor proposals to each funder's criteria."
              : grantTotal >= 40
              ? "Moderate — address capacity and M&E gaps before applying."
              : "Early-stage — build core organizational capacity first."}
          </p>
        </div>
      )}

      {/* ── Action Plan (grouped by High / Medium / Low) ── */}
      {data.gaps.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif text-xl font-bold">Action Plan</h2>
            {criticalGapCount > 0 && (
              <span className="text-xs font-medium text-red bg-red/10 border border-red/20 rounded-full px-3 py-0.5">
                {criticalGapCount} critical gap{criticalGapCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mb-4">Address these before submitting proposals — panels score these criteria first.</p>
          <ActionPlan gaps={data.gaps} expandedGaps={expandedGaps} toggleGap={toggleGap} />
        </div>
      )}

      {/* ── Tabs: Tenders / Grants ── */}
      <div className="flex border-b border-white/10 mb-6">
        <button
          onClick={() => setActiveTab("tenders")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "tenders" ? "border-gold text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <span>Matched Tenders</span>
          <span className="rounded-full bg-gold/20 text-gold px-2 py-0.5 text-xs">{visibleTenders.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("grants")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "grants" ? "border-teal-400 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <span>Matched Grants</span>
          <span className="rounded-full bg-teal-500/20 text-teal-400 px-2 py-0.5 text-xs">{data.matched_grants.length}</span>
        </button>
      </div>

      {/* ── Tenders Tab ── */}
      {activeTab === "tenders" && (
        <div className="mb-10">
          {visibleTenders.length === 0 && (
            <p className="text-gray-500 text-sm">No matching tenders found.</p>
          )}

          {strongMatchCount > 0 && <BidNoBidCTA count={strongMatchCount} />}

          <div className="space-y-10">
            {tenderGroups.map((group) => (
              <div key={group.label}>
                <h3 className={`text-sm font-semibold mb-1 ${GROUP_HEADER[group.variant]}`}>{group.label}</h3>
                {group.sub && <p className="text-xs text-gray-500 mb-4">{group.sub}</p>}
                {!group.sub && <div className="mb-3" />}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.tenders.map((t) => (
                    <TenderCard
                      key={t.id}
                      t={t}
                      gaps={data.gaps}
                      feedbackStatus={feedback[t.id]}
                      onFeedback={onFeedback}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Grants Tab ── */}
      {activeTab === "grants" && (
        <div className="space-y-8 mb-10">
          {data.matched_grants.length === 0 && <p className="text-gray-500 text-sm">No matching grants found.</p>}
          {grantGroups.map((group) => (
            <div key={group.label}>
              <h3 className={`text-sm font-semibold mb-1 ${GROUP_HEADER[group.variant]}`}>{group.label}</h3>
              <p className="text-xs text-gray-500 mb-4">{group.sub}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.grants.map((g) => <GrantCard key={g.id} g={g} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Your Next Step ── */}
      <div className="text-center mb-8">
        <h2 className="font-serif text-2xl font-bold text-gold mb-2">Your Next Step</h2>
        <p className="text-sm text-gray-400">
          {data.company_name} scored {data.readiness_score}% — a few targeted moves will close the gap.
        </p>
      </div>

      <div className="rounded-xl border border-gold/30 bg-navy-light p-6 mb-8">
        <p className="text-xs font-bold tracking-wider uppercase text-gold mb-4">Your Recommended Path to Your First Contract</p>
        <div className="space-y-4">
          {[
            {
              title: "Close the capability gaps",
              body: topGap
                ? `Start with: ${topGap.fix}`
                : `Obtain relevant certifications, document past performance with measurable outcomes, and prepare your full vendor documentation package — these are what procurement panels score first.`,
            },
            {
              title: `Monitor ${sectorLabel} opportunities`,
              body: `Real-time alerts for tenders matching your exact capabilities and target countries — start with SME-friendly contracts that fit your capacity.`,
            },
            {
              title: "Submit a winning proposal",
              body: "Professional technical and financial proposal writing that follows the scoring criteria used by UN evaluation panels.",
            },
          ].map((step, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-6 h-6 rounded-full bg-gold/20 text-gold text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
              <div>
                <h4 className="text-sm font-semibold">{step.title}</h4>
                <p className="text-xs text-gray-400 mt-0.5">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {(["tender-intelligence", "submission-package", "strategic-partnership"] as TierSlug[]).map((slug, i) => {
          const tier = TIER_INFO[slug];
          const isRec = slug === data.recommended_tier;
          return (
            <div
              key={slug}
              className={`rounded-xl border-2 p-5 bg-navy-light relative flex flex-col transition-colors ${isRec ? "border-gold" : "border-white/10 hover:border-white/20"}`}
              style={{ animation: "fadeInUp 0.5s ease-out both", animationDelay: `${i * 0.1}s` }}
            >
              {isRec && (
                <span className="absolute -top-3 right-4 rounded-full bg-gold px-3 py-0.5 text-[10px] font-bold text-white uppercase">Best Fit</span>
              )}
              <h3 className="text-base font-bold mb-1">{tier.name}</h3>
              <div className="mt-2 mb-3">
                <span className={`text-2xl font-bold ${isRec ? "text-gold" : "text-white"}`}>{tier.price}</span>
                <span className="text-xs text-gray-500">{tier.billingPeriod}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed flex-1">{tier.tagline}</p>
              <button
                onClick={() => { window.location.href = `/login?plan=${slug}`; }}
                className={`w-full rounded-lg py-2.5 text-xs font-semibold text-center transition-colors mb-2 ${isRec ? "bg-gold text-white hover:bg-gold-dark" : "border border-white/20 text-white hover:bg-white/5"}`}
              >
                {tier.cta} →
              </button>
              <a
                href={`/pay?plan=${slug}`}
                className="w-full rounded-lg py-1.5 text-[11px] font-medium text-center text-gray-500 hover:text-gray-300 border border-white/10 hover:border-white/20 transition-colors"
              >
                Pay with USDT / Wire / Whish
              </a>
            </div>
          );
        })}
      </div>

      {/* Dashboard CTA */}
      <div className="rounded-xl border border-gold/40 bg-gold/10 p-6 text-center">
        <div className="text-xs font-semibold uppercase tracking-widest text-gold mb-2">Your pipeline is ready</div>
        <h3 className="text-xl font-bold text-white mb-2">See your matched tenders and track your progress</h3>
        <p className="text-sm text-gray-400 mb-5">
          We&apos;ve found {data.matched_tenders.length} tenders and {data.matched_grants.length} grants for you.
          Start your 14-day free trial and track them all in your personal pipeline.
        </p>
        <button
          onClick={() => {
            const bridge = {
              assessment_id: data.id,
              email: data.email,
              readiness_score: data.readiness_score,
              company_name: data.company_name,
              matched_tenders: data.matched_tenders.slice(0, 10).map((t) => ({
                id: t.id,
                title: t.title,
                agency: t.agency,
                deadline: t.deadline ?? null,
                estimated_value: typeof t.estimated_value === "string" ? t.estimated_value : null,
                fit_score: t.score,
                structured_reasons: t.structured_reasons
                  ? {
                      ...t.structured_reasons,
                      opportunityBucket: t.opportunity_bucket ?? null,
                      opportunityBucketLabel: t.opportunity_bucket_label ?? null,
                      opportunityBucketReason: t.opportunity_bucket_reason ?? null,
                    }
                  : null,
              })),
              gaps: data.gaps.filter((g) => g.severity === "high").slice(0, 5),
            };
            localStorage.setItem("tp_bridge", JSON.stringify(bridge));
            window.location.href = "/login?next=/dashboard";
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-gold px-6 py-3 text-sm font-semibold text-white hover:bg-gold-dark transition-colors"
        >
          Go to my dashboard →
        </button>
      </div>

      {/* Bottom links */}
      <div className="text-center space-y-3 mt-8">
        <Link href="/#services" className="text-sm text-gray-400 hover:text-white transition-colors">See all services →</Link>
        <div>
          <button onClick={onReset} className="text-sm text-gray-500 hover:text-gold underline transition-colors">
            Run Another Assessment
          </button>
        </div>
      </div>
    </div>
  );
}
