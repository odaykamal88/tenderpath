"use client";

import { useState } from "react";
import type { TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
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

const GRANT_DIMENSION_LABELS = [
  "Impact Methodology", "M&E Frameworks", "Grant Management", "Org Capacity", "Financial Controls",
];

type GroupVariant = "high" | "medium" | "adjacent" | "geo";

interface TenderGroup {
  label: string;
  sub?: string;
  tenders: MatchedTender[];
  variant: GroupVariant;
}

function groupTenders(tenders: MatchedTender[]): TenderGroup[] {
  const sorted = [...tenders].sort((a, b) => b.score - a.score);
  const highFit: MatchedTender[] = [];
  const mediumLow: MatchedTender[] = [];
  const adjacent: MatchedTender[] = [];
  const geo: MatchedTender[] = [];

  for (const t of sorted) {
    if (t.is_adjacent) { adjacent.push(t); continue; }
    if (t.bucket === "regional" || t.bucket === "global" || t.bucket === "remote") { geo.push(t); continue; }
    if (t.score >= 70) highFit.push(t);
    else mediumLow.push(t);
  }

  const groups: TenderGroup[] = [];
  if (highFit.length) groups.push({ label: "High-Fit Opportunities", tenders: highFit, variant: "high" });
  if (mediumLow.length) groups.push({ label: "Medium & Low Matches", tenders: mediumLow, variant: "medium" });
  if (adjacent.length) groups.push({
    label: "Adjacent Sector Opportunities",
    sub: "In sectors near your core — lower direct fit, but worth monitoring for partnerships or expansion.",
    tenders: adjacent,
    variant: "adjacent",
  });
  if (geo.length) groups.push({ label: "Regional & Global Opportunities", tenders: geo, variant: "geo" });
  if (!groups.length) groups.push({ label: "Matched Tenders", tenders: sorted, variant: "medium" });
  return groups;
}

function groupGrants(grants: MatchedGrant[]): { label: string; grants: MatchedGrant[] }[] {
  const sorted = [...grants].sort((a, b) => b.score - a.score);
  const regional: MatchedGrant[] = [];
  const global: MatchedGrant[] = [];
  for (const g of sorted) {
    const c = (g.country ?? g.region ?? "").toLowerCase();
    if (!c || c === "global" || c === "international" || c.includes("global")) global.push(g);
    else regional.push(g);
  }
  const groups: { label: string; grants: MatchedGrant[] }[] = [];
  if (regional.length) groups.push({ label: "Regional Grants", grants: regional });
  if (global.length) groups.push({ label: "Global Grant Opportunities", grants: global });
  if (!groups.length) groups.push({ label: "Matched Grants", grants: sorted });
  return groups;
}

/* ── TenderCard ── */

function TenderCard({ t }: { t: MatchedTender }) {
  const badge = matchBadge(t.score);
  const soon = isDeadlineSoon(t.deadline);
  const agencyQ = encodeURIComponent(t.agency);
  const refQ = encodeURIComponent(t.reference_id ?? t.title);
  const scoreBg = t.score >= 70 ? "bg-green/15" : t.score >= 50 ? "bg-amber-500/15" : "bg-gray-700/40";
  const scoreText = t.score >= 70 ? "text-green" : t.score >= 50 ? "text-amber-400" : "text-gray-400";

  return (
    <div className={`rounded-xl bg-navy-light border p-4 flex flex-col sm:flex-row gap-4 ${t.is_adjacent ? "border-blue-500/25" : "border-white/10"}`}>
      {/* Score panel */}
      <div className="flex sm:flex-col items-center gap-3 sm:gap-2 sm:w-24 flex-shrink-0">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${scoreBg}`}>
          <span className={`text-base font-bold leading-none ${scoreText}`}>{t.score}%</span>
        </div>
        <div className="flex flex-wrap sm:flex-col gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
          {t.is_adjacent && (
            <span className="rounded px-2 py-0.5 text-[10px] font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">Adjacent</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Chips: country + sector + ref */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-gold uppercase">{t.country}</span>
          {t.sector && (
            <span className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-gray-300">{t.sector}</span>
          )}
          {t.reference_id && (
            <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-mono text-gray-500">{t.reference_id}</span>
          )}
        </div>

        {/* Title */}
        <h4 className="text-sm font-bold leading-snug mb-2">{t.title}</h4>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400 mb-2">
          <span>{t.agency}</span>
          {t.deadline && (
            <span className={`flex items-center gap-1 ${soon ? "text-red font-medium" : ""}`}>
              <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(t.deadline)}{soon && " — closing soon"}
            </span>
          )}
          {t.estimated_value != null && (
            <span>{typeof t.estimated_value === "number" ? `$${t.estimated_value.toLocaleString()}` : t.estimated_value}</span>
          )}
          {t.jv_allowed && <span className="text-blue-400">JV Allowed</span>}
        </div>

        {/* Why matched */}
        {(t.match_reason || (t.match_reasons && t.match_reasons.length > 0)) && (
          <p className="text-[11px] text-gray-400 italic mb-3">
            {t.match_reason ?? t.match_reasons![0]}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {t.source_url && (
            <a href={t.source_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded bg-gold/90 border border-gold px-3 py-1.5 text-xs text-navy font-medium hover:bg-gold transition-colors">
              View Notice →
            </a>
          )}
          <a href={`https://www.google.com/search?q=${agencyQ}+procurement+${refQ}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded bg-gold/15 border border-gold/30 px-3 py-1.5 text-xs text-gold hover:bg-gold/25 transition-colors">
            Search Procurement →
          </a>
        </div>
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
  high: "text-green",
  medium: "text-gold",
  adjacent: "text-blue-400",
  geo: "text-purple-400",
};

/* ── Main component ── */

export default function AssessmentResults({ data, onReset }: Props) {
  const [activeTab, setActiveTab] = useState<"tenders" | "grants">("tenders");
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [showFullSummary, setShowFullSummary] = useState(false);

  const toggleGap = (i: number) => {
    setExpandedGaps((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/api/assessment/${data.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tenderGroups = groupTenders(data.matched_tenders);
  const grantGroups = groupGrants(data.matched_grants);
  const strongMatchCount = data.matched_tenders.filter((t) => t.score >= 50).length;
  const criticalGapCount = data.gaps.filter((g) => g.severity === "high").length;

  const SUMMARY_LIMIT = 130;
  const summaryTruncated = data.summary.length > SUMMARY_LIMIT;
  const summaryDisplay = showFullSummary || !summaryTruncated
    ? data.summary
    : data.summary.slice(0, SUMMARY_LIMIT).trimEnd() + "…";

  // Derive grant readiness dimension scores
  const grantTotal = data.grant_readiness_score;
  const grantDims = [
    Math.min(100, Math.round(grantTotal * 0.85)),
    Math.min(100, Math.round(grantTotal * 0.7)),
    Math.min(100, Math.round(grantTotal * 1.05)),
    Math.min(100, Math.round(grantTotal * 1.1)),
    Math.min(100, Math.round(grantTotal * 0.8)),
  ];

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

      {/* Summary — collapsed by default */}
      <div className="mb-4">
        <p className="text-sm italic text-gray-300 leading-relaxed inline">
          {summaryDisplay}
        </p>
        {summaryTruncated && (
          <button
            onClick={() => setShowFullSummary((v) => !v)}
            className="ml-2 text-xs text-gold hover:text-white transition-colors underline underline-offset-2"
          >
            {showFullSummary ? "Show less" : "Show more"}
          </button>
        )}
      </div>

      {/* Industry badge */}
      <div className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-900/40 border border-blue-500/30 px-4 py-1.5 text-xs font-medium text-blue-300">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Industry detected: {data.sector}
        </span>
      </div>

      {/* Readiness Score */}
      <div className="rounded-xl bg-navy-light border border-white/10 p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-shrink-0 text-center sm:text-left">
            <div className="text-4xl font-bold">
              {data.readiness_score}<span className="text-lg text-gray-500">/100</span>
            </div>
            <div className="text-xs text-gray-400 mt-1">Readiness Score</div>
          </div>
          <div className="flex-1 space-y-2.5">
            {DIMENSION_LABELS.map(({ key, label }) => {
              const val = data.readiness_dimensions[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-24 text-right">{label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${scoreColor(val)}`} style={{ width: `${val}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8">{val}</span>
                </div>
              );
            })}
          </div>
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
        <div className="rounded-xl bg-navy-light border border-white/10 p-6 mb-6">
          <h3 className="font-serif text-lg font-bold mb-1">Grant Readiness Score</h3>
          <p className="text-xs text-gray-500 mb-4">Based on impact methodology, M&E, and grant management capacity</p>
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-shrink-0 text-center sm:text-left">
              <div className="text-4xl font-bold">
                {data.grant_readiness_score}<span className="text-lg text-gray-500">/100</span>
              </div>
              <div className="text-xs text-gray-400 mt-1">Grant Readiness</div>
            </div>
            <div className="flex-1 space-y-2.5">
              {GRANT_DIMENSION_LABELS.map((label, i) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-32 text-right">{label}</span>
                  <div className="flex-1 bg-gray-800 rounded-full h-2.5 overflow-hidden">
                    <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${grantDims[i]}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 w-8">{grantDims[i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Action Plan (Gaps) — moved above tabs ── */}
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
          <div className="space-y-2">
            {data.gaps.map((g, i) => (
              <div key={i} className={`rounded-lg border ${severityColor(g.severity)}`}>
                <button
                  onClick={() => toggleGap(i)}
                  className="w-full px-4 py-3 text-left flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-200 min-w-0">
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded flex-shrink-0 ${severityBadgeCls(g.severity)}`}>
                      {g.severity}
                    </span>
                    <span className="truncate">{g.gap}</span>
                  </span>
                  <svg className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform ${expandedGaps.has(i) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedGaps.has(i) && (
                  <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                    <p className="text-sm text-gray-300"><span className="text-gray-400 font-medium">Fix: </span>{g.fix}</p>
                    {g.action_steps?.length > 0 && (
                      <ol className="list-decimal list-inside space-y-1">
                        {g.action_steps.map((step, si) => (
                          <li key={si} className="text-xs text-gray-300">{step}</li>
                        ))}
                      </ol>
                    )}
                    <p className="text-xs text-gray-500">
                      Recommended service: <span className="text-gold">{TIER_INFO[g.upsell_tier]?.name ?? g.upsell_tier}</span>
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tabs: Tenders / Grants ── */}
      <div className="flex border-b border-white/10 mb-6">
        <button
          onClick={() => setActiveTab("tenders")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "tenders" ? "border-gold text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}
        >
          <span>Matched Tenders</span>
          <span className="rounded-full bg-gold/20 text-gold px-2 py-0.5 text-xs">{data.matched_tenders.length}</span>
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
          {data.matched_tenders.length === 0 && (
            <p className="text-gray-500 text-sm">No matching tenders found.</p>
          )}

          {/* Bid/No-Bid CTA — only when strong matches exist */}
          {strongMatchCount > 0 && <BidNoBidCTA count={strongMatchCount} />}

          <div className="space-y-10">
            {tenderGroups.map((group) => (
              <div key={group.label}>
                <h3 className={`text-sm font-semibold mb-1 ${GROUP_HEADER[group.variant]}`}>{group.label}</h3>
                {group.sub && <p className="text-xs text-gray-500 mb-4">{group.sub}</p>}
                {!group.sub && <div className="mb-3" />}
                <div className="space-y-3">
                  {group.tenders.map((t) => <TenderCard key={t.id} t={t} />)}
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
              <h3 className="text-sm font-semibold text-teal-400 mb-4">{group.label}</h3>
              <div className="space-y-4">
                {group.grants.map((g) => {
                  const badge = matchBadge(g.score);
                  const soon = isDeadlineSoon(g.deadline);
                  return (
                    <div key={g.id} className="rounded-xl bg-navy-light border border-white/10 p-5">
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-2">
                        <span>{g.agency}</span>
                        {(g.country ?? g.region) && <span>{g.country ?? g.region}</span>}
                        {g.value_range && <span>{g.value_range}</span>}
                        {g.deadline && (
                          <span className={soon ? "text-red font-medium" : ""}>Deadline: {formatDate(g.deadline)}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-start gap-2 mb-3">
                        <h4 className="text-base font-semibold flex-1">{g.title}</h4>
                        <span className="rounded bg-teal-500/20 border border-teal-500/40 px-2 py-0.5 text-[10px] font-semibold text-teal-300 uppercase flex-shrink-0">Grant</span>
                        {g.org_type_mismatch && (
                          <span className="rounded bg-orange-500/15 border border-orange-500/40 px-2 py-0.5 text-[10px] font-medium text-orange-400 flex-shrink-0">⚠ Check eligibility</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{g.score}% match</span>
                        <span className="text-xs text-gray-400">{badge.label}</span>
                      </div>
                      {g.description && <p className="text-xs text-gray-300 mb-3 line-clamp-2">{g.description}</p>}
                      {g.source_url ? (
                        <a href={g.source_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-teal-500/20 border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/30 transition-colors">
                          Apply / Learn More →
                        </a>
                      ) : (
                        <span className="text-xs text-gray-500 italic">Contact {g.agency} directly for application details</span>
                      )}
                    </div>
                  );
                })}
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
        <p className="text-xs font-bold tracking-wider uppercase text-gold mb-4">Your Recommended Path to Your First UN Contract</p>
        <div className="space-y-4">
          {[
            {
              title: "Close the capability gaps",
              body: "Obtain ISO 9001, document past performance with measurable outcomes, and prepare your full vendor documentation package — these are what procurement panels score first",
            },
            {
              title: "Monitor matched opportunities",
              body: "Real-time alerts for tenders matching your exact capabilities and target countries — start with SME-friendly contracts under $200K",
            },
            {
              title: "Submit a winning proposal",
              body: "Professional technical and financial proposal writing that follows the scoring criteria used by UN evaluation panels",
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
              readiness_score: data.readiness_score,
              company_name: data.company_name,
              matched_tenders: data.matched_tenders.slice(0, 5),
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
        <a href="/#services" className="text-sm text-gray-400 hover:text-white transition-colors">See all services →</a>
        <div>
          <button onClick={onReset} className="text-sm text-gray-500 hover:text-gold underline transition-colors">
            Run Another Assessment
          </button>
        </div>
      </div>
    </div>
  );
}
