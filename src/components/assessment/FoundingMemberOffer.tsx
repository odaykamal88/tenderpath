"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "tp_founding_offer_dismissed";

export function FoundingMemberOffer() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable — skip
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="relative bg-paper w-full max-w-md border border-ink shadow-2xl">
        {/* Close */}
        <button
          onClick={dismiss}
          aria-label="Dismiss offer"
          className="absolute top-4 right-4 font-mono text-[11px] tracking-[0.12em] text-ink-3 hover:text-ink"
        >
          ✕
        </button>

        {/* Top band */}
        <div className="bg-ink text-paper px-7 py-5">
          <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-accent mb-2">
            Founding member · First 100 only
          </p>
          <div className="flex items-baseline gap-3">
            <span className="font-serif text-[64px] leading-none tracking-[-0.03em]">33%</span>
            <div>
              <p className="font-serif text-[20px] leading-tight">off the monthly plan</p>
              <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-paper-2 mt-0.5">locked forever</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-7 py-6">
          {/* Price comparison */}
          <div className="grid grid-cols-2 border border-rule mb-6">
            <div className="p-4 border-r border-rule">
              <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-accent mb-2">Founding rate</p>
              <p className="font-serif text-[36px] leading-none tracking-[-0.02em] text-ink">$390</p>
              <p className="font-mono text-[10px] text-ink-3 mt-1">/year</p>
            </div>
            <div className="p-4">
              <p className="font-mono text-[9px] tracking-[0.16em] uppercase text-mute mb-2">Monthly plan</p>
              <p className="font-serif text-[36px] leading-none tracking-[-0.02em] text-ink-3 line-through">$588</p>
              <p className="font-mono text-[10px] text-mute mt-1">$49/mo × 12</p>
            </div>
          </div>

          {/* What's included */}
          <ul className="space-y-1.5 mb-6">
            {[
              "Weekly digest — 5–10 best-fit tenders & grants",
              "AI fit score for every opportunity",
              "Arabic + English delivery",
              "Deadline alerts",
              "Rate locked forever, never repriced",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[12.5px] text-ink-2 leading-snug">
                <span className="font-mono text-[10px] text-accent mt-0.5 shrink-0">·</span>
                {item}
              </li>
            ))}
          </ul>

          <a
            href="/pay?plan=founding-member"
            className="block w-full bg-ink text-paper text-center font-mono text-[11px] tracking-[0.14em] uppercase py-3.5 hover:bg-accent transition-colors"
          >
            Lock in founding rate — $390/yr →
          </a>

          <button
            onClick={dismiss}
            className="block w-full text-center font-mono text-[10px] tracking-[0.1em] uppercase text-mute hover:text-ink mt-3"
          >
            No thanks, I'll pay $49/mo
          </button>
        </div>
      </div>
    </div>
  );
}
