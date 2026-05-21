import Link from "next/link";
import styles from "./AssessmentTabs.module.css";

export type Dimension = { label: string; value: number };
// Kept exported for the email-completion template — see src/lib/email/sendAssessment.ts.
// ScoreTab itself no longer renders a top-tenders peek (audit 2026-05-21 UX);
// the Tenders tab and dashboard pipeline cover that intent better.
export type TenderPeek = {
  code: string;
  title: string;
  agency: string;
  fit: number;
  deadline: string;
  urgent?: boolean;
  sector?: string | null;
  matchReason?: string | null;
  confidence?: "high" | "medium" | "low" | null;
  sourceUrl?: string | null;
};

export type ViewerActivity = {
  pipeline: { total: number; applied: number; inProgress: number; saved: number };
  services: { active: { id: number; service: string; status: string }[]; activeCount: number };
};

function prettyService(slug: string): string {
  if (slug === "bid-no-bid") return "Bid-no-bid";
  if (slug === "proposal-draft" || slug === "proposal") return "Proposal draft";
  if (slug === "roster-fast-track" || slug === "lta-roster") return "Roster fast-track";
  if (slug === "grants-tenders-matching" || slug === "digest") return "Tender intelligence";
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyStatus(status: string): string {
  if (status === "new") return "queued";
  if (status === "in_progress") return "in progress";
  if (status === "waiting_on_client") return "waiting on you";
  if (status === "delivered") return "ready";
  return status.replace(/_/g, " ");
}

export function ScoreTab({
  score,
  delta,
  summary,
  dimensions,
  recommendedTier,
  activity,
}: {
  score: number;
  delta: number;
  tier: string;
  summary: string;
  dimensions: Dimension[];
  recommendedTier: { name: string; price: string; pitch: string };
  activity?: ViewerActivity | null;
}) {
  return (
    <div className={styles.scoreGrid}>
      <section>
        <div className={styles.heroRow}>
          <span className={styles.hero}>{score}</span>
          <div>
            <div className={styles.heroDenom}>/100</div>
            <div className={styles.deltaPos}>
              {delta >= 0 ? "↑" : "↓"} {delta >= 0 ? "+" : ""}
              {delta} since last run
            </div>
          </div>
        </div>
        <ul className={styles.dimList}>
          {dimensions.map((d) => (
            <li key={d.label} className={styles.dimRow}>
              <span>{d.label}</span>
              <span className={styles.dimBar}>
                <span
                  style={{
                    width: `${d.value}%`,
                    background:
                      d.value < 60
                        ? "var(--tp2-neg)"
                        : d.value < 75
                        ? "var(--tp2-warn)"
                        : "var(--tp2-ink)",
                  }}
                />
              </span>
              <span className={`${styles.dimVal} tp-mono tp-tabular`}>{d.value}</span>
            </li>
          ))}
        </ul>
        <p className={styles.summary}>{"“"}{summary}{"”"}</p>
      </section>

      <aside>
        {activity && (
          <>
            <div className={styles.activityCard}>
              <div className={styles.activityHead}>
                <span className={styles.eyebrow}>Your pipeline</span>
                <Link href="/dashboard/pipeline" className={styles.activityLink}>
                  View all ↗
                </Link>
              </div>
              <div className={styles.activityCount}>
                <span className={`${styles.activityNumber} tp-tabular`}>{activity.pipeline.total}</span>
                <span className={styles.activityNumberSub}>
                  {activity.pipeline.total === 1 ? "tender tracked" : "tenders tracked"}
                </span>
              </div>
              {activity.pipeline.total > 0 ? (
                <ul className={styles.activityList}>
                  {activity.pipeline.applied > 0 && (
                    <li>
                      <span className={`${styles.activityListNum} tp-tabular`}>{activity.pipeline.applied}</span>{" "}
                      applied
                    </li>
                  )}
                  {activity.pipeline.inProgress > 0 && (
                    <li>
                      <span className={`${styles.activityListNum} tp-tabular`}>{activity.pipeline.inProgress}</span>{" "}
                      in progress
                    </li>
                  )}
                  {activity.pipeline.saved > 0 && (
                    <li>
                      <span className={`${styles.activityListNum} tp-tabular`}>{activity.pipeline.saved}</span>{" "}
                      saved
                    </li>
                  )}
                </ul>
              ) : (
                <p className={styles.activityEmpty}>
                  Save your first tender from the{" "}
                  <Link href="/dashboard?tab=tenders" className={styles.activityLink}>
                    Tenders tab
                  </Link>
                  .
                </p>
              )}
            </div>

            <div className={styles.activityCard}>
              <div className={styles.activityHead}>
                <span className={styles.eyebrow}>Services in flight</span>
                <Link href="/dashboard/work-orders" className={styles.activityLink}>
                  View all ↗
                </Link>
              </div>
              <div className={styles.activityCount}>
                <span className={`${styles.activityNumber} tp-tabular`}>{activity.services.activeCount}</span>
                <span className={styles.activityNumberSub}>
                  {activity.services.activeCount === 1 ? "active" : "active"}
                </span>
              </div>
              {activity.services.active.length > 0 ? (
                <ul className={styles.activityList}>
                  {activity.services.active.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/dashboard/work-orders/${s.id}`}
                        className={styles.activityLink}
                      >
                        {prettyService(s.service)} · {prettyStatus(s.status)}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.activityEmpty}>
                  <Link href="/dashboard/services" className={styles.activityLink}>
                    Buy your first service →
                  </Link>
                </p>
              )}
            </div>
          </>
        )}

        <div className={styles.cta}>
          <div className={styles.eyebrowOnDark}>Recommended</div>
          <div className={styles.ctaTitle}>
            {recommendedTier.name} — {recommendedTier.price}
          </div>
          <p className={styles.ctaPitch}>{recommendedTier.pitch}</p>
          <Link
            href="/pay?plan=grants-tenders-matching"
            className={styles.ctaButton}
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Subscribe →
          </Link>
        </div>
      </aside>
    </div>
  );
}
