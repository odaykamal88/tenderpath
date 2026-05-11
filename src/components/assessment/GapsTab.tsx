import styles from "./AssessmentTabs.module.css";

export type Gap = {
  severity: "High" | "Med" | "Low";
  title: string;
  why: string;
  fix: string;
  cta: string;
};

export function GapsTab({
  gaps,
  scoreToday,
  scoreImpact,
  ceiling = 85,
}: {
  gaps: Gap[];
  scoreToday: number;
  scoreImpact: { label: string; delta: number; projected: number }[];
  ceiling?: number;
}) {
  return (
    <div className={styles.gapsGrid}>
      <section>
        <div className={styles.eyebrow}>
          {gaps.length} gaps · estimated 14 days to close
        </div>
        <h2 className={styles.sectionTitle}>
          Compliance is the only thing between you and Tier 1.
        </h2>
        <ol className={styles.gapList}>
          {gaps.map((g, i) => (
            <li key={i} className={styles.gapRow}>
              <span
                className={`${styles.sev} ${
                  g.severity === "High"
                    ? styles.sevHigh
                    : g.severity === "Med"
                    ? styles.sevMed
                    : styles.sevLow
                }`}
              >
                {g.severity}
              </span>
              <div>
                <div className={styles.gapTitle}>{g.title}</div>
                <p className={styles.gapWhy}>{g.why}</p>
                <div className={`${styles.gapFix} tp-mono`}>{g.fix}</div>
              </div>
              <button className={styles.rowCta}>{g.cta}</button>
            </li>
          ))}
        </ol>
      </section>

      <aside>
        <div className={styles.eyebrow}>Score impact</div>
        <div className={styles.impactCard}>
          <div className={styles.impactRow}>
            <span>Today</span>
            <span className="tp-mono">{scoreToday}</span>
          </div>
          {scoreImpact.map((s) => (
            <div key={s.label} className={styles.impactRow}>
              <span>{s.label}</span>
              <span className={`${styles.impactDelta} tp-mono`}>
                +{s.delta} → {s.projected}
              </span>
            </div>
          ))}
          <div className={styles.impactCeiling}>
            <span>Tier 1 ceiling</span>
            <span className="tp-mono">≥ {ceiling}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
