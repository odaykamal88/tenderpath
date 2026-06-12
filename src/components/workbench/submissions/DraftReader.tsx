"use client";

/* The draft reader — faithful port of the prototype's sub-reader.jsx. In-app
 * document preview for the review/final stages: each deliverable renders as
 * readable paper pages built from the order's OWN intake (docContent), with
 * approve / request-changes inline so the trust moment happens HERE, not in a
 * downloaded file. ←/→ page between deliverables; Esc closes. */

import { useEffect, useMemo, useRef, useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { ClientOrderAction, SubmissionOrder } from "@/lib/submissions/types";
import { docContent, type DocBlock } from "@/lib/submissions/doc-content";

function Block({ b, mobile }: { b: DocBlock; mobile: boolean }) {
  switch (b.b) {
    case "h1":
      return (
        <h1 style={{ fontFamily: F.display, fontSize: mobile ? 22 : 27, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, margin: "0 0 6px", paddingBottom: 12, borderBottom: `2px solid ${C.ink}` }}>
          {b.text}
        </h1>
      );
    case "h2":
      return <h2 style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: 700, color: C.ink, margin: "20px 0 0" }}>{b.text}</h2>;
    case "p":
      return (
        <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.75, color: C.ink2, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
          {b.text}
        </p>
      );
    case "kv":
      return (
        <div style={{ border: `1px solid ${C.ruleSoft}`, margin: "14px 0 0" }}>
          {b.rows.map(([k, v], i) => (
            <div key={`${k}-${i}`} style={{ display: "flex", gap: 14, padding: "7px 12px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
              <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, width: 110, flexShrink: 0, paddingTop: 2 }}>{k}</span>
              <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>{v}</span>
            </div>
          ))}
        </div>
      );
    case "list":
      return (
        <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
          {b.items.map((it, i) => (
            <li key={i} style={{ fontFamily: F.sans, fontSize: 12.5, lineHeight: 1.6, color: C.ink2, display: "flex", gap: 9 }}>
              <span style={{ color: C.accent, flexShrink: 0 }}>§</span>
              {it}
            </li>
          ))}
        </ul>
      );
    case "table": {
      const gridCols = `2.2fr ${b.head.slice(1).map(() => "1fr").join(" ")}`;
      return (
        <div style={{ border: `1px solid ${C.rule}`, margin: "14px 0 0", overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: gridCols, padding: "7px 12px", background: C.paper2, minWidth: mobile ? 380 : 420, gap: 8 }}>
            {b.head.map((c, i) => (
              <span key={c} style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, textAlign: i > 0 ? "right" : "left" }}>{c}</span>
            ))}
          </div>
          {b.rows.map((r, ri) => (
            <div key={ri} style={{ display: "grid", gridTemplateColumns: gridCols, padding: "8px 12px", borderTop: `1px solid ${C.ruleSoft}`, minWidth: mobile ? 380 : 420, gap: 8 }}>
              {r.map((cell, ci) => (
                <span key={ci} style={{ fontFamily: ci > 0 ? F.mono : F.sans, fontSize: ci > 0 ? 11.5 : 12.5, color: C.ink2, textAlign: ci > 0 ? "right" : "left", lineHeight: 1.5, fontVariantNumeric: "tabular-nums", whiteSpace: "pre-wrap" }}>
                  {cell}
                </span>
              ))}
            </div>
          ))}
          {b.foot && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", borderTop: `1.5px solid ${C.ink}`, background: "#fbf9f3", minWidth: mobile ? 380 : 420, boxSizing: "border-box", gap: 12 }}>
              <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.ink2 }}>{b.foot[0]}</span>
              <span style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 700, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{b.foot[1]}</span>
            </div>
          )}
        </div>
      );
    }
    case "note":
      return (
        <div style={{ margin: "16px 0 0", padding: "10px 13px", background: "#fdfaf2", border: `1px solid ${C.accent2}`, display: "flex", gap: 9 }}>
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent, flexShrink: 0, paddingTop: 2 }}>QA</span>
          <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.55 }}>{b.text}</span>
        </div>
      );
    case "sig":
      return (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, marginBottom: 18 }}>Yours faithfully,</div>
          <div style={{ width: 200, borderBottom: `1px solid ${C.ink}`, height: 26, position: "relative" }}>
            <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent, position: "absolute", bottom: 4 }}>
              sign here
            </span>
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: C.ink, marginTop: 7 }}>{b.name}</div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 2 }}>{b.role}</div>
        </div>
      );
    default:
      return null;
  }
}

export function DraftReader({
  order,
  startIdx = 0,
  busy,
  onClose,
  onAct,
}: {
  order: SubmissionOrder;
  startIdx?: number;
  busy: boolean;
  onClose: () => void;
  onAct: (a: ClientOrderAction) => void;
}) {
  const { data } = useWorkbench();
  const mobile = useMedia("(max-width: 767px)");
  const [idx, setIdx] = useState(startIdx);
  const [mode, setMode] = useState<null | "changes">(null);
  const [notes, setNotes] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const company = useMemo(
    () => ({
      name: data?.company.name || "Your company",
      signatory: data?.company.user || data?.company.name || "Authorized representative",
    }),
    [data],
  );
  const all = useMemo(() => docContent(order, company), [order, company]);
  const docs = order.deliverables;
  const doc = all[Math.min(idx, all.length - 1)];

  const canAct = order.stage === "review";
  const isFinal = order.stage === "final" || order.stage === "submitted";

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx((i) => Math.min(docs.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docs.length, onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 110, display: "flex", flexDirection: "column", background: "rgba(15,22,32,0.78)" }}>
      {/* top bar */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: mobile ? "10px 14px" : "12px 22px", background: C.ink, color: C.paper, borderBottom: "1px solid #2b3543" }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent2 }}>
            {order.type} · {order.ref} · {isFinal ? "final pack" : `draft for your review · round ${order.round + 1}`}
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
            {order.tender}
          </div>
        </div>
        <a
          href={`/api/dashboard/submission-orders/${order.id}/export?deliverable=${idx}`}
          style={{ background: "transparent", border: "1px solid #3a4654", color: C.paper, padding: "7px 11px", cursor: "pointer", fontFamily: F.mono, fontSize: 10, flexShrink: 0, textDecoration: "none" }}
        >
          Download ↓
        </a>
        <button
          onClick={onClose}
          aria-label="Close reader"
          style={{ background: "transparent", border: "1px solid #3a4654", color: C.paper, width: 30, height: 30, cursor: "pointer", fontSize: 14, lineHeight: 1, flexShrink: 0 }}
        >
          ✕
        </button>
      </div>

      {/* doc tabs */}
      <div style={{ flexShrink: 0, display: "flex", gap: 0, background: C.ink, padding: mobile ? "0 8px" : "0 16px", overflowX: "auto" }}>
        {docs.map((d, i) => (
          <button
            key={d.name}
            onClick={() => setIdx(i)}
            style={{ background: i === idx ? "#fffdf8" : "transparent", color: i === idx ? C.ink : "#8a94a1", border: 0, borderTop: `2px solid ${i === idx ? C.accent : "transparent"}`, padding: "9px 14px", cursor: "pointer", fontFamily: F.sans, fontSize: 11.5, fontWeight: i === idx ? 600 : 400, whiteSpace: "nowrap" }}
          >
            {i + 1}. {mobile && d.name.length > 34 ? `${d.name.slice(0, 32)}…` : d.name}
          </button>
        ))}
      </div>

      {/* page */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: mobile ? "16px 10px 30px" : "26px 20px 40px" }}>
        <div style={{ maxWidth: 700, margin: "0 auto", position: "relative" }}>
          <div style={{ background: "#fffdf8", border: `1px solid ${C.rule}`, boxShadow: "0 16px 44px rgba(15,22,32,0.35)", padding: mobile ? "30px 22px 40px" : "48px 52px 56px", position: "relative" }}>
            <div style={{ position: "absolute", top: 18, right: 18, transform: "rotate(-4deg)", border: `1.5px solid ${isFinal ? C.pos : C.accent}`, color: isFinal ? C.pos : C.accent, fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", padding: "4px 9px", opacity: 0.85 }}>
              {isFinal ? "Final · submission copy" : "Draft · QA passed"}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginBottom: 18 }}>
              {company.name} · {doc?.fmt} · prepared by TenderPath
            </div>
            {doc?.blocks.map((b, i) => <Block key={i} b={b} mobile={mobile} />)}
          </div>
          {/* pager */}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
              style={{ visibility: idx === 0 ? "hidden" : "visible", background: "transparent", border: 0, color: "#aab3bf", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
            >
              ← {idx > 0 ? docs[idx - 1].name.split("—")[0] : ""}
            </button>
            <button
              onClick={() => setIdx((i) => Math.min(docs.length - 1, i + 1))}
              style={{ visibility: idx === docs.length - 1 ? "hidden" : "visible", background: "transparent", border: 0, color: "#aab3bf", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}
            >
              {idx < docs.length - 1 ? docs[idx + 1].name.split("—")[0] : ""} →
            </button>
          </div>
        </div>
      </div>

      {/* action bar (review only) */}
      {canAct && (
        <div style={{ flexShrink: 0, background: C.white, borderTop: `1px solid ${C.rule}`, padding: mobile ? "12px 14px" : "14px 22px" }}>
          {mode !== "changes" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 700, margin: "0 auto", flexWrap: "wrap" }}>
              <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, flex: 1, minWidth: 180, lineHeight: 1.5 }}>
                Read all {docs.length} documents — check names, figures and the financial section before approving.
              </span>
              <Btn kind="ghost" size="sm" onClick={() => setMode("changes")}>Request changes</Btn>
              <Btn kind="gold" size="sm" disabled={busy} onClick={() => onAct({ action: "approve" })}>
                Approve — prepare final pack →
              </Btn>
            </div>
          ) : (
            <div style={{ maxWidth: 700, margin: "0 auto" }}>
              <textarea
                rows={2}
                autoFocus
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Be specific — “rate for line 4 should be 8,200”, “lead expert name is misspelled in CV annex”…"
                style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 13, padding: "9px 11px", border: `1px solid ${C.rule}`, outline: "none", resize: "vertical", lineHeight: 1.5, borderRadius: 0 }}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 8, justifyContent: "flex-end" }}>
                <Btn kind="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Btn>
                <Btn
                  kind="primary"
                  size="sm"
                  disabled={busy || !notes.trim()}
                  onClick={() => {
                    onAct({ action: "request_changes", notes: notes.trim() });
                    setNotes("");
                    setMode(null);
                  }}
                >
                  Send revision request →
                </Btn>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
