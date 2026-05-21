"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../../admin.module.css";

const STATUSES = ["suggested", "contacted", "applied", "shortlisted", "won", "lost"] as const;
type Status = typeof STATUSES[number];

const STATUS_LABEL: Record<Status, string> = {
  suggested: "Suggested",
  contacted: "Contacted",
  applied: "Applied",
  shortlisted: "Shortlisted",
  won: "Won",
  lost: "Lost",
};

const ROUTED_SERVICES = [
  { value: "bid-no-bid", label: "Bid-No-Bid" },
  { value: "proposal-draft", label: "Proposal Draft" },
  { value: "roster-fast-track", label: "Roster Fast-Track" },
  { value: "matching", label: "Matching" },
] as const;

interface MatchRow {
  id: number;
  tender_id: number;
  assessment_id: number;
  routed_service: string;
  status: Status;
  fit_reasoning: string;
  outcome: string | null;
  created_at: string;
  updated_at: string;
  tender_title: string;
  tender_agency: string | null;
  tender_country: string | null;
  tender_sector: string | null;
  tender_deadline: string | null;
  tender_source_url: string | null;
  tender_reference: string | null;
  vendor_company: string | null;
  vendor_email: string | null;
  vendor_sector: string | null;
  vendor_tier: string | null;
}

interface PipelineResponse {
  matches: MatchRow[];
  total: number;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), "content-type": "application/json" };
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function relTime(value: string): string {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/-/g, " ");
}

function getInitial(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? "";
}

export default function MatchingPipelinePage() {
  const [data, setData] = useState<PipelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [routedService, setRoutedService] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async (params: { q: string; routed_service: string }) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URLSearchParams({ limit: "500" });
      if (params.q) u.set("q", params.q);
      if (params.routed_service) u.set("routed_service", params.routed_service);
      const res = await fetch(`/api/admin/matching/matches?${u.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pipeline");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q0 = getInitial("q");
    const rs0 = getInitial("routed_service");
    setQ(q0);
    setAppliedQ(q0);
    setRoutedService(rs0);
    load({ q: q0, routed_service: rs0 });
  }, [load]);

  async function patchStatus(matchId: number, status: Status) {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/matching/matches/${matchId}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Moved to ${status}.` });
      await load({ q: appliedQ, routed_service: routedService });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update match" });
    } finally {
      setSaving(false);
    }
  }

  const grouped = useMemo(() => {
    const byStatus: Record<Status, MatchRow[]> = {
      suggested: [], contacted: [], applied: [], shortlisted: [], won: [], lost: [],
    };
    for (const m of data?.matches ?? []) {
      if (byStatus[m.status]) byStatus[m.status].push(m);
    }
    return byStatus;
  }, [data]);

  const counts: Record<Status, number> = useMemo(() => ({
    suggested: grouped.suggested.length,
    contacted: grouped.contacted.length,
    applied: grouped.applied.length,
    shortlisted: grouped.shortlisted.length,
    won: grouped.won.length,
    lost: grouped.lost.length,
  }), [grouped]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>05 — Matching · Pipeline</div>
          <h1 className={styles.pageTitle}>Match pipeline</h1>
          <p className={styles.pageSub}>
            Every match decision logged, grouped by status. Update status inline; deeper edits happen on the tender page.
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/matching" className={styles.btnGhost}>← Tenders</Link>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => load({ q: appliedQ, routed_service: routedService })}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}
      {toast && <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>{toast.msg}</div>}

      <section className={styles.heroRow}>
        {STATUSES.map((s) => (
          <div key={s} className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{STATUS_LABEL[s]}</div>
            <div className={styles.heroStatValue}>{counts[s]}</div>
          </div>
        ))}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Filters</h2>
            <p className={styles.panelSub}>Search by tender title, agency, or vendor company.</p>
          </div>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQ(q);
            const u = new URLSearchParams();
            if (q) u.set("q", q);
            if (routedService) u.set("routed_service", routedService);
            window.history.pushState(null, "", u.toString() ? `/admin/matching/pipeline?${u.toString()}` : "/admin/matching/pipeline");
            load({ q, routed_service: routedService });
          }}
          style={{ display: "flex", gap: 8, padding: "12px 22px 22px", flexWrap: "wrap" }}
        >
          <input
            className={styles.adminSearchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tender / agency / vendor"
            style={{ flex: 1, minWidth: 220 }}
          />
          <select
            className={styles.adminSearchInput}
            value={routedService}
            onChange={(e) => setRoutedService(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">All services</option>
            {ROUTED_SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button type="submit" className={styles.btnPrimary}>Apply</button>
          {(appliedQ || routedService) && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => {
                setQ("");
                setAppliedQ("");
                setRoutedService("");
                window.history.pushState(null, "", "/admin/matching/pipeline");
                load({ q: "", routed_service: "" });
              }}
            >
              Clear
            </button>
          )}
        </form>
      </section>

      {STATUSES.map((s) => {
        const rows = grouped[s];
        if (!rows.length && !loading) return null;
        return (
          <section key={s} className={styles.panel}>
            <header className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>{STATUS_LABEL[s]}</h2>
                <p className={styles.panelSub}>{rows.length} match{rows.length === 1 ? "" : "es"}</p>
              </div>
            </header>
            {rows.length === 0 ? (
              <div className={styles.woEmpty}>None.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.dossierTable}>
                  <thead>
                    <tr>
                      <th>Tender</th>
                      <th>Vendor</th>
                      <th>Service</th>
                      <th>Deadline</th>
                      <th>Updated</th>
                      <th>Reasoning</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <Link href={`/admin/matching/${m.tender_id}`} className={styles.tableLink}>
                            {m.tender_title}
                          </Link>
                          <div className={styles.sessionSubtle}>
                            {[m.tender_agency, m.tender_country, m.tender_sector].filter(Boolean).join(" · ") || "—"}
                          </div>
                        </td>
                        <td>
                          <div className={styles.cellName}>{m.vendor_company ?? "—"}</div>
                          <div className={styles.sessionSubtle}>
                            {m.vendor_email ?? "—"}{m.vendor_tier ? ` · ${m.vendor_tier}` : ""}
                          </div>
                        </td>
                        <td>{label(m.routed_service)}</td>
                        <td className={styles.mono}>{fmtDate(m.tender_deadline)}</td>
                        <td className={styles.mono}>{relTime(m.updated_at)}</td>
                        <td style={{ maxWidth: 280 }}>
                          <span className={styles.sessionSubtle} title={m.fit_reasoning}>
                            {m.fit_reasoning.length > 100 ? m.fit_reasoning.slice(0, 100) + "…" : m.fit_reasoning}
                          </span>
                          {m.outcome && (
                            <div className={styles.sessionSubtle} title={m.outcome}>
                              <strong>outcome:</strong> {m.outcome.length > 60 ? m.outcome.slice(0, 60) + "…" : m.outcome}
                            </div>
                          )}
                        </td>
                        <td className={styles.num}>
                          <select
                            value={m.status}
                            onChange={(e) => patchStatus(m.id, e.target.value as Status)}
                            disabled={saving}
                            className={styles.adminSearchInput}
                            style={{ padding: "4px 6px", fontSize: 11 }}
                          >
                            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                          </select>
                        </td>
                        <td className={styles.num}>
                          <Link
                            href={`/admin/matching/${m.tender_id}`}
                            className={styles.btnGhost}
                            style={{ padding: "5px 9px", fontSize: 11 }}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {data && data.total === 0 && !loading && (
        <section className={styles.panel}>
          <div className={styles.woEmpty}>
            No matches logged yet. <Link href="/admin/matching" className={styles.tableLink}>Open the tender list</Link> and log your first match.
          </div>
        </section>
      )}
    </>
  );
}
