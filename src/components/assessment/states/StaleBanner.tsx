import styles from "./states.module.css";

export function StaleBanner({
  ageDays,
  refreshHref,
  threshold = 7,
}: {
  ageDays: number;
  refreshHref: string;
  threshold?: number;
}) {
  if (ageDays < threshold) return null;
  return (
    <div role="status" className={styles.staleBanner}>
      <span className={styles.staleEyebrow}>Stale</span>
      <span className={styles.staleBody}>
        Your data is {ageDays} days old. Tenders may have closed since then.
      </span>
      <a href={refreshHref} className={styles.staleAction}>Re-run assessment →</a>
    </div>
  );
}
