"use client";

/**
 * Confidence gate — Sprint 8 Fix 5.
 *
 * Renders an inline prompt above the service-intake form when the user's
 * assessment is low-confidence or multi-bucket. The goal is to convert
 * "confident-wrong" outputs (the EBBA / AERIX failure mode in the May 16
 * validation wave) into a one-question disambiguation, before any paid
 * service order.
 *
 * No API change in this MVP: the user's chosen primary sector is persisted
 * to localStorage keyed by work-order context. A follow-up PR can move the
 * persistence to the assessment row.
 */

import { useEffect, useMemo, useState } from "react";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

interface ConfidenceGateProps {
  /** The classified sector from the assessment, e.g. "Engineering, Security & ICT". */
  sector: string | null;
  /** The user-supplied description from the assessment. */
  description: string | null;
  companyName?: string | null;
  /** Scope for persistence — typically the work-order context this order belongs to. */
  scopeKey: string;
  /** Called when the user confirms or skips. The chosen value is the primary line of business
   *  if confirmed, or null if skipped. The parent should attach this to the intake payload. */
  onChosen?: (primarySector: string | null) => void;
}

const AMBIGUOUS_SECTORS = new Set(["General", "Other", "Unclassified", ""]);
// Use only `,` and `/` as multi-sector separators. `&` and " and " over-split
// legitimate single sectors like "Oil & Gas" and "Water and Waste Water Management".
const SPLIT_PATTERN = /[,/]/;

function parseCandidates(sector: string | null): string[] {
  if (!sector) return [];
  return sector
    .split(SPLIT_PATTERN)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !AMBIGUOUS_SECTORS.has(s))
    .slice(0, 6);
}

function isAmbiguous(sector: string | null, description: string | null): boolean {
  const cleanSector = (sector ?? "").trim();
  if (AMBIGUOUS_SECTORS.has(cleanSector)) return true;
  const candidates = parseCandidates(cleanSector);
  if (candidates.length >= 2) return true;
  const desc = (description ?? "").trim();
  if (desc.length > 0 && desc.length < 60) return true;
  return false;
}

function storageKey(scope: string): string {
  return `tp_confirmed_primary_sector_${scope}`;
}

export default function ConfidenceGate({
  sector,
  description,
  companyName,
  scopeKey,
  onChosen,
}: ConfidenceGateProps) {
  const ambiguous = useMemo(() => isAmbiguous(sector, description), [sector, description]);
  const candidates = useMemo(() => parseCandidates(sector), [sector]);

  const [chosen, setChosen] = useState<string | null>(null);
  const [custom, setCustom] = useState<string>("");
  const [skipped, setSkipped] = useState<boolean>(false);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Read persisted choice once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey(scopeKey));
      if (raw) {
        const parsed = JSON.parse(raw) as { primary: string | null; skipped?: boolean };
        if (parsed.primary) {
          setChosen(parsed.primary);
          onChosen?.(parsed.primary);
        } else if (parsed.skipped) {
          setSkipped(true);
          onChosen?.(null);
        }
      }
    } catch {
      // ignore parse errors; treat as unconfirmed.
    } finally {
      setLoaded(true);
    }
  }, [scopeKey, onChosen]);

  if (!ambiguous) return null;
  if (!loaded) return null;
  if (chosen || skipped) {
    // Render a small confirmation chip so the user knows their choice is locked.
    return (
      <div
        className="mb-4 rounded-sm border border-rule bg-paper-3/60 px-4 py-2.5 text-[12px] text-ink-2"
        style={{ fontFamily: MONO }}
      >
        {chosen ? (
          <>
            Primary line of business for this order:{" "}
            <span className="font-semibold text-ink">{chosen}</span>
            <button
              type="button"
              className="ml-3 text-[11px] uppercase tracking-[0.14em] underline-offset-2 hover:underline"
              onClick={() => {
                window.localStorage.removeItem(storageKey(scopeKey));
                setChosen(null);
                setSkipped(false);
                onChosen?.(null);
              }}
            >
              Change
            </button>
          </>
        ) : (
          <>
            Continuing with current sector classification.
            <button
              type="button"
              className="ml-3 text-[11px] uppercase tracking-[0.14em] underline-offset-2 hover:underline"
              onClick={() => {
                window.localStorage.removeItem(storageKey(scopeKey));
                setSkipped(false);
              }}
            >
              Reconsider
            </button>
          </>
        )}
      </div>
    );
  }

  const persist = (primary: string | null) => {
    try {
      window.localStorage.setItem(
        storageKey(scopeKey),
        JSON.stringify({ primary, skipped: primary == null }),
      );
    } catch {
      // localStorage may be unavailable; we still update local state.
    }
  };

  const confirm = (value: string) => {
    const v = value.trim();
    if (!v) return;
    setChosen(v);
    persist(v);
    onChosen?.(v);
  };

  const skip = () => {
    setSkipped(true);
    persist(null);
    onChosen?.(null);
  };

  return (
    <div className="mb-6 rounded-md border-l-2 border-amber-600 bg-amber-50/40 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800 mb-1.5" style={{ fontFamily: MONO }}>
        Confirm your primary line of business
      </div>
      <p className="text-[13px] text-ink leading-relaxed mb-3">
        We classified {companyName ? <span className="font-semibold">{companyName}</span> : "your company"} as
        {" "}
        <span className="font-semibold italic">&ldquo;{sector ?? "Unclassified"}&rdquo;</span>
        {candidates.length >= 2
          ? ` — that covers ${candidates.length} sectors and may produce a generic analysis.`
          : " — that classification is too thin to ground a sharp analysis."}
        {" "}Pick the single primary line of business that applies to <span className="font-semibold">this order</span>.
      </p>

      {candidates.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {candidates.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => confirm(c)}
              className="rounded-sm border border-rule bg-white px-2.5 py-1 text-[12px] text-ink hover:border-ink hover:text-ink transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Or type your primary line of business"
          className="flex-1 rounded-sm border border-rule bg-white px-3 py-2 text-[13px] text-ink placeholder:text-mute focus:border-ink focus:outline-none"
        />
        <button
          type="button"
          onClick={() => confirm(custom)}
          disabled={custom.trim().length === 0}
          className="rounded-sm bg-ink px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white hover:bg-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: MONO }}
        >
          Use for this order →
        </button>
      </div>

      <button
        type="button"
        onClick={skip}
        className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink transition-colors"
        style={{ fontFamily: MONO }}
      >
        Skip — continue with current classification
      </button>
    </div>
  );
}
