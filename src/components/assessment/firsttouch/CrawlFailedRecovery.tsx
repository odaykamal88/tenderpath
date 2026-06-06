import Link from "next/link";
import styles from "./firsttouch.module.css";

export function CrawlFailedRecovery({
  url,
  errorId,
  reason,
}: {
  url: string;
  errorId: string;
  reason: "blocked" | "404" | "spa" | "timeout";
}) {
  const reasonCopy = {
    blocked: "Your site blocks crawlers via robots.txt. We'll need an alternate path.",
    "404":   "We couldn't reach that URL. Double-check the address.",
    spa:     "Your site renders client-side; we read the SSR shell only and got little.",
    timeout: "The site took longer than 30s. We bailed out.",
  }[reason];
  return (
    <div className={styles.failed} role="alert">
      <span className={styles.eyebrow}>We tried, didn&apos;t find enough</span>
      <h2 className={styles.failedTitle}>{reasonCopy}</h2>
      <div className={styles.failedMeta}>
        <span>tried</span>
        <code>{url}</code>
        <span>·</span>
        <span>error</span>
        <code>{errorId}</code>
      </div>
      <p className={styles.failedHint}>You can still complete an assessment in three ways:</p>
      <ul className={styles.forkList}>
        <li><Link href="/assessment/manual" className={styles.forkRow}><span className={styles.forkTitle}>Answer 4 questions</span><span className={styles.forkSub}>~3 min</span><span aria-hidden="true">›</span></Link></li>
        <li><Link href="/assessment/upload" className={styles.forkRow}><span className={styles.forkTitle}>Upload a capability statement</span><span className={styles.forkSub}>PDF or DOCX</span><span aria-hidden="true">›</span></Link></li>
        <li><a href={`mailto:help@tenderpath.me?subject=Crawl failed ${errorId}`} className={styles.forkRow}><span className={styles.forkTitle}>Email us — we&apos;ll do it manually</span><span className={styles.forkSub}>1 business day</span><span aria-hidden="true">›</span></a></li>
      </ul>
    </div>
  );
}
