"use client";

import { useEffect, useState, useCallback } from "react";

interface CrawlLog {
  id: number;
  started_at: string;
  platform: string | null;
  status: string;
  duration_ms: number | null;
  tenders_added: number;
  tenders_updated: number;
  tenders_expired: number;
  broken_links: number;
  error: string | null;
}

interface SubscriptionRow {
  tier: string;
  count: number;
}

interface Stats {
  totalUsers: number;
  totalAssessments: number;
  openTenders: number;
  activeSubscriptions: SubscriptionRow[];
  recentCrawls: CrawlLog[];
  platformHealth: Array<{
    platform: string;
    role: "primary" | "supplement" | "observed";
    status: "healthy" | "degraded" | "down" | "never_run";
    last_run: string | null;
    last_success: string | null;
    added_24h: number;
    updated_24h: number;
    failures_24h: number;
    open_tenders: number;
    message: string;
  }>;
  sourceQuality: Array<{
    platform: string;
    open_tenders: number;
    description_complete_pct: number;
    deadline_complete_pct: number;
    sector_complete_pct: number;
    source_url_complete_pct: number;
    broken_link_pct: number;
    thin_descriptions: number;
    quality_status: "healthy" | "degraded" | "critical";
    message: string;
  }>;
  ungmFamilyHealth: {
    status: "healthy" | "degraded" | "critical";
    message: string;
    agencies: Array<{
      agency: string;
      open_tenders: number;
    }>;
  };
  workerHealth: {
    configured: boolean;
    ok: boolean;
    status: "healthy" | "degraded" | "unconfigured" | "unreachable";
    endpoint?: string;
    browser?: string;
    browserError?: string | null;
    version?: string;
    checkedAt: string;
    durationMs?: number;
    error?: string;
  };
}

const TIER_LABELS: Record<string, string> = {
  "tender-intelligence": "Grants + Tenders Matching",
  "submission-package": "Proposal Draft",
  "strategic-partnership": "Roster Fast-Track",
};

const TIER_PRICES: Record<string, string> = {
  "tender-intelligence": "$49/mo",
  "submission-package": "$299",
  "strategic-partnership": "$749/roster",
};

function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function duration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function StatCard({
  label,
  value,
  sub,
  color = "violet",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "violet" | "amber" | "teal" | "blue";
}) {
  const accent: Record<string, string> = {
    violet: "text-violet-400",
    amber: "text-amber-400",
    teal: "text-teal-400",
    blue: "text-blue-400",
  };
  return (
    <div className="rounded-xl bg-white/5 border border-white/8 p-5">
      <p className="text-xs text-slate-500 uppercase tracking-wider font-medium mb-2">{label}</p>
      <p className={`text-3xl font-bold ${accent[color]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "bg-green-500/15 text-green-400 border-green-500/30",
    completed: "bg-green-500/15 text-green-400 border-green-500/30",
    healthy: "bg-green-500/15 text-green-400 border-green-500/30",
    running: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    degraded: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    never_run: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    error: "bg-red-500/15 text-red-400 border-red-500/30",
    down: "bg-red-500/15 text-red-400 border-red-500/30",
    critical: "bg-red-500/15 text-red-400 border-red-500/30",
    unreachable: "bg-red-500/15 text-red-400 border-red-500/30",
    unconfigured: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const cls = map[status.toLowerCase()] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;

    try {
      const res = await fetch("/api/admin/stats", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setStats(data);
      setLastRefreshed(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const triggerSync = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync-tenders", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setSyncResult({ ok: data.ok, message: data.message ?? (data.ok ? "Sync triggered." : "Sync failed.") });
      // Reload stats after a brief delay to pick up new crawl log
      setTimeout(load, 2000);
    } catch {
      setSyncResult({ ok: false, message: "Network error — sync not triggered." });
    } finally {
      setSyncing(false);
    }
  };

  const totalActiveSubs = stats?.activeSubscriptions.reduce((s, r) => s + Number(r.count), 0) ?? 0;

  return (
    <div className="p-8 max-w-6xl mx-auto" style={{ animation: "fadeIn 0.4s ease-out both" }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Overview</h1>
          {lastRefreshed && (
            <p className="text-xs text-slate-500 mt-1">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:text-white hover:border-white/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={triggerSync}
            disabled={syncing}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              syncing
                ? "bg-violet-500/40 text-violet-300 cursor-not-allowed"
                : "bg-violet-600 text-white hover:bg-violet-500"
            }`}
          >
            {syncing ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Syncing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                Sync Tenders
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${
            syncResult.ok
              ? "bg-green-500/10 border-green-500/30 text-green-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {syncResult.ok ? (
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
          {syncResult.message}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Stats grid */}
      {stats ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Users" value={Number(stats.totalUsers).toLocaleString()} color="violet" />
            <StatCard label="Assessments Run" value={Number(stats.totalAssessments).toLocaleString()} color="blue" />
            <StatCard label="Open Tenders" value={Number(stats.openTenders).toLocaleString()} color="teal" />
            <StatCard
              label="Active Subscriptions"
              value={totalActiveSubs}
              sub={totalActiveSubs === 1 ? "1 paid seat" : `${totalActiveSubs} paid seats`}
              color="amber"
            />
          </div>

          {/* Subscriptions breakdown */}
          <div className="rounded-xl bg-white/5 border border-white/8 p-6 mb-6">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Active Subscriptions by Tier
            </h2>
            {stats.activeSubscriptions.length === 0 ? (
              <p className="text-sm text-slate-500">No active subscriptions yet.</p>
            ) : (
              <div className="space-y-3">
                {stats.activeSubscriptions.map((row) => {
                  const pct = totalActiveSubs > 0 ? Math.round((Number(row.count) / totalActiveSubs) * 100) : 0;
                  return (
                    <div key={row.tier}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <span className="text-sm text-slate-200">{TIER_LABELS[row.tier] ?? row.tier}</span>
                          <span className="ml-2 text-xs text-slate-500">{TIER_PRICES[row.tier] ?? ""}</span>
                        </div>
                        <span className="text-sm font-semibold text-white">
                          {Number(row.count)} <span className="text-slate-500 font-normal text-xs">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-400 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Worker health */}
          <div className="rounded-xl bg-white/5 border border-white/8 p-6 mb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Browser Worker Health
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill status={stats.workerHealth.status} />
                  <span className="text-xs text-slate-500">
                    Browser: {stats.workerHealth.browser ?? "—"}
                  </span>
                  {stats.workerHealth.version && (
                    <span className="text-xs text-slate-500">{stats.workerHealth.version}</span>
                  )}
                  {stats.workerHealth.durationMs != null && (
                    <span className="text-xs text-slate-500">{duration(stats.workerHealth.durationMs)}</span>
                  )}
                </div>
                {(stats.workerHealth.error || stats.workerHealth.browserError) && (
                  <p className="mt-2 text-xs text-red-400">
                    {stats.workerHealth.error ?? stats.workerHealth.browserError}
                  </p>
                )}
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>Checked {formatDate(stats.workerHealth.checkedAt)}</div>
                {stats.workerHealth.endpoint && (
                  <div className="mt-1 max-w-sm truncate" title={stats.workerHealth.endpoint}>
                    {stats.workerHealth.endpoint}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* UNGM family coverage */}
          <div className="rounded-xl bg-white/5 border border-white/8 p-6 mb-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l7.5 4.5v9L12 21l-7.5-4.5v-9L12 3z" />
                  </svg>
                  UNGM Family Coverage
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <StatusPill status={stats.ungmFamilyHealth.status} />
                  <span className="text-xs text-slate-400">{stats.ungmFamilyHealth.message}</span>
                </div>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {stats.ungmFamilyHealth.agencies.map((agency) => (
                  <div key={agency.agency} className="rounded-lg border border-white/8 bg-black/10 px-3 py-2 text-center">
                    <div className="text-[11px] text-slate-500 font-medium">{agency.agency}</div>
                    <div className={`text-sm font-semibold ${agency.open_tenders > 0 ? "text-teal-400" : "text-red-400"}`}>
                      {agency.open_tenders}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Platform health */}
          <div className="rounded-xl bg-white/5 border border-white/8 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 15a4 4 0 004 4h10a4 4 0 100-8h-1.26A8 8 0 103 15z" />
                </svg>
                Source Health
              </h2>
              <span className="text-xs text-slate-500">Expected sources + observed sources</span>
            </div>
            {stats.platformHealth.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-500 text-center">No platform health yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-3 text-left font-medium">Platform</th>
                      <th className="px-6 py-3 text-left font-medium">Status</th>
                      <th className="px-6 py-3 text-left font-medium">Role</th>
                      <th className="px-6 py-3 text-left font-medium">Last Success</th>
                      <th className="px-6 py-3 text-left font-medium">Last Run</th>
                      <th className="px-6 py-3 text-right font-medium">Open</th>
                      <th className="px-6 py-3 text-right font-medium">24h Added</th>
                      <th className="px-6 py-3 text-right font-medium">24h Failures</th>
                      <th className="px-6 py-3 text-left font-medium">Signal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stats.platformHealth.map((row) => (
                      <tr key={row.platform} className="hover:bg-white/3 transition-colors">
                        <td className="px-6 py-3 text-slate-300 whitespace-nowrap">{row.platform}</td>
                        <td className="px-6 py-3 whitespace-nowrap"><StatusPill status={row.status} /></td>
                        <td className="px-6 py-3 text-slate-500 whitespace-nowrap capitalize">{row.role}</td>
                        <td className="px-6 py-3 text-slate-400 whitespace-nowrap">{formatDate(row.last_success)}</td>
                        <td className="px-6 py-3 text-slate-500 whitespace-nowrap">{formatDate(row.last_run)}</td>
                        <td className="px-6 py-3 text-right text-slate-300 font-medium">{row.open_tenders}</td>
                        <td className="px-6 py-3 text-right text-teal-400 font-medium">{row.added_24h}</td>
                        <td className={`px-6 py-3 text-right font-medium ${row.failures_24h > 0 ? "text-red-400" : "text-slate-500"}`}>
                          {row.failures_24h}
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-500 min-w-56">
                          {row.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Source quality */}
          <div className="rounded-xl bg-white/5 border border-white/8 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h6v6m-8 4h10a2 2 0 002-2V7.8a2 2 0 00-.59-1.42l-3.79-3.79A2 2 0 0013.2 2H7a2 2 0 00-2 2v15a2 2 0 002 2z" />
                </svg>
                Source Data Quality
              </h2>
              <span className="text-xs text-slate-500">Open tender field completeness</span>
            </div>
            {stats.sourceQuality.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-500 text-center">No source quality metrics yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-3 text-left font-medium">Platform</th>
                      <th className="px-6 py-3 text-left font-medium">Quality</th>
                      <th className="px-6 py-3 text-right font-medium">Open</th>
                      <th className="px-6 py-3 text-right font-medium">Descriptions</th>
                      <th className="px-6 py-3 text-right font-medium">Deadlines</th>
                      <th className="px-6 py-3 text-right font-medium">Sectors</th>
                      <th className="px-6 py-3 text-right font-medium">URLs</th>
                      <th className="px-6 py-3 text-right font-medium">Broken</th>
                      <th className="px-6 py-3 text-left font-medium">Signal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stats.sourceQuality.map((row) => (
                      <tr key={row.platform} className="hover:bg-white/3 transition-colors">
                        <td className="px-6 py-3 text-slate-300 whitespace-nowrap">{row.platform}</td>
                        <td className="px-6 py-3 whitespace-nowrap"><StatusPill status={row.quality_status} /></td>
                        <td className="px-6 py-3 text-right text-slate-300 font-medium">{row.open_tenders}</td>
                        <td className={`px-6 py-3 text-right font-medium ${row.description_complete_pct < 70 ? "text-amber-400" : "text-teal-400"}`}>
                          {row.description_complete_pct}%
                        </td>
                        <td className={`px-6 py-3 text-right font-medium ${row.deadline_complete_pct < 70 ? "text-amber-400" : "text-teal-400"}`}>
                          {row.deadline_complete_pct}%
                        </td>
                        <td className={`px-6 py-3 text-right font-medium ${row.sector_complete_pct < 70 ? "text-amber-400" : "text-teal-400"}`}>
                          {row.sector_complete_pct}%
                        </td>
                        <td className={`px-6 py-3 text-right font-medium ${row.source_url_complete_pct < 95 ? "text-amber-400" : "text-teal-400"}`}>
                          {row.source_url_complete_pct}%
                        </td>
                        <td className={`px-6 py-3 text-right font-medium ${row.broken_link_pct > 10 ? "text-red-400" : "text-slate-500"}`}>
                          {row.broken_link_pct}%
                        </td>
                        <td className="px-6 py-3 text-xs text-slate-500 min-w-56">
                          {row.message}
                          {row.thin_descriptions > 0 && (
                            <span className="block text-slate-600">
                              {row.thin_descriptions} thin description{row.thin_descriptions === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Crawl logs */}
          <div className="rounded-xl bg-white/5 border border-white/8 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Recent Crawl Logs
              </h2>
              <span className="text-xs text-slate-500">Last 10 runs</span>
            </div>

            {stats.recentCrawls.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate-500 text-center">No crawl logs yet. Trigger a sync to start.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="px-6 py-3 text-left font-medium">Started</th>
                      <th className="px-6 py-3 text-left font-medium">Platform</th>
                      <th className="px-6 py-3 text-left font-medium">Status</th>
                      <th className="px-6 py-3 text-right font-medium">Added</th>
                      <th className="px-6 py-3 text-right font-medium">Updated</th>
                      <th className="px-6 py-3 text-right font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {stats.recentCrawls.map((log) => (
                      <tr key={log.id} className="hover:bg-white/3 transition-colors">
                        <td className="px-6 py-3 text-slate-300 whitespace-nowrap">{formatDate(log.started_at)}</td>
                        <td className="px-6 py-3 text-slate-400 whitespace-nowrap">{log.platform ?? "—"}</td>
                        <td className="px-6 py-3">
                          <StatusPill status={log.status} />
                          {log.error && (
                            <p className="text-[11px] text-red-400 mt-1 max-w-xs truncate" title={log.error}>
                              {log.error}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right text-teal-400 font-medium">
                          {`+${log.tenders_added ?? 0}`}
                        </td>
                        <td className="px-6 py-3 text-right text-slate-300">
                          {log.tenders_updated ?? 0}
                        </td>
                        <td className="px-6 py-3 text-right text-slate-500 whitespace-nowrap">
                          {duration(log.duration_ms)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : !error ? (
        /* Loading skeleton */
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-white/5 border border-white/8 p-5 h-24 animate-pulse" />
            ))}
          </div>
          <div className="rounded-xl bg-white/5 border border-white/8 h-40 animate-pulse" />
          <div className="rounded-xl bg-white/5 border border-white/8 h-64 animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}
