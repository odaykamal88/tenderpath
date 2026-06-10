"use client";

/**
 * ReportNextStepCTA — the conversion slab for the ANONYMOUS Vendor Readiness
 * report. One recommended paid SKU (derived server-side by the same readiness
 * engine the wizard used — src/lib/assessment/next-step.ts) plus a
 * "save report → sign up" sheet that keeps the score on screen.
 *
 * Rendered only for anonymous viewers. When nextStep is null the slab degrades
 * to the save-report sign-up alone — never a dead CTA.
 */

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import SignupSheet from "@/app/assessment/SignupSheet";
import { C, F } from "@/components/workbench/tokens";
import { Eyebrow } from "@/components/workbench/ui";
import type { ReportNextStep } from "@/lib/assessment/next-step";

export function ReportNextStepCTA({ nextStep }: { nextStep: ReportNextStep | null }) {
  const [signupOpen, setSignupOpen] = useState(false);

  const primaryLink: CSSProperties = {
    background: C.paper,
    color: C.ink,
    fontFamily: F.mono,
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    padding: "13px 26px",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
  const ghostBtn: CSSProperties = {
    background: "none",
    border: 0,
    cursor: "pointer",
    fontFamily: F.mono,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(246,243,236,0.7)",
    borderBottom: "1px solid rgba(246,243,236,0.3)",
    paddingBottom: 2,
  };

  return (
    <section style={{ background: C.ink, color: C.paper, padding: "40px", marginTop: 40 }}>
      <Eyebrow color={C.accent2}>{nextStep ? "Recommended next step" : "Save your readiness report"}</Eyebrow>

      {nextStep ? (
        <>
          <h2 style={{ fontFamily: F.display, fontSize: 36, fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "14px 0 12px", color: C.paper }}>
            {nextStep.label}
          </h2>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: "rgba(246,243,236,0.7)", lineHeight: 1.55, marginBottom: 24, maxWidth: 560 }}>
            {nextStep.rationale}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 24, paddingTop: 24, borderTop: "1px solid rgba(246,243,236,0.15)" }}>
            <span style={{ fontFamily: F.display, fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{nextStep.price}</span>
            {nextStep.comingSoon ? (
              <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(246,243,236,0.6)", border: "1px solid rgba(246,243,236,0.2)", padding: "13px 26px" }}>
                Coming soon
              </span>
            ) : (
              <Link href={`/pay?plan=${nextStep.paySlug}`} style={primaryLink}>
                Start {nextStep.label} →
              </Link>
            )}
            <button onClick={() => setSignupOpen(true)} style={ghostBtn}>
              Save report → sign up
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ fontFamily: F.display, fontSize: 36, fontWeight: 400, lineHeight: 1.05, letterSpacing: "-0.02em", margin: "14px 0 12px", color: C.paper }}>
            Keep your score — and we&apos;ll keep watching.
          </h2>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: "rgba(246,243,236,0.7)", lineHeight: 1.55, marginBottom: 24, maxWidth: 560 }}>
            Save this report to your dashboard. We&apos;ll keep your score, matched tenders, grants and
            fixes current — and alert you when new matches post.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 24, paddingTop: 24, borderTop: "1px solid rgba(246,243,236,0.15)" }}>
            <button onClick={() => setSignupOpen(true)} style={primaryLink}>
              Save report → sign up
            </button>
          </div>
        </>
      )}

      <SignupSheet open={signupOpen} onClose={() => setSignupOpen(false)} />
    </section>
  );
}
