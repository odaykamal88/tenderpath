/* GET /api/dashboard/workbench — the consolidated Workbench view model.
 *
 * One read that powers the whole redesigned dashboard (Overview, Matches,
 * Gaps + Navigator, Submissions, and the global overlays). It authenticates
 * with the same bearer token the rest of the dashboard uses, then assembles
 * WorkbenchData from real reads: the latest assessment (score/dims/gaps/
 * tenders), the viewer's pipeline counts, their paid work orders, and the
 * vault. Unlike requireDashboardAccess it does NOT 402 a trial-expired user —
 * it returns their data plus an `access.locked` flag so the UI can show the
 * readiness they already have and gate only the premium actions behind a
 * subscribe prompt. */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { evaluateAccess } from "@/lib/access";
import { getFreeSubmissionStatus } from "@/lib/free-submission";
import { newSubscriptionConfigured } from "@/lib/workbench/pricing";
import { loadWorkbenchSource, getViewerActivityForUser } from "@/lib/assessment/data";
import { buildWorkbenchData, emptyWorkbenchData } from "@/lib/workbench/build";
import type { NavigatorCompany } from "@/lib/workbench/navigator";
import type { WbAccess, WbSubmission, WbVaultSummary } from "@/lib/workbench/types";
import type { Gap, MatchedTender, User } from "@/lib/types";

export const dynamic = "force-dynamic";

function serviceTypeLabel(slug: string | null): string {
  switch (slug) {
    case "proposal-draft":
      return "Proposal";
    case "bid-no-bid":
      return "Bid / No-Bid";
    case "roster-fast-track":
      return "Roster";
    default:
      return "Submission";
  }
}

function submissionStatus(genStatus: string | null, rawStatus: string): { status: string; stage: string } {
  if (genStatus === "ready") return { status: "review", stage: "Ready for your review" };
  if (genStatus === "pending" || genStatus === "generating") return { status: "drafting", stage: "In production" };
  if (rawStatus === "delivered") return { status: "submitted", stage: "Delivered" };
  if (rawStatus === "waiting_on_client") return { status: "review", stage: "Awaiting your input" };
  return { status: "drafting", stage: "In production" };
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

// Best-effort: a missing column or table must never 500 the whole dashboard.
async function loadSubmissions(userId: number): Promise<WbSubmission[]> {
  try {
    // Only reference columns we're confident exist across work_orders schema
    // revisions — a missing column would fail the whole query and silently
    // empty the Submissions list. created_at + tender_title + status are stable.
    const rows = await sql`
      SELECT w.id, w.service_slug, w.plan, w.status, w.tender_title, w.created_at,
             (
               SELECT generation_status FROM proposal_packages
               WHERE work_order_id = w.id ORDER BY created_at DESC LIMIT 1
             ) AS gen_status
      FROM work_orders w
      WHERE w.user_id = ${userId}
        AND w.payment_status = 'paid'
        AND w.status NOT IN ('canceled')
      ORDER BY w.created_at DESC
      LIMIT 12
    `;
    return rows.map((r) => {
      const { status, stage } = submissionStatus(
        (r.gen_status as string | null) ?? null,
        String(r.status),
      );
      return {
        id: r.id as number,
        tender: (r.tender_title as string | null) ?? "Untitled tender",
        agency: null,
        type: serviceTypeLabel((r.service_slug as string | null) ?? (r.plan as string | null) ?? null),
        status,
        stage,
        price: null,
        due: null,
        updated: relativeTime((r.created_at as string | null) ?? null),
        href: `/dashboard/work-orders/${r.id}`,
      };
    });
  } catch (err) {
    console.warn("[workbench:submissions:load_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function loadVaultSummary(userId: number, openGapCount: number): Promise<WbVaultSummary> {
  try {
    const rows = await sql`SELECT COUNT(*)::int AS n FROM vault_documents WHERE user_id = ${userId}`;
    const onFile = (rows[0]?.n as number) ?? 0;
    return { onFile, missing: openGapCount, total: onFile + openGapCount };
  } catch {
    return { onFile: 0, missing: openGapCount, total: openGapCount };
  }
}

// Gap indices the user has marked closed in the Navigator (g{idx}-closed in
// assessment_step_completions). These lift the live readiness score and persist
// across reloads. Best-effort — a hiccup just means closes look unmarked.
async function loadAcknowledgedGapIdx(assessmentId: number): Promise<Set<number>> {
  try {
    const rows = await sql`
      SELECT step_key FROM assessment_step_completions
      WHERE assessment_id = ${assessmentId} AND step_key LIKE 'g%-closed'
    `;
    const set = new Set<number>();
    for (const r of rows) {
      const m = String(r.step_key).match(/^g(\d+)-closed$/);
      if (m) set.add(Number(m[1]));
    }
    return set;
  } catch {
    return new Set();
  }
}

export async function GET(request: Request) {
  const user = (await getUserFromRequest(request)) as User | null;
  if (!user) {
    return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
  }

  const accessInfo = evaluateAccess(user);
  // Fail-closed DB read (ensures its own schema) — never blocks the dashboard.
  const freeSubmission = await getFreeSubmissionStatus(user);
  const access: WbAccess = {
    hasAccess: accessInfo.hasAccess,
    reason: accessInfo.reason,
    trialDaysLeft: accessInfo.trialDaysLeft,
    isTrialing: accessInfo.isTrialing,
    locked: !accessInfo.hasAccess,
    isPaid: accessInfo.reason === "subscribed" || accessInfo.reason === "admin",
    freeSubmissionEligible: freeSubmission.eligible,
    newSubscriptionLive: newSubscriptionConfigured(),
  };
  const trialDays = accessInfo.trialDaysLeft;

  const source = await loadWorkbenchSource(user.email);
  if (!source) {
    return NextResponse.json(emptyWorkbenchData({ email: user.email, trialDays, access }));
  }

  const { report, row } = source;

  // Computing / failed assessments don't have a renderable Workbench yet —
  // signal the client to route to the standalone assessment status view.
  if (report.status === "computing" || report.status === "failed") {
    return NextResponse.json(
      emptyWorkbenchData({
        email: user.email,
        trialDays,
        access,
        assessmentStatus: report.status,
        reportId: report.reportId,
      }),
    );
  }

  const [activity, submissions] = await Promise.all([
    getViewerActivityForUser(user.id),
    loadSubmissions(user.id),
  ]);

  const rawGaps = (row.gaps ?? []) as Gap[];
  const rawTenders = (row.matched_tenders ?? []) as MatchedTender[];
  const openGapCount = report.gaps.filter((g) => !g.resolved).length;
  const [vault, acknowledgedIdx] = await Promise.all([
    loadVaultSummary(user.id, openGapCount),
    loadAcknowledgedGapIdx(row.id),
  ]);

  const navCompany: NavigatorCompany = {
    legalName: user.business_name ?? report.companyName,
    regNo: null, // not captured in schema today — Navigator instructs in plain language
    incorporated: null,
    country: report.countries[0] ?? null,
    email: user.email,
  };

  const data = buildWorkbenchData({
    report,
    rawGaps,
    rawTenders,
    navCompany,
    activity,
    submissions,
    vault,
    access,
    trialDays,
    acknowledgedIdx,
  });

  return NextResponse.json(data);
}
