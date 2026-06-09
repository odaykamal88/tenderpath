"use client";

import type { CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";

/**
 * CountryFilterPills — country toggles for the Tenders / Grants feeds.
 *
 * When one country dominates a user's matches (e.g. 95% US for a US/UK/Kenya
 * operator), these let them hide it to see the rest. Each pill shows the country
 * + its match count; clicking toggles it OFF. Presentation only — the owning tab
 * holds the excluded-set state and does the filtering. Hidden when there are
 * fewer than two countries: a single-country feed has nothing to filter.
 */
export function CountryFilterPills({
  counts,
  excluded,
  visibleCount,
  totalCount,
  noun,
  onToggle,
  onClear,
}: {
  counts: [string, number][];
  excluded: Set<string>;
  visibleCount: number;
  totalCount: number;
  noun: string;
  onToggle: (country: string) => void;
  onClear: () => void;
}) {
  if (counts.length < 2) return null;
  const anyOff = excluded.size > 0;

  const mono = (extra: CSSProperties = {}): CSSProperties => ({
    fontFamily: F.mono,
    fontSize: 10,
    letterSpacing: "0.06em",
    ...extra,
  });

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "14px 0 4px" }}>
      <span style={mono({ textTransform: "uppercase", color: C.faint, marginRight: 2 })}>Country</span>
      {counts.map(([country, n]) => {
        const off = excluded.has(country);
        return (
          <button
            key={country}
            type="button"
            onClick={() => onToggle(country)}
            aria-pressed={!off}
            title={off ? `Show ${country} ${noun}` : `Hide ${country} ${noun}`}
            style={mono({
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              border: `1px solid ${off ? C.ruleSoft : C.rule}`,
              background: off ? "transparent" : C.white,
              color: off ? C.faint : C.ink2,
              textDecoration: off ? "line-through" : "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
            })}
          >
            {country}
            <span style={{ color: off ? C.faint : C.mute, fontVariantNumeric: "tabular-nums" }}>{n}</span>
          </button>
        );
      })}
      {anyOff && (
        <>
          <button
            type="button"
            onClick={onClear}
            style={mono({
              padding: "5px 10px",
              border: 0,
              background: "none",
              color: C.accent,
              cursor: "pointer",
              textTransform: "uppercase",
              borderBottom: `1px solid ${C.rule}`,
            })}
          >
            Reset
          </button>
          <span style={mono({ color: C.faint })}>
            Showing {visibleCount} of {totalCount}
          </span>
        </>
      )}
    </div>
  );
}
