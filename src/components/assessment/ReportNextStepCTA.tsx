"use client";

/**
 * ReportNextStepCTA — the conversion slab for the ANONYMOUS Vendor Readiness
 * report. Ports the old post-wizard AssessmentResults S3 block onto the shared
 * /assessment/[id] report chrome:
 *
 *   - one recommended paid SKU (derived server-side by the same readiness
 *     engine the wizard used — see src/lib/assessment/next-step.ts), and
 *   - a "save report → sign up" sheet that keeps the score on screen
 *     (reuses the live SignupSheet / magic-link + Google auth contracts).
 *
 * Rendered only for anonymous viewers (signed-in dashboard users already have
 * access and don't get the sign-up pitch). When nextStep is null the slab
 * degrades to the save-report sign-up alone — never a dead CTA.
 */

import { useState } from "react";
import Link from "next/link";
import SignupSheet from "@/app/assessment/SignupSheet";
import type { ReportNextStep } from "@/lib/assessment/next-step";

export function ReportNextStepCTA({ nextStep }: { nextStep: ReportNextStep | null }) {
  const [signupOpen, setSignupOpen] = useState(false);

  return (
    <section className="bg-ink text-paper p-8 lg:p-10 mt-10">
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-accent-2 mb-4">
        {nextStep ? "Recommended next step" : "Save your readiness report"}
      </p>

      {nextStep ? (
        <>
          <h2 className="font-serif text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] mb-3">
            {nextStep.label}
          </h2>
          <p className="text-[14px] text-paper-2/70 leading-[1.55] mb-6 max-w-xl">
            {nextStep.rationale}
          </p>
          <div className="flex flex-wrap items-baseline gap-6 pt-6 border-t border-paper-2/15">
            <span className="font-serif text-[40px] leading-none tabular-nums">{nextStep.price}</span>
            {nextStep.comingSoon ? (
              <span className="font-mono text-[11px] tracking-[0.14em] uppercase text-paper-2/60 border border-paper-2/20 px-7 py-3.5">
                Coming soon
              </span>
            ) : (
              <Link
                href={`/pay?plan=${nextStep.paySlug}`}
                className="bg-paper text-ink font-mono text-[11px] tracking-[0.14em] uppercase px-7 py-3.5 hover:bg-accent-2 transition-colors"
              >
                Start {nextStep.label} →
              </Link>
            )}
            <button
              onClick={() => setSignupOpen(true)}
              className="font-mono text-[11px] tracking-[0.12em] uppercase text-paper-2/70 hover:text-paper border-b border-paper-2/30 hover:border-paper pb-0.5"
            >
              Save report → sign up
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="font-serif text-[32px] lg:text-[40px] font-normal leading-[1.05] tracking-[-0.02em] mb-3">
            Keep your score — and we&apos;ll keep watching.
          </h2>
          <p className="text-[14px] text-paper-2/70 leading-[1.55] mb-6 max-w-xl">
            Save this report to your dashboard. We&apos;ll keep your score, matched tenders, grants
            and fixes current — and alert you when new matches post.
          </p>
          <div className="flex flex-wrap items-baseline gap-6 pt-6 border-t border-paper-2/15">
            <button
              onClick={() => setSignupOpen(true)}
              className="bg-paper text-ink font-mono text-[11px] tracking-[0.14em] uppercase px-7 py-3.5 hover:bg-accent-2 transition-colors"
            >
              Save report → sign up
            </button>
          </div>
        </>
      )}

      <SignupSheet open={signupOpen} onClose={() => setSignupOpen(false)} />
    </section>
  );
}
