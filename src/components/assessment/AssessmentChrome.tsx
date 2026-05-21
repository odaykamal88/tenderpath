import Link from "next/link";
import styles from "./AssessmentChrome.module.css";
import { AssessmentActions } from "./AssessmentActions";

type TabKey = "score" | "gaps" | "tenders" | "grants" | "next";

const TABS: { key: TabKey; label: string }[] = [
  { key: "score",   label: "Score" },
  { key: "gaps",    label: "Gaps" },
  { key: "tenders", label: "Tenders" },
  { key: "grants",  label: "Grants" },
  { key: "next",    label: "Next steps" },
];

export function AssessmentHeader({
  companyName,
  reportId,
  displayNumber,
}: {
  companyName: string;
  // UUID — capability identifier used in URLs (resend, PDF, deep links).
  reportId: string;
  // Zero-padded internal number — the human-readable label only.
  displayNumber: string;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerLead}>
        <div className={styles.eyebrow}>Vendor readiness · No. {displayNumber}</div>
        <h1 className={styles.title}>{companyName}</h1>
      </div>
      <nav className={styles.actions}>
        <AssessmentActions reportId={reportId} />
      </nav>
    </header>
  );
}

export function AssessmentTabs({
  active,
  basePath,
  counts,
}: {
  active: TabKey;
  // Audit 2026-05-20 UX: route the tabs back to whichever shell rendered
  // them. /dashboard preserves its sidebar layout when the tab links stay
  // on /dashboard?tab=X. The standalone /assessment/[id] view (used for
  // anonymous + emailed-link traffic) passes its own UUID path. Without
  // this prop both shells would hard-jump to /assessment/[id] and the
  // signed-in user would lose the dashboard sidebar on every tab click.
  basePath: string;
  counts?: Partial<Record<TabKey, number>>;
}) {
  return (
    <div className={styles.tabbar} role="tablist">
      {TABS.map((t) => {
        const count = counts?.[t.key];
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
            role="tab"
            aria-selected={isActive}
          >
            {t.label}
            {count != null && <span className={styles.tabCount}>{count}</span>}
          </Link>
        );
      })}
      <span className={styles.tabFooter}>Filed {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
    </div>
  );
}

export function AssessmentChrome({
  activeTab,
  reportId,
  displayNumber,
  companyName,
  counts,
  basePath,
  children,
}: {
  activeTab: TabKey;
  reportId: string;
  displayNumber: string;
  companyName: string;
  counts?: Partial<Record<TabKey, number>>;
  // Tab-link base. `/dashboard` keeps the signed-in sidebar layout; the
  // standalone /assessment/[id] page passes `/assessment/{uuid}`.
  basePath: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.chrome}>
      <AssessmentHeader companyName={companyName} reportId={reportId} displayNumber={displayNumber} />
      <AssessmentTabs active={activeTab} basePath={basePath} counts={counts} />
      <div className={`${styles.tabContent} tp2-tab-panel`}>{children}</div>
    </main>
  );
}

export type { TabKey };
