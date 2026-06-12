"use client";

/* Submissions — the paid proposal-submission workflow (faithful port of the
 * prototype's sub-proposals.jsx). Deadline nudges → in-flight orders → the
 * four formats → submitted & outcomes. The wizard, drawer and reader mount as
 * overlays from here.
 *
 * URL params (deep links): ?start=EOI|RFQ|ITB|RFP opens the wizard,
 * ?match=<id> preselects the opportunity, ?order=<id> opens the drawer,
 * ?placed=<id> shows the order-placed toast after /pay. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, F } from "../tokens";
import { Btn, Card, deadlineLabel, daysUntil, SectionHead, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { isSubmissionCode } from "@/lib/workbench/pricing";
import type { ClientOrderAction, SubmissionCode, SubmissionOrder } from "@/lib/submissions/types";
import { FLOWS, type SubmissionFlow } from "@/lib/submissions/flows";
import { STAGE_META, STAGES, stageIndex } from "@/lib/submissions/stages";
import type { WbMatch } from "@/lib/workbench/types";
import { agoLabel, clientAct, useSubmissionOrders } from "../submissions/api";
import { SubWizard } from "../submissions/SubWizard";
import { OrderDrawer } from "../submissions/OrderDrawer";
import { DraftReader } from "../submissions/DraftReader";

/* ── mini stage strip for order cards ──────────────────────────────────── */

function StageStrip({ o }: { o: SubmissionOrder }) {
  const idx = stageIndex(o.stage);
  const stages = STAGES.filter((s) => s !== "revisions" || o.round > 0 || o.stage === "revisions");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {stages.map((s) => {
        const si = stageIndex(s);
        const col = si < idx || o.stage === "submitted" ? C.pos : si === idx ? C.accent : C.paper2;
        return <span key={s} title={STAGE_META[s].user} style={{ flex: 1, height: 3, background: col }} />;
      })}
    </div>
  );
}

/* ── order card (in-flight AND submitted) ──────────────────────────────── */

function OrderCard({
  o,
  onOpen,
  onResume,
}: {
  o: SubmissionOrder;
  onOpen: () => void;
  onResume: () => void;
}) {
  const mobile = useMedia("(max-width: 1023px)");
  const needsYou = o.stage === "review" || o.stage === "final";
  const out = o.outcome;
  const lost = out?.state === "lost";
  const won = out?.state === "won";
  const shortl = out?.state === "shortlisted";
  const unpaid = !o.paidAt;
  const stageColor = lost ? C.neg : o.stage === "submitted" ? C.pos : o.stage === "review" ? C.blue : o.stage === "final" ? C.accent : C.warn;
  const pill = unpaid ? "Payment pending" : lost ? "Not selected" : won ? "Won" : shortl ? "Shortlisted" : STAGE_META[o.stage].user;
  const cta = unpaid
    ? "Pay & start drafting →"
    : o.stage === "review"
      ? "Review draft →"
      : o.stage === "final"
        ? "Submit final pack →"
        : lost
          ? "See the debrief →"
          : "Open →";
  return (
    <div style={{ border: `1px solid ${needsYou ? C.accent2 : C.rule}`, background: C.white, padding: mobile ? "16px 16px" : "18px 22px", display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr auto", gap: 16, alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 7, flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: unpaid ? C.ink2 : C.white, background: unpaid ? C.paper2 : stageColor, padding: "2px 7px", whiteSpace: "nowrap" }}>
            {pill}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint }}>
            {o.type} · {o.ref}
          </span>
          {needsYou && (
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent }}>
              ● needs you
            </span>
          )}
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 15, color: C.ink, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {o.tender}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 5 }}>
          {[o.agency, o.due ? `due ${shortDate(o.due)} (${deadlineLabel(o.due)})` : null, `updated ${agoLabel(o.updatedAt)}`]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {!unpaid ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1, maxWidth: 280 }}>
              <StageStrip o={o} />
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.ink2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {o.stageNote}
            </span>
          </div>
        ) : (
          <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, marginTop: 8 }}>
            Intake saved — payment wasn&apos;t completed, so drafting hasn&apos;t started.
          </div>
        )}
      </div>
      <div style={{ textAlign: mobile ? "left" : "right", flexShrink: 0 }}>
        <Btn kind={needsYou || unpaid ? "gold" : "ghost"} size="sm" onClick={unpaid ? onResume : onOpen}>
          {cta}
        </Btn>
      </div>
    </div>
  );
}

/* ── format card ───────────────────────────────────────────────────────── */

function TypeCard({ flow, onStart }: { flow: SubmissionFlow; onStart: () => void }) {
  return (
    <div style={{ border: `1px solid ${C.rule}`, background: C.white, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "18px 18px 14px", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontFamily: F.display, fontSize: 26, color: C.ink }}>{flow.code}</span>
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, border: `1px solid ${C.ruleSoft}`, padding: "2px 6px", whiteSpace: "nowrap" }}>
            {flow.complexity}
          </span>
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, marginTop: 5, fontWeight: 600 }}>{flow.name}</div>
        <p style={{ fontFamily: F.sans, fontSize: 12, lineHeight: 1.55, color: C.mute, margin: "8px 0 12px" }}>{flow.blurb}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {flow.deliverables.map((d) => (
            <span key={d.name} style={{ fontFamily: F.sans, fontSize: 11, color: C.ink2, display: "flex", gap: 7, lineHeight: 1.45 }}>
              <span style={{ color: C.accent2, flexShrink: 0 }}>—</span>
              {d.name}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "13px 18px", borderTop: `1px solid ${C.ruleSoft}` }}>
        <div>
          <span style={{ fontFamily: F.display, fontSize: 22, color: C.ink }}>${flow.price}</span>
          <div style={{ fontFamily: F.mono, fontSize: 9, color: C.mute, marginTop: 1, letterSpacing: "0.04em" }}>
            {flow.sla.toUpperCase()}
          </div>
        </div>
        <Btn kind="primary" size="sm" onClick={onStart}>Start →</Btn>
      </div>
    </div>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export function SubmissionsPage() {
  const { data, openPaste } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const { payload, error, loading, refetch } = useSubmissionOrders();

  const [wizardType, setWizardType] = useState<SubmissionCode | null>(null);
  const [wizardSeed, setWizardSeed] = useState<WbMatch | null>(null);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [reader, setReader] = useState<{ order: SubmissionOrder; startIdx: number } | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const orders = useMemo(() => payload?.orders ?? [], [payload]);
  const active = orders.filter((o) => o.stage !== "submitted");
  const doneOrders = orders.filter((o) => o.stage === "submitted" && o.paidAt);
  const needsYou = active.filter((o) => o.paidAt && (o.stage === "review" || o.stage === "final")).length;
  const waiting = active
    .filter((o) => o.paidAt && (o.stage === "review" || o.stage === "final"))
    .sort((a, b) => new Date(a.due ?? "2999-01-01").getTime() - new Date(b.due ?? "2999-01-01").getTime());

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4200);
  }, []);

  // One-shot URL param handling (?start, ?match, ?order, ?placed). Read via
  // window.location to avoid the useSearchParams Suspense requirement.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const start = params.get("start")?.toUpperCase();
    const matchId = params.get("match");
    const orderId = params.get("order");
    const placed = params.get("placed");
    let dirty = false;
    if (start && isSubmissionCode(start)) {
      setWizardType(start as SubmissionCode);
      dirty = true;
    }
    if (orderId && /^\d+$/.test(orderId)) {
      setDrawerId(Number(orderId));
      dirty = true;
    }
    if (placed && /^\d+$/.test(placed)) {
      setDrawerId(Number(placed));
      sessionStorage.setItem("tp_sub_placed", placed);
      dirty = true;
    }
    if (matchId && /^\d+$/.test(matchId)) {
      sessionStorage.setItem("tp_sub_seed_match", matchId);
      dirty = true;
    }
    if (dirty) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // Order-placed toast fires once the placed order is loaded.
  useEffect(() => {
    const placed = sessionStorage.getItem("tp_sub_placed");
    if (!placed || orders.length === 0) return;
    const o = orders.find((x) => String(x.id) === placed);
    if (o) {
      sessionStorage.removeItem("tp_sub_placed");
      showToast(`Order placed — ${o.type} ${o.ref}. Drafting starts now · ${o.slaMins}-minute SLA.`);
    }
  }, [orders, showToast]);

  // The match seed resolves once workbench data lands.
  useEffect(() => {
    if (!data || !wizardType) return;
    const stored = sessionStorage.getItem("tp_sub_seed_match");
    if (!stored) return;
    sessionStorage.removeItem("tp_sub_seed_match");
    const m = data.matches.find((x) => String(x.id) === stored);
    if (m) setWizardSeed(m);
  }, [data, wizardType]);

  const resumePayment = useCallback((order: SubmissionOrder) => {
    // Reopen the wizard on the saved draft — Review & pay is one step away.
    setWizardSeed(null);
    setWizardType(order.type);
  }, []);

  const readerAct = useCallback(
    async (action: ClientOrderAction) => {
      if (!reader) return;
      setReaderBusy(true);
      try {
        const { order: fresh } = await clientAct(reader.order.id, action);
        refetch(true);
        if (action.action === "request_changes") {
          setReader(null);
          setDrawerId(fresh.id);
        } else {
          setReader({ order: fresh, startIdx: reader.startIdx });
        }
      } catch {
        refetch(true);
      } finally {
        setReaderBusy(false);
      }
    },
    [reader, refetch],
  );

  return (
    <div>
      {/* deadline nudges — orders waiting on you */}
      {waiting.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
          {waiting.map((o) => {
            const d = daysUntil(o.due);
            const urgent = d != null && d <= 4;
            return (
              <button
                key={o.id}
                onClick={() => setDrawerId(o.id)}
                style={{ display: "flex", alignItems: "center", gap: 14, background: C.ink, color: C.paper, border: 0, borderLeft: `3px solid ${urgent ? C.neg : C.accent}`, padding: "12px 18px", cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: urgent ? "#e8a0a0" : C.accent2, flexShrink: 0 }}>
                  {urgent ? "urgent" : "waiting on you"}
                </span>
                <span style={{ fontFamily: F.sans, fontSize: 12.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {o.type} {o.ref} — {o.stage === "final" ? "final pack ready; submit 24h early" : "draft waiting for your review"} · due {shortDate(o.due)}
                  {d != null ? ` (${d} day${d === 1 ? "" : "s"})` : ""}
                </span>
                <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent2, flexShrink: 0 }}>
                  Open →
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div style={{ border: "1px solid #dcb8b8", background: "#fdf8f8", padding: "11px 14px", marginBottom: 20, fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>
          {error}
        </div>
      )}

      {/* in flight */}
      <div style={{ marginBottom: 38 }}>
        <SectionHead
          n="05"
          title="In flight"
          count={active.length}
          hint={needsYou ? `${needsYou} waiting on you` : "We'll prompt you the moment we need something"}
        />
        {loading && orders.length === 0 ? (
          <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, padding: "8px 0" }}>Loading your submissions…</div>
        ) : active.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {active.map((o) => (
              <OrderCard key={o.id} o={o} onOpen={() => setDrawerId(o.id)} onResume={() => resumePayment(o)} />
            ))}
          </div>
        ) : (
          <div style={{ border: `1px dashed ${C.rule}`, padding: "26px 22px", textAlign: "center", fontFamily: F.sans, fontSize: 13, color: C.mute }}>
            Nothing in flight. Start a submission below — drafts land in under an hour.
          </div>
        )}
      </div>

      {/* start a submission */}
      <div style={{ marginBottom: 38 }}>
        <SectionHead title="Start a submission" hint="Fixed fee · unlimited revisions · full-refund guarantee" />
        {data?.access.freeSubmissionEligible && (
          <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", marginBottom: 14, borderLeft: `3px solid ${C.pos}`, background: "#f3f8f4", flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.white, background: C.pos, padding: "3px 8px" }}>On us</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, flex: 1, minWidth: 220 }}>
              <strong style={{ fontWeight: 600 }}>Your first proposal submission is free</strong> while you&apos;re on trial — the credit is applied automatically at checkout, any format below.
            </span>
          </Card>
        )}
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
          {(Object.keys(FLOWS) as SubmissionCode[]).map((code) => (
            <TypeCard key={code} flow={FLOWS[code]} onStart={() => { setWizardSeed(null); setWizardType(code); }} />
          ))}
        </div>
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: F.sans, fontSize: 14, color: C.ink, fontWeight: 500 }}>Not sure which format the notice is?</div>
            <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 3 }}>
              Paste it — we detect the type, price it, and ask only for the inputs it&apos;s scored on.
            </div>
          </div>
          <Btn kind="gold" onClick={() => openPaste()}>Paste a tender →</Btn>
        </div>
      </div>

      {/* submitted */}
      {doneOrders.length > 0 && (
        <div>
          <SectionHead title="Submitted" count={doneOrders.length} hint="Outcomes feed your readiness score" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {doneOrders.map((o) => (
              <OrderCard key={o.id} o={o} onOpen={() => setDrawerId(o.id)} onResume={() => {}} />
            ))}
          </div>
        </div>
      )}

      {/* overlays */}
      {wizardType && (
        <SubWizard
          type={wizardType}
          seedMatch={wizardSeed}
          onClose={() => {
            setWizardType(null);
            setWizardSeed(null);
            refetch(true);
          }}
        />
      )}
      {drawerId != null && (
        <OrderDrawer
          orderId={drawerId}
          initial={orders.find((o) => o.id === drawerId) ?? null}
          onClose={() => setDrawerId(null)}
          onOpenReader={(o, startIdx) => setReader({ order: o, startIdx })}
          onChanged={() => refetch(true)}
        />
      )}
      {reader && (
        <DraftReader
          order={reader.order}
          startIdx={reader.startIdx}
          busy={readerBusy}
          onClose={() => setReader(null)}
          onAct={readerAct}
        />
      )}

      {/* toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 120, background: C.ink, color: C.paper, padding: "11px 18px", fontFamily: F.sans, fontSize: 12.5, border: `1px solid ${C.spineLine}`, boxShadow: "0 8px 28px rgba(15,22,32,0.35)", maxWidth: "min(520px, 90vw)" }}>
          <span style={{ color: C.accent2, fontFamily: F.mono, fontSize: 11, marginRight: 8 }}>✓</span>
          {toast}
        </div>
      )}
    </div>
  );
}
