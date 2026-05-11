import { notFound } from "next/navigation";
import { AssessmentChrome } from "@/components/assessment/AssessmentChrome";
import { ScoreTab } from "@/components/assessment/ScoreTab";
import { GapsTab } from "@/components/assessment/GapsTab";
import { TendersTab } from "@/components/assessment/TendersTab";
import { GrantsTab } from "@/components/assessment/GrantsTab";
import { NextStepsTab } from "@/components/assessment/NextStepsTab";
import { LoadingState } from "@/components/assessment/states/LoadingState";
import { ErrorState } from "@/components/assessment/states/ErrorState";
import { getAssessment, getThisWeek } from "@/lib/assessment";

export const revalidate = 60;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

export default async function AssessmentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tab } = await searchParams;

  const data = await getAssessment(id);
  if (!data) notFound();

  if (data.status === "computing") {
    return <LoadingState companyName={data.companyName} />;
  }

  if (data.status === "failed") {
    return (
      <ErrorState
        errorId={data.errorId ?? id}
        body="Your assessment could not be completed. Please try again or contact support."
        retryHref="/assessment"
      />
    );
  }

  const activeTab = (["score", "gaps", "tenders", "grants", "next"] as const).includes(tab as never)
    ? (tab as "score" | "gaps" | "tenders" | "grants" | "next")
    : "score";

  const counts = {
    gaps: data.gaps.length,
    tenders: data.tenders.length,
    grants: data.grants.length,
    next: data.totalSteps,
  };

  return (
    <AssessmentChrome
      activeTab={activeTab}
      reportId={id}
      companyName={data.companyName}
      counts={counts}
    >
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
      {activeTab === "grants" && (
        <GrantsTab grants={data.grants} />
      )}
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
