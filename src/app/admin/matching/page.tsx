"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";

interface MatchingTender {
  id: number;
  title: string;
  agency: string | null;
  country: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  reference_id: string | null;
  created_at: string;
  updated_at: string | null;
  match_count: number;
}

interface MatchingTendersResponse {
  tenders: MatchingTender[];
  total: number;
  filters: {
    countries: string[];
    agencies: string[];
    sectors: string[];
  };
  applied: { q: string; country: string; agency: string; sector: string; deadlineBefore: string; limit: number };
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function relativeDeadline(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return "—";
  const days = Math.round((d - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < -1) return `${Math.abs(days)}d ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

function getInitial(name: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? fallback;
}

export default function AdminMatchingPage() {
  const [data, setData] = useState<MatchingTendersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [agency, setAgency] = useState("");
  const [sector, setSector] = useState("");
  const [deadlineBefore, setDeadlineBefore] = useState("");

  const load = useCallback(async (params: { q: string; country: string; agency: string; sector: string; deadlineBefore: string }) => {
    setLoading(true);
    setError(null);
    try {
      const u = new URLSearchParams({ limit: "200" });
      if (params.q) u.set("q", params.q);
      if (params.country) u.set("country", params.country);
      if (params.agency) u.set("agency", params.agency);
      if (params.sector) u.set("sector", params.sector);
      if (params.deadlineBefore) u.set("deadline_before", params.deadlineBefore);
      const res = await fetch(`/api/admin/matching/tenders?${u.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = {
      q: getInitial("q"),
      country: getInitial("country"),
      agency: getInitial("agency"),
      sector: getInitial("sector"),
      deadlineBefore: getInitial("deadline_before"),
    };
    setQ(init.q);
    setCountry(init.country);
    setAgency(init.agency);
    setSector(init.sector);
    setDeadlineBefore(init.deadlineBefore);
    load(init);
  }, [load]);

  const hasFilters = q || country || agency || sector || deadlineBefore;
  const tendersWithMatches = useMemo(
    () => (data?.tenders ?? []).filter((t) => t.match_count > 0).length,
    [data]
  );
  const totalMatchRows = useMemo(
    () => (data?.tenders ?? []).reduce((acc, t) => acc + t.match_count, 0),
    [data]
  );

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>05 — Matching</div>
          <h1 className={styles.pageTitle}>Tender → vendor workbench</h1>
          <p className={styles.pageSub}>
            Filter live tenders, open one, route it to a vendor with reasoning. Every decision captures as training data.
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/matching/pipeline" className={styles.btnGhost}>Pipeline</Link>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => load({ q, country, agency, sector, deadlineBefore })}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.heroRow}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Tenders shown</div>
          <div className={styles.heroStatValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Tenders with a match</div>
          <div className={styles.heroStatValue}>{tendersWithMatches}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Match decisions on view</div>
          <div className={styles.heroStatValue}>{totalMatchRows}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Agencies in scope</div>
          <div className={styles.heroStatValue}>{(data?.filters.agencies ?? []).length}</div>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Filters</h2>
            <p className={styles.panelSub}>Type any country, agency, or sector — partial and case-insensitive. Search hits title, agency, and reference.</p>
          </div>
          {hasFilters && (
            <Link href="/admin/matching" className={styles.btnGhost}>Clear all</Link>
          )}
        </header>
        <form
          method="get"
          action="/admin/matching"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
            padding: "16px 22px 22px",
          }}
        >
          <input
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title / agency / ref"
            className={styles.adminSearchInput}
          />
          <input
            name="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country — type or pick"
            list="match-countries"
            autoComplete="off"
            className={styles.adminSearchInput}
          />
          <datalist id="match-countries">
            {data?.filters.countries.map((c) => <option key={c} value={c} />)}
          </datalist>
          <input
            name="agency"
            value={agency}
            onChange={(e) => setAgency(e.target.value)}
            placeholder="Agency — type or pick"
            list="match-agencies"
            autoComplete="off"
            className={styles.adminSearchInput}
          />
          <datalist id="match-agencies">
            {data?.filters.agencies.map((a) => <option key={a} value={a} />)}
          </datalist>
          <input
            name="sector"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Sector — type or pick"
            list="match-sectors"
            autoComplete="off"
            className={styles.adminSearchInput}
          />
          <datalist id="match-sectors">
            {data?.filters.sectors.map((s) => <option key={s} value={s} />)}
          </datalist>
          <input
            type="date"
            name="deadline_before"
            value={deadlineBefore}
            onChange={(e) => setDeadlineBefore(e.target.value)}
            className={styles.adminSearchInput}
          />
          <button type="submit" className={styles.btnPrimary}>Apply</button>
        </form>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Open tenders</h2>
            <p className={styles.panelSub}>Soonest deadline first. Broken-link tenders excluded.</p>
          </div>
          {data && <span className={styles.panelMeta}>{data.total} shown</span>}
        </header>
        {loading ? (
          <div className={styles.woEmpty}>Loading tenders…</div>
        ) : !data || data.tenders.length === 0 ? (
          <div className={styles.woEmpty}>No tenders match these filters.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Agency</th>
                  <th>Country</th>
                  <th>Sector</th>
                  <th>Deadline</th>
                  <th>Value</th>
                  <th className={styles.num}>Matches</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.tenders.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.source_url ? (
                        <a className={styles.tableLink} href={t.source_url} target="_blank" rel="noreferrer">
                          {t.title}
                        </a>
                      ) : (
                        <span className={styles.cellName}>{t.title}</span>
                      )}
                      {t.reference_id && <div className={styles.sessionSubtle}>{t.reference_id}</div>}
                    </td>
                    <td>{t.agency || "—"}</td>
                    <td>{t.country || "—"}</td>
                    <td>{t.sector || "—"}</td>
                    <td>
                      <div className={styles.mono}>{fmtDate(t.deadline)}</div>
                      <div className={styles.sessionSubtle}>{relativeDeadline(t.deadline)}</div>
                    </td>
                    <td>{t.estimated_value || "—"}</td>
                    <td className={`${styles.num} ${t.match_count > 0 ? styles.posNum : styles.muteNum}`}>
                      {t.match_count}
                    </td>
                    <td className={styles.num}>
                      <Link
                        href={`/admin/matching/${t.id}`}
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
    </>
  );
}
