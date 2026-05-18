import styles from "./AssessmentTabs.module.css";

export type Move = { title: string; why: string; eta: string; cta: string };
export type MoveGroup = { when: string; items: Move[] };

export function NextStepsTab({
  groups,
  totalSteps,
  projectedDelta,
}: {
  groups: MoveGroup[];
  totalSteps: number;
  projectedDelta: number;
}) {
  const empty = totalSteps === 0 || groups.length === 0;
  return (
    <>
      <div className={styles.eyebrow}>
        {empty
          ? "All identified gaps covered — no scheduled remediation"
          : `${totalSteps} step${totalSteps === 1 ? "" : "s"} · sequenced · estimated +${projectedDelta} score`}
      </div>
      <h2 className={styles.sectionTitle}>
        {empty ? "Nothing in the 90-day queue." : "A 90-day plan, not a checklist."}
      </h2>
      {empty ? (
        <p className={styles.nextWhy} style={{ maxWidth: 560 }}>
          We did not detect any open readiness gaps for the next 90 days. If new
          evidence drops out of your vault, or a new assessment surfaces a gap,
          this view will refill automatically.
        </p>
      ) : (
        groups.map((g, i) => (
          <div key={i} className={styles.nextGroup}>
            <span className={`${styles.nextWhen} tp-mono`}>{g.when}</span>
            <ol className={styles.nextItems}>
              {g.items.map((m, j) => (
                <li key={j} className={styles.nextRow}>
                  <span>
                    <div className={styles.nextTitle}>{m.title}</div>
                    <div className={styles.nextWhy}>{m.why}</div>
                  </span>
                  <span className={`${styles.nextEta} tp-mono`}>{m.eta}</span>
                  <button className={styles.rowCta}>{m.cta}</button>
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </>
  );
}
