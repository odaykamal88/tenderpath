import styles from "./AssessmentTabs.module.css";

export type Dimension = { label: string; value: number };
export type TenderPeek = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  urgent?: boolean;
};

export function ScoreTab({
  score,
  delta,
  tier,
  summary,
  dimensions,
  topTenders,
  recommendedTier,
}: {
  score: number;
  delta: number;
  tier: string;
  summary: string;
  dimensions: Dimension[];
  topTenders: TenderPeek[];
  recommendedTier: { name: string; price: string; pitch: string };
}) {
  return (
    <div className={styles.scoreGrid}>
      <section>
        <div className={styles.heroRow}>
          <span className={styles.hero}>{score}</span>
          <div>
            <div className={styles.heroDenom}>/100</div>
            <div className={styles.deltaPos}>
              {delta >= 0 ? "↑" : "↓"} {delta >= 0 ? "+" : ""}
              {delta} since last run
            </div>
          </div>
        </div>
        <p className={styles.summary}>{summary}</p>
        <ul className={styles.dimList}>
          {dimensions.map((d) => (
            <li key={d.label} className={styles.dimRow}>
              <span>{d.label}</span>
              <span className={styles.dimBar}>
                <span
                  style={{
                    width: `${d.value}%`,
                    background:
                      d.value < 60
                        ? "var(--tp2-neg)"
                        : d.value < 75
                        ? "var(--tp2-warn)"
                        : "var(--tp2-ink)",
                  }}
                />
              </span>
              <span className={`${styles.dimVal} tp-mono tp-tabular`}>{d.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <aside>
        <div className={styles.eyebrow}>Peek · top tenders</div>
        <div className={styles.peekTable}>
          {topTenders.map((t) => (
            <div key={t.code} className={styles.peekRow}>
              <div>
                <div className={`${styles.peekMeta} tp-mono`}>
                  {t.code} · {t.agency}
                </div>
                <div className={styles.peekTitle}>{t.title}</div>
              </div>
              <span className={`${styles.peekFit} tp-mono`}>{t.fit}</span>
              <span
                className={`${styles.peekDl} tp-mono`}
                data-urgent={t.urgent ? "true" : undefined}
              >
                {t.deadline}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.cta}>
          <div className={styles.eyebrowOnDark}>Recommended</div>
          <div className={styles.ctaTitle}>
            {recommendedTier.name} — {recommendedTier.price}
          </div>
          <p className={styles.ctaPitch}>{recommendedTier.pitch}</p>
          <button className={styles.ctaButton}>Subscribe →</button>
        </div>
      </aside>
    </div>
  );
}
