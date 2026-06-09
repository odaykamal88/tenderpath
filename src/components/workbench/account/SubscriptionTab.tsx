"use client";

/* Subscription — current plan + manage, from the real access state. Paid users
 * manage/cancel through the Stripe billing portal; trial users go to checkout. */

import { useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useWorkbench } from "../WorkbenchProvider";
import { requestBillingPortal } from "./portal";

const INCLUDED = [
  "Live matched tenders, ranked by fit",
  "The full tender database (Browse)",
  "Readiness score + the gap Navigator",
  "Document Vault",
  "Bid / no-bid decision engine",
  "Deadline alerts & weekly digest",
];

export function SubscriptionTab() {
  const { data, token, openSubscribe } = useWorkbench();
  const { access } = data;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const manage = async () => {
    if (!access.isPaid) {
      openSubscribe();
      return;
    }
    setBusy(true);
    const r = await requestBillingPortal(token);
    setBusy(false);
    if (r.url) window.location.href = r.url;
    else setMsg(r.message ?? "Couldn't open the billing portal.");
  };

  const planLabel = access.isPaid ? "Active subscription" : access.locked ? "Trial ended" : "Free trial";
  const planSub = access.isPaid
    ? "Full Workbench access."
    : access.locked
      ? "Subscribe to keep your dashboard access."
      : `${access.trialDaysLeft} day${access.trialDaysLeft === 1 ? "" : "s"} left — no card required.`;

  return (
    <div>
      <div style={{ background: C.ink, color: C.paper, padding: "26px 28px", marginBottom: 20, display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 30, color: C.paper }}>{planLabel}</div>
          <div style={{ fontFamily: F.sans, fontSize: 13.5, color: "#cdc6b3", marginTop: 6 }}>{planSub}</div>
        </div>
        <Btn kind="gold" onClick={manage} disabled={busy}>{busy ? "Opening…" : access.isPaid ? "Manage plan →" : "Subscribe →"}</Btn>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
        <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: "0 0 14px" }}>What&apos;s included</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {INCLUDED.map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "baseline", fontFamily: F.sans, fontSize: 13, color: C.ink2 }}>
              <span style={{ color: C.pos }}>✓</span> {f}
            </div>
          ))}
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 16 }}>
          Proposal submissions are billed separately — per submission, only when you commit to a bid.
        </p>
      </div>

      {access.isPaid && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>Manage or cancel your plan anytime in the Stripe portal.</span>
          <Btn kind="danger" size="sm" onClick={manage} disabled={busy}>Manage / cancel</Btn>
        </div>
      )}
      {msg && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.neg, marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
