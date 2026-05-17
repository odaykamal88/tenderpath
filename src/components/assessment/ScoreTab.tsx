import Link from "next/link";
import styles from "./AssessmentTabs.module.css";

export type Dimension = { label: string; value: number };
export type TenderPeek = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  urgent?: boolean;
  sector?: string | null;
  matchReason?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  sourceUrl?: string | null;
};

function peekDotColor(confidence: TenderPeek["confidence"]): string {
  if (confidence === "high") return "var(--tp2-pos, #1f7a4d)";
  if (confidence === "medium") return "var(--tp2-warn, #c08400)";
  if (confidence === "low") return "var(--tp2-neg, #b03030)";
  return "var(--tp2-line, #c8c0b3)";
}

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
        <p className={styles.summary}>{"“"}{summary}{"”"}</p>
      </section>

      <aside>
        <div className={styles.eyebrow}>Peek · top tenders</div>
        <div className={styles.peekTable}>
          {topTenders.map((t) => (
            <div key={t.code} className={styles.peekRow}>
              <div>
                <div className={`${styles.peekMeta} tp-mono`}>
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: peekDotColor(t.confidence),
                      marginRight: 6,
                      verticalAlign: "middle",
                    }}
                  />
                  {t.code} · {t.agency}
                  {t.sector && <> · {t.sector}</>}
                </div>
                <div className={styles.peekTitle}>
                  {t.sourceUrl ? (
                    <a
                      href={t.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "inherit", textDecoration: "none" }}
                    >
                      {t.title} ↗
                    </a>
                  ) : (
                    t.title
                  )}
                </div>
                {t.matchReason && (
                  <div
                    style={{
                      marginTop: 3,
                      fontFamily: "var(--tp2-serif, ui-serif), serif",
                      fontSize: 12,
                      color: "var(--tp2-ink-3, #8a826f)",
                      lineHeight: 1.4,
                    }}
                  >
                    {t.matchReason}
                  </div>
                )}
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
          <Link href="/pay?plan=grants-tenders-matching" className={styles.ctaButton} style={{ display: "inline-block", textDecoration: "none" }}>Subscribe →</Link>
        </div>
      </aside>
    </div>
  );
}
