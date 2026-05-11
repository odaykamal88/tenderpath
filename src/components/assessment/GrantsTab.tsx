import styles from "./AssessmentTabs.module.css";

export type Grant = {
  funder: string;
  program: string;
  ceiling: string;
  eligibility: string;
  effort: string;
  fit: number;
};

export function GrantsTab({ grants }: { grants: Grant[] }) {
  return (
    <>
      <div className={styles.tableHead}>
        <div>
          <div className={styles.eyebrow}>
            {grants.length} grants · all open · NGO eligible
          </div>
          <h2 className={styles.sectionTitleSmall}>
            Funding programs that match your thesis
          </h2>
        </div>
        <div className={`${styles.eligibilityToggle} tp-mono`}>
          Toggle: <span className={styles.toggleActive}>NGO</span> · Company · Both
        </div>
      </div>

      <div className={`${styles.gridHead} ${styles.grantsGrid}`}>
        <span>Funder</span>
        <span>Program</span>
        <span style={{ textAlign: "right" }}>Ceiling</span>
        <span>Eligibility</span>
        <span style={{ textAlign: "right" }}>Effort</span>
        <span style={{ textAlign: "right" }}>Fit</span>
      </div>
      {grants.map((g) => (
        <div key={g.funder + g.program} className={`${styles.gridRow} ${styles.grantsGrid}`}>
          <span className={styles.funderCell}>{g.funder}</span>
          <span className={styles.cellSecondary}>{g.program}</span>
          <span className={`${styles.ceilingCell} tp-mono`}>{g.ceiling}</span>
          <span className={`${styles.eligCell} tp-mono`}>{g.eligibility}</span>
          <span className={`${styles.effortCell} tp-mono`}>{g.effort}</span>
          <span
            className={`${styles.fitCell} tp-mono`}
            data-strength={g.fit >= 70 ? "strong" : "ok"}
          >
            {g.fit}
          </span>
        </div>
      ))}

      <p className={styles.note}>
        <span className={`${styles.noteTag} tp-mono`}>Note</span>
        Effort = our estimate of proposal lift, not deadline. We track 47 funders
        weekly; switch profile to see private-sector RFPs.
      </p>
    </>
  );
}
