"use client";

/* Subscription — current plan + inline checkout / manage, from the real access
 * state. Trial users subscribe inline via the shared embedded checkout (no hop
 * to /pay); paid users manage/cancel through the Stripe billing portal. */

import { useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useWorkbench } from "../WorkbenchProvider";
import { requestBillingPortal } from "./portal";
import { CheckoutCard } from "@/components/checkout/CheckoutCard";
import { SUBSCRIPTION_PLANS, ANNUAL_SAVING_PCT } from "@/lib/workbench/pricing";

// Pro unlocks (the rest of the dashboard is free) — kept in sync with
// PRO_FEATURES in src/lib/workbench/pricing.ts and the landing Pricing card.
const INCLUDED = [
  "Unlimited bid / no-bid verdicts",
  "The Gap Navigator for every readiness gap",
  "Document Vault + readiness tracking",
];

// Subscriptions carry no tender/work-order/submission context.
const SUB_CONTEXT = {
  tender: null,
  agency: null,
  pipelineItemId: null,
  workOrderId: null,
  submissionType: null,
  submissionOrderId: null,
};

export function SubscriptionTab() {
  const { data, token } = useWorkbench();
  const { access } = data;
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cycle, setCycle] = useState<"monthly" | "annual">("annual");
  const [subscribing, setSubscribing] = useState(false);

  // The flat $49/$324 subscription once both Stripe prices are configured;
  // otherwise the legacy annual-access flow (annual only). Mirrors openSubscribe.
  const newLive = access.newSubscriptionLive;
  const planSlug = newLive ? (cycle === "annual" ? "sub-annual" : "sub-monthly") : "annual-access";

  const openPortal = async () => {
    setBusy(true);
    const r = await requestBillingPortal(token);
    setBusy(false);
    if (r.url) window.location.href = r.url;
    else setMsg(r.message ?? "Couldn't open the billing portal.");
  };

  const planLabel = access.isPaid ? "Pro · active" : access.locked ? "Pro trial ended" : "Pro trial";
  const planSub = access.isPaid
    ? "Vault, gap Navigator & unlimited bid/no-bid are unlocked."
    : access.locked
      ? "Subscribe to unlock the vault, gap Navigator & unlimited bid/no-bid."
      : `${access.trialDaysLeft} day${access.trialDaysLeft === 1 ? "" : "s"} left of Pro — no card required.`;

  const annual = SUBSCRIPTION_PLANS.annual;
  const monthly = SUBSCRIPTION_PLANS.monthly;

  return (
    <div>
      <div style={{ background: C.ink, color: C.paper, padding: "26px 28px", marginBottom: 20, display: "grid", gridTemplateColumns: "1fr auto", gap: 24, alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: F.display, fontSize: 30, color: C.paper }}>{planLabel}</div>
          <div style={{ fontFamily: F.sans, fontSize: 13.5, color: "#cdc6b3", marginTop: 6 }}>{planSub}</div>
        </div>
        {access.isPaid ? (
          <Btn kind="gold" onClick={openPortal} disabled={busy}>{busy ? "Opening…" : "Manage plan →"}</Btn>
        ) : subscribing ? (
          <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent2 }}>
            Choose how to pay ↓
          </div>
        ) : (
          <Btn kind="gold" onClick={() => setSubscribing(true)}>Subscribe →</Btn>
        )}
      </div>

      {/* Inline subscribe — embedded card checkout, no hop to /pay. */}
      {!access.isPaid && subscribing && (
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
          {newLive && (
            <div style={{ display: "inline-flex", border: `1px solid ${C.rule}`, marginBottom: 16 }}>
              {(["annual", "monthly"] as const).map((k) => {
                const on = cycle === k;
                return (
                  <button
                    key={k}
                    onClick={() => setCycle(k)}
                    style={{
                      fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
                      padding: "8px 16px", border: 0, cursor: "pointer",
                      background: on ? C.ink : "transparent", color: on ? C.paper : C.mute,
                    }}
                  >
                    {k}{k === "annual" ? ` · save ${ANNUAL_SAVING_PCT}%` : ""}
                  </button>
                );
              })}
            </div>
          )}

          {newLive ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: F.display, fontSize: 40, color: C.ink, lineHeight: 1 }}>
                ${cycle === "annual" ? annual.perMonth : monthly.price}
              </span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mute }}>
                / month{cycle === "annual" ? ` · billed $${annual.price}/yr` : ""}
              </span>
            </div>
          ) : (
            <div style={{ fontFamily: F.display, fontSize: 26, color: C.ink, marginBottom: 4 }}>Annual dashboard access</div>
          )}

          <div style={{ fontFamily: F.sans, fontSize: 12, color: C.mute, marginBottom: 16 }}>
            {access.trialDaysLeft > 0
              ? `Your ${access.trialDaysLeft}-day free trial continues — you won't be charged until it ends. Cancel anytime.`
              : "Cancel anytime; your access runs to the end of the billing period."}
          </div>

          {/* key=planSlug so switching cycle tears down any half-mounted checkout */}
          <CheckoutCard key={planSlug} plan={planSlug} context={SUB_CONTEXT} />
        </div>
      )}

      <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
        <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: "0 0 14px" }}>What Pro unlocks</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
          {INCLUDED.map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "baseline", fontFamily: F.sans, fontSize: 13, color: C.ink2 }}>
              <span style={{ color: C.pos }}>✓</span> {f}
            </div>
          ))}
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 16 }}>
          Matched tenders, the tender database, the weekly digest and 3 bid/no-bid calls a month stay free. Proposal submissions are billed separately — per submission, only when you commit to a bid.
        </p>
      </div>

      {access.isPaid && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>Manage or cancel your plan anytime in the Stripe portal.</span>
          <Btn kind="danger" size="sm" onClick={openPortal} disabled={busy}>Manage / cancel</Btn>
        </div>
      )}
      {msg && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.neg, marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
