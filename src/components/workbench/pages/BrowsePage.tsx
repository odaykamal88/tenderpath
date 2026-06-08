"use client";

/* Browse — the full tender database (superset of matches). Real faceted search
 * against /api/dashboard/browse: search, Best-fit / Closing-soon sort, sector /
 * type / source facets, "My matches only", and a Matched badge + real fit on the
 * user's matches. Each row's "→" opens the Paste flow to score/decide. */

import { useCallback, useEffect, useRef, useState } from "react";
import { C, F } from "../tokens";
import { Card, Btn, FitBadge, DeadlinePill, SectionHead } from "../ui";
import { Icon } from "../icons";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { BucketKey, WbBrowseResult, WbBrowseRow, WbFacet, WbMatch } from "@/lib/workbench/types";

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

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function FacetGroup({
  label,
  facets,
  selected,
  onToggle,
}: {
  label: string;
  facets: WbFacet[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (facets.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.faint, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {facets.map((f) => {
          const on = selected.includes(f.value);
          return (
            <button key={f.value} onClick={() => onToggle(f.value)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", background: "none", border: 0, cursor: "pointer", textAlign: "left", width: "100%" }}>
              <span style={{ width: 13, height: 13, border: `1px solid ${on ? C.ink : C.rule}`, background: on ? C.ink : C.white, color: C.white, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 9 }}>{on ? "✓" : ""}</span>
              <span style={{ flex: 1, fontFamily: F.sans, fontSize: 12.5, color: on ? C.ink : C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.value}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{f.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BrowsePage() {
  const { token, openPaste, go } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");

  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sectors, setSectors] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [sort, setSort] = useState<"deadline" | "fit">("deadline");
  const [showFilters, setShowFilters] = useState(false);

  const [rows, setRows] = useState<WbBrowseRow[]>([]);
  const [facets, setFacets] = useState<WbBrowseResult["facets"]>({ sector: [], type: [], source: [] });
  const [total, setTotal] = useState(0);
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
      if (sectors.length) p.set("sector", sectors.join(","));
      if (types.length) p.set("type", types.join(","));
      if (sources.length) p.set("source", sources.join(","));
      if (matchedOnly) p.set("matched", "1");
      p.set("sort", sort);
      p.set("page", String(pageNum));
      return `/api/dashboard/browse?${p.toString()}`;
    },
    [debouncedQ, sectors, types, sources, matchedOnly, sort],
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

  // Refetch (replace) whenever filters change. State updates live inside the
  // async closure (not the effect body) so they don't trip the
  // set-state-in-effect cascade rule.
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
      setFacets(result.facets);
      setTotal(result.total);
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

  const activeCount = sectors.length + types.length + sources.length + (matchedOnly ? 1 : 0) + (q ? 1 : 0);
  const clearAll = () => {
    setQ("");
    setSectors([]);
    setTypes([]);
    setSources([]);
    setMatchedOnly(false);
  };
  const hasMore = rows.length < total;

  const rail = (
    <div style={{ position: mobile ? "static" : "sticky", top: 84 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", cursor: "pointer", marginBottom: 16 }}>
        <span style={{ width: 13, height: 13, border: `1px solid ${matchedOnly ? C.ink : C.rule}`, background: matchedOnly ? C.ink : C.white, color: C.white, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 9 }}>{matchedOnly ? "✓" : ""}</span>
        <input type="checkbox" checked={matchedOnly} onChange={(e) => setMatchedOnly(e.target.checked)} style={{ display: "none" }} />
        <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink }}>My matches only</span>
      </label>
      <FacetGroup label="Sector" facets={facets.sector} selected={sectors} onToggle={(v) => setSectors((s) => toggle(s, v))} />
      <FacetGroup label="Procurement type" facets={facets.type} selected={types} onToggle={(v) => setTypes((s) => toggle(s, v))} />
      <FacetGroup label="Source" facets={facets.source} selected={sources} onToggle={(v) => setSources((s) => toggle(s, v))} />
      {activeCount > 0 && (
        <button onClick={clearAll} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.neg, background: "none", border: 0, cursor: "pointer", padding: "4px 2px" }}>
          Clear ({activeCount})
        </button>
      )}
    </div>
  );

  return (
    <div>
      <SectionHead n="03" title="Tender database" count={total} hint="Live feeds from UNGM, EU, AfDB & national portals" />

      {/* edit-sectors nudge */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, borderLeft: `2px solid ${C.accent}`, background: "#f8f2e2", padding: "11px 16px", marginBottom: 20, flexWrap: "wrap" }}>
        <span style={{ color: C.accent, flexShrink: 0 }}>↻</span>
        <span style={{ flex: 1, minWidth: 200, fontFamily: F.sans, fontSize: 12.5, color: C.ink2 }}>Fit scores are tuned to your sector labels. Add or edit them to surface more relevant tenders.</span>
        <button onClick={() => go("account")} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer", flexShrink: 0 }}>Edit my sectors →</button>
      </div>

      {/* search + sort */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 220, background: C.white, border: `1px solid ${C.rule}`, padding: "9px 12px", color: C.mute }}>
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, agency, sector…" style={{ flex: 1, border: 0, outline: 0, background: "transparent", fontFamily: F.sans, fontSize: 13, color: C.ink }} />
        </div>
        {mobile && (
          <Btn kind="ghost" size="sm" onClick={() => setShowFilters((s) => !s)}>Filters{activeCount ? ` · ${activeCount}` : ""}</Btn>
        )}
        <div style={{ display: "flex", border: `1px solid ${C.rule}` }}>
          {([["fit", "Best fit"], ["deadline", "Closing soon"]] as [typeof sort, string][]).map(([val, lbl]) => (
            <button key={val} onClick={() => setSort(val)} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", background: sort === val ? C.ink : C.white, color: sort === val ? C.paper : C.ink2, border: 0, cursor: "pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "212px 1fr", gap: mobile ? 16 : 28, alignItems: "start" }}>
        {(!mobile || showFilters) && rail}

        <div>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginBottom: 10 }}>
            {loading ? "Loading…" : `${total} tender${total === 1 ? "" : "s"}${activeCount ? " · filtered" : ""}`}
          </div>
          {error && <Card pad={20}><span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.neg }}>{error}</span></Card>}
          {!error && (
            <Card style={{ overflow: "hidden" }}>
              {rows.map((r) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: mobile ? "1fr auto" : "56px 1fr 110px 48px 76px 28px", gap: mobile ? 12 : 14, alignItems: "center", padding: mobile ? "13px 16px" : "13px 18px", borderBottom: `1px solid ${C.ruleSoft}` }}>
                  {!mobile && <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.faint, overflow: "hidden", textOverflow: "ellipsis" }}>{r.code}</span>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {r.matched && <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.pos, border: `1px solid #bfe0cc`, padding: "1px 5px", flexShrink: 0 }}>Matched</span>}
                      <span style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                    </div>
                    <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[r.agency, r.type, r.source].filter((x) => x && x !== "—").join(" · ")}{mobile && r.value !== "—" ? ` · ${r.value}` : ""}
                    </div>
                  </div>
                  {!mobile && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{r.value}</span>}
                  {!mobile && <span style={{ textAlign: "right" }}><FitBadge score={r.fit ?? 0} /></span>}
                  {!mobile && <span style={{ textAlign: "right" }}><DeadlinePill deadline={r.deadline} /></span>}
                  <button onClick={() => openPaste(rowToSeed(r))} aria-label="Score this tender" style={{ width: 28, height: 28, border: `1px solid ${C.rule}`, background: C.white, color: C.ink, cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end" }}>→</button>
                </div>
              ))}
              {!loading && rows.length === 0 && (
                <div style={{ padding: "22px 18px", fontFamily: F.sans, fontSize: 13.5, color: C.mute }}>
                  No tenders match these filters.{" "}
                  {activeCount > 0 && <button onClick={clearAll} style={{ color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}>Clear filters</button>}
                </div>
              )}
            </Card>
          )}
          {hasMore && !error && (
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <Btn kind="ghost" size="sm" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : `Load more (${total - rows.length})`}</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
