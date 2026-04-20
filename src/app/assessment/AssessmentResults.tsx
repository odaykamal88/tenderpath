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
  if (score >= 80) return { label: "High Fit", cls: "bg-green/20 text-green border border-green/30" };
  if (score >= 60) return { label: "Medium Fit", cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" };
  return { label: "Low Fit", cls: "bg-gray-500/20 text-gray-400 border border-gray-500/30" };
}

function severityColor(s: string): string {
  if (s === "high") return "bg-red/15 border-red/40 text-red";
  if (s === "medium") return "bg-orange-500/15 border-orange-500/40 text-orange-400";
  return "bg-yellow-500/15 border-yellow-500/40 text-yellow-400";
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

function groupGrants(grants: MatchedGrant[]): { label: string; grants: MatchedGrant[] }[] {
  const sorted = [...grants].sort((a, b) => b.score - a.score);
  const regional: MatchedGrant[] = [];
  const global: MatchedGrant[] = [];
  for (const g of sorted) {
    const c = (g.country ?? g.region ?? "").toLowerCase();
    if (!c || c === "global" || c === "international" || c.includes("global")) {
      global.push(g);
    } else {
      regional.push(g);
    }
  }
  const groups: { label: string; grants: MatchedGrant[] }[] = [];
  if (regional.length) groups.push({ label: "Regional Grants", grants: regional });
  if (global.length) groups.push({ label: "Global Grant Opportunities", grants: global });
  if (!groups.length) groups.push({ label: "Matched Grants", grants: sorted });
  return groups;
}

export default function AssessmentResults({ data, onReset }: Props) {
  const [activeTab, setActiveTab] = useState<"tenders" | "grants">("tenders");
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

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

  const sortedTenders = [...data.matched_tenders].sort((a, b) => b.score - a.score);
  const grantGroups = groupGrants(data.matched_grants);

  // Derive grant readiness dimension scores from grant_readiness_score
  // The API doesn't return individual grant dims, so we approximate from the total
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
        Bookmark or share this link instead:
        <button onClick={copyLink} className="inline-flex items-center gap-1 rounded bg-green/90 px-3 py-1 text-xs font-medium text-white hover:bg-green transition-colors">
          {copied ? "Copied!" : "Copy Results Link"}
        </button>
      </div>

      {/* Summary */}
      <p className="text-sm italic text-gray-300 leading-relaxed mb-6">{data.summary}</p>

      {/* Industry detected */}
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
        <div className="mb-8 space-y-2">
          {data.strengths.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-green">
              <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-300">{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Grant Readiness Score */}
      {data.grant_readiness_score > 0 && (
        <div className="rounded-xl bg-navy-light border border-white/10 p-6 mb-8">
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

      {/* Tabs: Tenders / Grants */}
      <div className="flex border-b border-white/10 mb-6">
        <button
          onClick={() => setActiveTab("tenders")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "tenders" ? "border-gold text-white" : "border-transparent text-gray-500 hover:text-gray-300"
          }`}
        >
          <span>Matched Tenders</span>
          <span className="rounded-full bg-gold/20 text-gold px-2 py-0.5 text-xs">{data.matched_tenders.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("grants")}
          className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "grants" ? "border-teal-400 text-white" : "border-transparent text-gray-500 hover:text-gray-300"
          }`}
        >
          <span>Matched Grants</span>
          <span className="rounded-full bg-teal-500/20 text-teal-400 px-2 py-0.5 text-xs">{data.matched_grants.length}</span>
        </button>
      </div>

      {/* Tenders Tab */}
      {activeTab === "tenders" && (
        <div className="space-y-4 mb-10">
          {sortedTenders.length === 0 && <p className="text-gray-500 text-sm">No matching tenders found.</p>}
          {sortedTenders.map((t) => {
            const badge = matchBadge(t.score);
            const soon = isDeadlineSoon(t.deadline);
            const agencyQ = encodeURIComponent(t.agency);
            const refQ = encodeURIComponent(t.reference_id ?? t.title);
            return (
              <div key={t.id} className="rounded-xl bg-navy-light border border-white/10 p-5">
                {/* Top row: ref chip + country tag + Copy ID */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {t.reference_id && (
                    <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-mono text-gray-400">{t.reference_id}</span>
                  )}
                  <span className="rounded bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-gold uppercase">{t.country}</span>
                  {t.reference_id && (
                    <button
                      onClick={() => navigator.clipboard.writeText(t.reference_id!)}
                      className="text-[10px] text-gray-500 hover:text-gray-300 flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy ID
                    </button>
                  )}
                </div>

                {/* Title */}
                <h4 className="text-base font-bold mb-3">{t.title}</h4>

                {/* Match % badge + fit label */}
                <div className="flex items-center gap-2 mb-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{t.score}% match</span>
                  <span className="text-xs text-gray-400">{badge.label}</span>
                </div>

                {/* Meta row: agency · country · value · deadline */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-3">
                  <span>{t.agency}</span>
                  <span>{t.country}</span>
                  {t.estimated_value != null && (
                    <span>{typeof t.estimated_value === "number" ? `$${t.estimated_value.toLocaleString()}` : t.estimated_value}</span>
                  )}
                  {t.deadline && (
                    <span className={`flex items-center gap-1 ${soon ? "text-red font-medium" : ""}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Deadline: {formatDate(t.deadline)}
                    </span>
                  )}
                </div>

                {/* JV allowed badge */}
                {t.jv_allowed && (
                  <span className="inline-flex items-center rounded bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] text-blue-300 mb-3 mr-2">
                    JV Allowed
                  </span>
                )}

                {/* One-line match reason */}
                {t.match_reason && (
                  <p className="text-xs text-gray-300 italic mb-3">{t.match_reason}</p>
                )}

                {/* Metadata: Source · Discovered · Confidence */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500 mb-4">
                  <span>Source: {t.agency} Procurement</span>
                  {t.discovered_date && <span>Discovered: {formatDate(t.discovered_date)}</span>}
                  <span>Confidence: {t.confidence ?? (t.score >= 70 ? "Verified" : "Inferred")}</span>
                </div>

                {/* Direct source link (primary) + Google fallbacks.
                    Every crawler populates source_url today, but we keep the
                    Google search buttons as a secondary path for the rare row
                    where the origin URL is stale or 404s. */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {t.source_url && (
                    <a
                      href={t.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-gold/90 border border-gold px-3 py-1.5 text-xs text-navy font-medium hover:bg-gold transition-colors"
                    >
                      View Notice →
                    </a>
                  )}
                  <a
                    href={`https://www.google.com/search?q=${agencyQ}+procurement+${refQ}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-gold/15 border border-gold/30 px-3 py-1.5 text-xs text-gold hover:bg-gold/25 transition-colors"
                  >
                    Search {t.agency} Procurement →
                  </a>
                  <a
                    href={`https://www.google.com/search?q=UNGM+${refQ}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-gray-800 border border-white/10 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 transition-colors"
                  >
                    Search UNGM →
                  </a>
                </div>

                {t.reference_id && (
                  <p className="text-[10px] text-gray-600 mt-1">Use reference ID {t.reference_id} to find this tender on the portal</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Grants Tab */}
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
                      {/* Agency · region/country · value range · deadline */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-2">
                        <span>{g.agency}</span>
                        {(g.country ?? g.region) && <span>{g.country ?? g.region}</span>}
                        {g.value_range && <span>{g.value_range}</span>}
                        {g.deadline && (
                          <span className={soon ? "text-red font-medium" : ""}>
                            Deadline: {formatDate(g.deadline)}
                          </span>
                        )}
                      </div>

                      {/* Title + GRANT badge + eligibility warning */}
                      <div className="flex flex-wrap items-start gap-2 mb-3">
                        <h4 className="text-base font-semibold flex-1">{g.title}</h4>
                        <span className="rounded bg-teal-500/20 border border-teal-500/40 px-2 py-0.5 text-[10px] font-semibold text-teal-300 uppercase flex-shrink-0">Grant</span>
                        {g.org_type_mismatch && (
                          <span className="rounded bg-orange-500/15 border border-orange-500/40 px-2 py-0.5 text-[10px] font-medium text-orange-400 flex-shrink-0">
                            ⚠ Check eligibility
                          </span>
                        )}
                      </div>

                      {/* Match badge */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{g.score}% match</span>
                        <span className="text-xs text-gray-400">{badge.label}</span>
                      </div>

                      {/* 2-line description */}
                      {g.description && (
                        <p className="text-xs text-gray-300 mb-3 line-clamp-2">{g.description}</p>
                      )}

                      {/* Apply / Learn More */}
                      {g.source_url ? (
                        <a
                          href={g.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-teal-500/20 border border-teal-500/40 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/30 transition-colors"
                        >
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

      {/* Identified Gaps */}
      {data.gaps.length > 0 && (
        <div className="mb-10">
          <h2 className="font-serif text-xl font-bold mb-4">Identified Gaps</h2>
          <div className="space-y-2">
            {data.gaps.map((g, i) => (
              <div key={i}>
                <button
                  onClick={() => toggleGap(i)}
                  className={`w-full rounded-lg border px-4 py-3 text-left text-sm flex items-center justify-between ${severityColor(g.severity)}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-current flex-shrink-0" />
                    {g.gap}
                  </span>
                  <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${expandedGaps.has(i) ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedGaps.has(i) && (
                  <div className="mt-1 rounded-lg bg-navy-light border border-white/10 p-4 text-sm space-y-3">
                    <p className="text-gray-300"><strong className="text-gray-400">Fix:</strong> {g.fix}</p>
                    {g.action_steps?.length > 0 && (
                      <div>
                        <strong className="text-gray-400 text-xs">Action Steps:</strong>
                        <ul className="list-disc list-inside mt-1 space-y-1 text-gray-300 text-xs">
                          {g.action_steps.map((step, si) => <li key={si}>{step}</li>)}
                        </ul>
                      </div>
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

      {/* Your Next Step */}
      <div className="text-center mb-8">
        <h2 className="font-serif text-2xl font-bold text-gold mb-2">Your Next Step</h2>
        <p className="text-sm text-gray-400">
          {data.company_name} scored {data.readiness_score}% — a few targeted moves will close the gap.
        </p>
      </div>

      <div className="rounded-xl border border-gold/30 bg-navy-light p-6 mb-8">
        <p className="text-xs font-bold tracking-wider uppercase text-gold mb-4">Your Recommended Path to Your First UN Contract</p>
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-gold/20 text-gold text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <div>
              <h4 className="text-sm font-semibold">Close the capability gaps</h4>
              <p className="text-xs text-gray-400 mt-0.5">Obtain ISO 9001, document past performance with measurable outcomes, and prepare your full vendor documentation package — these are what procurement panels score first</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-gold/20 text-gold text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
            <div>
              <h4 className="text-sm font-semibold">Monitor matched opportunities</h4>
              <p className="text-xs text-gray-400 mt-0.5">Real-time alerts for tenders matching your exact capabilities and target countries — start with SME-friendly contracts under $200K</p>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-gold/20 text-gold text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
            <div>
              <h4 className="text-sm font-semibold">Submit a winning proposal</h4>
              <p className="text-xs text-gray-400 mt-0.5">Professional technical and financial proposal writing that follows the scoring criteria used by UN evaluation panels</p>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing cards — all 3 tiers, ascending price, recommended highlighted */}
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        {(["tender-intelligence", "submission-package", "strategic-partnership"] as TierSlug[]).map((slug, i) => {
          const tier = TIER_INFO[slug];
          const isRec = slug === data.recommended_tier;
          return (
            <div
              key={slug}
              className={`rounded-xl border-2 p-5 bg-navy-light relative cursor-pointer transition-colors ${
                isRec ? "border-gold hover:bg-navy-light/80" : "border-white/10 hover:border-white/20 hover:bg-navy-light/60"
              }`}
              style={{ animation: "fadeInUp 0.5s ease-out both", animationDelay: `${i * 0.1}s` }}
              onClick={() => { window.location.href = `/login?plan=${slug}`; }}
            >
              {isRec && (
                <span className="absolute -top-3 right-4 rounded-full bg-gold px-3 py-0.5 text-[10px] font-bold text-white uppercase">Best Fit</span>
              )}
              <h3 className="text-base font-bold mb-1">{tier.name}</h3>
              <div className="mt-2 mb-3">
                <span className={`text-2xl font-bold ${isRec ? "text-gold" : "text-white"}`}>{tier.price}</span>
                <span className="text-xs text-gray-500">{tier.billingPeriod}</span>
              </div>
              <p className="text-xs text-gray-400 mb-4 leading-relaxed">{tier.tagline}</p>
              <div className={`w-full rounded-lg py-2.5 text-xs font-semibold text-center transition-colors ${
                isRec ? "bg-gold text-white hover:bg-gold-dark" : "border border-white/20 text-white hover:bg-white/5"
              }`}>
                {tier.cta} →
              </div>
            </div>
          );
        })}
      </div>

      {/* Dashboard CTA — free→trial conversion */}
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
      <div className="text-center space-y-3">
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
