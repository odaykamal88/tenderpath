import styles from "./firsttouch.module.css";

export function NoWebsiteFork() {
  return (
    <div className={styles.fork}>
      <span className={styles.eyebrow}>No website? Three ways in.</span>
      <ul className={styles.forkList}>
        <li>
          <a href="/assessment/manual" className={styles.forkRow}>
            <span className={styles.forkTitle}>Answer 4 questions</span>
            <span className={styles.forkSub}>~3 min · works for any org</span>
            <span aria-hidden="true">›</span>
          </a>
        </li>
        <li>
          <a href="/assessment/upload" className={styles.forkRow}>
            <span className={styles.forkTitle}>Upload a capability statement</span>
            <span className={styles.forkSub}>PDF or DOCX · we extract the rest</span>
            <span aria-hidden="true">›</span>
          </a>
        </li>
        <li>
          <a href="/assessment/linkedin" className={styles.forkRow}>
            <span className={styles.forkTitle}>Paste your LinkedIn org URL</span>
            <span className={styles.forkSub}>Public pages only</span>
            <span aria-hidden="true">›</span>
          </a>
        </li>
      </ul>
    </div>
  );
}
