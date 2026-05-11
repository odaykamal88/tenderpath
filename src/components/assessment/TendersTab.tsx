import styles from "./AssessmentTabs.module.css";

export type Tender = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  value: string;
  urgent?: boolean;
};

export function TendersTab({
  tenders,
  filter = "all",
  countsByFilter,
}: {
  tenders: Tender[];
  filter?: "all" | "strong" | "closing";
  countsByFilter: { all: number; strong: number; closing: number };
}) {
  return (
    <>
      <div className={styles.tableHead}>
        <div>
          <div className={styles.eyebrow}>
            {countsByFilter.all} matches · {countsByFilter.strong} strong fit
          </div>
          <h2 className={styles.sectionTitleSmall}>
            Open opportunities matched to your profile
          </h2>
        </div>
        <div className={styles.filterBar}>
          {[
            { key: "all", label: `All ${countsByFilter.all}` },
            { key: "strong", label: `Strong ${countsByFilter.strong}` },
            { key: "closing", label: "Closing soon" },
          ].map((f) => (
            <button
              key={f.key}
              data-active={filter === f.key ? "true" : undefined}
              className={`${styles.filterChip} tp-mono`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.gridHead} ${styles.tendersGrid}`}>
        <span>Reference</span>
        <span>Title</span>
        <span>Agency</span>
        <span style={{ textAlign: "right" }}>Fit</span>
        <span style={{ textAlign: "right" }}>Closes</span>
        <span style={{ textAlign: "right" }}>Action</span>
      </div>
      {tenders.map((t) => (
        <div key={t.code} className={`${styles.gridRow} ${styles.tendersGrid}`}>
          <span className={`${styles.refCell} tp-mono`}>{t.code}</span>
          <span>
            <div>{t.title}</div>
            <div className={`${styles.cellMeta} tp-mono`}>{t.value}</div>
          </span>
          <span className={styles.cellSecondary}>{t.agency}</span>
          <span
            className={`${styles.fitCell} tp-mono tp-tabular`}
            data-strength={
              t.fit >= 75 ? "strong" : t.fit >= 65 ? "ok" : "weak"
            }
          >
            {t.fit}
          </span>
          <span
            className={`${styles.dlCell} tp-mono`}
            data-urgent={t.urgent ? "true" : undefined}
          >
            {t.deadline}
          </span>
          <button className={styles.rowCta}>Open →</button>
        </div>
      ))}
    </>
  );
}
