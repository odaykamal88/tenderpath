import styles from "./AssessmentTabs.module.css";

export type Gap = {
  severity: "High" | "Med" | "Low";
  title: string;
  why: string;
  fix: string;
  /** True when the user's vault carries evidence that maps to this gap. */
  resolved?: boolean;
  // Sprint 24 (audit 2026-05-20 UX): per-gap projected score uplift +
  // step-completion progress sourced from assessment_step_completions.
  // potentialDelta is the headline number (`+N pts`); stepsCount/stepsDone
  // drive the `X of Y steps done` subtitle. The CTA-button column was
  // dropped — the action items now live in the Next Steps tab as toggleable
  // to-dos that sync into this view via stepsDone.
  potentialDelta: number;
  stepsCount: number;
  stepsDone: number;
};

export function GapsTab({
  gaps,
  scoreToday,
  scoreImpact,
  ceiling = 85,
}: {
  gaps: Gap[];
  scoreToday: number;
  scoreImpact: { label: string; delta: number; projected: number }[];
  ceiling?: number;
}) {
  return (
    <div className={styles.gapsGrid}>
      <section>
        <div className={styles.eyebrow}>
          {(() => {
            const open = gaps.filter((g) => !g.resolved).length;
            const done = gaps.length - open;
            if (open === 0) {
              return `${gaps.length} gap${gaps.length === 1 ? "" : "s"} · all covered by your vault`;
            }
            return done > 0
              ? `${open} open · ${done} covered · ~${Math.max(7, open * 2)} days to close`
              : `${open} gap${open === 1 ? "" : "s"} · estimated ${Math.max(7, open * 2)} days to close`;
          })()}
        </div>
        <h2 className={styles.sectionTitle}>
          {gaps.filter((g) => !g.resolved).length === 0
            ? "Compliance handled — focus on bids."
            : "Compliance is the only thing between you and Tier 1."}
        </h2>
        <ol className={styles.gapList}>
          {gaps.map((g, i) => {
            const allStepsDone = g.stepsCount > 0 && g.stepsDone >= g.stepsCount;
            return (
              <li key={i} className={styles.gapRow} data-resolved={g.resolved ? "true" : undefined}>
                <span
                  className={`${styles.sev} ${
                    g.resolved
                      ? styles.sevDone
                      : g.severity === "High"
                      ? styles.sevHigh
                      : g.severity === "Med"
                      ? styles.sevMed
                      : styles.sevLow
                  }`}
                >
                  {g.resolved ? "Done" : g.severity}
                </span>
                <div>
                  <div className={styles.gapTitle}>{g.title}</div>
                  <p className={styles.gapWhy}>{g.why}</p>
                  <div className={`${styles.gapFix} tp-mono`}>{g.fix}</div>
                </div>
                {g.resolved ? (
                  <span
                    className={styles.gapResolved}
                    aria-label="Evidence on file"
                    title="Evidence on file in your vault"
                  >
                    ✓
                  </span>
                ) : (
                  <div className={styles.gapPotential}>
                    <div
                      className={`${styles.gapPotentialDelta} tp-mono`}
                      data-state={allStepsDone ? "ready" : undefined}
                    >
                      +{g.potentialDelta} pts
                    </div>
                    {g.stepsCount > 0 && (
                      <div className={`${styles.gapPotentialProgress} tp-mono`}>
                        {allStepsDone
                          ? "Steps done ✓"
                          : `${g.stepsDone} of ${g.stepsCount} ${g.stepsCount === 1 ? "step" : "steps"}`}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <aside>
        <div className={styles.eyebrow}>Score impact</div>
        <div className={styles.impactCard}>
          <div className={styles.impactRow}>
            <span>Today</span>
            <span className="tp-mono">{scoreToday}</span>
          </div>
          {scoreImpact.map((s) => (
            <div key={s.label} className={styles.impactRow}>
              <span>{s.label}</span>
              <span className={`${styles.impactDelta} tp-mono`}>
                +{s.delta} → {s.projected}
              </span>
            </div>
          ))}
          <div className={styles.impactCeiling}>
            <span>Tier 1 ceiling</span>
            <span className="tp-mono">≥ {ceiling}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
