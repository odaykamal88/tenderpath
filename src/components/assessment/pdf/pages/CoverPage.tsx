import type { ReportData } from "../ReportDocument";
import styles from "./pdf.module.css";

export function CoverPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.cover}`}>
      <header className={styles.coverHead}>
        <span className={styles.brand}>TenderPath</span>
        <span className={styles.coverEyebrow}>Vendor Readiness Report</span>
      </header>
      <div className={styles.coverBody}>
        <span className={styles.coverEyebrow}>Prepared for</span>
        <h1 className={styles.coverTitle}>{data.companyName}</h1>
        <p className={styles.coverSub}>{data.sector}</p>
      </div>
      <div className={styles.coverScore}>
        <div>
          <span className={styles.eyebrow}>Readiness score</span>
          <div className={styles.heroNum}>
            {data.score}<span className={styles.heroDenom}>/100</span>
          </div>
          <span className={styles.tier}>{data.tier}</span>
        </div>
        <div className={styles.coverPath}>
          <span className={styles.eyebrow}>Path to Tier 1</span>
          <p>Three fixes lift you to <strong>+16 points</strong> in 90 days.</p>
        </div>
      </div>
      <footer className={styles.coverFoot}>
        <span>Report No. {data.displayNumber}</span>
        <span>Confidential — internal stakeholders</span>
        <span>{data.preparedAt}</span>
      </footer>
    </section>
  );
}
