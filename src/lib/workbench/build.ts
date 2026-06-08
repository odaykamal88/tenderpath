/* Assemble WorkbenchData from real backend reads.
 *
 * Pure mapping: takes the already-mapped AssessmentReport (score, dimensions,
 * gap-resolution, decoded tenders) plus the raw Gap[] / MatchedTender[] (for
 * action_steps, opportunity_type/source, opportunity_bucket) and the viewer's
 * pipeline/submissions/access, and produces the single WorkbenchData contract
 * the UI consumes. Nothing here invents data — every field traces to a read. */

import type { Gap, MatchedTender } from "@/lib/types";
import type { AssessmentReport, ViewerActivity } from "@/lib/assessment/data";
import { buildNavigatorScript, gapKey, effortLabel, type NavigatorCompany } from "./navigator";
import type {
  BucketKey,
  WbAccess,
  WbGap,
  WbMatch,
  WbNextMove,
  WbPipeline,
  WbSubmission,
  WbVaultSummary,
  WorkbenchData,
} from "./types";

const DAY = 86_400_000;
function daysUntil(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAY);
}
function isSoon(d: string | null): boolean {
  const x = daysUntil(d);
  return x != null && x >= 0 && x <= 7;
}

function deriveBucket(fit: number, soon: boolean, roster: boolean): BucketKey {
  if (soon && fit >= 45) return "act_now";
  if (fit >= 75) return "strong_fit";
  if (roster) return "strategic";
  if (fit >= 45) return "adjacent";
  return "watchlist";
}

function inferType(title: string): string {
  const s = title.toLowerCase();
  if (/\brfp\b/.test(s)) return "Request for Proposal";
  if (/\bitb\b/.test(s)) return "Invitation to Bid";
  if (/\brfq\b/.test(s)) return "Request for Quotation";
  if (/\beoi\b/.test(s)) return "Expression of Interest";
  if (/\blta\b|framework|long.?term agreement/.test(s)) return "LTA / Framework";
  if (/grant/.test(s)) return "Grant";
  return "Tender";
}

function mapMatches(report: AssessmentReport, raw: MatchedTender[]): WbMatch[] {
  return report.tenders.map((t, i) => {
    const r = raw[i] ?? ({} as MatchedTender);
    const proc = r.structured_reasons?.procurement;
    const type = r.opportunity_type ?? proc?.opportunityType ?? inferType(t.title);
    const source = r.source_name ?? proc?.sourceName ?? t.sourceUrl ?? "—";
    const soon = isSoon(t.deadline);
    const roster =
      r.jv_allowed === true ||
      /\blta\b|framework|roster|long.?term agreement/i.test(`${type} ${t.title}`) ||
      t.registration != null;
    const sectors =
      r.structured_reasons?.matchedSectors && r.structured_reasons.matchedSectors.length > 0
        ? r.structured_reasons.matchedSectors.slice(0, 4)
        : t.sector
          ? [t.sector]
          : [];
    const why =
      (t.matchReasons ?? []).slice(0, 2).join(" ") || t.decisionHeadline || "Matched on your profile.";
    return {
      id: r.id ?? i,
      tenderId: typeof r.id === "number" ? r.id : null,
      code: t.code,
      title: t.title,
      agency: t.agency,
      type,
      source: typeof source === "string" ? source : "—",
      deadline: t.deadline ?? null,
      value: t.value,
      fit: t.fit,
      bucket: (r.opportunity_bucket as BucketKey | undefined) ?? deriveBucket(t.fit, soon, roster),
      why,
      sectors,
      roster,
      caveat: (t.caveats ?? [])[0] ?? null,
      sourceUrl: t.sourceUrl,
    };
  });
}

function mapGaps(report: AssessmentReport, raw: Gap[], navCompany: NavigatorCompany): WbGap[] {
  const seen = new Set<string>();
  return report.gaps.map((g, i) => {
    const rawGap: Gap =
      raw[i] ?? { gap: g.title, fix: g.why, action_steps: [], severity: "medium", upsell_tier: "tender-intelligence" };
    const id = gapKey(rawGap, i, seen);
    const script = buildNavigatorScript(rawGap, navCompany);
    const severity = g.severity === "High" ? "high" : g.severity === "Med" ? "medium" : "low";
    const stepKeys = Array.from({ length: Math.max(1, g.stepsCount) }, (_, j) => `g${i}-s${j}`);
    return {
      id,
      severity,
      status: g.resolved ? "covered" : "open",
      impact: g.resolved ? 0 : g.potentialDelta,
      eta: effortLabel(script, rawGap.severity),
      title: g.title,
      why: g.why,
      fixLabel: severity === "high" ? "Walk me through it" : script.kind === "review" ? "Review" : "Fix it",
      stepKeys,
      stepsDone: g.stepsDone,
      copilot: script,
    };
  });
}

function buildPipeline(report: AssessmentReport, activity: ViewerActivity | null): WbPipeline {
  const matched = report.tenders.length;
  const strong = report.tenders.filter((t) => t.fit >= 70).length;
  const dueSoon = report.tenders.filter((t) => isSoon(t.deadline)).length;
  const active = activity?.pipeline.inProgress ?? 0;
  const submitted = activity?.pipeline.applied ?? 0;
  const total = Math.max(activity?.pipeline.total ?? 0, matched);
  return { matched, strong, active, submitted, dueSoon, total };
}

function deriveNextMove(
  report: AssessmentReport,
  gaps: WbGap[],
  matches: WbMatch[],
  submissions: WbSubmission[],
): WbNextMove | null {
  if (matches.length === 0 && gaps.every((g) => g.status === "covered")) return null;

  const openGaps = gaps.filter((g) => g.status === "open");
  const topGap = openGaps.find((g) => g.severity === "high") ?? openGaps[0] ?? null;
  const urgentMatch = matches.find((m) => isSoon(m.deadline)) ?? null;
  const topMatch = matches[0] ?? null;

  // "Then this week" — derived, de-duplicated, capped at 3.
  const thenThisWeek: WbNextMove["thenThisWeek"] = [];
  for (const m of matches.filter((m) => isSoon(m.deadline)).slice(0, 2)) {
    const d = daysUntil(m.deadline);
    thenThisWeek.push({
      label: `Run bid / no-bid on ${m.title}`,
      meta: d != null ? `closes ${d}d` : "closing",
      action: { kind: "paste", matchId: m.id },
    });
  }
  const review = submissions.find((s) => /review|waiting/i.test(s.status));
  if (review) {
    thenThisWeek.push({
      label: `Review your ${review.tender} draft`,
      meta: "ready",
      action: { kind: "route", to: "proposals" },
    });
  }
  for (const g of openGaps) {
    if (thenThisWeek.length >= 3) break;
    thenThisWeek.push({
      label: `Close: ${g.title}`,
      meta: g.eta,
      action: { kind: "navigator", gapId: g.id },
    });
  }

  const eyebrow = "Your next move · decided for you";
  let title: string;
  let body: string;
  let primary: WbNextMove["primary"];
  let secondary: WbNextMove["secondary"];

  if (topGap) {
    title = topGap.id === "ungm" ? "Register on UNGM — it unblocks your matches." : `Close your top blocker: ${topGap.title}`;
    body =
      `${topGap.why} ` +
      (topGap.impact > 0 ? `Clearing it lifts your readiness by about +${topGap.impact} points` : "Clearing it strengthens your eligibility") +
      (topMatch ? ` and strengthens your bid on ${topMatch.title} (${topMatch.fit}% fit).` : ".");
    primary = { label: "Start with the Navigator →", action: { kind: "navigator", gapId: topGap.id } };
    secondary = topMatch
      ? { label: "See the tender", action: { kind: "route", to: "matches" } }
      : { label: "See all gaps", action: { kind: "route", to: "gaps" } };
  } else if (urgentMatch) {
    const d = daysUntil(urgentMatch.deadline);
    title = `Decide on ${urgentMatch.title}`;
    body = `Your strongest near-term match closes ${d != null ? `in ${d} days` : "soon"} at ${urgentMatch.fit}% fit. Run the bid / no-bid call now, then commit or archive.`;
    primary = { label: "Run bid / no-bid →", action: { kind: "paste", matchId: urgentMatch.id } };
    secondary = { label: "See the tender", action: { kind: "route", to: "matches" } };
  } else if (topMatch && topMatch.fit >= 70) {
    title = `Move on ${topMatch.title}`;
    body = `Strong fit at ${topMatch.fit}%. Move it from shortlist to a submission while the deadline is comfortable.`;
    primary = { label: "Start a proposal →", action: { kind: "route", to: "proposals" } };
    secondary = { label: "Run bid / no-bid", action: { kind: "paste", matchId: topMatch.id } };
  } else {
    title = "Review your matched tenders";
    body = "No urgent blockers right now. Scan your ranked matches and qualify the ones worth pursuing.";
    primary = { label: "See your matches →", action: { kind: "route", to: "matches" } };
    secondary = null;
  }

  return { eyebrow, title, body, primary, secondary, thenThisWeek: thenThisWeek.slice(0, 3) };
}

export function buildWorkbenchData(input: {
  report: AssessmentReport;
  rawGaps: Gap[];
  rawTenders: MatchedTender[];
  navCompany: NavigatorCompany;
  activity: ViewerActivity | null;
  submissions: WbSubmission[];
  vault: WbVaultSummary;
  access: WbAccess;
  trialDays: number;
}): WorkbenchData {
  const { report, rawGaps, rawTenders, navCompany, activity, submissions, vault, access, trialDays } = input;

  const matches = mapMatches(report, rawTenders);
  const gaps = mapGaps(report, rawGaps, navCompany);
  const pipeline = buildPipeline(report, activity);
  const nextMove = deriveNextMove(report, gaps, matches, submissions);

  return {
    hasAssessment: true,
    assessmentStatus: report.status,
    reportId: report.reportId,
    company: {
      name: report.companyName,
      fileNo: report.displayNumber,
      sector: report.sector,
      country: report.countries.join(" · ") || (navCompany.country ?? ""),
      user: navCompany.email ?? "",
      trialDays,
    },
    readiness: {
      score: report.score,
      delta: report.scoreDelta,
      tier: report.tier,
      dims: report.dimensions.map((d) => [d.label, d.value] as [string, number]),
      line: report.summary,
    },
    pipeline,
    nextMove,
    gaps,
    matches,
    submissions,
    vault,
    access,
  };
}

/** Empty-state payload for a signed-in user with no completed assessment. */
export function emptyWorkbenchData(input: {
  email: string;
  trialDays: number;
  access: WbAccess;
  assessmentStatus?: "computing" | "failed" | null;
  reportId?: string | null;
}): WorkbenchData {
  return {
    hasAssessment: false,
    assessmentStatus: input.assessmentStatus ?? null,
    reportId: input.reportId ?? null,
    company: { name: "", fileNo: "—", sector: "", country: "", user: input.email, trialDays: input.trialDays },
    readiness: { score: 0, delta: 0, tier: "", dims: [], line: "" },
    pipeline: { matched: 0, strong: 0, active: 0, submitted: 0, dueSoon: 0, total: 0 },
    nextMove: null,
    gaps: [],
    matches: [],
    submissions: [],
    vault: { onFile: 0, total: 0, missing: 0 },
    access: input.access,
  };
}
