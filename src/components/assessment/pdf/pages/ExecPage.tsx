import type { ReportData } from "../ReportDocument";
import styles from "./pdf.module.css";

export function ExecPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>02 · Executive summary</span>
      <h2 className={styles.h2}>You&apos;re in the top quartile of {data.sector}. Three closures unlock UN-tier work.</h2>
      <div className={styles.metricStrip}>
        {[
          [`${data.score} / 100`, "Readiness", `${data.scoreDelta >= 0 ? "+" : ""}${data.scoreDelta} since last run`],
          ["+16", "90-day uplift", "if 3 fixes are completed"],
          ["18 → 41", "Eligible tenders", "12-mo horizon, after fixes"],
        ].map(([big, lab, sub], i) => (
          <div key={i} className={styles.metricCell}>
            <div className={styles.metricBig}>{big}</div>
            <div className={styles.metricLab}>{lab}</div>
            <div className={styles.metricSub}>{sub}</div>
          </div>
        ))}
      </div>
      <span className={styles.subEyebrow}>The three fixes — in order of impact</span>
      <ol className={styles.fixList}>
        {data.gaps.slice(0, 3).map((g, i) => (
          <li key={i}>
            <span className={styles.fixNum}>0{i + 1}</span>
            <div>
              <div className={styles.fixTitle}>{g.title}</div>
              <div className={styles.fixMeta}>+{g.lift} · {g.effort}</div>
              <div className={styles.fixWhy}>{g.unlock}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
