import styles from "./states.module.css";

export function LoadingState({ companyName }: { companyName: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={styles.loading}>
      <span className="tp2-sr-only">Computing readiness score for {companyName}…</span>
      <div className={styles.heroRow}>
        <span className={`tp2-skeleton ${styles.heroBar}`} />
        <div>
          <span className={`tp2-skeleton ${styles.heroDenomBar}`} />
        </div>
      </div>
      <ul className={styles.dimList}>
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className={styles.dimRow}>
            <span className={`tp2-skeleton ${styles.labelBar}`} />
            <span className={`tp2-skeleton ${styles.valueBar}`} />
          </li>
        ))}
      </ul>
      <ol className={styles.checklist}>
        {[
          "Crawled website",
          "Matched 247 tenders",
          "Cross-referenced UNGM",
          "Computing peer benchmark…",
        ].map((step, i) => (
          <li key={i} className={styles.step} data-state={i < 3 ? "done" : "pending"}>
            <span className={styles.stepDot} />
            {step}
          </li>
        ))}
      </ol>
    </div>
  );
}
