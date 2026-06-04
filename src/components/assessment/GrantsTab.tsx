"use client";

import { useMemo, useState } from "react";
import styles from "./AssessmentTabs.module.css";
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
};

export function GrantsTab({ grants }: { grants: Grant[] }) {
  // Country filter — hide grants from a dominant funding geography to see the
  // rest. Many grants are global (no country); those always show. Pills only
  // render when ≥2 countries are present.
  const countryCounts = useMemo<[string, number][]>(() => {
    const m = new Map<string, number>();
    for (const g of grants) {
      const c = (g.country ?? "").trim();
      if (c) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [grants]);
  const [excludedCountries, setExcludedCountries] = useState<Set<string>>(() => new Set());
  const visibleGrants = useMemo(
    () =>
      excludedCountries.size === 0
        ? grants
        : grants.filter((g) => !excludedCountries.has((g.country ?? "").trim())),
    [grants, excludedCountries],
  );
  const toggleCountry = (c: string) =>
    setExcludedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <>
      <div className={styles.tableHead}>
        <div>
          <div className={styles.eyebrow}>
            {grants.length} grants · all open · NGO eligible
          </div>
          <h2 className={styles.sectionTitleSmall}>
            Funding programs that match your thesis
          </h2>
        </div>
        <div className={`${styles.eligibilityToggle} tp-mono`}>
          Toggle: <span className={styles.toggleActive}>NGO</span> · Company · Both
        </div>
      </div>

      <CountryFilterPills
        counts={countryCounts}
        excluded={excludedCountries}
        visibleCount={visibleGrants.length}
        totalCount={grants.length}
        noun="grants"
        onToggle={toggleCountry}
        onClear={() => setExcludedCountries(new Set())}
      />

      <div className={`${styles.gridHead} ${styles.grantsGrid}`}>
        <span>Funder</span>
        <span>Program</span>
        <span style={{ textAlign: "right" }}>Ceiling</span>
        <span>Eligibility</span>
        <span style={{ textAlign: "right" }}>Effort</span>
        <span style={{ textAlign: "right" }}>Fit</span>
      </div>
      {visibleGrants.length === 0 && excludedCountries.size > 0 && (
        <p className={styles.note}>
          <span className={`${styles.noteTag} tp-mono`}>Filtered</span>
          All grants are from countries you&rsquo;ve hidden. Re-enable a country above to see them.
        </p>
      )}
      {visibleGrants.map((g) => (
        <div key={g.funder + g.program} className={`${styles.gridRow} ${styles.grantsGrid}`}>
          <span className={styles.funderCell}>{g.funder}</span>
          <span className={styles.cellSecondary}>
            {g.sourceUrl ? (
              <a
                href={g.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className={styles.titleLink}
              >
                {g.program}
              </a>
            ) : (
              g.program
            )}
          </span>
          <span className={`${styles.ceilingCell} tp-mono`}>{g.ceiling}</span>
          <span className={`${styles.eligCell} tp-mono`}>{g.eligibility}</span>
          <span className={`${styles.effortCell} tp-mono`}>{g.effort}</span>
          <span
            className={`${styles.fitCell} tp-mono`}
            data-strength={g.fit >= 70 ? "strong" : "ok"}
          >
            {g.fit}
          </span>
        </div>
      ))}

      <p className={styles.note}>
        <span className={`${styles.noteTag} tp-mono`}>Note</span>
        Effort = our estimate of proposal lift, not deadline. We track 47 funders
        weekly; switch profile to see private-sector RFPs.
      </p>
    </>
  );
}
