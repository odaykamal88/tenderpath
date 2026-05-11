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
  return (
    <>
      <div className={styles.eyebrow}>
        {totalSteps} steps · sequenced · estimated +{projectedDelta} score by Q3
      </div>
      <h2 className={styles.sectionTitle}>A 90-day plan, not a checklist.</h2>
      {groups.map((g, i) => (
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
      ))}
    </>
  );
}
