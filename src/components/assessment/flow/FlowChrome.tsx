"use client";

import Link from "next/link";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";

export type FlowPhase = "entry" | "crawling" | "step1" | "step2" | "step3" | "analyzing";

const STAGES: [string, string][] = [
  ["profile", "Profile"],
  ["analysis", "Analysis"],
  ["report", "Report"],
];

function stageIndex(phase: FlowPhase): number {
  // entry / crawling / the three wizard steps are all the "Profile" stage;
  // analyzing is "Analysis"; "Report" is the destination we redirect to.
  return phase === "analyzing" ? 1 : 0;
}

/** Sticky dossier top bar with a Profile → Analysis → Report stepper. */
export function FlowChrome({ phase, authedEmail }: { phase: FlowPhase; authedEmail: string | null }) {
  const mobile = useMedia("(max-width: 860px)");
  const idx = stageIndex(phase);

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(246,243,236,0.9)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: `1px solid ${C.rule}`,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: mobile ? "13px 18px" : "15px 56px",
          display: "flex",
          alignItems: "center",
          gap: 18,
          boxSizing: "border-box",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 6, textDecoration: "none", flexShrink: 0 }}>
          <span style={{ fontFamily: F.display, fontSize: 20, fontWeight: 500, color: C.ink, letterSpacing: "-0.01em" }}>
            TenderPath
          </span>
          <span style={{ color: C.accent, fontFamily: F.display, fontSize: 20 }}>·</span>
        </Link>

        {!mobile && (
          <div style={{ display: "flex", alignItems: "center", marginLeft: 8 }}>
            {STAGES.map(([id, label], i) => {
              const done = i < idx;
              const on = i === idx;
              return (
                <div key={id} style={{ display: "flex", alignItems: "center" }}>
                  {i > 0 && <span style={{ width: 26, height: 1, background: i <= idx ? C.accent : C.rule, margin: "0 10px" }} />}
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 999,
                        border: `1px solid ${on || done ? C.accent : C.rule}`,
                        background: done ? C.accent : "transparent",
                        color: done ? C.white : on ? C.accent : C.faint,
                        fontSize: 9,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: F.mono,
                      }}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span
                      style={{
                        fontFamily: F.mono,
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: on ? C.ink : C.faint,
                      }}
                    >
                      {label}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          {authedEmail ? (
            <>
              {!mobile && (
                <span
                  style={{
                    fontFamily: F.mono,
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: C.mute,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    maxWidth: 180,
                  }}
                >
                  {authedEmail}
                </span>
              )}
              <Link
                href="/dashboard"
                style={{
                  background: C.ink,
                  color: C.paper,
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "8px 14px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Open dashboard →
              </Link>
            </>
          ) : (
            <>
              {!mobile && (
                <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute }}>
                  Free · no card
                </span>
              )}
              <Link
                href="/login"
                style={{
                  fontFamily: F.mono,
                  fontSize: 10.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: C.ink,
                  textDecoration: "none",
                  borderBottom: `1px solid ${C.rule}`,
                  paddingBottom: 2,
                  whiteSpace: "nowrap",
                }}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
