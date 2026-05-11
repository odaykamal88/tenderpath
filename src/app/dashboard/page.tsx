import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUserAssessment, getThisWeek } from "@/lib/assessment";
import styles from "@/components/assessment/dashboard.module.css";

export const revalidate = 60;

export default async function DashboardPage() {
  const data = await getCurrentUserAssessment();

  if (!data) redirect("/assessment");
  if (data.status === "computing" || data.status === "failed") {
    redirect(`/assessment/${data.reportId}`);
  }

  const thisWeek = await getThisWeek(data.reportId);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
      {thisWeek.length > 0 && (
        <div className={styles.thisWeek}>
          <span className={styles.eyebrow}>This week</span>
          <ul className={styles.weekList}>
            {thisWeek.map((item, i) => (
              <li key={i} className={styles.weekRow}>
                <span className={styles.weekKind}>{item.kind}</span>
                <span className={styles.weekTitle}>{item.title}</span>
                <span className={styles.weekDue}>{item.due}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {(["score", "gaps", "tenders", "grants", "next"] as const).map((tab) => (
          <Link
            key={tab}
            href={`/assessment/${data.reportId}?tab=${tab}`}
            style={{
              fontFamily: "var(--tp2-mono)",
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--tp2-ink)",
              textDecoration: "none",
              borderBottom: "1px solid var(--tp2-ink)",
              paddingBottom: 2,
            }}
          >
            {tab === "next" ? "Next steps" : tab}
          </Link>
        ))}
      </div>
    </main>
  );
}
