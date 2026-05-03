"use client";

import { useEffect, useState } from "react";

/* ============================================================
   Hero — Direction A · Editorial dossier
   - Eyebrow as issue/edition tag
   - Fraunces display headline with italic accent on "qualify"
   - Score counter-ups from 0 → 74 on load
   - Right column is a real readiness card (not a sample card)
   ============================================================ */

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
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
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
    <div className="relative w-full max-w-md">
      {/* paper offset shadow */}
      <div
        aria-hidden
        className="absolute inset-0 translate-x-2 translate-y-2 bg-paper-2"
      />
      <div className="relative bg-[#fffdf7] border border-rule p-6 lg:p-7">
        {/* file header */}
        <div className="flex items-baseline justify-between border-b border-rule pb-3 mb-4">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute">
            Vendor file · sample
          </span>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-accent">
            Tier 2 · Eligible
          </span>
        </div>

        {/* score */}
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[88px] leading-[0.85] tracking-[-0.04em] text-ink tabular-nums">
            {score}
          </span>
          <div>
            <span className="font-serif text-2xl text-mute">/100</span>
            <p className="text-xs text-ink-2 mt-1">Readiness score</p>
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
              className="grid grid-cols-[14px_1fr_auto] gap-3 items-center text-[13px] py-1 border-b border-dashed border-rule last:border-0"
              style={{
                opacity: 0,
                animation: start
                  ? `fadeInUp 0.45s ease-out forwards`
                  : "none",
                animationDelay: `${800 + i * 80}ms`,
              }}
            >
              <span
                className={`text-[11px] font-mono ${
                  item.ok ? "text-pos" : "text-accent"
                }`}
              >
                {item.ok ? "✓" : "○"}
              </span>
              <span className="text-ink-2">{item.label}</span>
              <span
                className={`font-mono text-[10px] ${
                  item.ok ? "text-mute" : "text-accent"
                }`}
              >
                {item.note}
              </span>
            </li>
          ))}
        </ul>

        {/* footer */}
        <div className="mt-5 pt-3 border-t border-rule flex items-center justify-between">
          <span className="font-mono text-[10px] text-mute tracking-[0.06em]">
            Generated 5 min · 12 matches
          </span>
          <a
            href="/assessment"
            className="font-mono text-[10px] tracking-[0.08em] uppercase text-ink border-b border-ink hover:text-accent hover:border-accent transition-colors"
          >
            Run mine →
          </a>
        </div>
      </div>
    </div>
  );
}

const TICKER_ITEMS = [
  ["WFP-LOG-26-0418", "Cold-chain logistics · Kenya", "$1.2–1.8M"],
  ["UNHCR-WASH-26-0188", "Borehole drilling · Jordan", "$680K"],
  ["UNICEF-ICT-26-0291", "School connectivity · Ghana", "$2.1M"],
  ["UNDP-CONS-26-0117", "Health centre rehab · Uganda", "$950K"],
  ["WHO-MED-26-0044", "Medical equipment supply · Egypt", "$1.4M"],
  ["UN-PROC-26-0533", "Office furniture · Nairobi HQ", "$220K"],
];

function LiveTicker() {
  return (
    <div
      className="border-y border-rule bg-paper-3 overflow-hidden"
      role="region"
      aria-label="Live tender feed"
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-8 flex items-center gap-6">
        {/* fixed label */}
        <div className="flex items-center gap-2 py-2.5 shrink-0 border-r border-rule pr-6">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-pos opacity-75 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pos" />
          </span>
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-mute">
            Live feed
          </span>
        </div>
        {/* marquee */}
        <div
          className="relative flex-1 overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 5%, black 95%, transparent)",
          }}
        >
          <div
            className="flex gap-10 whitespace-nowrap py-2.5 hover:[animation-play-state:paused]"
            style={{ animation: "ticker 40s linear infinite", width: "max-content" }}
          >
            {[...TICKER_ITEMS, ...TICKER_ITEMS].map(([ref, title, val], i) => (
              <span key={i} className="flex items-center gap-3 text-[12px]">
                <span className="font-mono text-[10px] text-accent tracking-wider">
                  {ref}
                </span>
                <span className="text-ink-2">{title}</span>
                <span className="font-mono text-[10px] text-mute">{val}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <>
      <LiveTicker />
      <section className="relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-7xl px-6 lg:px-8 py-16 lg:py-24">
          <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-20 items-start">
            {/* Left: editorial column */}
            <div className="max-w-xl">
              <p className="eyebrow mb-7" style={{ animation: "fadeIn 0.4s ease-out 60ms both" }}>
                Issue №01 · UN Procurement Brief
              </p>
              <h1
                className="display text-[44px] sm:text-[56px] lg:text-[64px] text-ink mb-7"
                style={{ animation: "fadeInUp 0.5s ease-out 120ms both" }}
              >
                You may already <em className="not-italic font-serif italic text-accent">qualify</em> for UN contracts<span className="text-accent">.</span>
              </h1>
              <p
                className="text-[17px] lg:text-lg text-ink-2 leading-[1.6] mb-9 max-w-lg"
                style={{ animation: "fadeInUp 0.5s ease-out 240ms both" }}
              >
                $25.7B went to UN suppliers in 2024 — most of it to vendors
                who already knew the system. Find out where you stand in five
                minutes, then decide whether to bid before the deadline closes.
              </p>

              <div
                className="flex flex-wrap items-center gap-5"
                style={{ animation: "fadeInUp 0.5s ease-out 360ms both" }}
              >
                <a
                  href="/assessment"
                  className="inline-flex items-center gap-3 bg-ink px-7 py-4 text-[14px] font-medium text-paper hover:bg-accent transition-colors"
                >
                  Get my readiness score
                  <span className="font-mono text-[13px]">→</span>
                </a>
                <a
                  href="#how-it-works"
                  className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink transition-colors border-b border-rule hover:border-ink pb-0.5"
                >
                  How it works
                </a>
              </div>

              <div
                className="mt-10 pt-6 border-t border-rule"
                style={{ animation: "fadeIn 0.5s ease-out 480ms both" }}
              >
                <p className="text-[11px] text-ink-3 leading-relaxed italic font-serif">
                  Built by someone who spent years inside WFP reviewing supplier
                  bids — and kept seeing qualified vendors lose on paperwork.
                </p>
                <p className="font-mono text-[10px] text-mute mt-3 tracking-[0.06em]">
                  1,200+ assessments run · 15+ UN agencies covered ·{" "}
                  <a href="/login" className="text-ink hover:text-accent border-b border-ink hover:border-accent">
                    Sign in →
                  </a>
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
