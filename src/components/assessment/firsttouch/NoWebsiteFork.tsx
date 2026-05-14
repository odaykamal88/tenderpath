import Link from "next/link";
import styles from "./firsttouch.module.css";

export function NoWebsiteFork() {
  return (
    <div className={styles.fork}>
      <span className={styles.eyebrow}>No website? Three public-data paths in.</span>
      <ul className={styles.forkList}>
        <li>
          <Link href="/assessment/manual" className={styles.forkRow}>
            <span className={styles.forkTitle}>Answer 4 questions</span>
            <span className={styles.forkSub}>~3 min · works for any org</span>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
        <li>
          <Link href="/assessment" className={styles.forkRow}>
            <span className={styles.forkTitle}>Describe your business manually</span>
            <span className={styles.forkSub}>No documents or private financials</span>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
        <li>
          <Link href="/assessment/linkedin" className={styles.forkRow}>
            <span className={styles.forkTitle}>Paste your LinkedIn org URL</span>
            <span className={styles.forkSub}>Public pages only</span>
            <span aria-hidden="true">›</span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
