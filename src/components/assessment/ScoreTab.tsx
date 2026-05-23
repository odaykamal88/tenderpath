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
  // PR-N (2026-05-23): added tender_title so the score-tab "Services in
  // flight" card can render "Service · Tender name · Status". Stays
  // optional so older callers / cached responses don't break.
  services: {
    active: {
      id: number;
      service: string;
      status: string;
      tender_title?: string | null;
    }[];
    activeCount: number;
  };
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
  activity,
}: {
  score: number;
  delta: number;
  tier: string;
  summary: string;
  dimensions: Dimension[];
  // PR-K (2026-05-23): `recommendedTier` is still accepted by callers but
  // ignored — the digest "Subscribe →" CTA was removed in favor of a
  // seamless "Sign in" / "Open dashboard" affordance based on the viewer's
  // auth state. Keep the prop accepted so /assessment/[id] + /dashboard
  // can pass it without a type break while we decide what (if any)
  // tier-recommendation surface replaces it.
  recommendedTier?: { name: string; price: string; pitch: string };
  activity?: ViewerActivity | null;
  // PR-N (2026-05-23): same backward-compat treatment as recommendedTier —
  // we removed the "Open Dashboard / Sign in" CTA at the bottom of the
  // aside, so this prop is no longer read. Accept it so callers in
  // /dashboard and /assessment/[id] keep type-checking without a coordinated
  // edit.
  viewerSignedIn?: boolean;
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
        {/* PR-N (2026-05-23): "Your pipeline" card removed entirely — the
            sidebar already exposes pipeline depth, and the empty-state
            for a fresh user was reading as filler. The "Open dashboard /
            Sign in" CTA is also gone: signed-in viewers are already on
            the dashboard. Only "Services in flight" stays, enriched with
            tender title + status. */}
        {activity && (
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
                      {/* PR-N: Service · Tender · Status per spec. Tender
                          title omitted when missing — keeps the row short
                          rather than rendering "Service · — · Status". */}
                      {prettyService(s.service)}
                      {s.tender_title ? <> · <span>{s.tender_title}</span></> : null}
                      {" · "}
                      {prettyStatus(s.status)}
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
        )}
      </aside>
    </div>
  );
}
