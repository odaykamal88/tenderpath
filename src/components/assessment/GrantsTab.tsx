"use client";

import { useMemo, useState } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { DeadlinePill, Tag } from "@/components/workbench/ui";
import { CountryFilterPills } from "./CountryFilterPills";

export type Grant = {
  funder: string;
  program: string;
  ceiling: string;
  eligibility: string;
  effort: string;
  fit: number;
  country?: string | null;
  sourceUrl?: string | null;
  // Closing date for the "Closes" column — often null (many grant feeds omit it).
  deadline?: string | null;
  // Honest editorial line (the engine's match reason / description), never a
  // fabricated eligibility verdict.
  note?: string | null;
};

export function GrantsTab({ grants }: { grants: Grant[] }) {
  const mobile = useMedia("(max-width: 860px)");

  // Country filter — hide grants from a dominant funding geography. Many grants
  // are global (no country); those always show. Pills render only when ≥2.
  const countryCounts = useMemo<[string, number][]>(() => {
    const m = new Map<string, number>();
    for (const g of grants) {
      const c = (g.country ?? "").trim();
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [grants]);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const visible = useMemo(
    () => (excluded.size === 0 ? grants : grants.filter((g) => !excluded.has((g.country ?? "").trim()))),
    [grants, excluded],
  );
  const toggleCountry = (c: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const strong = grants.filter((g) => g.fit >= 70).length;
  const cols = "150px 1fr 100px 80px";

  if (grants.length === 0) {
    return (
      <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, maxWidth: 620 }}>
        No grant programmes matched your profile this run. Grants are surfaced when your sectors and
        geography line up with an open funding window — re-run the assessment after adding more
        sectors, or check back as new calls post.
      </p>
    );
  }

  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, maxWidth: 620, margin: "0 0 4px" }}>
        Open grant programmes matched to your profile — by relevance, not keywords. {grants.length}{" "}
        {grants.length === 1 ? "programme" : "programmes"}
        {strong > 0 ? <>, {strong} a strong fit (≥70%).</> : "."}
      </p>

      <CountryFilterPills
        counts={countryCounts}
        excluded={excluded}
        visibleCount={visible.length}
        totalCount={grants.length}
        noun="grants"
        onToggle={toggleCountry}
        onClear={() => setExcluded(new Set())}
      />

      {!mobile && (
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "8px 0", borderBottom: `1px solid ${C.ink}`, fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginTop: 8 }}>
          <span>Funder</span>
          <span>Programme</span>
          <span style={{ textAlign: "right" }}>Ceiling</span>
          <span style={{ textAlign: "right" }}>Closes</span>
        </div>
      )}

      {visible.length === 0 && excluded.size > 0 && (
        <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, margin: "14px 0 0" }}>
          All grants are from countries you&rsquo;ve hidden. Re-enable a country above to see them.
        </p>
      )}

      {visible.map((g, i) => (
        <div
          key={`${g.funder}-${g.program}-${i}`}
          style={{
            display: "grid",
            gridTemplateColumns: mobile ? "1fr auto" : cols,
            gap: mobile ? 10 : 16,
            padding: "14px 0",
            borderBottom: `1px solid ${C.ruleSoft}`,
            alignItems: "baseline",
          }}
        >
          {!mobile && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.ink2, letterSpacing: "0.02em" }}>{g.funder}</span>}
          <div style={{ minWidth: 0, gridColumn: mobile ? "1 / 2" : "auto" }}>
            {mobile && <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginBottom: 2 }}>{g.funder}</div>}
            <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, lineHeight: 1.3 }}>
              {g.sourceUrl ? (
                <a href={g.sourceUrl} target="_blank" rel="noreferrer" style={{ color: C.ink, textDecoration: "none", borderBottom: `1px solid ${C.rule}` }}>
                  {g.program}
                </a>
              ) : (
                g.program
              )}
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, marginTop: 4, lineHeight: 1.5, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              {g.eligibility && <Tag>{g.eligibility}</Tag>}
              <span style={{ fontFamily: F.mono, fontSize: 10, color: g.fit >= 70 ? C.pos : C.mute }}>{g.fit} fit</span>
              {g.note && <span>{g.note}</span>}
            </div>
            {mobile && (
              <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.ink, marginTop: 6 }}>
                {g.ceiling} · <DeadlinePill deadline={g.deadline} />
              </div>
            )}
          </div>
          {!mobile && <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink, textAlign: "right" }}>{g.ceiling}</span>}
          {!mobile && (
            <span style={{ textAlign: "right" }}>
              <DeadlinePill deadline={g.deadline} />
            </span>
          )}
          {mobile && <span />}
        </div>
      ))}

      <p style={{ fontFamily: F.sans, fontSize: 12, color: C.faint, lineHeight: 1.55, margin: "16px 0 0", display: "flex", gap: 8 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, border: `1px solid ${C.ruleSoft}`, padding: "2px 6px", whiteSpace: "nowrap", height: "fit-content" }}>Note</span>
        <span>Fit is how closely the programme matches your sectors and geography — not an eligibility ruling. Confirm each call&rsquo;s own criteria before applying.</span>
      </p>
    </div>
  );
}
