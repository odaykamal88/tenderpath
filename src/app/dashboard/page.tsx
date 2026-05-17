/* /dashboard — D2 tabbed report pinned to the user's latest assessment.
 *
 * Same five-tab chrome as /assessment/[id], with a "This week" dark strip pinned
 * above the tabs for the closest tender/grant deadlines. If the user has no
 * assessment yet, redirect to /assessment so they can run one.
 */

import { redirect } from "next/navigation";
import { AssessmentChrome } from "@/components/assessment/AssessmentChrome";
import { ScoreTab } from "@/components/assessment/ScoreTab";
import { GapsTab } from "@/components/assessment/GapsTab";
import { TendersTab } from "@/components/assessment/TendersTab";
import { GrantsTab } from "@/components/assessment/GrantsTab";
import { NextStepsTab } from "@/components/assessment/NextStepsTab";
import { FunnelBeacon } from "@/components/telemetry/FunnelBeacon";
import { getCurrentUserAssessment, getThisWeek } from "@/lib/assessment";
import { safeUrl } from "@/lib/url";
import dashStyles from "@/components/assessment/dashboard.module.css";

export const revalidate = 60;

type Tab = "score" | "gaps" | "tenders" | "grants" | "next";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const data = await getCurrentUserAssessment();
  if (!data) redirect("/assessment");
  if (data.status === "computing" || data.status === "failed") {
    redirect(`/assessment/${data.reportId}`);
  }

  const { tab: rawTab } = await searchParams;
  const activeTab: Tab = (["score", "gaps", "tenders", "grants", "next"] as const).includes(
    rawTab as Tab,
  )
    ? (rawTab as Tab)
    : "score";

  const week = await getThisWeek(data.reportId);

  const counts = {
    gaps: data.gaps.length,
    tenders: data.tenders.length,
    grants: data.grants.length,
    next: data.totalSteps,
  };

  return (
    <AssessmentChrome
      activeTab={activeTab}
      reportId={data.reportId}
      companyName={data.companyName}
      counts={counts}
    >
      <FunnelBeacon
        event="dashboard_landed"
        props={{
          report_id: data.reportId,
          score: data.score,
          tab: activeTab,
          tier: data.tier,
        }}
      />
      {week.length > 0 && (
        <section className={dashStyles.thisWeek} aria-label="This week">
          <span className={dashStyles.eyebrow}>This week</span>
          <ul className={dashStyles.weekList}>
            {week.map((row, i) => {
              const externalUrl = safeUrl(row.url);
              const href = externalUrl || `/pay?plan=grants-tenders-matching`;
              return (
                <li key={i} className={dashStyles.weekRow}>
                  <a
                    href={href}
                    target={externalUrl ? "_blank" : undefined}
                    rel={externalUrl ? "noopener noreferrer" : undefined}
                    className={dashStyles.weekRowLink}
                  >
                    <span className={dashStyles.weekKind}>{row.kind}</span>
                    <span className={dashStyles.weekTitle}>{row.title}</span>
                    <span className={dashStyles.weekDue}>{row.due} ↗</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeTab === "score" && (
        <ScoreTab
          score={data.score}
          delta={data.scoreDelta}
          tier={data.tier}
          summary={data.summary}
          dimensions={data.dimensions}
          topTenders={data.topTenders}
          recommendedTier={data.recommendedTier}
        />
      )}
      {activeTab === "gaps" && (
        <GapsTab
          gaps={data.gaps}
          scoreToday={data.score}
          scoreImpact={data.scoreImpact}
        />
      )}
      {activeTab === "tenders" && (
        <TendersTab
          tenders={data.tenders}
          countsByFilter={data.countsByFilter}
        />
      )}
      {activeTab === "grants" && <GrantsTab grants={data.grants} />}
      {activeTab === "next" && (
        <NextStepsTab
          groups={[]}
          totalSteps={data.totalSteps}
          projectedDelta={data.projectedDelta}
        />
      )}
    </AssessmentChrome>
  );
}
