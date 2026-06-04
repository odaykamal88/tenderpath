"use client";

import styles from "./AssessmentTabs.module.css";

/**
 * CountryFilterPills — oval country toggles for the Tenders / Grants feeds.
 *
 * When one country dominates a user's matches (e.g. 95% US for a US/UK/Kenya
 * operator), these let them hide that country to see the rest. Each pill shows
 * the country + its match count; clicking toggles it OFF (excluded). Presentation
 * only — the owning tab holds the excluded-set state and does the filtering.
 *
 * Hidden entirely when there are fewer than two countries to choose between: a
 * single-country (or country-less) feed has nothing to filter.
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
  // [country, matchCount][], caller-sorted (most common first).
  counts: [string, number][];
  excluded: Set<string>;
  visibleCount: number;
  totalCount: number;
  // "tenders" | "grants" — used in the toggle tooltips only.
  noun: string;
  onToggle: (country: string) => void;
  onClear: () => void;
}) {
  if (counts.length < 2) return null;
  const anyOff = excluded.size > 0;

  return (
    <div className={styles.countryFilter}>
      <span className={`${styles.countryFilterLabel} tp-mono`}>Country</span>
      {counts.map(([country, n]) => {
        const off = excluded.has(country);
        return (
          <button
            key={country}
            type="button"
            onClick={() => onToggle(country)}
            data-off={off ? "true" : undefined}
            aria-pressed={!off}
            title={off ? `Show ${country} ${noun}` : `Hide ${country} ${noun}`}
            className={`${styles.countryPill} tp-mono`}
          >
            {country}
            <span className={styles.countryPillCount}>{n}</span>
          </button>
        );
      })}
      {anyOff && (
        <>
          <button
            type="button"
            onClick={onClear}
            className={`${styles.countryPillClear} tp-mono`}
          >
            Reset
          </button>
          <span className={`${styles.countryFilterShowing} tp-mono`}>
            Showing {visibleCount} of {totalCount}
          </span>
        </>
      )}
    </div>
  );
}
