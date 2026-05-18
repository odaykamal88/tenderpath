/* /dashboard — D2 tabbed report pinned to the user's latest assessment.
 *
 * Renders the same chrome as /assessment/[id]. Both routes share rowToReport
 * and ThisWeekStrip, so the two URLs converge on identical data and visuals
 * once the user has at least one completed assessment.
 *
 * Forced dynamic so this view and /assessment/[id] cannot diverge on Next.js
 * ISR cache windows when the underlying assessment row mutates.
 */

import { redirect } from "next/navigation";
import { AssessmentChrome } from "@/components/assessment/AssessmentChrome";
import { ScoreTab } from "@/components/assessment/ScoreTab";
import { GapsTab } from "@/components/assessment/GapsTab";
import { TendersTab } from "@/components/assessment/TendersTab";
import { GrantsTab } from "@/components/assessment/GrantsTab";
import { NextStepsTab } from "@/components/assessment/NextStepsTab";
import { ThisWeekStrip } from "@/components/assessment/ThisWeekStrip";
import { FunnelBeacon } from "@/components/telemetry/FunnelBeacon";
import { getCurrentUserAssessment, getThisWeek } from "@/lib/assessment";

export const dynamic = "force-dynamic";

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
    gaps: data.gaps.filter((g) => !g.resolved).length,
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
      <ThisWeekStrip rows={week} />

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
          groups={data.nextStepsGroups}
          totalSteps={data.totalSteps}
          projectedDelta={data.projectedDelta}
        />
      )}
    </AssessmentChrome>
  );
}
