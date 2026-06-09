"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { C, F } from "@/components/workbench/tokens";
import { Eyebrow, Tag } from "@/components/workbench/ui";

/* The four dimensions the readiness score is actually built from. These mirror
   the real ReadinessDimensions the analysis produces (see analyze.ts /
   src/lib/types.ts) — no invented fifth dimension, no fabricated weights. The
   overall 0–100 score is judged across these four; we describe what each one
   reads rather than publishing a precise weight formula we don't run. */
const DIMENSIONS: [string, string][] = [
  ["Technical capability", "What you build, supply, or deliver — measured against what the matched tenders actually require."],
  ["Compliance", "UNGM registration, certifications, audited financials, and the mandatory policies evaluators screen for first."],
  ["Geography", "Where you operate versus where the contracts are being issued. The most common silent disqualifier on UN tenders."],
  ["Track record", "Comparable references and contract sizes you've delivered — the signal evaluators use to de-risk an award."],
];

/* Real sources the crawler + assessment cross-check against. No fabricated
   "real-time API" claims or freshness timestamps we can't stand behind. */
const SOURCES = [
  "UNGM vendor registry",
  "UN agency procurement portals",
  "EU Funding & Tenders",
  "Development-bank & donor feeds",
  "Your website + anything you upload",
];

function Sheet({ onClose }: { onClose: () => void }) {
  // Escape-to-close + body scroll lock while the slide-over is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const panel: CSSProperties = {
    position: "relative",
    width: "min(440px, 92vw)",
    height: "100%",
    background: C.paper,
    borderLeft: `1px solid ${C.rule}`,
    overflowY: "auto",
    animation: "tpSheetIn .26s ease",
    padding: "28px 30px 40px",
    boxSizing: "border-box",
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How we calculate your score"
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end" }}
    >
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.45)" }} />
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <Eyebrow color={C.accent}>Methodology</Eyebrow>
            <div
              style={{
                fontFamily: F.display,
                fontSize: 26,
                fontWeight: 400,
                letterSpacing: "-0.015em",
                color: C.ink,
                marginTop: 4,
              }}
            >
              How we calculate your score
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: `1px solid ${C.rule}`,
              cursor: "pointer",
              color: C.ink,
              padding: "5px 8px",
              fontFamily: F.mono,
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink2, lineHeight: 1.6, marginTop: 16 }}>
          Your readiness score blends four dimensions, scored from your profile and website and
          cross-checked against the live sources we track. Nothing here is a black box — every gap
          links back to the evidence that flagged it.
        </p>

        <Eyebrow style={{ marginTop: 24, marginBottom: 8 }}>The four dimensions</Eyebrow>
        {DIMENSIONS.map(([label, desc]) => (
          <div key={label} style={{ padding: "11px 0", borderBottom: `1px dashed ${C.ruleSoft}` }}>
            <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500 }}>{label}</div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.5, marginTop: 3 }}>{desc}</div>
          </div>
        ))}

        <Eyebrow style={{ marginTop: 24, marginBottom: 8 }}>What we check against</Eyebrow>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SOURCES.map((s) => (
            <Tag key={s}>{s}</Tag>
          ))}
        </div>

        <div style={{ marginTop: 24, padding: 16, background: C.white, border: `1px solid ${C.rule}` }}>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, fontWeight: 500 }}>Think a finding is wrong?</div>
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.5, marginTop: 4 }}>
            Each gap is tied to the source that flagged it. If something looks off, reply to your
            report email with the report ID and we&rsquo;ll re-check it against that source.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Self-contained trigger + slide-over. Drop one anywhere a "How we calculate"
 *  affordance is needed (report masthead, Score tab). Manages its own state. */
export function HowWeCalculate({
  label = "How we calculate",
  color = C.mute,
  withGlyph = true,
}: {
  label?: string;
  color?: string;
  withGlyph?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: 0,
          cursor: "pointer",
          fontFamily: F.mono,
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color,
          whiteSpace: "nowrap",
          padding: 0,
        }}
      >
        {withGlyph && (
          <span
            style={{
              width: 15,
              height: 15,
              borderRadius: 999,
              border: `1px solid ${C.rule}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
            }}
          >
            ?
          </span>
        )}
        {label}
      </button>
      {open && <Sheet onClose={() => setOpen(false)} />}
    </>
  );
}
