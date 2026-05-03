"use client";

import { useEffect, useState, useCallback } from "react";
import styles from "./admin.module.css";
import { StatusTag, StatusDot, Sparkbar } from "./_components/StatusTag";

// ─────────────────────────────────────────────────────────────────────
// Types — mirror /api/admin/stats response
// ─────────────────────────────────────────────────────────────────────
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

interface SubscriptionRow { tier: string; count: number; }

interface PlatformHealth {
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
}

interface SourceQuality {
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
}

interface Stats {
  totalUsers: number;
  totalAssessments: number;
  openTenders: number;
  activeSubscriptions: SubscriptionRow[];
  recentCrawls: CrawlLog[];
  platformHealth: PlatformHealth[];
  sourceQuality: SourceQuality[];
  ungmFamilyHealth: {
    status: "healthy" | "degraded" | "critical";
    message: string;
    agencies: Array<{ agency: string; open_tenders: number }>;
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
  "tender-intelligence":    "Grants + Tenders Matching",
  "submission-package":     "Proposal Draft",
  "strategic-partnership":  "Roster Fast-Track",
};
const TIER_PRICES: Record<string, string> = {
  "tender-intelligence":    "$49/mo",
  "submission-package":     "$299",
  "strategic-partnership":  "$749",
};

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function fmtNum(n: number | string): string {
  return Number(n).toLocaleString("en-US");
}
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000).toString().padStart(2, "0")}s`;
}
function relTime(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v).getTime();
  if (isNaN(d)) return "—";
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
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
      const res = await fetch("/api/admin/stats", { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setStats(data);
      setLastRefreshed(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerSync = async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/admin/sync-tenders", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSyncResult({ ok: data.ok, message: data.message ?? (data.ok ? "Sync triggered." : "Sync failed.") });
      setTimeout(load, 2000);
    } catch {
      setSyncResult({ ok: false, message: "Network error — sync not triggered." });
    } finally {
      setSyncing(false);
    }
  };

  const totalSubs = stats?.activeSubscriptions.reduce((s, r) => s + Number(r.count), 0) ?? 0;
  const flagged = stats?.platformHealth.filter((p) => p.status !== "healthy") ?? [];

  return (
    <>
      {/* Header */}
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>01 — Overview</div>
          <h1 className={styles.pageTitle}>System dossier</h1>
          <p className={styles.pageSub}>
            Daily snapshot of users, paid seats, source health, and crawl integrity.
          </p>
        </div>
        <div className={styles.pageActions}>
          {lastRefreshed && (
            <div className={styles.refreshed}>
              <span className={styles.statusDot} style={{ background: "var(--color-green)" }} />
              Refreshed {relTime(lastRefreshed.toISOString())}
            </div>
          )}
          <button type="button" className={styles.btnGhost} onClick={load}>Refresh</button>
          <button type="button" className={styles.btnPrimary} onClick={triggerSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync sources"}
          </button>
        </div>
      </header>

      {/* Toast */}
      {syncResult && (
        <div className={`${styles.toast} ${syncResult.ok ? styles.toastOk : styles.toastErr}`}>
          {syncResult.message}
        </div>
      )}
      {error && (
        <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>
      )}

      {stats ? (
        <>
          {/* Hero stats */}
          <section className={styles.heroRow}>
            <HeroStat label="Total users"       value={fmtNum(stats.totalUsers)} />
            <HeroStat label="Assessments run"   value={fmtNum(stats.totalAssessments)} />
            <HeroStat label="Open tenders"      value={fmtNum(stats.openTenders)} sub={`${stats.platformHealth.length} sources`} />
            <HeroStat label="Paid seats"        value={fmtNum(totalSubs)} sub={totalSubs === 1 ? "1 active subscription" : `${totalSubs} active subscriptions`} />
          </section>

          {/* Two-up: subs + worker */}
          <section className={styles.grid2}>
            {/* Subscriptions */}
            <article className={styles.panel}>
              <header className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Active subscriptions</h2>
                <span className={styles.panelMeta}>{totalSubs} seats</span>
              </header>
              <div className={styles.panelBody}>
                {stats.activeSubscriptions.length === 0 ? (
                  <p className={styles.mute} style={{ fontSize: 13 }}>No active subscriptions yet.</p>
                ) : (
                  stats.activeSubscriptions.map((row) => {
                    const pct = totalSubs > 0 ? Math.round((Number(row.count) / totalSubs) * 100) : 0;
                    return (
                      <div key={row.tier} className={styles.subRow}>
                        <div className={styles.subRowHead}>
                          <div>
                            <div className={styles.subRowName}>{TIER_LABELS[row.tier] ?? row.tier}</div>
                            <div className={styles.subRowPrice}>{TIER_PRICES[row.tier] ?? ""}</div>
                          </div>
                          <div>
                            <span className={styles.subRowCount}>{Number(row.count)}</span>
                            <span className={styles.subRowPct}> · {pct}%</span>
                          </div>
                        </div>
                        <Sparkbar pct={pct} tone="warn" />
                      </div>
                    );
                  })
                )}
              </div>
            </article>

            {/* Worker + UNGM */}
            <article className={styles.panel}>
              <header className={styles.panelHead}>
                <h2 className={styles.panelTitle}>Browser worker</h2>
                <StatusTag status={stats.workerHealth.status} />
              </header>
              <div className={styles.panelBody}>
                <dl className={styles.kvList}>
                  <div><dt>Browser</dt><dd>{stats.workerHealth.browser ?? "—"}</dd></div>
                  {stats.workerHealth.version && <div><dt>Version</dt><dd className={styles.mono}>{stats.workerHealth.version}</dd></div>}
                  {stats.workerHealth.durationMs != null && <div><dt>Latency</dt><dd className={styles.mono}>{fmtDur(stats.workerHealth.durationMs)}</dd></div>}
                  {stats.workerHealth.endpoint && <div><dt>Endpoint</dt><dd className={`${styles.mono} ${styles.trunc}`} title={stats.workerHealth.endpoint}>{stats.workerHealth.endpoint}</dd></div>}
                  <div><dt>Checked</dt><dd className={styles.mono}>{relTime(stats.workerHealth.checkedAt)}</dd></div>
                </dl>

                {(stats.workerHealth.error || stats.workerHealth.browserError) && (
                  <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-red)" }}>
                    {stats.workerHealth.error ?? stats.workerHealth.browserError}
                  </p>
                )}

                <div className={styles.ungmStrip}>
                  <div className={styles.ungmHead}>
                    <div className={styles.ungmTitle}>UNGM family coverage</div>
                    <StatusTag status={stats.ungmFamilyHealth.status} />
                  </div>
                  <div className={styles.ungmGrid}>
                    {stats.ungmFamilyHealth.agencies.map((a) => (
                      <div key={a.agency} className={styles.ungmCell}>
                        <div className={styles.ungmName}>{a.agency}</div>
                        <div
                          className={styles.ungmNum}
                          style={{ color: a.open_tenders > 0 ? "var(--color-accent)" : "var(--color-red)" }}
                        >
                          {a.open_tenders}
                        </div>
                      </div>
                    ))}
                  </div>
                  {stats.ungmFamilyHealth.message && (
                    <p style={{ marginTop: 10, fontSize: 11, color: "var(--color-ink-3)" }}>
                      {stats.ungmFamilyHealth.message}
                    </p>
                  )}
                </div>
              </div>
            </article>
          </section>

          {/* Source health */}
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Source health</h2>
                <p className={styles.panelSub}>
                  {stats.platformHealth.length} sources · {flagged.length} need attention
                </p>
              </div>
            </header>

            {flagged.length > 0 && (
              <div className={styles.alertStrip}>
                {flagged.map((p) => (
                  <div
                    key={p.platform}
                    className={`${styles.alert} ${p.status === "down" ? styles.alertDown : styles.alertDegraded}`}
                  >
                    <StatusDot status={p.status} />
                    <div>
                      <span className={styles.alertPlatform}>{p.platform}</span>
                      <span className={styles.alertMsg}> — {p.message}</span>
                    </div>
                    <span className={styles.alertMeta}>{relTime(p.last_success)}</span>
                  </div>
                ))}
              </div>
            )}

            {stats.platformHealth.length === 0 ? (
              <div className={styles.woEmpty}>No platform health yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dossierTable}>
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Status</th>
                      <th>Role</th>
                      <th>Last success</th>
                      <th className={styles.num}>Open</th>
                      <th className={styles.num}>+24h</th>
                      <th className={styles.num}>Fails</th>
                      <th>Signal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.platformHealth.map((p) => (
                      <tr key={p.platform}>
                        <td><span className={styles.cellName}>{p.platform}</span></td>
                        <td><StatusTag status={p.status} /></td>
                        <td className={styles.muteNum} style={{ textTransform: "capitalize" }}>{p.role}</td>
                        <td className={styles.mono}>{fmtDate(p.last_success)}</td>
                        <td className={styles.num}>{fmtNum(p.open_tenders)}</td>
                        <td className={`${styles.num} ${p.added_24h > 0 ? styles.posNum : styles.muteNum}`}>
                          {p.added_24h > 0 ? `+${p.added_24h}` : "0"}
                        </td>
                        <td className={`${styles.num} ${p.failures_24h > 0 ? styles.negNum : styles.muteNum}`}>
                          {p.failures_24h}
                        </td>
                        <td className={styles.signal}>{p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Source quality */}
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Source data quality</h2>
                <p className={styles.panelSub}>Field completeness across open tenders</p>
              </div>
            </header>

            {stats.sourceQuality.length === 0 ? (
              <div className={styles.woEmpty}>No source quality metrics yet.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dossierTable}>
                  <thead>
                    <tr>
                      <th>Platform</th>
                      <th>Quality</th>
                      <th className={styles.num}>Open</th>
                      <th>Descriptions</th>
                      <th>Deadlines</th>
                      <th>Sectors</th>
                      <th>URLs</th>
                      <th className={styles.num}>Broken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.sourceQuality.map((q) => (
                      <tr key={q.platform}>
                        <td><span className={styles.cellName}>{q.platform}</span></td>
                        <td><StatusTag status={q.quality_status} /></td>
                        <td className={styles.num}>{fmtNum(q.open_tenders)}</td>
                        {([
                          ["description_complete_pct", 70],
                          ["deadline_complete_pct", 70],
                          ["sector_complete_pct", 70],
                          ["source_url_complete_pct", 95],
                        ] as const).map(([k, threshold]) => {
                          const v = q[k];
                          const tone = v < threshold ? "warn" : "pos";
                          return (
                            <td key={k} className={styles.barCell}>
                              <div className={styles.barRow}>
                                <span className={styles.barNum}>{v}%</span>
                                <Sparkbar pct={v} tone={tone} />
                              </div>
                            </td>
                          );
                        })}
                        <td className={`${styles.num} ${
                          q.broken_link_pct > 10 ? styles.negNum :
                          q.broken_link_pct > 0  ? styles.warnNum :
                                                   styles.muteNum
                        }`}>
                          {q.broken_link_pct}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Crawl logs */}
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Recent crawl logs</h2>
                <p className={styles.panelSub}>Last 10 runs · all sources</p>
              </div>
            </header>

            {stats.recentCrawls.length === 0 ? (
              <div className={styles.woEmpty}>No crawl logs yet. Trigger a sync to start.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dossierTable}>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Platform</th>
                      <th>Status</th>
                      <th className={styles.num}>Added</th>
                      <th className={styles.num}>Updated</th>
                      <th className={styles.num}>Duration</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentCrawls.map((log) => (
                      <tr key={log.id}>
                        <td className={styles.mono}>{fmtDate(log.started_at)}</td>
                        <td><span className={styles.cellName}>{log.platform ?? "—"}</span></td>
                        <td><StatusTag status={log.status} /></td>
                        <td className={`${styles.num} ${log.tenders_added > 0 ? styles.posNum : styles.muteNum}`}>
                          {log.tenders_added > 0 ? `+${log.tenders_added}` : "0"}
                        </td>
                        <td className={styles.num}>{log.tenders_updated ?? 0}</td>
                        <td className={`${styles.num} ${styles.muteNum}`}>{fmtDur(log.duration_ms)}</td>
                        <td className={styles.signal} style={{ color: log.error ? "var(--color-red)" : undefined }}>
                          {log.error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : !error ? (
        <LoadingSkeleton />
      ) : null}
    </>
  );
}

function HeroStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.heroStat}>
      <div className={styles.heroStatLabel}>{label}</div>
      <div className={styles.heroStatValue}>{value}</div>
      {sub && <div className={styles.heroStatMeta}>{sub}</div>}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className={styles.heroRow}>
        {[0,1,2,3].map((i) => (
          <div key={i} className={styles.heroStat}>
            <div className={styles.skeleton} style={{ height: 10, width: 80 }} />
            <div className={styles.skeleton} style={{ height: 36, width: 120, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className={styles.skeleton} style={{ height: 220, marginBottom: 24 }} />
      <div className={styles.skeleton} style={{ height: 320 }} />
    </>
  );
}
