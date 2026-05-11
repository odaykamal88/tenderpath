import styles from "./states.module.css";

export function ErrorState({
  errorId,
  title = "We couldn't compute your score.",
  body,
  retryHref,
}: {
  errorId: string;
  title?: string;
  body: string;
  retryHref: string;
}) {
  return (
    <div role="alert" className={styles.error}>
      <div className={styles.errorEyebrow}>Error</div>
      <h2 className={styles.errorTitle}>{title}</h2>
      <p className={styles.errorBody}>{body}</p>
      <div className={styles.errorMeta}>
        <span>error_id</span>
        <code className={styles.errorId}>{errorId}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(errorId)}
          className={styles.copyBtn}
        >
          Copy
        </button>
      </div>
      <div className={styles.errorActions}>
        <a href={retryHref} className={styles.primaryBtn}>Try again</a>
        <a href="mailto:support@tenderpath.me" className={styles.secondaryBtn}>Email support</a>
      </div>
    </div>
  );
}
