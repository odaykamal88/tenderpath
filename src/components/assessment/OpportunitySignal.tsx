"use client";

import { useEffect, useState } from "react";

/**
 * Live "opportunity signal" strip shown in the assessment wizard once the user
 * has picked at least one sector (Step 2) and one country (Step 1). It tells
 * them how big the live opportunity pool in their space is — the launch
 * "wow" moment — and nudges them to finish. Backed by real corpus counts via
 * /api/assessment/opportunity-signal; renders nothing until there's a signal,
 * so it never flashes a discouraging zero or a spinner.
 */

interface Signal {
  tenders: number;
  agencies: number;
  closingSoon: number;
  grants: number;
  mappedSectors: string[];
}

function summarize(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items[0]} +${items.length - 1} more`;
}

export default function OpportunitySignal({
  sectors,
  countries,
}: {
  sectors: string[];
  countries: string[];
}) {
  const [signal, setSignal] = useState<Signal | null>(null);

  // Encode the input sets as stable primitive keys so the effect only re-runs
  // when the actual sector/country selection changes — not on every render
  // (the arrays are fresh refs each time the wizard re-renders).
  const sectorsKey = [...sectors].sort().join("|");
  const countriesKey = [...countries].sort().join("|");

  useEffect(() => {
    let cancelled = false;
    // Debounce: users toggle several sector chips in quick succession. All
    // setState happens inside this async callback (never synchronously in the
    // effect body) to satisfy react-hooks/set-state-in-effect.
    const handle = setTimeout(() => {
      if (!sectorsKey || !countriesKey) {
        if (!cancelled) setSignal(null);
        return;
      }
      const params = new URLSearchParams({ sectors: sectorsKey.replaceAll("|", ","), countries: countriesKey.replaceAll("|", ",") });
      fetch(`/api/assessment/opportunity-signal?${params.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled) setSignal((data?.signal as Signal | null) ?? null);
        })
        .catch(() => {
          if (!cancelled) setSignal(null);
        });
    }, 650);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [sectorsKey, countriesKey]);

  if (!signal || signal.tenders <= 0) return null;

  const sectorLabel = summarize(signal.mappedSectors.length ? signal.mappedSectors : sectors);
  const geoLabel = summarize(countries);

  const facets = [
    `${signal.agencies} ${signal.agencies === 1 ? "agency" : "agencies"}`,
    signal.closingSoon > 0 ? `${signal.closingSoon} closing within 30 days` : null,
    signal.grants > 0 ? `${signal.grants} grant${signal.grants === 1 ? "" : "s"} you may be eligible for` : null,
  ].filter(Boolean);

  return (
    <div className="border-l-2 border-accent bg-paper-2 px-5 py-4 mb-8">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-pos opacity-75 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pos" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-accent">
          Live opportunity signal
        </span>
      </div>

      <p className="text-[15px] sm:text-[16px] text-ink-2 leading-[1.5]">
        <span className="font-serif text-[28px] sm:text-[32px] text-ink tabular-nums align-baseline mr-1.5">
          {signal.tenders}
        </span>
        open UN {signal.tenders === 1 ? "tender" : "tenders"} in{" "}
        <span className="text-ink font-medium">{sectorLabel}</span> across{" "}
        <span className="text-ink font-medium">{geoLabel}</span> right now.
      </p>

      {facets.length > 0 && (
        <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-mute mt-2.5">
          {facets.join(" · ")}
        </p>
      )}

      <p className="text-[12px] text-ink-3 mt-2 leading-snug max-w-md">
        Finish your assessment to see which you&rsquo;re ready to win — and the gaps to close first.
      </p>
    </div>
  );
}
