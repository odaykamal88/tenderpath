"use client";

import { useEffect, useState } from "react";
import type { LandingTender } from "@/lib/landing/recent-tenders";

/* Hero — Direction A · editorial dossier · mobile-tuned at 375px */

const CHECKLIST: Array<{ label: string; ok: boolean; note?: string }> = [
  { label: "Sector match · Logistics, WASH", ok: true, note: "82" },
  { label: "Geographic coverage · East Africa", ok: true, note: "85" },
  { label: "Compliance — ISO 9001 quality cert", ok: false, note: "Open" },
  { label: "Past performance · references", ok: true, note: "70" },
  { label: "Financial capacity · audited 3y", ok: false, note: "Open" },
];

function useCountUp(target: number, duration = 1500, start = false) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, start]);
  return n;
}

function ReadinessCard() {
  const [start, setStart] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStart(true), 320);
    return () => clearTimeout(t);
  }, []);
  const score = useCountUp(74, 1500, start);

  return (
    <div className="relative w-full max-w-md mx-auto lg:mx-0">
      <div aria-hidden className="absolute inset-0 translate-x-1.5 translate-y-1.5 sm:translate-x-2 sm:translate-y-2 bg-paper-2" />
      <div className="relative bg-[#fffdf7] border border-rule p-5 sm:p-6 lg:p-7">
        {/* file header */}
        <div className="flex items-baseline justify-between gap-2 border-b border-rule pb-3 mb-4">
          <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.14em] sm:tracking-[0.16em] uppercase text-mute">
            Vendor file · sample
          </span>
          <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.1em] sm:tracking-[0.12em] uppercase text-accent whitespace-nowrap">
            Tier 2 · Eligible
          </span>
        </div>

        {/* score */}
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[72px] sm:text-[88px] leading-[0.85] tracking-[-0.04em] text-ink tabular-nums">
            {score}
          </span>
          <div>
            <span className="font-serif text-xl sm:text-2xl text-mute">/100</span>
            <p className="text-[11px] sm:text-xs text-ink-2 mt-1">Readiness score</p>
          </div>
        </div>

        {/* score bar */}
        <div className="mt-4 h-[3px] bg-paper-2 relative">
          <div
            className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-[1500ms] ease-out"
            style={{ width: start ? "74%" : "0%" }}
          />
        </div>

        {/* checklist */}
        <ul className="mt-5 space-y-2">
          {CHECKLIST.map((item, i) => (
            <li
              key={item.label}
              className="grid grid-cols-[14px_1fr_auto] gap-3 items-center text-[12px] sm:text-[13px] py-1 border-b border-dashed border-rule last:border-0"
              style={{
                opacity: 0,
                animation: start ? `fadeInUp 0.45s ease-out forwards` : "none",
                animationDelay: `${800 + i * 80}ms`,
              }}
            >
              <span className={`text-[11px] font-mono ${item.ok ? "text-pos" : "text-accent"}`}>
                {item.ok ? "✓" : "○"}
              </span>
              <span className="text-ink-2 truncate">{item.label}</span>
              <span className={`font-mono text-[10px] shrink-0 ${item.ok ? "text-mute" : "text-accent"}`}>
                {item.note}
              </span>
            </li>
          ))}
        </ul>

        {/* footer */}
        <div className="mt-5 pt-3 border-t border-rule flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] sm:text-[10px] text-mute tracking-[0.06em]">
            Generated 5 min · 12 matches
          </span>
          <a
            href="/assessment"
            className="font-mono text-[10px] tracking-[0.08em] uppercase text-ink border-b border-ink hover:text-accent hover:border-accent transition-colors whitespace-nowrap"
          >
            Run mine →
          </a>
        </div>
      </div>
    </div>
  );
}

function LiveTicker({ tenders }: { tenders: LandingTender[] }) {
  const items = tenders.length
    ? tenders
    : [{ reference: "LIVE", title: "Recent UN opportunity", agency: "UN", country: "Global", value: null }];

  return (
    <div className="border-y border-rule bg-paper-3 overflow-hidden" role="region" aria-label="Live tender feed">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8 flex items-center gap-3 sm:gap-6">
        {/* fixed label */}
        <div className="flex items-center gap-2 py-2.5 shrink-0 border-r border-rule pr-3 sm:pr-6">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-pos opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pos" />
          </span>
          <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.14em] sm:tracking-[0.16em] uppercase text-mute">
            Live
          </span>
        </div>
        {/* marquee */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            maskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
            WebkitMaskImage: "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
          }}
        >
          <div
            className="flex gap-6 sm:gap-10 whitespace-nowrap py-2.5 hover:[animation-play-state:paused]"
            style={{ animation: "ticker 40s linear infinite", width: "max-content" }}
          >
            {[...items, ...items].map((item, i) => (
              <span key={i} className="flex items-center gap-3 text-[12px]">
                <span className="font-mono text-[10px] text-accent tracking-wider">
                  {item.reference}
                </span>
                <span className="text-ink-2">
                  {item.title} · {item.country}
                </span>
                <span className="font-mono text-[10px] text-mute">
                  {item.value ?? item.agency}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero({ tenders }: { tenders: LandingTender[] }) {
  return (
    <>
      <LiveTicker tenders={tenders} />
      <section className="relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-24">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 sm:gap-12 lg:gap-20 items-start">
            {/* Left: editorial column */}
            <div className="max-w-xl">
              <p className="eyebrow mb-5 sm:mb-7 text-[10px] sm:text-[11px]" style={{ animation: "fadeIn 0.4s ease-out 60ms both" }}>
                Issue №01 · UN Procurement Brief
              </p>
              <h1
                className="display text-[38px] sm:text-[56px] lg:text-[64px] leading-[1.04] sm:leading-[1.02] tracking-[-0.02em] text-ink mb-5 sm:mb-7 text-balance"
                style={{ animation: "fadeInUp 0.5s ease-out 120ms both" }}
              >
                You may already <em className="not-italic font-serif italic text-accent">qualify</em> for UN contracts<span className="text-accent">.</span>
              </h1>
              <p
                className="text-[15px] sm:text-[17px] lg:text-lg text-ink-2 leading-[1.6] mb-7 sm:mb-9 max-w-lg"
                style={{ animation: "fadeInUp 0.5s ease-out 240ms both" }}
              >
                $25.7B went to UN suppliers in 2024 — most of it to vendors who already knew the system. Find out where you stand in five minutes, then decide whether to bid before the deadline closes.
              </p>

              <div
                className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4 sm:gap-5"
                style={{ animation: "fadeInUp 0.5s ease-out 360ms both" }}
              >
                <a
                  href="/assessment"
                  className="inline-flex items-center justify-center sm:justify-start gap-3 bg-ink px-6 sm:px-7 py-4 text-[14px] font-medium text-paper hover:bg-accent transition-colors"
                >
                  Get my readiness score
                  <span className="font-mono text-[13px]">→</span>
                </a>
              </div>

              <div
                className="mt-8 sm:mt-10 pt-5 sm:pt-6 border-t border-rule"
                style={{ animation: "fadeIn 0.5s ease-out 480ms both" }}
              >
                <p className="text-[11.5px] sm:text-[11px] text-ink-3 leading-relaxed italic font-serif">
                  Built by someone who spent years inside WFP reviewing supplier bids — and kept seeing qualified vendors lose on paperwork.
                </p>
                <p className="font-mono text-[10px] text-mute mt-3 tracking-[0.06em]">
                  1,200+ assessments · 15+ UN agencies
                </p>
              </div>
            </div>

            {/* Right: readiness card */}
            <div className="flex justify-center lg:justify-end">
              <ReadinessCard />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
