"use client";

/* Browse — the full tender database (superset of matches), as a filterable
 * table that mirrors the admin matching workbench. Real faceted search against
 * /api/dashboard/browse: instant search, multi-country + agency + sector
 * type-ahead, a min-days-to-deadline floor, Best-fit / Closing-soon sort, and a
 * "My matches only" toggle. Matched tenders carry a real fit + "Matched" badge;
 * each row's "→" opens the Paste flow to score/decide. */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { C, F } from "../tokens";
import { Btn, FitBadge, DeadlinePill, SectionHead, shortDate } from "../ui";
import { Icon } from "../icons";
import { useWorkbench } from "../WorkbenchProvider";
import type { BucketKey, WbBrowseResult, WbBrowseRow, WbMatch } from "@/lib/workbench/types";

function rowToSeed(r: WbBrowseRow): WbMatch {
  const fit = r.fit ?? 0;
  const bucket: BucketKey = fit >= 75 ? "strong_fit" : fit >= 45 ? "adjacent" : "watchlist";
  return {
    id: r.id,
    tenderId: r.tenderId,
    code: r.code,
    title: r.title,
    agency: r.agency,
    type: r.type,
    source: r.source,
    deadline: r.deadline,
    value: r.value,
    fit,
    bucket,
    why: "",
    sectors: r.sector ? [r.sector] : [],
    roster: false,
    caveat: null,
    sourceUrl: r.sourceUrl,
  };
}

const inputStyle: CSSProperties = {
  height: 38,
  border: `1px solid ${C.rule}`,
  background: C.white,
  color: C.ink,
  padding: "0 11px",
  fontFamily: F.sans,
  fontSize: 13,
  outline: "none",
  minWidth: 0,
};
const thStyle: CSSProperties = {
  fontFamily: F.mono,
  fontSize: 9.5,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: C.faint,
  textAlign: "left",
  fontWeight: 500,
  padding: "11px 12px",
  borderBottom: `1px solid ${C.ink}`,
  whiteSpace: "nowrap",
};
const tdStyle: CSSProperties = {
  padding: "11px 12px",
  borderBottom: `1px solid ${C.ruleSoft}`,
  fontFamily: F.sans,
  fontSize: 13,
  color: C.ink2,
  verticalAlign: "top",
};

export function BrowsePage() {
  const { token, openPaste, go } = useWorkbench();

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [countryInput, setCountryInput] = useState("");
  const [agency, setAgency] = useState("");
  const [sector, setSector] = useState("");
  const [minDays, setMinDays] = useState("0");
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [sort, setSort] = useState<"deadline" | "fit">("fit");

  const [rows, setRows] = useState<WbBrowseRow[]>([]);
  const [sectorSug, setSectorSug] = useState<string[]>([]);
  const [countrySug, setCountrySug] = useState<string[]>([]);
  const [agencySug, setAgencySug] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [soonTotal, setSoonTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const buildUrl = useCallback(
    (pageNum: number) => {
      const p = new URLSearchParams();
      if (debouncedQ) p.set("q", debouncedQ);
      if (sector) p.set("sector", sector);
      if (countries.length) p.set("country", countries.join(","));
      if (agency) p.set("agency", agency);
      if (minDays && minDays !== "0") p.set("min_days", minDays);
      if (matchedOnly) p.set("matched", "1");
      p.set("sort", sort);
      p.set("page", String(pageNum));
      return `/api/dashboard/browse?${p.toString()}`;
    },
    [debouncedQ, sector, countries, agency, minDays, matchedOnly, sort],
  );

  const fetchPage = useCallback(
    async (pageNum: number): Promise<WbBrowseResult | null> => {
      const res = await fetch(buildUrl(pageNum), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as WbBrowseResult;
    },
    [buildUrl, token],
  );

  // Refetch (replace) whenever any filter changes. State updates live inside the
  // async closure so they don't trip the set-state-in-effect cascade rule.
  useEffect(() => {
    const id = ++reqId.current;
    (async () => {
      setLoading(true);
      setError(null);
      const result = await fetchPage(1);
      if (id !== reqId.current) return; // stale
      if (!result) {
        setError("Couldn't load tenders. Please try again.");
        setLoading(false);
        return;
      }
      setRows(result.tenders);
      setSectorSug(result.facets.sector.map((f) => f.value));
      setCountrySug(result.countries);
      setAgencySug(result.agencies);
      setTotal(result.total);
      setMatchedTotal(result.matchedTotal);
      setSoonTotal(result.soonTotal);
      setPage(1);
      setLoading(false);
    })();
  }, [fetchPage]);

  const loadMore = async () => {
    setLoadingMore(true);
    const next = page + 1;
    const result = await fetchPage(next);
    if (result) {
      setRows((prev) => [...prev, ...result.tenders]);
      setPage(next);
    }
    setLoadingMore(false);
  };

  const addCountry = (val: string) => {
    const v = val.trim();
    if (!v) return;
    const match = countrySug.find((c) => c.toLowerCase() === v.toLowerCase());
    const final = match ?? v;
    setCountries((cs) => (cs.some((c) => c.toLowerCase() === final.toLowerCase()) ? cs : [...cs, final]));
    setCountryInput("");
  };

  const activeCount =
    countries.length +
    (agency ? 1 : 0) +
    (sector ? 1 : 0) +
    (minDays && minDays !== "0" ? 1 : 0) +
    (matchedOnly ? 1 : 0) +
    (q ? 1 : 0);

  const clearAll = () => {
    setQ("");
    setCountries([]);
    setCountryInput("");
    setAgency("");
    setSector("");
    setMinDays("0");
    setMatchedOnly(false);
  };
  const hasMore = rows.length < total;

  const sortToggle = (
    <div style={{ display: "flex", border: `1px solid ${C.rule}` }}>
      {([["fit", "Best fit"], ["deadline", "Closing soon"]] as [typeof sort, string][]).map(([val, lbl]) => (
        <button
          key={val}
          onClick={() => setSort(val)}
          style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", background: sort === val ? C.ink : C.white, color: sort === val ? C.paper : C.ink2, border: 0, cursor: "pointer" }}
        >
          {lbl}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <style>{`.wbBrowseTbl tbody tr:hover{background:rgba(156,107,31,0.05);}`}</style>
      <SectionHead n="03" title="Tender database" count={total} action={sortToggle} />

      {/* stat strip — mirrors the admin matching hero row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", border: `1px solid ${C.rule}`, background: C.white, marginBottom: 20 }}>
        {([["Tenders shown", total], ["Matched to you", matchedTotal], ["Closing ≤7 days", soonTotal]] as [string, number][]).map(([label, val], i) => (
          <div key={label} style={{ padding: "15px 18px", borderLeft: i ? `1px solid ${C.ruleSoft}` : undefined }}>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint }}>{label}</div>
            <div style={{ fontFamily: F.display, fontSize: 32, color: C.ink, lineHeight: 1.05, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{val}</div>
          </div>
        ))}
      </div>

      {/* edit-sectors nudge */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: `2px solid ${C.accent}`, background: "#f8f2e2", padding: "11px 16px", marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ color: C.accent, flexShrink: 0 }}>↻</span>
        <span style={{ flex: 1, minWidth: 200, fontFamily: F.sans, fontSize: 12.5, color: C.ink2 }}>Fit scores are tuned to your sector labels. Add or edit them to surface more relevant tenders.</span>
        <button onClick={() => go("account")} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer", flexShrink: 0 }}>Edit my sectors →</button>
      </div>

      {/* filter bar — instant, no apply */}
      <div style={{ display: "flex", gap: 10, marginBottom: 8, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "2 1 240px", minWidth: 220, background: C.white, border: `1px solid ${C.rule}`, padding: "0 12px", color: C.mute }}>
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, agency, sector…" style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontFamily: F.sans, fontSize: 13, color: C.ink }} />
        </div>

        {/* country — type to add multiple */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", flex: "1 1 220px", minWidth: 200, minHeight: 38, border: `1px solid ${C.rule}`, background: C.white, padding: "4px 8px" }}>
          {countries.map((c) => (
            <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: F.mono, fontSize: 10.5, color: C.paper, background: C.ink, padding: "3px 7px", whiteSpace: "nowrap" }}>
              {c}
              <button type="button" aria-label={`Remove ${c}`} onClick={() => setCountries((cs) => cs.filter((x) => x !== c))} style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
          <input
            value={countryInput}
            onChange={(e) => {
              const v = e.target.value;
              if (countrySug.some((c) => c.toLowerCase() === v.toLowerCase())) addCountry(v);
              else setCountryInput(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addCountry(countryInput); }
              else if (e.key === "Backspace" && !countryInput && countries.length) setCountries((cs) => cs.slice(0, -1));
            }}
            placeholder={countries.length ? "Add…" : "Country — type to add"}
            list="browse-countries"
            autoComplete="off"
            style={{ flex: 1, minWidth: 96, border: 0, outline: 0, background: "transparent", color: C.ink, fontFamily: F.sans, fontSize: 13 }}
          />
          <datalist id="browse-countries">
            {countrySug.filter((c) => !countries.some((sel) => sel.toLowerCase() === c.toLowerCase())).map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        <input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Agency" list="browse-agencies" autoComplete="off" style={{ ...inputStyle, flex: "1 1 150px" }} />
        <datalist id="browse-agencies">{agencySug.map((a) => <option key={a} value={a} />)}</datalist>

        <input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="Sector" list="browse-sectors" autoComplete="off" style={{ ...inputStyle, flex: "1 1 150px" }} />
        <datalist id="browse-sectors">{sectorSug.map((s) => <option key={s} value={s} />)}</datalist>

        <input type="number" min={0} value={minDays} onChange={(e) => setMinDays(e.target.value)} placeholder="Min days" title="Only show tenders closing at least this many days out. 0 = all." style={{ ...inputStyle, flex: "0 1 110px", width: 110 }} />

        <button onClick={() => setMatchedOnly((v) => !v)} style={{ height: 38, padding: "0 13px", border: `1px solid ${matchedOnly ? C.ink : C.rule}`, background: matchedOnly ? C.ink : C.white, color: matchedOnly ? C.paper : C.ink2, cursor: "pointer", fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          {matchedOnly ? "✓ " : ""}My matches
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute }}>
          {loading ? "Loading…" : `${total} tender${total === 1 ? "" : "s"}${activeCount ? " · filtered" : ""}`}
        </span>
        {activeCount > 0 && (
          <button onClick={clearAll} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.neg, background: "none", border: 0, cursor: "pointer" }}>
            Clear ({activeCount})
          </button>
        )}
      </div>

      {error ? (
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: 20 }}>
          <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.neg }}>{error}</span>
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.rule}`, background: C.white, overflowX: "auto" }}>
          <table className="wbBrowseTbl" style={{ width: "100%", minWidth: 820, borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Agency</th>
                <th style={thStyle}>Country</th>
                <th style={thStyle}>Sector</th>
                <th style={thStyle}>Deadline</th>
                <th style={thStyle}>Value</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Fit</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, minWidth: 230 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.matched && <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.pos, border: "1px solid #bfe0cc", padding: "1px 5px", flexShrink: 0 }}>Matched</span>}
                      {r.sourceUrl ? (
                        <a href={r.sourceUrl} target="_blank" rel="noreferrer" style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, textDecoration: "none" }}>{r.title}</a>
                      ) : (
                        <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>{r.title}</span>
                      )}
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, marginTop: 3 }}>{r.code}</div>
                  </td>
                  <td style={tdStyle}>{r.agency || "—"}</td>
                  <td style={tdStyle}>{r.country || "—"}</td>
                  <td style={tdStyle}>{r.sector || "—"}</td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <div style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink2 }}>{shortDate(r.deadline)}</div>
                    <div style={{ marginTop: 2 }}><DeadlinePill deadline={r.deadline} /></div>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: F.mono, fontSize: 11.5 }}>{r.value}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}><FitBadge score={r.fit ?? 0} /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button onClick={() => openPaste(rowToSeed(r))} aria-label="Score this tender" title="Score this tender" style={{ width: 28, height: 28, border: `1px solid ${C.rule}`, background: C.white, color: C.ink, cursor: "pointer" }}>→</button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ ...tdStyle, padding: "22px 14px", color: C.mute }}>
                    No tenders match these filters.{" "}
                    {activeCount > 0 && <button onClick={clearAll} style={{ color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}>Clear filters</button>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && !error && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <Btn kind="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : `Load more (${total - rows.length})`}</Btn>
        </div>
      )}
    </div>
  );
}
