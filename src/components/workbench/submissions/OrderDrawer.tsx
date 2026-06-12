"use client";

/* The order drawer (prototype: sub-tracker.jsx): stage timeline, receipt,
 * outcome + debrief loop, amendments / Q&A / agency-mail panel, deliverables
 * by envelope, carried-in flags, intake summary, and the append-only activity
 * log — every event labeled "You" or "TenderPath".
 *
 * Honesty line held throughout: we draft, the user signs and submits. The
 * final-mile shepherd guides; it never claims we filed on their behalf. */

import { useCallback, useEffect, useState } from "react";
import { C, F } from "../tokens";
import { Btn, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import type {
  ClientOrderAction,
  EnvelopeKey,
  SubmissionOrder,
} from "@/lib/submissions/types";
import { ENVELOPE_LABELS, flowFor } from "@/lib/submissions/flows";
import { STAGE_META, TIMELINE_ORDER } from "@/lib/submissions/stages";
import { agoLabel, clientAct, getOrder } from "./api";

const eyebrow: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: 9,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.mute,
  marginBottom: 10,
};

function StageChip({ order }: { order: SubmissionOrder }) {
  const styleFor: Record<string, { bg: string; fg: string; label: string }> = {
    intake: { bg: C.paper2, fg: C.ink2, label: "Intake" },
    drafting: { bg: C.accent, fg: C.white, label: "Drafting" },
    qa: { bg: C.accent, fg: C.white, label: "Quality check" },
    review: { bg: C.ink, fg: C.paper, label: "Your review" },
    revisions: { bg: C.warn, fg: C.white, label: "Revisions" },
    final: { bg: C.ink, fg: C.paper, label: "Final pack" },
    submitted: { bg: C.pos, fg: C.white, label: "Submitted" },
  };
  const s = styleFor[order.stage] ?? styleFor.intake;
  return (
    <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", background: s.bg, color: s.fg, padding: "3px 8px" }}>
      {s.label}
    </span>
  );
}

function money(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function Timeline({ order }: { order: SubmissionOrder }) {
  const stages = TIMELINE_ORDER.filter((s) => s !== "revisions" || order.round > 0);
  const currentIdx = stages.indexOf(order.stage);
  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
      {stages.map((s, i) => {
        const meta = STAGE_META[s];
        const done = i < currentIdx || order.stage === "submitted";
        const current = i === currentIdx && order.stage !== "submitted";
        return (
          <div key={s} style={{ display: "flex", gap: 13, padding: "13px 16px", borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none", background: current ? "#fbf8f1" : "transparent" }}>
            <span style={{ fontFamily: F.mono, fontSize: 11, color: done ? C.pos : current ? C.accent : C.rule, width: 14, flexShrink: 0, paddingTop: 1 }}>
              {done ? "✓" : current ? "●" : "○"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: F.sans, fontSize: 13.5, fontWeight: current ? 600 : 500, color: done || current ? C.ink : C.mute }}>
                  {meta.label}
                </span>
                {current && (
                  <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent }}>
                    Current
                  </span>
                )}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 3, lineHeight: 1.5 }}>
                {current && order.stageNote ? order.stageNote : meta.client}
              </div>
              {current && (s === "drafting" || s === "revisions") && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ height: 3, background: C.paper2, maxWidth: 260 }}>
                    <div style={{ height: 3, width: `${order.pct}%`, background: C.accent }} />
                  </div>
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: C.mute, marginTop: 5 }}>
                    {order.pct}% drafted · SLA {order.slaMins} min
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutcomePanel({
  order,
  busy,
  act,
}: {
  order: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const oc = order.outcome;
  if (order.stage !== "submitted") return null;
  if (oc.state === "pending") {
    return (
      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "14px 16px" }}>
        <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55 }}>
          Filed with the agency — outcome pending. We record it here the moment it&apos;s known.
        </span>
      </div>
    );
  }
  const won = oc.state === "won";
  const shortlisted = oc.state === "shortlisted";
  const headColor = won || shortlisted ? C.pos : C.neg;
  const debrief = oc.debrief;
  return (
    <div style={{ background: C.white, border: `1px solid ${won || shortlisted ? "#cfdfd2" : "#dcb8b8"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${C.ruleSoft}` }}>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: headColor }}>
          {won ? "Won — congratulations" : shortlisted ? "Shortlisted" : "Not selected — here's exactly why"}
        </span>
        {oc.decidedAt && (
          <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}>decided {shortDate(oc.decidedAt)}</span>
        )}
      </div>
      {(oc.scores ?? []).map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 14, padding: "10px 16px", borderBottom: `1px solid ${C.ruleSoft}` }}>
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, width: 130, flexShrink: 0, paddingTop: 2 }}>{k}</span>
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>{v}</span>
        </div>
      ))}
      {oc.state === "lost" && (
        <div style={{ padding: "13px 16px" }}>
          {!debrief && (
            <>
              <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.6, margin: 0 }}>
                You&apos;re entitled to know why — most vendors never ask. We request the debrief in procurement
                language and turn the answers into fixes.
              </p>
              <div style={{ marginTop: 10 }}>
                <Btn kind="primary" size="sm" disabled={busy} onClick={() => act({ action: "request_debrief" })}>
                  Request the debrief →
                </Btn>
              </div>
            </>
          )}
          {debrief?.state === "requested" && (
            <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.warn }}>
              Debrief requested — answers usually arrive within two weeks. We chase.
            </span>
          )}
          {debrief?.state === "received" && (
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginBottom: 8 }}>
                What changes next time — from the debrief
              </div>
              {debrief.lessons.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>—</span>
                  <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55 }}>{l}</span>
                </div>
              ))}
              <div style={{ fontFamily: F.mono, fontSize: 10, color: C.pos, marginTop: 8 }}>
                ✓ Applied to your drafting defaults and readiness score.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AmendmentsPanel({
  order,
  busy,
  act,
}: {
  order: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const [q, setQ] = useState("");
  const [fwd, setFwd] = useState("");
  const [showFwd, setShowFwd] = useState(false);
  return (
    <div>
      <div style={eyebrow}>Amendments, Q&A & agency mail</div>
      <div style={{ display: "grid", gap: 10 }}>
        {order.amendments.map((a) => (
          <div key={a.n} style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", background: C.accent, color: C.white, padding: "2px 7px", flexShrink: 0 }}>
                AMD
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{a.summary}</span>
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 12, color: C.pos, marginTop: 8, lineHeight: 1.55 }}>
              ✓ {a.action}
            </div>
          </div>
        ))}
        {order.qna.map((entry, i) => (
          <div key={i} style={{ background: C.white, border: `1px dashed ${C.rule}`, padding: "12px 14px" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, padding: "2px 7px", flexShrink: 0 }}>
                Q&A
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, lineHeight: 1.5, flex: 1 }}>{entry.q}</span>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 9, color: C.faint, marginTop: 6 }}>
              {agoLabel(entry.at)}
              {entry.via ? ` · ${entry.via}` : ""}
              {entry.src === "forward" ? " · forwarded by you" : entry.src === "lodged" ? " · lodged for you" : ""}
            </div>
            {entry.a ? (
              <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.pos, marginTop: 8, lineHeight: 1.55 }}>
                ✓ {entry.a}
                {entry.impact ? <span style={{ color: C.ink2 }}> — {entry.impact}</span> : null}
              </div>
            ) : (
              <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.warn, marginTop: 8 }}>
                {entry.src === "lodged" ? "Lodged — awaiting the agency's answer." : "Received — checking it against your draft."}
              </div>
            )}
          </div>
        ))}

        <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "13px 14px" }}>
          <p style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, margin: "0 0 9px", lineHeight: 1.55 }}>
            Something unclear in the notice? Ask — we phrase it in procurement language and lodge it
            anonymously before the Q&A deadline.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={q}
              placeholder="e.g. Does §4.2 require the deliverable in both languages?"
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: 1, fontFamily: F.sans, fontSize: 12.5, color: C.ink, border: `1px solid ${C.rule}`, padding: "9px 11px", outline: "none", borderRadius: 0, background: C.white }}
            />
            <Btn
              kind="primary"
              size="sm"
              disabled={busy || !q.trim()}
              onClick={() => {
                act({ action: "lodge_qna", q: q.trim() });
                setQ("");
              }}
            >
              Lodge it →
            </Btn>
          </div>
          <button
            onClick={() => setShowFwd((v) => !v)}
            style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 10 }}
          >
            {showFwd ? "− Hide" : "+ Got an agency reply? Paste it here"}
          </button>
          {showFwd && (
            <div style={{ marginTop: 8 }}>
              <textarea
                value={fwd}
                placeholder="Paste the agency's email or clarification text — we log it, answer it, and check it against your draft."
                onChange={(e) => setFwd(e.target.value)}
                rows={3}
                style={{ width: "100%", fontFamily: F.sans, fontSize: 12.5, color: C.ink, border: `1px solid ${C.rule}`, padding: "9px 11px", outline: "none", borderRadius: 0, resize: "vertical", background: C.white }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <Btn
                  kind="ghost"
                  size="sm"
                  disabled={busy || !fwd.trim()}
                  onClick={() => {
                    act({ action: "forward_agency_mail", text: fwd.trim() });
                    setFwd("");
                    setShowFwd(false);
                  }}
                >
                  Forward to TenderPath →
                </Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Shepherd({
  order,
  busy,
  act,
}: {
  order: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const [receipt, setReceipt] = useState(order.shepherd.receipt ?? "");
  const flow = flowFor(order.type);
  const checked = new Set(order.shepherd.checked);
  const allDone = flow.shepherd.every((s) => checked.has(s.id));
  if (order.stage !== "final") return null;
  return (
    <div>
      <div style={eyebrow}>Final mile — you sign and submit; we guide</div>
      <div style={{ background: C.white, border: `1px solid ${C.ink}` }}>
        {flow.shepherd.map((s, i) => {
          const on = checked.has(s.id);
          return (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => act({ action: "shepherd_toggle", item: s.id, done: !on })}
              style={{ display: "flex", gap: 12, width: "100%", textAlign: "left", padding: "12px 14px", background: "transparent", border: "none", borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none", cursor: "pointer", alignItems: "flex-start" }}
            >
              <span style={{ width: 15, height: 15, border: `1.5px solid ${on ? C.pos : C.rule}`, background: on ? C.pos : "transparent", color: C.white, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0, marginTop: 2 }}>
                {on ? "✓" : ""}
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 12.5, color: on ? C.mute : C.ink, lineHeight: 1.5, textDecoration: on ? "line-through" : "none" }}>
                {s.label}
              </span>
            </button>
          );
        })}
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.ruleSoft}` }}>
          <input
            value={receipt}
            placeholder="Submission receipt / reference number (optional)"
            onChange={(e) => setReceipt(e.target.value)}
            style={{ width: "100%", fontFamily: F.sans, fontSize: 12.5, color: C.ink, border: `1px solid ${C.rule}`, padding: "9px 11px", outline: "none", borderRadius: 0, background: C.white }}
          />
          <div style={{ marginTop: 10 }}>
            <Btn
              kind="gold"
              size="sm"
              full
              disabled={busy || !allDone}
              title={allDone ? undefined : "Complete every step first"}
              onClick={() => act({ action: "submit_final", receipt: receipt.trim() || null })}
            >
              {allDone ? "Mark as submitted to the agency →" : "Complete every step to confirm"}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OrderDrawer({
  orderId,
  initial,
  onClose,
  onOpenReader,
  onChanged,
}: {
  orderId: number;
  initial?: SubmissionOrder | null;
  onClose: () => void;
  onOpenReader: (order: SubmissionOrder) => void;
  onChanged: () => void;
}) {
  const mobile = useMedia("(max-width: 767px)");
  const [order, setOrder] = useState<SubmissionOrder | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const reload = useCallback(async () => {
    try {
      const { order: fresh } = await getOrder(orderId);
      setOrder(fresh);
    } catch {
      /* keep the stale copy visible */
    }
  }, [orderId]);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 20_000);
    return () => clearInterval(t);
  }, [reload]);

  const act = useCallback(
    async (action: ClientOrderAction) => {
      setBusy(true);
      setError(null);
      try {
        const { order: fresh } = await clientAct(orderId, action);
        setOrder(fresh);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed — try again.");
        reload();
      } finally {
        setBusy(false);
      }
    },
    [orderId, onChanged, reload],
  );

  if (!order) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
        <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.45)" }} />
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: mobile ? "100%" : 540, background: C.paper, padding: 24 }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mute }}>Loading order…</span>
        </div>
      </div>
    );
  }

  const envelopes: EnvelopeKey[] = ["technical", "financial", "forms"];
  const exportable = ["review", "revisions", "final", "submitted"].includes(order.stage);
  const carried = order.blockers.filter((b) => b.state !== "resolved");

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.45)" }} />
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: mobile ? "100%" : 540, background: C.paper, display: "flex", flexDirection: "column", borderLeft: `1px solid ${C.rule}` }}>
        {/* Header */}
        <div style={{ padding: "16px 22px 14px", borderBottom: `1px solid ${C.rule}`, background: C.white }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <StageChip order={order} />
            <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute }}>
              {order.type} · {order.ref} · {money(order.priceCents)} {order.paidAt ? "paid" : "payment pending"}
            </span>
            <button onClick={onClose} style={{ marginLeft: "auto", width: 30, height: 30, border: `1px solid ${C.rule}`, background: "transparent", color: C.ink, fontSize: 15, cursor: "pointer" }}>
              ×
            </button>
          </div>
          <h2 style={{ fontFamily: F.display, fontSize: 21, fontWeight: 400, color: C.ink, margin: "10px 0 0", letterSpacing: "-0.01em", lineHeight: 1.25 }}>
            {order.tender}
          </h2>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 6 }}>
            {[order.agency, order.due ? `due ${shortDate(order.due)}` : null, `updated ${agoLabel(order.updatedAt)}`]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>
            {order.paidAt && (
              <a
                href={`/api/dashboard/submission-orders/${order.id}/receipt`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, borderBottom: `1px solid ${C.ink}`, textDecoration: "none", paddingBottom: 1 }}
              >
                Receipt ↓
              </a>
            )}
            {!order.paidAt && (
              <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn }}>
                Payment wasn&apos;t completed — reopen the wizard to pay & start drafting.
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px 40px", display: "grid", gap: 26, alignContent: "start" }}>
          {error && (
            <div style={{ border: "1px solid #dcb8b8", background: "#fdf8f8", padding: "10px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>
              {error}
            </div>
          )}

          <OutcomePanel order={order} busy={busy} act={act} />

          <div>
            <div style={eyebrow}>Where it stands</div>
            <Timeline order={order} />
            {order.stage === "review" && (
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Btn kind="gold" size="sm" onClick={() => onOpenReader(order)}>
                  Open the draft reader →
                </Btn>
                <Btn kind="ghost" size="sm" disabled={busy} onClick={() => setNotesOpen((v) => !v)}>
                  Request changes
                </Btn>
              </div>
            )}
            {order.stage === "review" && notesOpen && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  value={notes}
                  placeholder="What should change? Be specific — quote the section if you can."
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  style={{ width: "100%", fontFamily: F.sans, fontSize: 12.5, color: C.ink, border: `1px solid ${C.rule}`, padding: "10px 12px", outline: "none", borderRadius: 0, resize: "vertical", background: C.white }}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                  <Btn
                    kind="primary"
                    size="sm"
                    disabled={busy || !notes.trim()}
                    onClick={() => {
                      act({ action: "request_changes", notes: notes.trim() });
                      setNotes("");
                      setNotesOpen(false);
                    }}
                  >
                    Send change requests →
                  </Btn>
                </div>
              </div>
            )}
            {order.stage === "revisions" && order.revisionNotes && (
              <div style={{ marginTop: 10, borderLeft: `2px solid ${C.warn}`, paddingLeft: 10, fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55 }}>
                Round {order.round} — your notes: “{order.revisionNotes}”
              </div>
            )}
          </div>

          <Shepherd order={order} busy={busy} act={act} />

          {order.paidAt && <AmendmentsPanel order={order} busy={busy} act={act} />}

          <div>
            <div style={eyebrow}>Deliverables — one ZIP per envelope, never merged</div>
            <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
              {envelopes.map((env) => {
                const docs = order.deliverables.filter((d) => d.envelope === env);
                if (docs.length === 0) return null;
                return (
                  <div key={env} style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 14px", background: C.paper2 }}>
                      <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.ink2 }}>
                        {ENVELOPE_LABELS[env]}
                      </span>
                      {exportable && (
                        <a
                          href={`/api/dashboard/submission-orders/${order.id}/export?envelope=${env}`}
                          style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent, textDecoration: "none" }}
                        >
                          ZIP ↓
                        </a>
                      )}
                    </div>
                    {docs.map((d) => (
                      <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                        <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, flex: 1, lineHeight: 1.4 }}>{d.name}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint }}>{d.fmt}</span>
                        <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: d.status === "ready" || d.status === "submitted" ? C.pos : d.status === "queued" ? C.faint : C.warn }}>
                          {d.status}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {exportable && (
                <div style={{ padding: "11px 14px" }}>
                  <a
                    href={`/api/dashboard/submission-orders/${order.id}/export?envelope=all`}
                    style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, borderBottom: `1px solid ${C.ink}`, textDecoration: "none", paddingBottom: 1 }}
                  >
                    Download all · {envelopes.filter((e) => order.deliverables.some((d) => d.envelope === e)).length} separate ZIPs ↓
                  </a>
                </div>
              )}
              {!exportable && (
                <div style={{ padding: "11px 14px", fontFamily: F.sans, fontSize: 11.5, color: C.faint }}>
                  Downloads unlock when the draft pack reaches your review.
                </div>
              )}
            </div>
          </div>

          {carried.length > 0 && (
            <div>
              <div style={eyebrow}>Flags carried in from intake</div>
              <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
                {carried.map((b, i) => (
                  <div key={b.id} style={{ display: "flex", gap: 10, padding: "11px 14px", borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none", alignItems: "flex-start" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: b.state === "open" ? C.neg : C.warn, flexShrink: 0, marginTop: 5 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, display: "block" }}>{b.label}</span>
                      <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute }}>{b.state}</span>
                      {b.note && <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, display: "block", marginTop: 2, lineHeight: 1.5 }}>{b.note}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.intake.length > 0 && (
            <div>
              <div style={eyebrow}>Intake summary</div>
              <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
                {order.intake.map(([k, v], i) => (
                  <div key={`${k}-${i}`} style={{ display: "flex", gap: 14, padding: "10px 14px", borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none" }}>
                    <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, width: 128, flexShrink: 0, paddingTop: 2 }}>{k}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.5 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.events.length > 0 && (
            <div>
              <div style={eyebrow}>Activity</div>
              <div style={{ borderLeft: `1px solid ${C.rule}`, paddingLeft: 14, display: "grid", gap: 12 }}>
                {[...order.events].reverse().map((e, i) => (
                  <div key={i}>
                    <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: e.by === "ops" ? C.accent : C.mute }}>
                      {e.by === "ops" ? "TenderPath" : "You"} · {agoLabel(e.at)}
                    </div>
                    <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5, marginTop: 2 }}>{e.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
