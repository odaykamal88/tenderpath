import styles from "./states.module.css";

export function PartialState({
  ready,
  total,
  pending,
  children,
}: {
  ready: number;
  total: number;
  pending: string[];
  children: React.ReactNode;
}) {
  return (
    <>
      <div role="status" aria-live="polite" className={styles.partialBanner}>
        <span className={styles.partialDot} />
        <span>
          {ready}/{total} ready · still computing: {pending.join(", ")}
        </span>
      </div>
      {children}
    </>
  );
}
