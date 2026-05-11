import styles from "./states.module.css";

export function EmptyState({
  what,
  why,
  unlocks,
}: {
  what: string;
  why: string;
  unlocks: { label: string; impact: string; href: string }[];
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyEyebrow}>0 {what}</div>
      <h2 className={styles.emptyTitle}>{why}</h2>
      <ul className={styles.unlockList}>
        {unlocks.map((u, i) => (
          <li key={i}>
            <a href={u.href} className={styles.unlockRow}>
              <span className={styles.unlockLabel}>{u.label}</span>
              <span className={styles.unlockImpact}>{u.impact}</span>
              <span aria-hidden="true">›</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
