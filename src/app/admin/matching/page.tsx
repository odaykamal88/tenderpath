"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import FacetCombobox from "./FacetCombobox";

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
  copy_count: number;
  source_names: string[];
  reference_ids: string[];
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
  agencies: string[];
  sectors: string[];
  minDays: string;
}

// Preset lead-time floors — kept in sync with the /admin/network "Min lead time"
// control so both admin surfaces speak the same language.
const MIN_DAYS_PRESETS = ["10", "7", "3", "0"];
function minDaysLabel(v: string): string {
  return v === "0" || v === "" ? "All (incl. closing soon)" : `${v}+ days`;
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

function listPreview(values: string[], limit = 3): string {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return "—";
  return unique.slice(0, limit).join(" · ") + (unique.length > limit ? ` · +${unique.length - limit}` : "");
}

function nextActionLabel(tender: MatchingTender): string {
  if (tender.match_count > 0) return "Review routed match";
  if ((tender.copy_count ?? 1) > 1) return "Route grouped opp";
  return "Route vendor";
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
  const [agencies, setAgencies] = useState<string[]>([]);
  const [sectors, setSectors] = useState<string[]>([]);
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
      if (params.agencies.length) u.set("agency", params.agencies.join(","));
      if (params.sectors.length) u.set("sector", params.sectors.join(","));
      u.set("min_days", params.minDays || "0");

      // Keep the address bar in sync so a filtered view is shareable/bookmarkable
      // — without a navigation (no page reload).
      if (typeof window !== "undefined") {
        const addr = new URLSearchParams();
        if (params.q) addr.set("q", params.q);
        if (params.countries.length) addr.set("country", params.countries.join(","));
        if (params.agencies.length) addr.set("agency", params.agencies.join(","));
        if (params.sectors.length) addr.set("sector", params.sectors.join(","));
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
    setAgencies(parseCsv(getInitial("agency")));
    setSectors(parseCsv(getInitial("sector")));
    // Absent min_days defaults to a 10-day floor (the actionable view); an
    // explicit value — including "0" for "show everything" — is honoured as-is.
    setMinDays(initMin === "" ? "10" : initMin);
  }, []);

  // Instant, debounced filtering — no form submit, no page reload. Also fires
  // once on mount (the hydrate effect above reschedules it with URL values
  // before the 220ms timer elapses, so exactly one initial request goes out).
  useEffect(() => {
    const t = setTimeout(() => load({ q, countries, agencies, sectors, minDays }), 220);
    return () => clearTimeout(t);
  }, [q, countries, agencies, sectors, minDays, load]);

  const clearAll = () => {
    setQ("");
    setCountries([]);
    setAgencies([]);
    setSectors([]);
    setMinDays("0");
  };

  const hasFilters = Boolean(q || countries.length || agencies.length || sectors.length);
  const tendersWithMatches = useMemo(
    () => (data?.tenders ?? []).filter((t) => t.match_count > 0).length,
    [data]
  );
  const totalMatchRows = useMemo(
    () => (data?.tenders ?? []).reduce((acc, t) => acc + t.match_count, 0),
    [data]
  );
  const foldedRows = useMemo(
    () => (data?.tenders ?? []).reduce((acc, t) => acc + Math.max(0, (t.copy_count ?? 1) - 1), 0),
    [data]
  );
  const sourcesInView = useMemo(
    () => new Set((data?.tenders ?? []).flatMap((t) => t.source_names ?? []).filter(Boolean)).size,
    [data]
  );

  // Preserve an arbitrary ?min_days=N from the URL by surfacing it as an option.
  const minDaysOptions = useMemo(
    () => (MIN_DAYS_PRESETS.includes(minDays) ? MIN_DAYS_PRESETS : [minDays, ...MIN_DAYS_PRESETS]),
    [minDays]
  );

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>05 — Matching</div>
          <h1 className={styles.pageTitle}>Opportunity routing queue</h1>
          <p className={styles.pageSub}>
            Work from unique opportunities, inspect source provenance, and route the best-fit vendor with reasoning.
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/matching/pipeline" className={styles.btnGhost}>Pipeline</Link>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={() => load({ q, countries, agencies, sectors, minDays })}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.heroRow}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>
            {minDays === "0" || minDays === "" ? "Unique opps · all active" : `Unique opps · ${minDays}+ days`}
          </div>
          <div className={styles.heroStatValue}>{data?.total ?? 0}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Need first routing</div>
          <div className={styles.heroStatValue}>{Math.max(0, (data?.total ?? 0) - tendersWithMatches)}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Folded crawler rows</div>
          <div className={styles.heroStatValue}>{foldedRows}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Sources in view</div>
          <div className={styles.heroStatValue}>{sourcesInView}</div>
          <div className={styles.heroStatMeta}>{totalMatchRows} logged decisions</div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.panelOverflowVisible}`}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Filters</h2>
            <p className={styles.panelSub}>Results update as you type — no need to apply. Pick from the dropdown or type your own. Search hits title, agency, and reference.</p>
          </div>
          {hasFilters && (
            <button type="button" onClick={clearAll} className={styles.btnGhost}>Clear all</button>
          )}
        </header>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12,
            padding: "16px 22px 22px",
            alignItems: "start",
          }}
        >
          <div className={styles.filterCell}>
            <span className={styles.filterCellLabel}>Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title / agency / ref"
              className={styles.adminSearchInput}
            />
          </div>

          <FacetCombobox
            label="Country"
            placeholder="Type or pick a country"
            options={data?.filters.countries ?? []}
            selected={countries}
            onChange={setCountries}
          />
          <FacetCombobox
            label="Agency"
            placeholder="Type or pick an agency"
            options={data?.filters.agencies ?? []}
            selected={agencies}
            onChange={setAgencies}
          />
          <FacetCombobox
            label="Sector"
            placeholder="Type or pick a sector"
            options={data?.filters.sectors ?? []}
            selected={sectors}
            onChange={setSectors}
          />

          <div className={styles.filterCell}>
            <span className={styles.filterCellLabel}>Min days to deadline</span>
            <select
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              className={styles.adminSearchInput}
              title="Only show tenders closing at least this many days out. All = include closing-soon and past-deadline."
            >
              {minDaysOptions.map((v) => (
                <option key={v} value={v}>{minDaysLabel(v)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Open tenders</h2>
            <p className={styles.panelSub}>Soonest deadline first. Cross-posted rows are folded into one opportunity with source and reference provenance.</p>
          </div>
          {data && (
            <span className={styles.panelMeta}>
              {data.total} shown · {minDays === "0" || minDays === "" ? "all active" : `closing ${minDays}+ days out`}
            </span>
          )}
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
                  <th>Scope</th>
                  <th>Deadline</th>
                  <th>Provenance</th>
                  <th>Next action</th>
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
                      {t.estimated_value && <div className={styles.sessionSubtle}>value {t.estimated_value}</div>}
                    </td>
                    <td>{t.agency || "—"}</td>
                    <td>
                      <div>{t.country || "—"}</div>
                      <div className={styles.sessionSubtle}>{t.sector || "sector unknown"}</div>
                    </td>
                    <td>
                      <div className={styles.mono}>{fmtDate(t.deadline)}</div>
                      <div className={styles.sessionSubtle}>{relativeDeadline(t.deadline)}</div>
                    </td>
                    <td>
                      <div className={styles.cellName}>
                        {(t.copy_count ?? 1) > 1 ? `${t.copy_count} copies` : "1 copy"}
                      </div>
                      <div className={styles.sessionSubtle}>{listPreview(t.source_names)}</div>
                      {t.reference_ids.length > 1 && (
                        <div className={styles.sessionSubtle}>{t.reference_ids.length} refs folded</div>
                      )}
                    </td>
                    <td>
                      <span className={styles.cellName}>{nextActionLabel(t)}</span>
                      <div className={styles.sessionSubtle}>
                        {t.match_count > 0 ? "move status in pipeline" : "open candidate ranking"}
                      </div>
                    </td>
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
