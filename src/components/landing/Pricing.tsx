"use client";

import { useState } from "react";
import { LC, LF, SectionTag, Eyebrow, Btn, Ic } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";
import {
  SUBMISSION_TYPES,
  SUBSCRIPTION_PLANS,
  ANNUAL_SAVING_PCT,
  TRIAL_DAYS,
} from "@/lib/workbench/pricing";

// Single-sourced from src/lib/workbench/pricing.ts so the marketing rates and
// the in-product Subscribe modal / Submissions screen can never drift. Freemium
// (2026-06): the dashboard is free on signup; Pro adds the vault, the gap
// Navigator and unlimited bid/no-bid.
const FREE_INCLUDES = [
  "Every matched tender, ranked & refreshed daily",
  "Browse the full tender database",
  "3 bid/no-bid verdicts a month",
  "Telegram deal-flow alerts & deadline nudges",
];
const PRO_ADDS = [
  "Unlimited paste → bid/no-bid verdicts",
  "The Gap Navigator for every readiness gap",
  "Document vault + readiness score tracking",
];

export default function Pricing() {
  const mobile = useMedia("(max-width: 767px)");
  const [annual, setAnnual] = useState(true);

  const monthly = SUBSCRIPTION_PLANS.monthly;
  const annualPlan = SUBSCRIPTION_PLANS.annual;
  const subPrice = annual ? annualPlan.perMonth : monthly.price;
  const annualSaving = monthly.price * 12 - annualPlan.price;
  const lowest = SUBMISSION_TYPES.reduce((a, b) => (b.price < a.price ? b : a), SUBMISSION_TYPES[0]);

  return (
    <section id="pricing" style={{ background: LC.paper, padding: mobile ? "52px 0" : "90px 0" }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ display: "inline-block" }}>
            <SectionTag n="05" label="Pricing" />
          </div>
          <h2 style={{ fontFamily: LF.display, fontSize: mobile ? 30 : 46, fontWeight: 400, letterSpacing: "-0.02em", color: LC.ink, margin: "16px 0 0", lineHeight: 1.05 }}>
            Free to start. Pro when you&apos;re ready.
          </h2>
          <p style={{ fontFamily: LF.sans, fontSize: mobile ? 15 : 17, color: LC.ink2, margin: "14px auto 0", maxWidth: 580, lineHeight: 1.6 }}>
            Your matched tenders, the full database, deal-flow alerts and 3 bid/no-bid calls a month are free — no card. Pro unlocks the document vault, the gap Navigator and unlimited verdicts. Proposals are billed only when you commit to a bid.
          </p>
        </div>

        {/* billing toggle */}
        <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
          <div style={{ display: "inline-flex", border: `1px solid ${LC.rule}`, background: LC.white, padding: 4 }}>
            {([["monthly", "Monthly"], ["annual", "Annual"]] as const).map(([k, l]) => {
              const on = (k === "annual") === annual;
              return (
                <button
                  key={k}
                  onClick={() => setAnnual(k === "annual")}
                  style={{
                    fontFamily: LF.mono,
                    fontSize: 11,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    padding: "9px 18px",
                    border: 0,
                    background: on ? LC.ink : "transparent",
                    color: on ? LC.paper : LC.mute,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  {l}
                  {k === "annual" && (
                    <span style={{ fontFamily: LF.mono, fontSize: 8.5, background: LC.accent, color: "#fff", padding: "2px 5px", letterSpacing: "0.04em" }}>
                      -{ANNUAL_SAVING_PCT}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: mobile ? 18 : 24, marginTop: 30, alignItems: "stretch" }}>
          {/* free dashboard + Pro unlock */}
          <div style={{ border: `1px solid ${LC.ink}`, background: LC.white, padding: mobile ? "26px 22px" : "34px 30px", display: "flex", flexDirection: "column" }}>
            <Eyebrow>The dashboard · free</Eyebrow>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, margin: "16px 0 4px" }}>
              <span style={{ fontFamily: LF.display, fontSize: 56, color: LC.ink, lineHeight: 0.85 }}>$0</span>
              <span style={{ fontFamily: LF.mono, fontSize: 12, color: LC.mute, marginBottom: 6 }}>to start · no card</span>
            </div>
            <div style={{ fontFamily: LF.sans, fontSize: 13, color: LC.mute, minHeight: 20 }}>Sign up free — these stay free.</div>
            <div style={{ height: 1, background: LC.ruleSoft, margin: "20px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {FREE_INCLUDES.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ color: LC.pos, marginTop: 1 }}>
                    <Ic name="check" size={15} color={LC.pos} />
                  </span>
                  <span style={{ fontFamily: LF.sans, fontSize: 13.5, color: LC.ink2, lineHeight: 1.45 }}>{f}</span>
                </div>
              ))}
            </div>

            {/* Pro unlock */}
            <div style={{ marginTop: 22, borderTop: `1px solid ${LC.ruleSoft}`, paddingTop: 20, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <Eyebrow color={LC.accent}>Pro unlocks</Eyebrow>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                  <span style={{ fontFamily: LF.display, fontSize: 30, color: LC.ink, lineHeight: 1 }}>${subPrice}</span>
                  <span style={{ fontFamily: LF.mono, fontSize: 10, color: LC.mute }}>/mo</span>
                </div>
              </div>
              <div style={{ fontFamily: LF.mono, fontSize: 9.5, color: LC.faint, textAlign: "right", marginTop: 2 }}>
                {annual ? <>Billed ${annualPlan.price}/yr · save ${annualSaving}</> : <>Switch to annual to save {ANNUAL_SAVING_PCT}%</>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
                {PRO_ADDS.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ color: LC.accent, marginTop: 1 }}>
                      <Ic name="check" size={15} color={LC.accent} />
                    </span>
                    <span style={{ fontFamily: LF.sans, fontSize: 13.5, color: LC.ink2, lineHeight: 1.45 }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>

            <Btn kind="gold" size="lg" href="/assessment?goal=track-tenders" style={{ marginTop: 24, width: "100%" }}>
              Start with a free score →
            </Btn>
            <div style={{ fontFamily: LF.mono, fontSize: 9.5, color: LC.faint, textAlign: "center", marginTop: 11, letterSpacing: "0.04em" }}>
              Free forever · Pro is a {TRIAL_DAYS}-day trial, no card
            </div>
          </div>

          {/* per-submission */}
          <div style={{ border: `1px solid ${LC.rule}`, background: LC.ink, color: LC.paper, padding: mobile ? "26px 22px" : "34px 30px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
            <div aria-hidden style={{ position: "absolute", top: -40, right: -20, fontFamily: LF.display, fontSize: 200, color: "rgba(200,151,62,0.07)", lineHeight: 1 }}>§</div>
            <Eyebrow color={LC.accent2}>Proposals · pay per submission</Eyebrow>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, margin: "16px 0 4px" }}>
              <span style={{ fontFamily: LF.display, fontSize: 56, color: LC.paper, lineHeight: 0.85 }}>${lowest.price}</span>
              <span style={{ fontFamily: LF.mono, fontSize: 12, color: LC.onDarkMute, marginBottom: 6 }}>/ submission &amp; up</span>
            </div>
            <div style={{ fontFamily: LF.sans, fontSize: 13, color: LC.onDark, minHeight: 20 }}>Only billed when you decide to bid. No retainer.</div>
            <div style={{ height: 1, background: LC.darkLine, margin: "20px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 1, background: LC.darkLine, border: `1px solid ${LC.darkLine}`, flex: 1 }}>
              {SUBMISSION_TYPES.map((s) => (
                <div key={s.code} style={{ background: LC.ink, display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                  <span style={{ fontFamily: LF.display, fontSize: 19, color: LC.paper, width: 42 }}>{s.code}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: LF.sans, fontSize: 12.5, color: LC.onDark }}>{s.name}</div>
                    <div style={{ fontFamily: LF.mono, fontSize: 9, color: LC.onDarkMute, marginTop: 1 }}>{s.complexity} · {s.turnaround} turnaround</div>
                  </div>
                  <span style={{ fontFamily: LF.display, fontSize: 22, color: LC.accent2 }}>${s.price}</span>
                </div>
              ))}
            </div>
            {/* The first proposal submission is genuinely free for trial users:
                the credit is granted on trial start and consumed at the first
                proposal commission (src/lib/free-submission.ts + the proposals
                checkout). Anonymous visitors start the funnel here. */}
            <Btn kind="ghostDark" size="lg" href="/assessment?goal=prepare-proposal" style={{ marginTop: 24, width: "100%" }}>
              Your first proposal submission is on us
            </Btn>
            <div style={{ fontFamily: LF.mono, fontSize: 9.5, color: LC.onDarkMute, textAlign: "center", marginTop: 11, letterSpacing: "0.04em" }}>
              Then pay per submission — only when you choose to bid
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
