import Link from "next/link";
import styles from "./AssessmentChrome.module.css";

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
}: {
  companyName: string;
  reportId: string;
}) {
  return (
    <header className={styles.header}>
      <div>
        <div className={styles.eyebrow}>Vendor readiness · No. {reportId}</div>
        <h1 className={styles.title}>{companyName}</h1>
      </div>
      <nav className={styles.actions}>
        <a href={`/api/report?id=${reportId}`} target="_blank" rel="noopener">PDF ↓</a>
        <button>Email ↗</button>
        <a href="/assessment">Run again →</a>
      </nav>
    </header>
  );
}

export function AssessmentTabs({
  active,
  reportId,
  counts,
}: {
  active: TabKey;
  reportId: string;
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
            href={`/assessment/${reportId}?tab=${t.key}`}
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
  companyName,
  counts,
  children,
}: {
  activeTab: TabKey;
  reportId: string;
  companyName: string;
  counts?: Partial<Record<TabKey, number>>;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.chrome}>
      <AssessmentHeader companyName={companyName} reportId={reportId} />
      <AssessmentTabs active={activeTab} reportId={reportId} counts={counts} />
      <div className={`${styles.tabContent} tp2-tab-panel`}>{children}</div>
    </main>
  );
}

export type { TabKey };
