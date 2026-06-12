"use client";

/* The in-app draft reader (prototype: sub-reader.jsx) — the trust moment.
 * Each deliverable renders as readable document pages built from the order's
 * OWN intake via docContent(); the PDF export renders the same block model, so
 * what the client approves here is what they download.
 *
 * Stamps: "DRAFT · QA PASSED" while in review → "FINAL · SUBMISSION COPY"
 * after approval. Signature points are explicit — nothing leaves unsigned
 * silently. Approve / request-changes live in the action bar (review stage),
 * mirroring the same actions in the drawer. */

import { useMemo, useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { ClientOrderAction, SubmissionOrder } from "@/lib/submissions/types";
import { docContent, type DocBlock } from "@/lib/submissions/doc-content";
import { ENVELOPE_LABELS } from "@/lib/submissions/flows";

function ReaderBlock({ block }: { block: DocBlock }) {
  switch (block.b) {
    case "h1":
      return (
        <h1 style={{ fontFamily: F.display, fontSize: 30, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, margin: "0 0 16px", paddingBottom: 12, borderBottom: `2px solid ${C.ink}` }}>
          {block.text}
        </h1>
      );
    case "h2":
      return (
        <h2 style={{ fontFamily: F.sans, fontSize: 15, fontWeight: 600, color: C.ink, margin: "22px 0 8px" }}>
          {block.text}
        </h2>
      );
    case "p":
      return (
        <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.7, color: C.ink2, margin: "0 0 12px", whiteSpace: "pre-wrap" }}>
          {block.text}
        </p>
      );
    case "kv":
      return (
        <div style={{ borderTop: `1px solid ${C.rule}`, margin: "14px 0" }}>
          {block.rows.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", gap: 18, padding: "9px 0", borderBottom: `1px solid ${C.ruleSoft}` }}>
              <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute, width: 120, flexShrink: 0, paddingTop: 3 }}>
                {k}
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, lineHeight: 1.55 }}>{v}</span>
            </div>
          ))}
        </div>
      );
    case "list":
      return (
        <div style={{ margin: "10px 0 14px", display: "grid", gap: 7 }}>
          {block.items.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 10 }}>
              <span style={{ fontFamily: F.mono, fontSize: 12, color: C.faint }}>·</span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div style={{ margin: "14px 0", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th
                    key={i}
                    style={{
                      fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase",
                      color: C.mute, textAlign: block.align?.[i] === "r" ? "right" : "left",
                      padding: "8px 10px", background: "#f3efe5", borderBottom: `1px solid ${C.rule}`,
                      fontWeight: 500, whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      style={{
                        fontFamily: ci === 0 ? F.sans : F.mono,
                        fontSize: ci === 0 ? 12.5 : 12,
                        color: ci === 0 ? C.ink : C.ink2,
                        textAlign: block.align?.[ci] === "r" ? "right" : "left",
                        padding: "9px 10px",
                        borderBottom: `1px solid ${C.ruleSoft}`,
                        lineHeight: 1.5,
                        verticalAlign: "top",
                        whiteSpace: "pre-wrap",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "note":
      return (
        <div style={{ borderLeft: `2px solid ${C.accent2}`, background: "#fbf8f1", padding: "10px 14px", margin: "14px 0" }}>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.6 }}>{block.text}</span>
        </div>
      );
    case "sig":
      return (
        <div style={{ marginTop: 30 }}>
          <div style={{ width: 240, borderBottom: `1px solid ${C.ink}`, height: 30 }} />
          <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginTop: 6 }}>
            {block.label}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function DraftReader({
  order,
  busy,
  onClose,
  onAct,
}: {
  order: SubmissionOrder;
  busy: boolean;
  onClose: () => void;
  onAct: (a: ClientOrderAction) => void;
}) {
  const { data } = useWorkbench();
  const mobile = useMedia("(max-width: 767px)");
  const [tab, setTab] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const company = data?.company.name || "Your company";
  const docs = useMemo(() => docContent(order, company), [order, company]);
  const doc = docs[Math.min(tab, docs.length - 1)];

  const isFinal = order.stage === "final" || order.stage === "submitted";
  const stamp = isFinal ? "FINAL · SUBMISSION COPY" : "DRAFT · QA PASSED";
  const crumb = [
    order.type,
    order.ref,
    isFinal ? "FINAL PACK" : "DRAFT FOR YOUR REVIEW",
    order.round > 0 ? `ROUND ${order.round + 1}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95, background: C.spine, display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: mobile ? "10px 14px" : "12px 24px", flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent2 }}>
            {crumb}
          </div>
          <div style={{ fontFamily: F.sans, fontSize: mobile ? 13 : 14.5, fontWeight: 600, color: C.paper, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {order.tender}
          </div>
        </div>
        <a
          href={`/api/dashboard/submission-orders/${order.id}/export?envelope=all`}
          style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.paper, border: "1px solid #3a4250", padding: "8px 13px", textDecoration: "none", flexShrink: 0 }}
        >
          Download ↓
        </a>
        <button
          onClick={onClose}
          style={{ width: 34, height: 34, border: "1px solid #3a4250", background: "transparent", color: C.paper, fontSize: 16, cursor: "pointer", flexShrink: 0 }}
        >
          ×
        </button>
      </div>

      {/* Deliverable tabs */}
      <div style={{ display: "flex", gap: 2, padding: mobile ? "0 14px" : "0 24px", flexShrink: 0, overflowX: "auto" }}>
        {docs.map((d, i) => (
          <button
            key={d.name}
            onClick={() => setTab(i)}
            style={{
              fontFamily: F.sans,
              fontSize: 12,
              fontWeight: i === tab ? 600 : 400,
              color: i === tab ? C.ink : "#9aa3af",
              background: i === tab ? C.paper : "transparent",
              border: "none",
              padding: "10px 16px",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {i + 1}. {d.name}
          </button>
        ))}
      </div>

      {/* Document page */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: mobile ? "18px 12px 90px" : "28px 24px 110px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", position: "relative", background: "#fffdf8", border: `1px solid ${C.rule}`, boxShadow: "0 18px 50px rgba(0,0,0,0.35)", padding: mobile ? "26px 20px 40px" : "44px 52px 60px" }}>
          {/* Stamp */}
          <div
            style={{
              position: "absolute",
              top: mobile ? 12 : 24,
              right: mobile ? 12 : 28,
              transform: "rotate(6deg)",
              fontFamily: F.mono,
              fontSize: 9,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: isFinal ? C.pos : C.accent,
              border: `1.5px solid ${isFinal ? C.pos : C.accent}`,
              padding: "5px 10px",
              background: "rgba(255,253,248,0.92)",
            }}
          >
            {stamp}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.mute, marginBottom: 22 }}>
            {company} · {doc?.fmt} · prepared by TenderPath · {ENVELOPE_LABELS[doc?.envelope as keyof typeof ENVELOPE_LABELS] ?? ""}
          </div>
          {doc?.blocks.map((b, i) => <ReaderBlock key={i} block={b} />)}
        </div>
      </div>

      {/* Action bar */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(15,22,32,0.97)", borderTop: "1px solid #2b3543", padding: mobile ? "12px 14px" : "14px 24px" }}>
        {order.stage === "review" ? (
          notesOpen ? (
            <div style={{ maxWidth: 880, margin: "0 auto" }}>
              <textarea
                value={notes}
                placeholder="What should change? Be specific — quote the section if you can."
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                autoFocus
                style={{ width: "100%", fontFamily: F.sans, fontSize: 13, color: C.ink, border: `1px solid ${C.rule}`, padding: "10px 12px", outline: "none", borderRadius: 0, resize: "vertical", background: C.white }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <Btn kind="ghost" size="sm" onClick={() => setNotesOpen(false)} style={{ borderColor: "#3a4250", color: C.paper }}>
                  Cancel
                </Btn>
                <Btn
                  kind="gold"
                  size="sm"
                  disabled={busy || !notes.trim()}
                  onClick={() => {
                    onAct({ action: "request_changes", notes: notes.trim() });
                    setNotes("");
                    setNotesOpen(false);
                  }}
                >
                  Send change requests →
                </Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 880, margin: "0 auto", flexWrap: "wrap" }}>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: "#9aa3af", flex: 1, minWidth: 200, lineHeight: 1.5 }}>
                Read all {docs.length} documents — check names, figures and the financial section before approving.
              </span>
              <Btn kind="ghost" size="sm" disabled={busy} onClick={() => setNotesOpen(true)} style={{ borderColor: "#3a4250", color: C.paper }}>
                Request changes
              </Btn>
              <Btn kind="gold" size="sm" disabled={busy} onClick={() => onAct({ action: "approve" })}>
                Approve — prepare final pack →
              </Btn>
            </div>
          )
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: 880, margin: "0 auto" }}>
            <span style={{ fontFamily: F.sans, fontSize: 12, color: "#9aa3af", flex: 1, lineHeight: 1.5 }}>
              {isFinal
                ? "Final submission copy — sign at every marked point, then submit each envelope to its own slot."
                : "This pack is in production — the reader unlocks for approval at the review stage."}
            </span>
            <Btn kind="ghost" size="sm" onClick={onClose} style={{ borderColor: "#3a4250", color: C.paper }}>
              Close
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
