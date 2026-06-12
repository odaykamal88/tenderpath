import { notFound } from "next/navigation";
import { AssessmentChrome } from "@/components/assessment/AssessmentChrome";
import { ScoreTab } from "@/components/assessment/ScoreTab";
import { GapsTab } from "@/components/assessment/GapsTab";
import { TendersTab } from "@/components/assessment/TendersTab";
import { GrantsTab } from "@/components/assessment/GrantsTab";
import { NextStepsTab } from "@/components/assessment/NextStepsTab";
import { ReportNextStepCTA } from "@/components/assessment/ReportNextStepCTA";
import { LoadingState } from "@/components/assessment/states/LoadingState";
import { ErrorState } from "@/components/assessment/states/ErrorState";
import { getAssessment, getViewerActivity } from "@/lib/assessment";

export const dynamic = "force-dynamic";

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
    gaps: data.gaps.filter((g) => !g.resolved).length,
    tenders: data.tenders.length,
    grants: data.grants.length,
    next: data.totalSteps,
  };

  // The Activity signal is score-tab-only — skip the DB round-trip on the
  // other tabs. getViewerActivity returns null for anonymous UUID-capability
  // viewers (no tp_session cookie), which also flips the score-tab CTA to the
  // sign-up path and renders the ReportNextStepCTA conversion slab.
  const activity = activeTab === "score" ? await getViewerActivity() : null;

  return (
    <AssessmentChrome
      activeTab={activeTab}
      reportId={data.reportId}
      displayNumber={data.displayNumber}
      companyName={data.companyName}
      preparedAt={data.preparedAt}
      counts={counts}
      // Standalone (anonymous / emailed-link / share-link) view — tab nav
      // stays inside the report URL. The signed-in dashboard variant uses
      // basePath="/dashboard" to preserve its workbench sidebar.
      basePath={`/assessment/${data.reportId}`}
    >
      {activeTab === "score" && (
        <>
          <ScoreTab
            score={data.score}
            delta={data.scoreDelta}
            tier={data.tier}
            summary={data.summary}
            dimensions={data.dimensions}
            topTenders={data.topTenders}
            matchedCount={data.countsByFilter.all}
            recommendedTier={data.recommendedTier}
            activity={activity}
            // PR-K (2026-05-23): non-null activity means tp_session cookie
            // verified — viewer is signed in. Used by ScoreTab to render
            // "Open dashboard →" vs "Sign in →" on the next-step CTA.
            viewerSignedIn={activity !== null}
          />
          {/* Anonymous viewers (no tp_session → activity === null) get the
              conversion slab the post-wizard page used to show: recommended
              paid SKU + save-report sign-up. Signed-in viewers already have
              access, so it's hidden for them. */}
          {activity === null && <ReportNextStepCTA nextStep={data.nextStep} />}
        </>
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
          selectedCountries={data.countries}
        />
      )}
      {activeTab === "grants" && (
        <GrantsTab grants={data.grants} />
      )}
      {activeTab === "next" && (
        <NextStepsTab
          groups={data.nextStepsGroups}
          totalSteps={data.totalSteps}
          projectedDelta={data.projectedDelta}
          assessmentRef={data.reportId}
        />
      )}
    </AssessmentChrome>
  );
}
