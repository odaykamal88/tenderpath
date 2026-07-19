"use client";

/* Overview — the home "brief". Leads with a single decided next move, live
 * readiness, this week's pressure, the pipeline shape, and top matches. All
 * derived server-side from the real assessment + pipeline. */

import Link from "next/link";
import { C, F } from "../tokens";
import { Eyebrow, Card, Bar, SevDot, FitBadge, DeadlinePill, SectionHeadLite, LinkBtn, daysUntil, isSoon } from "../ui";
import { bucketMeta } from "../buckets";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { FunnelBeacon } from "@/components/telemetry/FunnelBeacon";
import type { WbAction } from "@/lib/workbench/types";

function EmptyOverview({ failed, onPaste }: { failed: boolean; onPaste: () => void }) {
  const eyebrow = failed ? "Overview · Assessment needs a retry" : "Overview · No assessment yet";
  const title = failed ? "Your workspace is safe. Start with the tender." : "Start with the tender in front of you.";
  const body = failed
    ? "The assessment did not finish, but it does not block your tender. Paste the notice now, then retry the company assessment when you're ready."
    : "Paste the official notice for a bid/no-bid read and guided submission workspace. Add the five-minute company assessment afterwards to improve the evidence behind your matches.";
  return (
    <div>
      <Eyebrow color={failed ? C.warn : C.faint} style={{ marginBottom: 12 }}>{eyebrow}</Eyebrow>
      <h1 style={{ fontFamily: F.display, fontSize: 40, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, lineHeight: 1.05, margin: "0 0 14px" }}>
        {title}
      </h1>
      <p style={{ fontFamily: F.sans, fontSize: 15, lineHeight: 1.6, color: C.ink2, maxWidth: 560, margin: "0 0 26px" }}>
        {body}
      </p>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onPaste} style={{ display: "inline-flex", alignItems: "center", background: C.ink, color: C.paper, border: 0, padding: "13px 22px", cursor: "pointer", fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Paste a tender →
        </button>
        <Link href="/assessment" style={{ display: "inline-flex", alignItems: "center", color: C.ink, padding: "12px 4px", textDecoration: "none", borderBottom: `1px solid ${C.ink}`, fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {failed ? "Retry assessment" : "Build my company file"}
        </Link>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { data, liveScore, sessionGain, go, runAction, openNavigator, openPaste, isClosed } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");

  if (!data.hasAssessment) return <EmptyOverview failed={data.assessmentStatus === "failed"} onPaste={() => openPaste()} />;

  const { readiness, pipeline, matches, gaps, submissions, nextMove } = data;
  const urgent = matches.filter((m) => isSoon(m.deadline));
  const topGap = gaps.find((g) => g.severity === "high" && g.status === "open" && !isClosed(g.id));
  const gained = sessionGain + readiness.delta;
  const activeSubs = submissions.filter((s) => s.status !== "submitted");
  const reviewCount = submissions.filter((s) => s.status === "review").length;

  const act = (a: WbAction | undefined) => a && runAction(a);

  return (
    <div>
      <FunnelBeacon event="dashboard_landed" props={{ report_id: data.reportId, score: liveScore, tier: readiness.tier }} />
      {/* hero */}
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0,360px) minmax(0,1fr)", gap: mobile ? 20 : 28, marginBottom: 40 }}>
        {/* readiness */}
        <Card pad={24}>
          <Eyebrow color={C.accent}>Readiness</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
            <span style={{ fontFamily: F.display, fontSize: 78, fontWeight: 400, lineHeight: 0.82, letterSpacing: "-0.04em", color: C.ink }}>{liveScore}</span>
            <span style={{ fontFamily: F.display, fontSize: 26, color: C.faint }}>/100</span>
            {gained > 0 && (
              <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.pos, marginLeft: "auto", letterSpacing: "0.06em" }}>↑ +{gained} {sessionGain > 0 ? "live" : "since last run"}</span>
            )}
          </div>
          {readiness.tier && <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginTop: 10 }}>{readiness.tier}</div>}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.ruleSoft}` }}>
            {readiness.dims.map(([l, v]) => (
              <div key={l} style={{ display: "grid", gridTemplateColumns: "110px 1fr 32px", gap: 12, alignItems: "center", padding: "7px 0", borderBottom: `1px dashed ${C.ruleSoft}` }}>
                <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink }}>{l}</span>
                <Bar value={v} />
                <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <LinkBtn onClick={() => go("gaps")}>Fix the gaps →</LinkBtn>
          </div>
        </Card>

        {/* next move */}
        <div style={{ background: C.ink, color: C.paper, padding: 28, display: "flex", flexDirection: "column" }}>
          <Eyebrow color={C.accent2}>{nextMove?.eyebrow ?? "Your next move"}</Eyebrow>
          <h2 style={{ fontFamily: F.display, fontSize: 31, fontWeight: 400, lineHeight: 1.06, letterSpacing: "-0.02em", color: C.paper, margin: "16px 0 0" }}>
            {nextMove?.title ?? "Review your matched tenders."}
          </h2>
          <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: "#cdc6b3", margin: "14px 0 0", maxWidth: 520 }}>
            {nextMove?.body ?? "Scan your ranked matches and qualify the ones worth pursuing."}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
            {nextMove?.primary && (
              <button onClick={() => act(nextMove.primary!.action)} style={{ background: C.paper, color: C.ink, border: 0, padding: "12px 18px", cursor: "pointer", fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {nextMove.primary.label}
              </button>
            )}
            {nextMove?.secondary && (
              <button onClick={() => act(nextMove.secondary!.action)} style={{ background: "transparent", color: C.paper, border: `1px solid #3a4654`, padding: "12px 18px", cursor: "pointer", fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {nextMove.secondary.label}
              </button>
            )}
          </div>
          {nextMove && nextMove.thenThisWeek.length > 0 && (
            <>
              <div style={{ flex: 1, minHeight: 18 }} />
              <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid #28323e" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "#7d8794", marginBottom: 10 }}>Then this week</div>
                {nextMove.thenThisWeek.map((item, i) => (
                  <button key={i} onClick={() => act(item.action)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "9px 0", borderBottom: i < nextMove.thenThisWeek.length - 1 ? "1px solid #28323e" : "none", background: "none", border: 0, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ fontFamily: F.sans, fontSize: 13, color: "#e4ddcb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 12 }}>{item.label}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.accent2, whiteSpace: "nowrap" }}>{item.meta} →</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* pipeline */}
      <div style={{ marginBottom: 40 }}>
        <SectionHeadLite n="00" title="State of the pipeline" hint={`${pipeline.total} tracked · ${pipeline.dueSoon} closing this week`} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: `1px solid ${C.rule}`, background: C.white }}>
          {([["Matched", pipeline.matched, "shortlist"], ["High fit", pipeline.strong, "≥70%"], ["Active", pipeline.active, "evaluating"], ["Submitted", pipeline.submitted, "awaiting"]] as [string, number, string][]).map(([l, v, sub], i) => {
            const max = Math.max(pipeline.matched, pipeline.strong, pipeline.active, pipeline.submitted, 1);
            return (
              <div key={l} style={{ padding: "16px 18px", borderRight: i < 3 ? `1px solid ${C.ruleSoft}` : "none" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>{l}</span>
                </div>
                <div style={{ fontFamily: F.display, fontSize: 38, fontWeight: 400, color: C.ink, lineHeight: 1, marginTop: 10, fontVariantNumeric: "tabular-nums" }}>{v}</div>
                <div style={{ height: 2, background: C.paper2, marginTop: 10 }}><div style={{ height: 2, background: C.ink, width: `${(v / max) * 100}%` }} /></div>
                <div style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, marginTop: 7 }}>{sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* this week */}
      <div style={{ marginBottom: 40 }}>
        <SectionHeadLite n="01" title="This week" hint="What needs you now" />
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(3, minmax(0,1fr))", gap: 1, background: C.rule, border: `1px solid ${C.rule}` }}>
          <div style={{ background: C.white, padding: "18px 20px" }}>
            <Eyebrow>Deadlines this week</Eyebrow>
            <div style={{ marginTop: 12 }}>
              {urgent.length === 0 && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>Nothing closing in the next 7 days.</div>}
              {urgent.slice(0, 3).map((m) => (
                <button key={m.id} onClick={() => openPaste(m)} style={{ display: "flex", gap: 10, alignItems: "baseline", width: "100%", textAlign: "left", padding: "7px 0", background: "none", border: 0, cursor: "pointer" }}>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.neg, fontWeight: 600, width: 26, flexShrink: 0 }}>{daysUntil(m.deadline)}d</span>
                  <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: C.white, padding: "18px 20px" }}>
            <Eyebrow>Active proposals</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
              <span style={{ fontFamily: F.display, fontSize: 42, color: C.ink, lineHeight: 1 }}>{activeSubs.length}</span>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: C.mute }}>in progress</span>
            </div>
            {reviewCount > 0 && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.warn, marginTop: 8 }}>{reviewCount} ready for your review</div>}
            <div style={{ marginTop: 12 }}>
              <LinkBtn onClick={() => go("proposals")}>View submissions →</LinkBtn>
            </div>
          </div>
          <div style={{ background: C.white, padding: "18px 20px" }}>
            <Eyebrow>Top gap to close</Eyebrow>
            {topGap ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <SevDot severity={topGap.severity} />
                  <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500, lineHeight: 1.3 }}>{topGap.title}</span>
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>+{topGap.impact} to score · {topGap.eta}</div>
                <div style={{ marginTop: 11 }}>
                  <LinkBtn onClick={() => openNavigator(topGap.id)}>Fix with the Navigator →</LinkBtn>
                </div>
              </div>
            ) : (
              <div style={{ fontFamily: F.sans, fontSize: 13, color: C.pos, marginTop: 10 }}>All critical gaps covered ✓</div>
            )}
          </div>
        </div>
      </div>

      {/* top matches */}
      <div>
        <SectionHeadLite
          n="02"
          title="Top matches"
          count={pipeline.matched}
          action={<LinkBtn onClick={() => go("matches")}>All {pipeline.matched} matches →</LinkBtn>}
        />
        <Card>
          {matches.slice(0, 4).map((m) => {
            const [, color] = bucketMeta(m.bucket);
            return (
              <button key={m.id} onClick={() => go("matches")} style={{ display: "grid", gridTemplateColumns: "8px minmax(0,1fr) auto auto", gap: 14, alignItems: "center", width: "100%", textAlign: "left", padding: "13px 16px", borderBottom: `1px solid ${C.ruleSoft}`, background: "none", border: 0, cursor: "pointer" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 2 }}>{m.agency} · {m.value}</div>
                </span>
                <DeadlinePill deadline={m.deadline} />
                <FitBadge score={m.fit} />
              </button>
            );
          })}
          {matches.length === 0 && <div style={{ padding: "18px 16px", fontFamily: F.sans, fontSize: 13, color: C.mute }}>No matches yet — they appear here after your assessment runs.</div>}
        </Card>
      </div>
    </div>
  );
}
