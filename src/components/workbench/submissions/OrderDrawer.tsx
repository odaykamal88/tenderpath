"use client";

/* The order tracker drawer — faithful port of the prototype's sub-tracker.jsx.
 * Full per-type timeline, draft review with approve / request-changes, the
 * final-pack shepherd that walks the vendor through portal submission, the
 * outcome + debrief loop, and amendments / Q&A / agency mail.
 *
 * Honesty line held: we draft, the user signs and submits. Production
 * deviation from the prototype: the per-order inbound address isn't shown
 * (inbound mail is unprovisioned) — agency replies are pasted instead. */

import { useCallback, useEffect, useState } from "react";
import { C, F } from "../tokens";
import { Bar, Btn, deadlineLabel, SevDot, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import type { ClientOrderAction, EnvelopeKey, SubmissionOrder, SubmissionStage } from "@/lib/submissions/types";
import { ENVELOPE_LABELS, shepherdSteps } from "@/lib/submissions/flows";
import { STAGE_META, STAGES, stageIndex } from "@/lib/submissions/stages";
import { agoLabel, clientAct, getOrder } from "./api";
import { COMMERCE_ENABLED } from "@/lib/commerce";

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Eyebrow({ children, color = C.mute }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color }}>
      {children}
    </div>
  );
}

function stageColor(stage: SubmissionStage): string {
  return stage === "submitted" ? C.pos : stage === "review" ? C.blue : stage === "final" ? C.accent : C.warn;
}

/* ── stage timeline ────────────────────────────────────────────────────── */

function Timeline({ o }: { o: SubmissionOrder }) {
  const idx = stageIndex(o.stage);
  const stages = STAGES.filter((s) => s !== "revisions" || o.round > 0 || o.stage === "revisions");
  return (
    <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
      {stages.map((s, i) => {
        const si = stageIndex(s);
        const state = si < idx || o.stage === "submitted" && s === "submitted" ? (s === o.stage ? "now" : "done") : si === idx ? "now" : "next";
        const meta = STAGE_META[s];
        return (
          <div key={s} style={{ display: "flex", gap: 14, padding: "11px 16px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0, background: state === "now" ? "#fbf9f3" : "transparent" }}>
            <span style={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 2 }}>
              {state === "done" ? (
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.pos }}>✓</span>
              ) : state === "now" ? (
                <span style={{ width: 9, height: 9, borderRadius: 999, background: C.accent, marginTop: 3, boxShadow: `0 0 0 3px ${C.accent2}33` }} />
              ) : (
                <span style={{ width: 7, height: 7, borderRadius: 999, border: `1.5px solid ${C.rule}`, marginTop: 3 }} />
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: state === "now" ? 600 : 400, color: state === "next" ? C.faint : C.ink }}>
                  {meta.user}
                </span>
                {state === "now" && (
                  <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent }}>current</span>
                )}
              </div>
              {state !== "next" && (
                <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 2, lineHeight: 1.45 }}>
                  {state === "now" ? o.stageNote || meta.desc : meta.desc}
                </div>
              )}
              {state === "now" && o.stage === "drafting" && (
                <div style={{ marginTop: 8, maxWidth: 260 }}>
                  <Bar value={o.pct} height={3} />
                  <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute }}>{o.pct}% drafted · SLA {o.slaMins} min</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── deliverables (read in-app · export per envelope — never merged) ───── */

function Deliverables({
  o,
  onRead,
}: {
  o: SubmissionOrder;
  onRead: (idx: number) => void;
}) {
  const readable = o.stage === "review" || o.stage === "final" || o.stage === "submitted";
  const exportable = o.stage === "final" || o.stage === "submitted";
  const groups: EnvelopeKey[] = [];
  o.deliverables.forEach((d) => {
    if (!groups.includes(d.envelope)) groups.push(d.envelope);
  });
  return (
    <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
      {o.deliverables.map((d, i) => (
        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={readable ? C.accent : C.faint} strokeWidth="1.4">
            <path d="M4 2.5h5l3 3v8H4z" />
            <path d="M9 2.5V6h3" />
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, display: "block" }}>{d.name}</span>
            <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint }}>
              {d.fmt} · {ENVELOPE_LABELS[d.envelope].toLowerCase()}
            </span>
          </span>
          {readable ? (
            <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <Btn size="sm" kind="ghost" onClick={() => onRead(i)}>Read →</Btn>
              {exportable && (
                <a href={`/api/dashboard/submission-orders/${o.id}/export?deliverable=${i}`} style={{ textDecoration: "none" }}>
                  <Btn size="sm" kind="ghost">↓</Btn>
                </a>
              )}
            </span>
          ) : (
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: d.status === "drafting" ? C.warn : C.faint }}>
              {d.status}
            </span>
          )}
        </div>
      ))}
      {exportable && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${C.ink}`, background: "#fbf9f3" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute, marginBottom: 8 }}>
            Export — envelopes stay separate
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {groups.map((g) => (
              <a key={g} href={`/api/dashboard/submission-orders/${o.id}/export?envelope=${g}`} style={{ textDecoration: "none" }}>
                <Btn size="sm" kind="ghost">{ENVELOPE_LABELS[g]} ↓</Btn>
              </a>
            ))}
            <a href={`/api/dashboard/submission-orders/${o.id}/export?envelope=all`} style={{ textDecoration: "none" }}>
              <Btn size="sm" kind="ghost">All · {groups.length} separate ZIPs ↓</Btn>
            </a>
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.mute, lineHeight: 1.5, marginTop: 7 }}>
            Each envelope exports as its own file set, named per the portal&apos;s convention — upload them to
            their own slots, never as one merged document.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── review actions: read · approve · request changes ──────────────────── */

function ReviewActions({
  busy,
  act,
  onRead,
}: {
  busy: boolean;
  act: (a: ClientOrderAction) => void;
  onRead: (idx: number) => void;
}) {
  const [mode, setMode] = useState<null | "changes">(null);
  const [notes, setNotes] = useState("");
  return (
    <div style={{ border: `1px solid ${C.accent2}`, background: "#fdfaf2", padding: "16px 18px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent, marginBottom: 8 }}>
        Your review — unlimited revisions until you approve
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.6, margin: "0 0 14px" }}>
        The draft pack passed our QA gate. Read every document in the reader — especially names, figures
        and the financial section. Approve only when you&apos;d be happy for an evaluator to read it.
      </p>
      {mode !== "changes" ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn kind="gold" onClick={() => onRead(0)}>Read the draft pack →</Btn>
          <Btn kind="primary" disabled={busy} onClick={() => act({ action: "approve" })}>Approve — prepare final pack</Btn>
          <Btn kind="ghost" onClick={() => setMode("changes")}>Request changes</Btn>
        </div>
      ) : (
        <div>
          <textarea
            rows={3}
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Be specific — “rate for line 4 should be 8,200”, “lead expert name is misspelled in CV annex”…"
            style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 13, padding: "10px 12px", border: `1px solid ${C.rule}`, outline: "none", resize: "vertical", lineHeight: 1.5, background: C.white, borderRadius: 0 }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <Btn
              kind="primary"
              disabled={busy || !notes.trim()}
              onClick={() => {
                act({ action: "request_changes", notes: notes.trim() });
                setNotes("");
                setMode(null);
              }}
            >
              Send revision request →
            </Btn>
            <Btn kind="ghost" onClick={() => setMode(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── final-pack shepherd: guided portal submission ─────────────────────── */

function Shepherd({
  o,
  busy,
  act,
}: {
  o: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const [receipt, setReceipt] = useState(o.shepherd.receipt ?? "");
  const steps = shepherdSteps(o.type, o.portal, o.due);
  const checked = new Set(o.shepherd.checked);
  const allTicked = steps.every((s) => checked.has(s.id));
  return (
    <div style={{ border: `1px solid ${C.ink}`, background: C.white }}>
      <div style={{ padding: "12px 16px", background: C.ink, color: C.paper, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          Final mile — submit without errors
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.accent2 }}>
          {steps.filter((s) => checked.has(s.id)).length}/{steps.length}
        </span>
      </div>
      {steps.map((st, i) => {
        const on = checked.has(st.id);
        return (
          <button
            key={st.id}
            disabled={busy}
            onClick={() => act({ action: "shepherd_toggle", item: st.id, done: !on })}
            style={{ display: "flex", gap: 12, width: "100%", textAlign: "left", padding: "12px 16px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0, cursor: "pointer", background: on ? "#fbf9f3" : "transparent", border: "none", borderTopStyle: i ? "solid" : undefined, borderTopWidth: i ? 1 : 0, borderTopColor: C.ruleSoft }}
          >
            <span style={{ width: 16, height: 16, border: `1.5px solid ${on ? C.ink : C.rule}`, background: on ? C.ink : C.white, color: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0, marginTop: 2 }}>
              {on ? "✓" : ""}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: C.ink, display: "block", textDecoration: on ? "line-through" : "none", textDecorationColor: C.faint }}>
                {st.t}
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.5, display: "block", marginTop: 2 }}>{st.d}</span>
            </span>
          </button>
        );
      })}
      <div style={{ padding: "14px 16px", borderTop: `1px solid ${C.ink}`, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          placeholder="Portal receipt # (optional)"
          style={{ flex: 1, minWidth: 170, fontFamily: F.mono, fontSize: 12, padding: "9px 11px", border: `1px solid ${C.rule}`, outline: "none", background: C.white, borderRadius: 0 }}
        />
        <Btn
          kind="gold"
          disabled={busy}
          onClick={() => act({ action: "submit_final", receipt: receipt.trim() || null })}
          style={{ opacity: allTicked ? 1 : 0.45, pointerEvents: allTicked && !busy ? "auto" : "none" }}
        >
          Mark as submitted →
        </Btn>
      </div>
    </div>
  );
}

/* ── outcome — pending / shortlisted / won / lost (+ debrief loop) ──────── */

function OutcomePanel({
  o,
  busy,
  act,
}: {
  o: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const out = o.outcome ?? { state: "pending" as const };
  if (out.state === "pending") {
    return (
      <div style={{ border: "1px solid #cfe0d2", background: "#f4f9f4", padding: "14px 16px", display: "flex", gap: 10 }}>
        <span style={{ fontFamily: F.mono, fontSize: 12, color: C.pos }}>✓</span>
        <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55 }}>
          <b style={{ color: C.pos }}>Submitted.</b> {o.stageNote} We watch the portal — and if no award
          notice lands within 30 days, we draft a status inquiry to the procurement officer.
        </div>
      </div>
    );
  }
  if (out.state === "shortlisted") {
    return (
      <div style={{ border: "1px solid #c9d7e6", background: "#f3f7fb", padding: "14px 16px" }}>
        <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55 }}>
          <b style={{ color: C.blue }}>Shortlisted.</b> The next stage usually follows within weeks — when
          the invitation arrives, we pre-fill it from everything in this order.
        </div>
      </div>
    );
  }
  if (out.state === "won") {
    return (
      <div style={{ border: "1px solid #cfe0d2", background: "#f4f9f4", padding: "14px 16px" }}>
        <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55 }}>
          <b style={{ color: C.pos }}>Awarded.</b> Next comes contracting: expect a performance security
          request (typically 10% of contract value) and the draft contract for review. We shepherd both —
          nothing to do until the agency writes.
        </div>
      </div>
    );
  }
  /* lost — the part veterans actually care about */
  const debrief = out.debrief;
  return (
    <div style={{ border: "1px solid #e6c9c9", background: C.white }}>
      <div style={{ padding: "11px 16px", background: "#fdf6f6", borderBottom: "1px solid #e6c9c9", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.neg }}>
          Not selected — here&apos;s exactly why
        </span>
        {out.decidedAt && (
          <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint }}>decided {shortDate(out.decidedAt)}</span>
        )}
      </div>
      {(out.scores ?? []).map(([k, v], i) => (
        <div key={k} style={{ display: "flex", gap: 14, padding: "9px 16px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, width: 130, flexShrink: 0, paddingTop: 2 }}>{k}</span>
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>{v}</span>
        </div>
      ))}
      <div style={{ padding: "13px 16px", borderTop: `1px solid ${C.ruleSoft}` }}>
        {debrief?.state === "received" ? (
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent, marginBottom: 8 }}>
              What changes next time — from the debrief
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(debrief.lessons ?? []).map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 9, fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55 }}>
                  <span style={{ color: C.accent2, flexShrink: 0 }}>—</span>
                  {l}
                </div>
              ))}
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.pos, marginTop: 10 }}>
              ✓ Applied to your drafting defaults and readiness score.
            </div>
          </div>
        ) : debrief?.state === "requested" ? (
          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.warn, lineHeight: 1.55 }}>
            ⧖ Debrief requested — agencies typically respond within 5–10 working days. Lessons will land
            here, then flow into your next draft.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <span style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55, flex: 1, minWidth: 220 }}>
              You&apos;re entitled to know why — most vendors never ask. We draft the debrief request in
              procurement language and lodge it inside the window.
            </span>
            <Btn size="sm" kind="gold" disabled={busy} onClick={() => act({ action: "request_debrief" })}>
              Request the debrief →
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── amendments, Q&A & agency mail ─────────────────────────────────────── */

function AmendmentsPanel({
  o,
  busy,
  act,
}: {
  o: SubmissionOrder;
  busy: boolean;
  act: (a: ClientOrderAction) => void;
}) {
  const [q, setQ] = useState("");
  const [fwd, setFwd] = useState("");
  const inFlight = o.stage !== "submitted";
  const inputStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, fontFamily: F.sans, fontSize: 12.5, padding: "9px 11px",
    border: `1px solid ${C.rule}`, outline: "none", background: C.white, borderRadius: 0, color: C.ink,
  };
  const send = () => {
    if (!q.trim()) return;
    act({ action: "lodge_qna", q: q.trim() });
    setQ("");
  };
  return (
    <div>
      <Eyebrow>Amendments, Q&A & agency mail</Eyebrow>
      <div style={{ marginTop: 9 }}>
        {o.amendments.length > 0 && (
          <div style={{ border: `1px solid ${C.rule}`, background: C.white, marginBottom: 10 }}>
            {o.amendments.map((a, i) => (
              <div key={a.n} style={{ padding: "11px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.white, background: C.warn, padding: "1px 6px" }}>
                    AMD {a.n}
                  </span>
                  <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>{a.summary}</span>
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.pos, lineHeight: 1.5, marginTop: 5 }}>✓ {a.action}</div>
              </div>
            ))}
          </div>
        )}
        {o.qna.length > 0 && (
          <div style={{ border: `1px solid ${C.rule}`, background: C.white, marginBottom: 10 }}>
            {o.qna.map((en, i) => (
              <div key={i} style={{ padding: "11px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.white, background: C.blue, padding: "1px 6px" }}>
                    Q&A
                  </span>
                  <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.5, flex: 1, minWidth: 180 }}>{en.q}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}>
                    {agoLabel(en.at)}
                    {en.via ? ` · ${en.via}` : en.src === "forward" ? " · forwarded by you" : ""}
                  </span>
                </div>
                {en.a ? (
                  <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.pos, lineHeight: 1.5, marginTop: 5 }}>
                    ✓ {en.a}
                    {en.impact ? <span style={{ color: C.ink2 }}> — {en.impact}</span> : null}
                  </div>
                ) : (
                  <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.warn, marginTop: 5 }}>
                    {en.src === "lodged" ? "Lodged — awaiting the agency's answer." : "Received — checking it against your draft."}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {inFlight && (
          <div style={{ border: `1px dashed ${C.rule}`, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.5, marginBottom: 8 }}>
              Something unclear in the notice? Ask — we phrase it in procurement language and lodge it
              anonymously before the Q&A deadline.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="e.g. Does §4.2 require the deliverable in both languages?"
                style={inputStyle}
              />
              <Btn size="sm" kind="ghost" disabled={busy} onClick={send} style={{ opacity: q.trim() ? 1 : 0.5 }}>
                Lodge it →
              </Btn>
            </div>
          </div>
        )}
        <div style={{ border: `1px dashed ${C.rule}`, padding: "12px 14px" }}>
          <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.5, marginBottom: 8 }}>
            Agency replied to <i>your</i> inbox? Get it in here — we read it, log the Q&A, and check it
            against your draft.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <textarea
              value={fwd}
              onChange={(e) => setFwd(e.target.value)}
              rows={2}
              placeholder="Paste the agency's email or clarification text…"
              style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, minWidth: 200 }}
            />
            <Btn
              size="sm"
              kind="ghost"
              disabled={busy || !fwd.trim()}
              onClick={() => {
                act({ action: "forward_agency_mail", text: fwd.trim() });
                setFwd("");
              }}
            >
              Forward to TenderPath →
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── activity log ──────────────────────────────────────────────────────── */

function Activity({ o }: { o: SubmissionOrder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {[...o.events].reverse().map((e, i) => (
        <div key={i} style={{ display: "flex", gap: 12, padding: "8px 2px", borderTop: i ? `1px dashed ${C.ruleSoft}` : 0 }}>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, width: 92, flexShrink: 0, paddingTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {fmtDT(e.at)}
          </span>
          <span style={{ fontFamily: F.sans, fontSize: 12, color: e.by === "ops" ? C.ink2 : C.ink, lineHeight: 1.5 }}>
            {e.label}
            <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: e.by === "ops" ? C.accent : C.faint, marginLeft: 8 }}>
              {e.by === "ops" ? "TenderPath" : "You"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── the drawer ────────────────────────────────────────────────────────── */

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
  onOpenReader: (order: SubmissionOrder, startIdx: number) => void;
  onChanged: () => void;
}) {
  const mobile = useMedia("(max-width: 767px)");
  const [order, setOrder] = useState<SubmissionOrder | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [reload, onClose]);

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
      <div style={{ position: "fixed", inset: 0, zIndex: 95 }}>
        <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.5)" }} />
        <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: mobile ? "100%" : 560, background: C.paper, padding: 24, borderLeft: `1px solid ${C.rule}` }}>
          <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mute }}>Loading order…</span>
        </div>
      </div>
    );
  }

  const meta = STAGE_META[order.stage];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.5)" }} />
      <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: mobile ? "100%" : 560, background: C.paper, borderLeft: `1px solid ${C.rule}`, display: "flex", flexDirection: "column" }}>
        {/* head */}
        <div style={{ padding: mobile ? "16px 18px" : "20px 26px", borderBottom: `1px solid ${C.rule}`, background: C.white, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.white, background: stageColor(order.stage), padding: "2px 7px" }}>
              {meta.user}
            </span>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>
              {order.type} · {order.ref}
              {COMMERCE_ENABLED ? ` · $${Math.round(order.priceCents / 100)} ${order.paidAt ? "paid" : "payment pending"}` : ""}
            </span>
            <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: 0, cursor: "pointer", color: C.faint, fontFamily: F.mono, fontSize: 14 }}>
              ✕
            </button>
          </div>
          <div style={{ fontFamily: F.display, fontSize: 19, color: C.ink, letterSpacing: "-0.01em", margin: "8px 0 4px", lineHeight: 1.3 }}>
            {order.tender}
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span>
              {[order.agency, order.due ? `due ${shortDate(order.due)} (${deadlineLabel(order.due)})` : null, `updated ${agoLabel(order.updatedAt)}`]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {order.paidAt && (
              <a
                href={`/api/dashboard/submission-orders/${order.id}/receipt`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.accent, borderBottom: `1px solid ${C.accent2}`, textDecoration: "none", paddingBottom: 1 }}
              >
                Receipt ↓
              </a>
            )}
          </div>
          {!order.paidAt && (
            <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, marginTop: 8 }}>
              Payment wasn&apos;t completed — reopen the wizard to pay & start drafting.
            </div>
          )}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: mobile ? "18px 18px 40px" : "22px 26px 48px", display: "flex", flexDirection: "column", gap: 24 }}>
          {error && (
            <div style={{ border: "1px solid #dcb8b8", background: "#fdf8f8", padding: "10px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>
              {error}
            </div>
          )}

          {order.stage === "review" && <ReviewActions busy={busy} act={act} onRead={(i) => onOpenReader(order, i)} />}
          {order.stage === "final" && <Shepherd o={order} busy={busy} act={act} />}
          {order.stage === "submitted" && <OutcomePanel o={order} busy={busy} act={act} />}

          <div>
            <Eyebrow color={C.accent}>Where it stands</Eyebrow>
            <div style={{ marginTop: 9 }}>
              <Timeline o={order} />
            </div>
          </div>

          {order.paidAt && <AmendmentsPanel o={order} busy={busy} act={act} />}

          {order.stage === "revisions" && order.revisionNotes && (
            <div style={{ border: `1px dashed ${C.rule}`, padding: "12px 16px" }}>
              <Eyebrow color={C.warn}>Your revision notes — round {order.round}</Eyebrow>
              <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55, margin: "7px 0 0" }}>
                “{order.revisionNotes}”
              </p>
            </div>
          )}

          <div>
            <Eyebrow>Deliverables</Eyebrow>
            <div style={{ marginTop: 9 }}>
              <Deliverables o={order} onRead={(i) => onOpenReader(order, i)} />
            </div>
          </div>

          {order.blockers.length > 0 && (
            <div>
              <Eyebrow color={C.neg}>Flags carried into drafting</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
                {order.blockers.map((b) => (
                  <div key={b.id} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <SevDot severity={b.state === "resolved" ? "low" : b.sev} />
                    <div style={{ fontFamily: F.sans, fontSize: 11.5, color: b.state === "resolved" ? C.faint : C.ink2, lineHeight: 1.5, textDecoration: b.state === "resolved" ? "line-through" : "none" }}>
                      {b.label}
                      {b.note && <span style={{ color: C.mute, display: "block" }}>{b.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.intake.length > 0 && (
            <div>
              <Eyebrow>What we received at intake</Eyebrow>
              <div style={{ border: `1px solid ${C.rule}`, background: C.white, marginTop: 9 }}>
                {order.intake.map(([k, v], i) => (
                  <div key={`${k}-${i}`} style={{ display: "flex", gap: 14, padding: "9px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, width: 120, flexShrink: 0, paddingTop: 2 }}>{k}</span>
                    <span style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.5, minWidth: 0 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {order.events.length > 0 && (
            <div>
              <Eyebrow>Activity</Eyebrow>
              <div style={{ marginTop: 6 }}>
                <Activity o={order} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
