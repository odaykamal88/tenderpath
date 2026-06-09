"use client";

import { LC, LF, SectionTag, Ic, type IcName } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

const STEPS: Array<[string, IcName, string, string]> = [
  ["01", "target", "Assess & match", "Take the readiness assessment once. We score you and surface every live tender you actually fit — ranked, refreshed daily."],
  ["02", "paste", "Paste & decide", "Drop any tender. Get an instant bid/no-bid verdict with a fit score and the exact compliance checklist it demands."],
  ["03", "compass", "Close the gaps", "The Navigator walks you through each gap — UNGM, certifications, financials — hand-held, pre-filled, step by step."],
  ["04", "doc", "Submit & win", "Turn the brief into a submission-ready, compliance-mapped proposal in under an hour. Pay only when you bid."],
];

export default function HowItWorks() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section
      id="how"
      style={{ background: LC.white, padding: mobile ? "52px 0" : "88px 0", borderTop: `1px solid ${LC.rule}`, borderBottom: `1px solid ${LC.rule}` }}
    >
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ textAlign: mobile ? "left" : "center" }}>
          <div style={{ display: "inline-block" }}>
            <SectionTag n="03" label="How it works" />
          </div>
          <h2 style={{ fontFamily: LF.display, fontSize: mobile ? 28 : 44, fontWeight: 400, letterSpacing: "-0.02em", color: LC.ink, margin: "16px 0 0", lineHeight: 1.06 }}>
            Four steps to a winning bid.
          </h2>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: mobile ? "1fr" : "repeat(4, 1fr)",
            gap: mobile ? 14 : 22,
            marginTop: 40,
          }}
        >
          {STEPS.map((s, i) => (
            <div key={i} style={{ position: "relative", paddingTop: 22 }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: LC.rule }} />
              <div style={{ position: "absolute", top: -1, left: 0, width: 40, height: 2, background: LC.accent }} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span style={{ fontFamily: LF.mono, fontSize: 12, letterSpacing: "0.1em", color: LC.accent }}>{s[0]}</span>
                <span style={{ color: LC.ink }}>
                  <Ic name={s[1]} size={20} />
                </span>
              </div>
              <h3 style={{ fontFamily: LF.display, fontSize: 21, fontWeight: 500, color: LC.ink, margin: 0, letterSpacing: "-0.01em" }}>{s[2]}</h3>
              <p style={{ fontFamily: LF.sans, fontSize: 13.5, lineHeight: 1.6, color: LC.mute, margin: "10px 0 0" }}>{s[3]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
