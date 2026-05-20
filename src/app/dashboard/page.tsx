/* /dashboard — D2 tabbed report pinned to the user's latest assessment.
 *
 * Renders the same chrome as /assessment/[id]. Both routes share rowToReport
 * and ThisWeekStrip, so the two URLs converge on identical data and visuals
 * once the user has at least one completed assessment.
 *
 * Forced dynamic so this view and /assessment/[id] cannot diverge on Next.js
 * ISR cache windows when the underlying assessment row mutates.
 */

import Link from "next/link";
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

const SERIF = "'Fraunces', 'Times New Roman', serif";
const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

// Signed-in users with no completed assessment land here. Render an empty
// dashboard state instead of bouncing to /assessment — the dashboard layout
// already supplies sidebar, email, and trial chrome, so the user can see they
// are signed in rather than being dumped on the anonymous landing.
function EmptyDashboard() {
  return (
    <div className="px-6 sm:px-8 py-10 sm:py-14 max-w-[1400px]">
      <p
        className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400 mb-3"
        style={{ fontFamily: MONO }}
      >
        Overview · No assessment yet
      </p>
      <h1
        className="text-[34px] sm:text-[44px] font-medium tracking-tight text-stone-900 leading-[1.05] mb-4"
        style={{ fontFamily: SERIF }}
      >
        Run your first assessment.
      </h1>
      <p className="text-[14.5px] sm:text-[15px] text-stone-600 leading-relaxed max-w-xl mb-8">
        Your dashboard fills in once you complete an assessment — readiness score across five
        dimensions, gap analysis, matched tenders and grants, and a 90-day action plan.
        It takes about five minutes.
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href="/assessment"
          className="inline-flex items-center bg-stone-900 px-6 py-3 text-[13px] font-semibold text-white hover:bg-orange-500 transition-colors"
        >
          Start assessment →
        </Link>
        <span
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          Free · 3 minutes
        </span>
      </div>

      <div className="mt-12 grid sm:grid-cols-3 gap-px bg-stone-200 border border-stone-200 max-w-3xl">
        {[
          { kicker: "01", title: "Score", body: "Five readiness dimensions benchmarked against UN buyer expectations." },
          { kicker: "02", title: "Match", body: "Live tenders and grants ranked by fit for your sectors and country focus." },
          { kicker: "03", title: "Act", body: "A 90-day plan with the gaps to close first and the bids worth pursuing now." },
        ].map((step) => (
          <div key={step.kicker} className="bg-white p-5">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400 mb-2 tabular-nums"
              style={{ fontFamily: MONO }}
            >
              Step {step.kicker}
            </p>
            <p
              className="text-[18px] font-medium text-stone-900 mb-1.5 leading-tight"
              style={{ fontFamily: SERIF }}
            >
              {step.title}
            </p>
            <p className="text-[12.5px] text-stone-600 leading-snug">{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const data = await getCurrentUserAssessment();
  if (!data) return <EmptyDashboard />;
  if (data.status === "computing" || data.status === "failed") {
    redirect(`/assessment/${data.reportId}`);
  }

  const { tab: rawTab } = await searchParams;
  const activeTab: Tab = (["score", "gaps", "tenders", "grants", "next"] as const).includes(
    rawTab as Tab,
  )
    ? (rawTab as Tab)
    : "score";

  // ThisWeekStrip is a score-tab-only ornament — skip the DB round-trip on
  // gaps/tenders/grants/next where it's not rendered.
  const week = activeTab === "score" ? await getThisWeek(data.reportId) : [];

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
      displayNumber={data.displayNumber}
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
      {activeTab === "score" && (
        <>
          <ThisWeekStrip rows={week} />
          <ScoreTab
            score={data.score}
            delta={data.scoreDelta}
            tier={data.tier}
            summary={data.summary}
            dimensions={data.dimensions}
            topTenders={data.topTenders}
            recommendedTier={data.recommendedTier}
          />
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
      {activeTab === "grants" && <GrantsTab grants={data.grants} />}
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
