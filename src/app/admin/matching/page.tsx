"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  applied: { q: string; country: string; agency: string; sector: string; minDays: number; limit: number };
}

interface Filters {
  q: string;
  countries: string[];
  agency: string;
  sector: string;
  minDays: string;
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

function parseCsv(v: string): string[] {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export default function AdminMatchingPage() {
  const [data, setData] = useState<MatchingTendersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [countryInput, setCountryInput] = useState("");
  const [agency, setAgency] = useState("");
  const [sector, setSector] = useState("");
  const [minDays, setMinDays] = useState("10");
  const reqSeq = useRef(0);

  const load = useCallback(async (params: Filters) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setError(null);
    try {
      const u = new URLSearchParams({ limit: "200" });
      if (params.q) u.set("q", params.q);
      if (params.countries.length) u.set("country", params.countries.join(","));
      if (params.agency) u.set("agency", params.agency);
      if (params.sector) u.set("sector", params.sector);
      u.set("min_days", params.minDays || "0");

      // Keep the address bar in sync so a filtered view is shareable/bookmarkable
      // — without a navigation (no page reload).
      if (typeof window !== "undefined") {
        const addr = new URLSearchParams();
        if (params.q) addr.set("q", params.q);
        if (params.countries.length) addr.set("country", params.countries.join(","));
        if (params.agency) addr.set("agency", params.agency);
        if (params.sector) addr.set("sector", params.sector);
        addr.set("min_days", params.minDays || "0");
        const qs = addr.toString();
        window.history.replaceState(null, "", qs ? `/admin/matching?${qs}` : "/admin/matching");
      }

      const res = await fetch(`/api/admin/matching/tenders?${u.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = (await res.json()) as MatchingTendersResponse;
      if (seq !== reqSeq.current) return; // a newer request superseded this one
      setData(json);
    } catch (err) {
      if (seq !== reqSeq.current) return;
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, []);

  // Hydrate filters from the URL once on mount. Doing this in an effect (not a
  // lazy initializer) keeps SSR/CSR markup identical — no hydration mismatch.
  useEffect(() => {
    const initMin = getInitial("min_days");
    setQ(getInitial("q"));
    setCountries(parseCsv(getInitial("country")));
    setAgency(getInitial("agency"));
    setSector(getInitial("sector"));
    // Absent min_days defaults to a 10-day floor (the actionable view); an
    // explicit value — including "0" for "show everything" — is honoured as-is.
    setMinDays(initMin === "" ? "10" : initMin);
  }, []);

  // Instant, debounced filtering — no form submit, no page reload. Also fires
  // once on mount (the hydrate effect above reschedules it with URL values
  // before the 220ms timer elapses, so exactly one initial request goes out).
  useEffect(() => {
    const t = setTimeout(() => load({ q, countries, agency, sector, minDays }), 220);
    return () => clearTimeout(t);
  }, [q, countries, agency, sector, minDays, load]);

  const addCountry = useCallback(
    (val: string) => {
      const v = val.trim();
      if (!v) return;
      const match = (data?.filters.countries ?? []).find((c) => c.toLowerCase() === v.toLowerCase());
      const final = match ?? v;
      setCountries((cs) => (cs.some((c) => c.toLowerCase() === final.toLowerCase()) ? cs : [...cs, final]));
      setCountryInput("");
    },
    [data],
  );

  const clearAll = () => {
    setQ("");
    setCountries([]);
    setCountryInput("");
    setAgency("");
    setSector("");
    setMinDays("0");
  };

  const hasFilters = Boolean(q || countries.length || agency || sector);
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
            onClick={() => load({ q, countries, agency, sector, minDays })}
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
            <p className={styles.panelSub}>Results update as you type — no need to apply. Search hits title, agency, and reference.</p>
          </div>
          {hasFilters && (
            <button type="button" onClick={clearAll} className={styles.btnGhost}>Clear all</button>
          )}
        </header>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 10,
            padding: "16px 22px 22px",
            alignItems: "start",
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title / agency / ref"
            className={styles.adminSearchInput}
          />

          {/* Country — type to add multiple */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
              minHeight: 36,
              border: "1px solid var(--color-rule)",
              borderRadius: 4,
              background: "var(--color-paper-3)",
              padding: "4px 8px",
            }}
          >
            {countries.map((c) => (
              <span key={c} className={styles.chipActive} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                {c}
                <button
                  type="button"
                  aria-label={`Remove ${c}`}
                  onClick={() => setCountries((cs) => cs.filter((x) => x !== c))}
                  style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={countryInput}
              onChange={(e) => {
                const v = e.target.value;
                if ((data?.filters.countries ?? []).some((c) => c.toLowerCase() === v.toLowerCase())) addCountry(v);
                else setCountryInput(v);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCountry(countryInput);
                } else if (e.key === "Backspace" && !countryInput && countries.length) {
                  setCountries((cs) => cs.slice(0, -1));
                }
              }}
              placeholder={countries.length ? "Add another…" : "Country — type to add"}
              list="match-countries"
              autoComplete="off"
              style={{ flex: 1, minWidth: 110, border: 0, outline: 0, background: "transparent", color: "var(--color-ink)", font: "inherit", fontSize: 13 }}
            />
            <datalist id="match-countries">
              {(data?.filters.countries ?? [])
                .filter((c) => !countries.some((sel) => sel.toLowerCase() === c.toLowerCase()))
                .map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>

          <input
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
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--color-mute, #888)" }}>
            Min days to deadline
            <input
              type="number"
              min={0}
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              className={styles.adminSearchInput}
              title="Only show tenders closing at least this many days out. 0 = show all, including closing-soon and past-deadline."
            />
          </label>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Open tenders</h2>
            <p className={styles.panelSub}>Soonest deadline first. Broken-link tenders excluded. Showing tenders closing 10+ days out by default — set <em>Min days to deadline</em> to 0 to include closing-soon and past-deadline tenders.</p>
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
