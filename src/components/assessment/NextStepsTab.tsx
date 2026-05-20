"use client";

import { useState, useTransition } from "react";
import styles from "./AssessmentTabs.module.css";

// Sprint 24 (audit 2026-05-20 UX): action items are now toggleable to-dos.
// scoreDelta is the share of the parent gap's projected uplift attributed to
// this step (even split across the gap's effective steps). stepKey is the
// opaque persistence id sent to /api/assessment/[id]/step-toggle — currently
// `g{gapIdx}-s{stepIdx}` against the assessment's raw gaps[i].action_steps[j].
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
  const empty = totalSteps === 0 || groups.length === 0;
  return (
    <>
      <div className={styles.eyebrow}>
        {empty
          ? "All identified gaps covered — no scheduled remediation"
          : `${totalSteps} step${totalSteps === 1 ? "" : "s"} · sequenced · estimated +${projectedDelta} score`}
      </div>
      <h2 className={styles.sectionTitle}>
        {empty ? "Nothing in the 90-day queue." : "A 90-day plan, not a checklist."}
      </h2>
      {empty ? (
        <p className={styles.nextWhy} style={{ maxWidth: 560 }}>
          We did not detect any open readiness gaps for the next 90 days. If new
          evidence drops out of your vault, or a new assessment surfaces a gap,
          this view will refill automatically.
        </p>
      ) : (
        groups.map((g, i) => (
          <div key={i} className={styles.nextGroup}>
            <span className={`${styles.nextWhen} tp-mono`}>{g.when}</span>
            <ol className={styles.nextItems}>
              {g.items.map((m) => (
                <StepRow key={m.stepKey} move={m} assessmentRef={assessmentRef} />
              ))}
            </ol>
          </div>
        ))
      )}
    </>
  );
}

function StepRow({ move, assessmentRef }: { move: Move; assessmentRef: string }) {
  // Optimistic UI: flip local state immediately, await API roundtrip, revert
  // on failure. The server is authoritative on next page load (force-dynamic
  // refetch), so we don't sync back from server on success — the local state
  // already matches.
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
        const res = await fetch(
          `/api/assessment/${encodeURIComponent(assessmentRef)}/step-toggle`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stepKey: move.stepKey, done: next }),
          },
        );
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
    <li className={styles.nextRow} data-done={done ? "true" : undefined}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={styles.todoCheckbox}
        aria-pressed={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        title={done ? "Mark as not done" : "Mark as done"}
      >
        <span className={styles.todoCheckboxBox} data-checked={done ? "true" : undefined}>
          {done ? "✓" : ""}
        </span>
        <span className={styles.todoCheckboxBody}>
          <span className={styles.nextTitle}>{move.title}</span>
          <span className={styles.nextWhy}>{move.why}</span>
          {error && <span className={styles.todoError}>{error}</span>}
        </span>
      </button>
      <span className={`${styles.nextEta} tp-mono`}>{move.eta}</span>
      <span
        className={`${styles.stepPoints} tp-mono`}
        data-state={done ? "earned" : undefined}
        title={done ? "Counted toward your projected score" : "Pending — check to earn"}
      >
        {done ? "+" : "+"}{move.scoreDelta} pts
      </span>
    </li>
  );
}
