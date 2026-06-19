"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;

/** Checkout context forwarded to /api/pay/checkout. Same shape across every
 *  surface that initiates a card payment. */
export interface CheckoutContext {
  tender: string | null;
  agency: string | null;
  pipelineItemId: string | null;
  workOrderId: string | null;
  submissionType: string | null;
  /** Submissions-workflow order attached to this checkout (EOI/RFQ/ITB/RFP). */
  submissionOrderId: string | null;
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

/**
 * The single embedded-checkout primitive. POSTs to /api/pay/checkout, handles
 * the $0 first-proposal-free redirect, and mounts Stripe's embedded checkout.
 *
 * One implementation shared by every card-payment surface — the `/pay` page,
 * the submission wizard, and dashboard service flows — so there is exactly one
 * checkout code path. This is purely the card path: the caller owns readiness
 * gating (passed in as `disabledReason`) and any surrounding summary UI.
 *
 * `autoStart` kicks off checkout on mount (for inline embeds where the user has
 * already committed by clicking "Pay") so there's no redundant second click.
 */
export function CheckoutCard({
  plan,
  context,
  disabledReason,
  freeEligible,
  autoStart,
}: {
  plan: string | null;
  context: CheckoutContext;
  disabledReason?: string;
  freeEligible?: boolean;
  autoStart?: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "mounted" | "error">("idle");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<{ destroy(): void } | null>(null);

  useEffect(() => {
    return () => { checkoutRef.current?.destroy(); };
  }, []);

  const startCheckout = useCallback(async () => {
    if (!plan) { setError("Select a plan first."); return; }
    if (disabledReason) { setError(disabledReason); return; }
    if (!stripePromise) { setError("Stripe is not configured."); return; }
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          plan,
          tender: context.tender,
          agency: context.agency,
          pipeline_item_id: context.pipelineItemId,
          work_order_id: context.workOrderId,
          submission_type: context.submissionType,
          submission_order_id: context.submissionOrderId,
        }),
      });
      const data = (await res.json()) as { clientSecret?: string; free?: boolean; url?: string; error?: string };
      // Free first submission: the checkout route fulfilled it for $0 and hands
      // back a redirect to the (now generating) work order — no Stripe to mount.
      if (data.free && data.url) {
        window.location.href = data.url;
        return;
      }
      if (!data.clientSecret) {
        setError(data.error ?? "Something went wrong. Please try another payment method.");
        setStatus("error");
        return;
      }
      const stripe = await stripePromise;
      if (!stripe) { setError("Stripe failed to load."); setStatus("error"); return; }
      const checkout = await stripe.createEmbeddedCheckoutPage({ clientSecret: data.clientSecret });
      checkout.mount(containerRef.current!);
      checkoutRef.current = checkout;
      setStatus("mounted");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }, [plan, disabledReason, context]);

  // Inline embeds (the wizard) pass autoStart so the user's "Pay" click flows
  // straight into the mounted checkout. Guarded so it fires exactly once, and
  // deferred a tick so the kickoff setState isn't synchronous inside the effect.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || disabledReason) return;
    autoStarted.current = true;
    const id = setTimeout(() => { void startCheckout(); }, 0);
    return () => clearTimeout(id);
  }, [autoStart, disabledReason, startCheckout]);

  return (
    <div>
      <div ref={containerRef} className={status === "mounted" ? "" : "hidden"} />
      {status !== "mounted" && (
        <div className="space-y-3">
          {error && (
            <p className="rounded-none border-l-2 border-[#9c2a2a] bg-[#f6e9e9]/50 px-3 py-2 text-[11.5px] text-[#9c2a2a]">
              {error}
            </p>
          )}
          <button
            onClick={startCheckout}
            disabled={status === "loading" || !plan || Boolean(disabledReason)}
            className="w-full rounded-none bg-[#0f1620] px-4 py-3 text-[12.5px] font-semibold text-white hover:bg-[#2b3543] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading"
              ? (freeEligible ? "Claiming…" : "Loading secure checkout…")
              : (freeEligible ? "Claim free submission →" : "Pay with card →")}
          </button>
        </div>
      )}
    </div>
  );
}
