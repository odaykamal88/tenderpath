"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow } from "@/components/workbench/ui";

// action items are toggleable to-dos. scoreDelta is the share of the parent
// gap's projected uplift attributed to this step. stepKey is the persistence id
// sent to /api/assessment/[id]/step-toggle (`g{gapIdx}-s{stepIdx}`).
export type Move = {
  title: string;
  why: string;
  eta: string;
  scoreDelta: number;
  stepKey: string;
  done: boolean;
};
export type MoveGroup = { when: string; items: Move[] };

export function NextStepsTab({
  groups,
  totalSteps,
  projectedDelta,
  assessmentRef,
}: {
  groups: MoveGroup[];
  totalSteps: number;
  projectedDelta: number;
  /** UUID (assessment public_id) — used to POST step-toggle from the client. */
  assessmentRef: string;
}) {
  const mobile = useMedia("(max-width: 860px)");
  const empty = totalSteps === 0 || groups.length === 0;

  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, maxWidth: 620, margin: "0 0 4px" }}>
        {empty
          ? "We didn’t find any open readiness gaps for the next 90 days. If new evidence drops out of your vault, or a fresh assessment surfaces a gap, this view refills automatically."
          : "The order to work in — sequenced by leverage and lead time. Check items off as you complete them; the Navigator walks you through each one, pre-filled, inside the Workbench."}
      </p>
      <div style={{ marginBottom: 22 }}>
        <Eyebrow>
          {empty
            ? "All identified gaps covered"
            : `${totalSteps} step${totalSteps === 1 ? "" : "s"} · projected +${projectedDelta} score`}
        </Eyebrow>
      </div>

      {!empty && (
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : `repeat(${Math.min(groups.length, 3)}, 1fr)`, gap: mobile ? 22 : 28 }}>
          {groups.map((g, gi) => (
            <div key={gi}>
              <div style={{ borderTop: `2px solid ${C.ink}`, paddingTop: 10, marginBottom: 6 }}>
                <div style={{ fontFamily: F.display, fontSize: 18, color: C.ink }}>{g.when}</div>
                <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent, marginTop: 4 }}>
                  {g.items.length} {g.items.length === 1 ? "step" : "steps"}
                </div>
              </div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {g.items.map((m) => (
                  <StepRow key={m.stepKey} move={m} assessmentRef={assessmentRef} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {!empty && (
        <Link
          href="/dashboard"
          style={{
            display: "inline-flex",
            marginTop: 26,
            background: C.ink,
            color: C.paper,
            border: `1px solid ${C.ink}`,
            fontFamily: F.mono,
            fontSize: 11.5,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            padding: "11px 18px",
            textDecoration: "none",
            alignItems: "center",
            gap: 8,
          }}
        >
          Open the Navigator in your Workbench →
        </Link>
      )}
    </div>
  );
}

function StepRow({ move, assessmentRef }: { move: Move; assessmentRef: string }) {
  // Optimistic UI: flip local state immediately, revert on failure. The server
  // is authoritative on next page load (force-dynamic refetch).
  const [done, setDone] = useState(move.done);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    const next = !done;
    const prev = done;
    setDone(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/assessment/${encodeURIComponent(assessmentRef)}/step-toggle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepKey: move.stepKey, done: next }),
        });
        if (!res.ok) {
          setDone(prev);
          setError(res.status === 404 ? "Not found" : "Could not save");
        }
      } catch {
        setDone(prev);
        setError("Network error");
      }
    });
  };

  return (
    <li style={{ padding: "13px 0", borderBottom: `1px dashed ${C.ruleSoft}` }}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        style={{
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: 0,
          padding: 0,
          cursor: pending ? "default" : "pointer",
          opacity: done ? 0.6 : 1,
        }}
      >
        <span
          style={{
            width: 15,
            height: 15,
            flexShrink: 0,
            marginTop: 2,
            border: `1px solid ${done ? C.ink : C.rule}`,
            background: done ? C.ink : "transparent",
            color: C.paper,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            fontFamily: F.mono,
          }}
        >
          {done ? "✓" : ""}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500, lineHeight: 1.3, textDecoration: done ? "line-through" : "none" }}>
              {move.title}
            </span>
            {move.scoreDelta > 0 && (
              <span style={{ fontFamily: F.mono, fontSize: 11, color: done ? C.faint : C.pos, fontWeight: 600, whiteSpace: "nowrap" }}>
                +{move.scoreDelta} pts
              </span>
            )}
          </span>
          {move.why && (
            <span style={{ display: "block", fontFamily: F.sans, fontSize: 12, color: C.ink2, marginTop: 4, lineHeight: 1.5 }}>
              {move.why}
            </span>
          )}
          <span style={{ display: "block", fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, marginTop: 6 }}>
            {move.eta}
            {error && <span style={{ color: C.neg, marginLeft: 8 }}>{error}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
