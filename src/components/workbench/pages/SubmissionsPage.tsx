"use client";

/* Submissions — the paid proposal-submission workflow (prototype:
 * sub-proposals.jsx). Deadline nudges → in-flight orders → the four offerings
 * → submitted & outcomes. The intake wizard, order drawer and draft reader
 * mount as overlays from here.
 *
 * URL params (deep links): ?start=EOI|RFQ|ITB|RFP opens the wizard,
 * ?match=<id> preselects the opportunity, ?order=<id> opens the drawer,
 * ?placed=<id> shows the "Order placed" confirmation after /pay. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { C, F } from "../tokens";
import { Card, Btn, SectionHead, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { isSubmissionCode } from "@/lib/workbench/pricing";
import type { ClientOrderAction, SubmissionCode, SubmissionOrder } from "@/lib/submissions/types";
import { FLOWS } from "@/lib/submissions/flows";
import { stageIndex, STAGES } from "@/lib/submissions/stages";
import type { WbMatch } from "@/lib/workbench/types";
import { agoLabel, clientAct, useSubmissionOrders } from "../submissions/api";
import { SubWizard } from "../submissions/SubWizard";
import { OrderDrawer } from "../submissions/OrderDrawer";
import { DraftReader } from "../submissions/DraftReader";

/* ── nudge strip ───────────────────────────────────────────────────────── */

function NudgeStrip({
  nudges,
  onOpen,
}: {
  nudges: { orderId: number; kind: string; urgent: boolean; label: string; cta: string }[];
  onOpen: (id: number) => void;
}) {
  if (nudges.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 32 }}>
      {nudges.slice(0, 3).map((n) => (
        <button
          key={`${n.kind}-${n.orderId}`}
          onClick={() => onOpen(n.orderId)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            width: "100%",
            textAlign: "left",
            background: n.urgent ? "#5c1f1f" : C.spine,
            border: "none",
            padding: "13px 18px",
            cursor: "pointer",
          }}
        >
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: n.urgent ? "#f0b8b8" : C.accent2, flexShrink: 0 }}>
            {n.urgent ? "Urgent" : n.kind === "review" || n.kind === "final" ? "Waiting on you" : "Worth doing"}
          </span>
          <span style={{ fontFamily: F.sans, fontSize: 13, color: C.paper, flex: 1, minWidth: 0, lineHeight: 1.45 }}>
            {n.label}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: n.urgent ? "#f0b8b8" : C.accent2, flexShrink: 0 }}>
            {n.cta} →
          </span>
        </button>
      ))}
    </div>
  );
}

/* ── in-flight order card ──────────────────────────────────────────────── */

const STAGE_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  intake: { label: "Intake", bg: "#e7e2d6", fg: "#2b3543" },
  drafting: { label: "Drafting", bg: "#9c6b1f", fg: "#ffffff" },
  qa: { label: "Quality check", bg: "#9c6b1f", fg: "#ffffff" },
  review: { label: "Your review", bg: "#0f1620", fg: "#f6f3ec" },
  revisions: { label: "Revisions", bg: "#b3691a", fg: "#ffffff" },
  final: { label: "Final pack", bg: "#0f1620", fg: "#f6f3ec" },
  submitted: { label: "Submitted", bg: "#1f6b3d", fg: "#ffffff" },
};

function ProgressStrip({ order }: { order: SubmissionOrder }) {
  const idx = stageIndex(order.stage);
  return (
    <div style={{ display: "flex", gap: 3, maxWidth: 300 }}>
      {STAGES.map((s, i) => {
        const within = i < idx || order.stage === "submitted";
        const current = i === idx && order.stage !== "submitted";
        return (
          <span
            key={s}
            style={{
              flex: 1,
              height: 3,
              background: within ? C.pos : current ? C.accent : C.paper2,
            }}
          />
        );
      })}
    </div>
  );
}

function OrderCard({
  order,
  onOpen,
  onResume,
}: {
  order: SubmissionOrder;
  onOpen: () => void;
  onResume: () => void;
}) {
  const mobile = useMedia("(max-width: 1023px)");
  const chip = STAGE_CHIP[order.stage] ?? STAGE_CHIP.intake;
  const needsYou = order.stage === "review" || order.stage === "final";
  const unpaid = !order.paidAt;
  return (
    <Card
      style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr auto",
        gap: mobile ? 14 : 24,
        padding: "18px 20px",
        alignItems: "center",
        borderColor: needsYou ? C.ink : undefined,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: unpaid ? C.ink2 : chip.fg, background: unpaid ? C.paper2 : chip.bg, padding: "3px 8px" }}>
            {unpaid ? "Payment pending" : chip.label}
          </span>
          <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute }}>
            {order.type} · {order.ref}
          </span>
          {needsYou && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.neg }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: C.neg }} />
              Needs you
            </span>
          )}
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 15.5, color: C.ink, fontWeight: 500, marginTop: 8, lineHeight: 1.35 }}>
          {order.tender}
        </div>
        <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 4 }}>
          {[
            order.agency,
            order.due ? `due ${shortDate(order.due)}` : null,
            `updated ${agoLabel(order.updatedAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {!unpaid && (
          <>
            <div style={{ marginTop: 12 }}>
              <ProgressStrip order={order} />
            </div>
            {order.stageNote && (
              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 7 }}>{order.stageNote}</div>
            )}
          </>
        )}
        {unpaid && (
          <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, marginTop: 8 }}>
            Intake saved — payment wasn&apos;t completed, so drafting hasn&apos;t started.
          </div>
        )}
      </div>
      <div style={{ textAlign: mobile ? "left" : "right" }}>
        {unpaid ? (
          <Btn kind="gold" size="sm" onClick={onResume}>Pay & start drafting →</Btn>
        ) : (
          <Btn kind={order.stage === "review" ? "gold" : "ghost"} size="sm" onClick={onOpen}>
            {order.stage === "review" ? "Review draft →" : "Open →"}
          </Btn>
        )}
      </div>
    </Card>
  );
}

/* ── submitted & outcomes ──────────────────────────────────────────────── */

function OutcomeChip({ order }: { order: SubmissionOrder }) {
  const oc = order.outcome.state;
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: "Awaiting outcome", color: C.mute },
    shortlisted: { label: "Shortlisted", color: C.accent },
    won: { label: "Won", color: C.pos },
    lost: { label: "Not selected", color: C.neg },
  };
  const m = map[oc] ?? map.pending;
  return (
    <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: m.color, border: `1px solid ${C.ruleSoft}`, padding: "3px 8px", whiteSpace: "nowrap" }}>
      {m.label}
    </span>
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
  const [readerOrder, setReaderOrder] = useState<SubmissionOrder | null>(null);
  const [readerBusy, setReaderBusy] = useState(false);
  const [placedRef, setPlacedRef] = useState<string | null>(null);

  const orders = useMemo(() => payload?.orders ?? [], [payload]);
  const inFlight = orders.filter((o) => o.stage !== "submitted");
  const submitted = orders.filter((o) => o.stage === "submitted" && o.paidAt);
  const waitingOnYou = inFlight.filter((o) => o.paidAt && (o.stage === "review" || o.stage === "final")).length;

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
      setPlacedRef(placed);
      dirty = true;
    }
    if (matchId) dirty = true;
    if (dirty) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    // The match seed resolves once workbench data lands (next effect).
    if (matchId && /^\d+$/.test(matchId)) {
      sessionStorage.setItem("tp_sub_seed_match", matchId);
    }
  }, []);

  useEffect(() => {
    if (!data || !wizardType) return;
    const stored = sessionStorage.getItem("tp_sub_seed_match");
    if (!stored) return;
    sessionStorage.removeItem("tp_sub_seed_match");
    const m = data.matches.find((x) => String(x.id) === stored);
    if (m) setWizardSeed(m);
  }, [data, wizardType]);

  const openDrawer = useCallback((id: number) => setDrawerId(id), []);

  const resumePayment = useCallback(
    (order: SubmissionOrder) => {
      // Reopen the wizard on the saved draft — Review & pay is one step away.
      setWizardSeed(null);
      setWizardType(order.type);
    },
    [],
  );

  const readerAct = useCallback(
    async (action: ClientOrderAction) => {
      if (!readerOrder) return;
      setReaderBusy(true);
      try {
        const { order: fresh } = await clientAct(readerOrder.id, action);
        refetch(true);
        if (action.action === "request_changes") {
          setReaderOrder(null);
          setDrawerId(fresh.id);
        } else {
          setReaderOrder(fresh);
        }
      } catch {
        refetch(true);
      } finally {
        setReaderBusy(false);
      }
    },
    [readerOrder, refetch],
  );

  const placedOrder = placedRef ? orders.find((o) => String(o.id) === placedRef) : null;

  return (
    <div>
      {/* Order placed confirmation (return from /pay) */}
      {placedRef && (
        <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", marginBottom: 20, borderLeft: `3px solid ${C.pos}`, background: "#f3f8f4", flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.white, background: C.pos, padding: "3px 8px" }}>
            Order placed
          </span>
          <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, flex: 1, minWidth: 220 }}>
            {placedOrder
              ? `${placedOrder.type} ${placedOrder.ref} — drafting starts now. A receipt is in your inbox; track every stage here.`
              : "Drafting starts now. A receipt is in your inbox; track every stage here."}
          </span>
          <button onClick={() => setPlacedRef(null)} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>
        </Card>
      )}

      <NudgeStrip nudges={payload?.nudges ?? []} onOpen={openDrawer} />

      {loading && orders.length === 0 && (
        <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, padding: "8px 0 24px" }}>Loading your submissions…</div>
      )}
      {error && (
        <div style={{ border: "1px solid #dcb8b8", background: "#fdf8f8", padding: "11px 14px", marginBottom: 20, fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>
          {error}
        </div>
      )}

      {inFlight.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <SectionHead
            n="05"
            title="In flight"
            count={inFlight.length}
            hint={waitingOnYou > 0 ? `${waitingOnYou} waiting on you` : "Live from the drafting desk"}
          />
          <div style={{ display: "grid", gap: 14 }}>
            {inFlight.map((o) => (
              <OrderCard key={o.id} order={o} onOpen={() => openDrawer(o.id)} onResume={() => resumePayment(o)} />
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionHead title="Start a submission" hint="Fixed fee · unlimited revisions · full-refund guarantee" />
        {data?.access.freeSubmissionEligible && (
          <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", marginBottom: 14, borderLeft: `3px solid ${C.pos}`, background: "#f3f8f4", flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.white, background: C.pos, padding: "3px 8px" }}>On us</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, flex: 1, minWidth: 220 }}>
              <strong style={{ fontWeight: 600 }}>Your first proposal submission is free</strong> while you&apos;re on trial — the credit is applied automatically at checkout, any format below.
            </span>
          </Card>
        )}
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 14 }}>
          {(Object.keys(FLOWS) as SubmissionCode[]).map((code) => {
            const flow = FLOWS[code];
            return (
              <Card key={code} style={{ display: "flex", flexDirection: "column", padding: "18px 18px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: F.display, fontSize: 27, color: C.ink }}>{code}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, border: `1px solid ${C.ruleSoft}`, padding: "2px 6px", whiteSpace: "nowrap" }}>
                    {flow.tag}
                  </span>
                </div>
                <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, fontWeight: 600, marginTop: 8 }}>{flow.name}</div>
                <p style={{ fontFamily: F.sans, fontSize: 12, lineHeight: 1.55, color: C.mute, margin: "6px 0 10px" }}>{flow.desc}</p>
                <div style={{ display: "grid", gap: 5, flex: 1, alignContent: "start" }}>
                  {flow.bullets.map((b) => (
                    <div key={b} style={{ display: "flex", gap: 8 }}>
                      <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>—</span>
                      <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.45 }}>{b}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <span style={{ fontFamily: F.display, fontSize: 24, color: C.ink }}>${flow.price}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint }}> one-time</span>
                </div>
                <div style={{ fontFamily: F.mono, fontSize: 9, color: C.mute, marginTop: 3 }}>draft in under 1 hour</div>
                <div style={{ marginTop: 12 }}>
                  <Btn kind="primary" size="sm" full onClick={() => { setWizardSeed(null); setWizardType(code); }}>
                    Start {code} →
                  </Btn>
                </div>
              </Card>
            );
          })}
        </div>

        <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 20px", marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.ink, fontWeight: 500 }}>Not sure which format?</div>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.mute, marginTop: 4 }}>
              Paste the tender and we&apos;ll detect the type, price it, and request only the inputs it scores on.
            </div>
          </div>
          <Btn kind="gold" size="sm" onClick={() => openPaste()}>Paste a tender to begin →</Btn>
        </Card>
      </div>

      {submitted.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <SectionHead
            title="Submitted & outcomes"
            count={submitted.length}
            hint="Losses are data — debrief lessons feed your next draft"
          />
          <div style={{ display: "grid", gap: 10 }}>
            {submitted.map((o) => (
              <Card key={o.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", flexWrap: "wrap" }}>
                <OutcomeChip order={o} />
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, flexShrink: 0 }}>
                  {o.type} · {o.ref}
                </span>
                <span style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, flex: 1, minWidth: 200, lineHeight: 1.4 }}>
                  {o.tender}
                </span>
                {o.outcome.state === "lost" && !o.outcome.debrief && (
                  <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: C.warn }}>
                    Debrief available
                  </span>
                )}
                <Btn kind="ghost" size="sm" onClick={() => openDrawer(o.id)}>Open →</Btn>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Overlays */}
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
          onOpenReader={(o) => setReaderOrder(o)}
          onChanged={() => refetch(true)}
        />
      )}
      {readerOrder && (
        <DraftReader
          order={readerOrder}
          busy={readerBusy}
          onClose={() => setReaderOrder(null)}
          onAct={readerAct}
        />
      )}
    </div>
  );
}
