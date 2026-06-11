import type { CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";

const bar = (w: number | string, h: number): CSSProperties => ({
  display: "block",
  width: w,
  height: h,
  background: C.paper2,
  animation: "tpBlink 1.4s ease-in-out infinite",
});

const STEPS = [
  ["Reading your profile", "done"],
  ["Matching live tenders", "done"],
  ["Cross-referencing UNGM", "done"],
  ["Scoring readiness…", "pending"],
] as const;

export function LoadingState({ companyName }: { companyName: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px", color: C.ink, background: C.paper, minHeight: "100vh", boxSizing: "border-box" }}
    >
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Computing readiness score for {companyName}…
      </span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={bar(140, 96)} />
        <span style={bar(60, 28)} />
      </div>
      <ul style={{ listStyle: "none", margin: "28px 0 0", padding: 0, maxWidth: 460 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 30px", gap: 12, alignItems: "center", padding: "10px 0", borderBottom: `1px dashed ${C.ruleSoft}` }}>
            <span style={bar("70%", 11)} />
            <span style={bar("100%", 2)} />
            <span style={bar(22, 11)} />
          </li>
        ))}
      </ul>
      <ol style={{ listStyle: "none", margin: "30px 0 0", padding: 0, borderTop: `1px solid ${C.rule}` }}>
        {STEPS.map(([label, state], i) => (
          <li
            key={i}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid ${C.ruleSoft}`, fontFamily: F.sans, fontSize: 13.5, color: state === "done" ? C.ink2 : C.ink }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: state === "done" ? C.pos : C.accent,
                animation: state === "pending" ? "tpBlink 1s infinite" : undefined,
                display: "inline-block",
              }}
            />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
