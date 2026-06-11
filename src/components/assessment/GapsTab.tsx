"use client";

import type { CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow } from "@/components/workbench/ui";

export type Gap = {
  severity: "High" | "Med" | "Low";
  title: string;
  why: string;
  fix: string;
  /** True when the user's vault carries evidence that maps to this gap. */
  resolved?: boolean;
  // Per-gap projected score uplift + step-completion progress sourced from
  // assessment_step_completions. potentialDelta is the headline (`+N pts`);
  // stepsCount/stepsDone drive the `X of Y steps` subtitle.
  potentialDelta: number;
  stepsCount: number;
  stepsDone: number;
};

function sevTone(s: Gap["severity"]): string {
  return s === "High" ? C.neg : s === "Med" ? C.warn : C.mute;
}

export function GapsTab({
  gaps,
  scoreToday,
  scoreImpact,
}: {
  gaps: Gap[];
  scoreToday: number;
  scoreImpact: { label: string; delta: number; projected: number }[];
}) {
  const mobile = useMedia("(max-width: 860px)");
  const open = gaps.filter((g) => !g.resolved);
  const covered = gaps.filter((g) => g.resolved);
  const projected = scoreImpact.length ? scoreImpact[scoreImpact.length - 1].projected : scoreToday;
  const allCovered = open.length === 0;

  const Row = (g: Gap, i: number) => {
    const allStepsDone = g.stepsCount > 0 && g.stepsDone >= g.stepsCount;
    return (
      <div
        key={`${g.title}-${i}`}
        style={{
          display: "grid",
          gridTemplateColumns: mobile ? "14px 1fr auto" : "14px 1fr 150px 70px",
          gap: mobile ? 12 : 16,
          padding: "15px 0",
          borderBottom: `1px solid ${C.ruleSoft}`,
          alignItems: "baseline",
        }}
      >
        <span style={{ paddingTop: 5 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: g.resolved ? C.pos : sevTone(g.severity),
              display: "inline-block",
              flexShrink: 0,
            }}
          />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.ink, fontWeight: 500 }}>{g.title}</div>
          {g.why && (
            <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5, marginTop: 4, maxWidth: 560 }}>
              {g.why}
            </div>
          )}
          {g.fix && !g.resolved && (
            <div
              style={{
                fontFamily: F.mono,
                fontSize: 9.5,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: C.faint,
                marginTop: 7,
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: C.mute }}>Fix: {g.fix}</span>
              {mobile && <span style={{ color: C.pos }}>+{g.potentialDelta} pts</span>}
            </div>
          )}
        </div>
        {!mobile && (
          <span style={{ textAlign: "right" }}>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 9.5,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: g.resolved ? C.pos : sevTone(g.severity),
              }}
            >
              {g.resolved ? "covered" : g.severity}
            </span>
            <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 3 }}>
              {g.resolved
                ? "on file"
                : g.stepsCount > 0
                ? allStepsDone
                  ? "steps done ✓"
                  : `${g.stepsDone} of ${g.stepsCount} ${g.stepsCount === 1 ? "step" : "steps"}`
                : ""}
            </div>
          </span>
        )}
        {!mobile && (
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              color: g.resolved ? C.faint : C.pos,
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          >
            {g.resolved ? "✓" : `+${g.potentialDelta}`}
          </span>
        )}
      </div>
    );
  };

  const introStyle: CSSProperties = {
    fontFamily: F.sans,
    fontSize: 14,
    color: C.ink2,
    lineHeight: 1.55,
    maxWidth: 620,
    margin: 0,
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4, gap: 16, flexWrap: "wrap" }}>
        <p style={introStyle}>
          {allCovered ? (
            <>Every readiness gap we found is already covered by evidence in your vault — focus on the bids.</>
          ) : (
            <>
              Closing your {open.length} open {open.length === 1 ? "gap" : "gaps"} could lift your score from{" "}
              <b style={{ color: C.ink }}>{scoreToday}</b>
              {projected > scoreToday && (
                <>
                  {" "}
                  toward <b style={{ color: C.ink }}>{projected}</b>
                </>
              )}
              . Each is tied to the evidence that flagged it.
            </>
          )}
        </p>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, whiteSpace: "nowrap" }}>
          {open.length} open · {covered.length} covered
        </span>
      </div>

      {open.length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.ink}` }}>{open.map(Row)}</div>
      )}

      {covered.length > 0 && (
        <>
          <Eyebrow style={{ marginTop: 22, marginBottom: 2 }}>Already covered</Eyebrow>
          <div>{covered.map(Row)}</div>
        </>
      )}
    </div>
  );
}
