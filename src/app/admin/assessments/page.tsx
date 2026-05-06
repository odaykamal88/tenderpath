"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { StatusTag } from "../_components/StatusTag";

type SessionFilter = "all" | "logged_in" | "no_matches" | "email_attention" | "no_dashboard" | "weak_evidence";

interface AssessmentSession {
  id: number;
  company_name: string | null;
  email: string | null;
  website: string | null;
  sector: string | null;
  org_type: string | null;
  countries: string[];
  readiness_score: number | null;
  grant_readiness_score: number | null;
  tender_count: number;
  grant_count: number;
  gap_count: number;
  created_at: string;
  user: { id: number; email: string | null; created_at: string | null } | null;
  email_status: string | null;
  email_error: string | null;
  email_updated_at: string | null;
  pipeline_items: number;
  crawl_render_method: string | null;
  crawl_thin: boolean | null;
  crawl_final_url: string | null;
  completion_state: "matched" | "completed_no_matches";
}

interface AssessmentSessionsResponse {
  sessions: AssessmentSession[];
  total: number;
  filter: SessionFilter;
  attention: {
    no_matches: number;
    email_attention: number;
    no_dashboard: number;
    weak_evidence: number;
    logged_in: number;
  };
  totals: {
    tenders: number;
    grants: number;
    loggedIn: number;
    withPipeline: number;
  };
}

interface AssessmentSessionDetail {
  assessment: AssessmentSession & {
    description: string | null;
    recommended_tier: string | null;
    dev_themes: string[];
    include_consultancies: boolean | null;
    counts: { tenders: number; grants: number; gaps: number; pipeline_items: number };
    crawled_data?: { finalUrl?: string | null; renderMethod?: string | null; isThinContent?: boolean | null; content?: string | null } | null;
    ai_analysis?: { summary?: string; services?: string[]; capabilities?: string[]; strengths?: string[] } | null;
  };
  top_tenders: Array<{ title: string; agency?: string; score?: number; fit_score?: number; match_reason?: string | null; source_url?: string | null }>;
  top_grants: Array<{ title: string; agency?: string; score?: number; match_reason?: string | null; source_url?: string | null }>;
  gaps: Array<{ gap?: string; severity?: string; fix?: string }>;
  emails: Array<{ id: number; status: string | null; sent_at: string | null; error: string | null; updated_at: string | null }>;
  pipeline_items: Array<{ id: number; tender_title: string; tender_agency: string | null; fit_score: number; stage: string; updated_at: string | null }>;
}

const FILTERS: Array<{ key: SessionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "logged_in", label: "Logged in" },
  { key: "no_matches", label: "No matches" },
  { key: "email_attention", label: "Email attention" },
  { key: "no_dashboard", label: "No dashboard handoff" },
  { key: "weak_evidence", label: "Weak website evidence" },
];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function fmtNum(n: number | string): string {
  return Number(n).toLocaleString("en-US");
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function relTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "-";
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function label(value: string | null): string {
  if (!value) return "-";
  return value.replace(/_/g, " ").replace(/-/g, " ");
}

function matchState(row: AssessmentSession): string {
  if (row.tender_count > 0 || row.grant_count > 0) return "matched";
  return "completed no matches";
}

function urlQuery(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
}

function urlFilter(): SessionFilter {
  if (typeof window === "undefined") return "all";
  const raw = new URLSearchParams(window.location.search).get("filter")?.trim() ?? "all";
  return FILTERS.some((filter) => filter.key === raw) ? raw as SessionFilter : "all";
}

function filterHref(filter: SessionFilter, query: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (filter !== "all") params.set("filter", filter);
  const qs = params.toString();
  return qs ? `/admin/assessments?${qs}` : "/admin/assessments";
}

export default function AdminAssessmentsPage() {
  const initialQuery = urlQuery();
  const initialFilter = urlFilter();
  const [data, setData] = useState<AssessmentSessionsResponse | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<SessionFilter>(initialFilter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssessmentSessionDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async (q: string, nextFilter: SessionFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "150" });
      if (q.trim()) params.set("q", q.trim());
      if (nextFilter !== "all") params.set("filter", nextFilter);
      const res = await fetch(`/api/admin/assessment-sessions?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assessment sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = async (id: number) => {
    setDetailLoadingId(id);
    setDetailError(null);
    try {
      const res = await fetch(`/api/admin/assessment-sessions/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setDetail(await res.json());
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load assessment detail");
    } finally {
      setDetailLoadingId(null);
    }
  };

  useEffect(() => {
    const next = urlQuery();
    const nextFilter = urlFilter();
    setQuery(next);
    setAppliedQuery(next);
    setFilter(nextFilter);
    load(next, nextFilter);
  }, [load]);

  const matchedCount = useMemo(
    () => data?.sessions.filter((row) => row.tender_count > 0 || row.grant_count > 0).length ?? 0,
    [data]
  );
  const attentionTotal = (data?.attention.no_matches ?? 0)
    + (data?.attention.email_attention ?? 0)
    + (data?.attention.no_dashboard ?? 0)
    + (data?.attention.weak_evidence ?? 0);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>02 — Assessments</div>
          <h1 className={styles.pageTitle}>Assessment sessions</h1>
          <p className={styles.pageSub}>
            Logged-in assessment runs, entered emails, match generation, and dashboard handoff signals.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnGhost} onClick={() => load(appliedQuery, filter)}>Refresh</button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.heroRow}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Sessions shown</div>
          <div className={styles.heroStatValue}>{fmtNum(data?.total ?? 0)}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Logged-in emails</div>
          <div className={styles.heroStatValue}>{fmtNum(data?.totals.loggedIn ?? 0)}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Generated matches</div>
          <div className={styles.heroStatValue}>{fmtNum(matchedCount)}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Dashboard handoff</div>
          <div className={styles.heroStatValue}>{fmtNum(data?.totals.withPipeline ?? 0)}</div>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Needs attention</h2>
            <p className={styles.panelSub}>
              Assessment sessions where activation may have stalled.
            </p>
          </div>
          <span className={styles.panelMeta}>{fmtNum(attentionTotal)} signals</span>
        </header>
        <div className={styles.attentionGrid}>
          <Link href={filterHref("no_matches", appliedQuery)} className={styles.attentionTile}>
            <span className={styles.attentionLabel}>No matches</span>
            <span className={styles.attentionValue}>{fmtNum(data?.attention.no_matches ?? 0)}</span>
            <span className={styles.attentionHint}>Assessment completed but produced no tenders or grants.</span>
          </Link>
          <Link href={filterHref("email_attention", appliedQuery)} className={styles.attentionTile}>
            <span className={styles.attentionLabel}>Email attention</span>
            <span className={styles.attentionValue}>{fmtNum(data?.attention.email_attention ?? 0)}</span>
            <span className={styles.attentionHint}>Email not queued, pending, or failed delivery.</span>
          </Link>
          <Link href={filterHref("no_dashboard", appliedQuery)} className={styles.attentionTile}>
            <span className={styles.attentionLabel}>No dashboard handoff</span>
            <span className={styles.attentionValue}>{fmtNum(data?.attention.no_dashboard ?? 0)}</span>
            <span className={styles.attentionHint}>Logged-in assessment exists, but pipeline has no items.</span>
          </Link>
          <Link href={filterHref("logged_in", appliedQuery)} className={styles.attentionTile}>
            <span className={styles.attentionLabel}>Logged-in sessions</span>
            <span className={styles.attentionValue}>{fmtNum(data?.attention.logged_in ?? 0)}</span>
            <span className={styles.attentionHint}>Trace assessment-to-dashboard continuity by user.</span>
          </Link>
          <Link href={filterHref("weak_evidence", appliedQuery)} className={styles.attentionTile}>
            <span className={styles.attentionLabel}>Weak website evidence</span>
            <span className={styles.attentionValue}>{fmtNum(data?.attention.weak_evidence ?? 0)}</span>
            <span className={styles.attentionHint}>Website crawl was thin, failed, parked, or missing.</span>
          </Link>
        </div>
      </section>

      <section className={styles.woControls}>
        <form className={styles.adminSearch} method="get" action="/admin/assessments">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <input
            name="q"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search email, company, or website"
            className={styles.adminSearchInput}
          />
          <button type="submit" className={styles.btnPrimary}>Search</button>
          {appliedQuery && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => {
                setQuery("");
                setAppliedQuery("");
                window.history.pushState(null, "", filterHref(filter, ""));
                load("", filter);
              }}
            >
              Clear
            </button>
          )}
        </form>
        <div className={styles.woTabs}>
          {FILTERS.map((item) => (
            <Link
              key={item.key}
              href={filterHref(item.key, appliedQuery)}
              className={`${styles.woTab} ${filter === item.key ? styles.woTabActive : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Recent assessment runs</h2>
            <p className={styles.panelSub}>Latest 150 sessions · searchable by email · filter: {FILTERS.find((item) => item.key === filter)?.label ?? "All"}</p>
          </div>
          {data && <span className={styles.panelMeta}>{data.totals.tenders} tenders · {data.totals.grants} grants</span>}
        </header>

        {loading ? (
          <div className={styles.woEmpty}>Loading assessment sessions...</div>
        ) : !data || data.sessions.length === 0 ? (
          <div className={styles.woEmpty}>No assessment sessions found.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th className={styles.num}>Tenders</th>
                  <th className={styles.num}>Grants</th>
                  <th className={styles.num}>Score</th>
                  <th>Email</th>
                  <th>Dashboard</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className={styles.mono}>{relTime(row.created_at)}</div>
                      <div className={styles.sessionSubtle}>{fmtDate(row.created_at)}</div>
                    </td>
                    <td>
                      <div className={styles.cellName}>{row.email ?? "-"}</div>
                      <div className={styles.sessionSubtle}>
                        {row.user ? `user #${row.user.id}` : "no linked login"}
                      </div>
                    </td>
                    <td>
                      <div className={styles.cellName}>{row.company_name ?? "-"}</div>
                      <div className={styles.sessionSubtle}>
                        {label(row.org_type)} · {row.countries.slice(0, 3).join(", ") || "-"}
                      </div>
                      <div className={styles.sessionSubtle} title={row.crawl_final_url ?? undefined}>
                        crawl: {row.crawl_render_method ?? "missing"}{row.crawl_thin ? " · thin" : ""}
                      </div>
                    </td>
                    <td><StatusTag status={matchState(row)} /></td>
                    <td className={`${styles.num} ${row.tender_count > 0 ? styles.posNum : styles.warnNum}`}>{row.tender_count}</td>
                    <td className={`${styles.num} ${row.grant_count > 0 ? styles.posNum : styles.warnNum}`}>{row.grant_count}</td>
                    <td className={styles.num}>
                      {row.readiness_score ?? "-"}
                      {row.grant_readiness_score != null && (
                        <div className={styles.sessionSubtle}>grant {row.grant_readiness_score}</div>
                      )}
                    </td>
                    <td>
                      <StatusTag status={row.email_status ?? "not queued"} />
                      {row.email_error && (
                        <div className={styles.sessionError} title={row.email_error}>{row.email_error}</div>
                      )}
                    </td>
                    <td>
                      <div className={styles.cellName}>{row.pipeline_items} items</div>
                      <div className={styles.sessionSubtle}>
                        #{row.id} · {label(row.sector)}
                      </div>
                    </td>
                    <td className={styles.num}>
                      <button
                        type="button"
                        className={styles.btnGhost}
                        style={{ padding: "5px 9px", fontSize: 11 }}
                        onClick={() => loadDetail(row.id)}
                        disabled={detailLoadingId === row.id}
                      >
                        {detailLoadingId === row.id ? "Loading" : "Details"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detailError && <div className={`${styles.toast} ${styles.toastErr}`} style={{ margin: 22 }}>{detailError}</div>}
        {detail && <AssessmentDetailPanel detail={detail} onClose={() => setDetail(null)} />}
      </section>
    </>
  );
}

function AssessmentDetailPanel({ detail, onClose }: { detail: AssessmentSessionDetail; onClose: () => void }) {
  const a = detail.assessment;
  const evidence = a.crawled_data;
  return (
    <div className={styles.sourceDetail}>
      <header className={styles.sourceDetailHead}>
        <div>
          <h3 className={styles.sourceDetailTitle}>{a.company_name ?? `Assessment #${a.id}`}</h3>
          <p className={styles.panelSub}>{a.email ?? "-"} · {a.website ?? "no website"} · {fmtDate(a.created_at)}</p>
        </div>
        <button type="button" className={styles.btnGhost} onClick={onClose}>Close</button>
      </header>

      <div className={styles.sourceDetailGrid}>
        <div><div className={styles.sourceDetailLabel}>Tenders</div><div className={styles.sourceDetailValue}>{a.counts.tenders}</div></div>
        <div><div className={styles.sourceDetailLabel}>Grants</div><div className={styles.sourceDetailValue}>{a.counts.grants}</div></div>
        <div><div className={styles.sourceDetailLabel}>Pipeline</div><div className={styles.sourceDetailValue}>{a.counts.pipeline_items}</div></div>
        <div><div className={styles.sourceDetailLabel}>Score</div><div className={styles.sourceDetailValue}>{a.readiness_score ?? "-"}</div></div>
      </div>

      <div className={styles.sourceAgencyRow}>
        <span className={styles.sourceAgency}>crawl {evidence?.renderMethod ?? a.crawl_render_method ?? "missing"}</span>
        <span className={styles.sourceAgency}>{evidence?.isThinContent ?? a.crawl_thin ? "thin evidence" : "usable evidence"}</span>
        <span className={styles.sourceAgency}>org {label(a.org_type)}</span>
        <span className={styles.sourceAgency}>tier {label(a.recommended_tier)}</span>
      </div>

      {a.ai_analysis?.summary && (
        <p className={styles.signal} style={{ maxWidth: 900, marginBottom: 16 }}>{a.ai_analysis.summary}</p>
      )}

      <div className={styles.sourceDetailTables}>
        <MiniList
          title="Top tenders"
          rows={detail.top_tenders.map((t) => ({
            title: t.title,
            meta: [t.agency, `${Math.round(t.fit_score ?? t.score ?? 0)}%`].filter(Boolean).join(" · "),
            href: t.source_url ?? null,
            note: t.match_reason ?? null,
          }))}
        />
        <MiniList
          title="Top grants"
          rows={detail.top_grants.map((g) => ({
            title: g.title,
            meta: [g.agency, `${Math.round(g.score ?? 0)}%`].filter(Boolean).join(" · "),
            href: g.source_url ?? null,
            note: g.match_reason ?? null,
          }))}
        />
      </div>

      <div className={styles.sourceDetailTables} style={{ marginTop: 18 }}>
        <MiniList
          title="Readiness gaps"
          rows={detail.gaps.map((g) => ({
            title: g.gap ?? "Gap",
            meta: label(g.severity ?? null),
            href: null,
            note: g.fix ?? null,
          }))}
        />
        <MiniList
          title="Activation trail"
          rows={[
            ...detail.emails.map((e) => ({
              title: `Email ${label(e.status)}`,
              meta: fmtDate(e.updated_at ?? e.sent_at),
              href: null,
              note: e.error,
            })),
            ...detail.pipeline_items.slice(0, 8).map((p) => ({
              title: p.tender_title,
              meta: `${label(p.stage)} · ${p.fit_score}% · ${fmtDate(p.updated_at)}`,
              href: null,
              note: p.tender_agency,
            })),
          ]}
        />
      </div>
    </div>
  );
}

function MiniList({ title, rows }: { title: string; rows: Array<{ title: string; meta: string; href: string | null; note: string | null }> }) {
  return (
    <div>
      <div className={styles.sourceDetailLabel}>{title}</div>
      <table className={styles.dossierTable}>
        <tbody>
          {rows.length ? rows.map((row, i) => (
            <tr key={`${row.title}:${i}`}>
              <td>
                {row.href ? <a className={styles.tableLink} href={row.href} target="_blank" rel="noreferrer">{row.title}</a> : <span className={styles.cellName}>{row.title}</span>}
                {row.note && <div className={styles.sessionSubtle} title={row.note}>{row.note}</div>}
              </td>
              <td className={styles.mono}>{row.meta || "-"}</td>
            </tr>
          )) : (
            <tr><td className={styles.mute}>No rows.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
