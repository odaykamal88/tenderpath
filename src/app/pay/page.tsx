"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;
import { TIERS, isComingSoonTier } from "@/lib/pricing";

const MONO = "var(--font-jetbrains), ui-monospace, Menlo, monospace";
const SERIF = "var(--font-fraunces), Georgia, serif";

const CONFIG = {
  usdt: {
    trc20:
      process.env.NEXT_PUBLIC_USDT_TRC20_ADDRESS ||
      "TKh1rcVFrbLX6mTKw9gJcZYoJZR4VSuCWF",
  },
  wire: {
    bankName:
      process.env.NEXT_PUBLIC_WIRE_EG_BANK_NAME ||
      "Commercial International Bank (CIB)",
    accountName:
      process.env.NEXT_PUBLIC_WIRE_EG_ACCOUNT_NAME || "TenderPath",
    iban:
      process.env.NEXT_PUBLIC_WIRE_EG_IBAN ||
      "EG020010001800000100041263622",
    swift: process.env.NEXT_PUBLIC_WIRE_EG_SWIFT || "",
  },
  supportEmail: "info@tenderpath.me",
};

type Tab = "card" | "usdt" | "wire";

interface PayContext {
  tender: string | null;
  agency: string | null;
  pipelineItemId: string | null;
  workOrderId: string | null;
  submissionType: string | null;
}

interface FulfillmentReadiness {
  mode: "self_serve" | "human_review" | "blocked";
  payment_allowed: boolean;
  auto_fulfill_allowed: boolean;
  score_0_10: number | null;
  missing_inputs: string[];
  warnings: string[];
  code: string | null;
  message: string;
}

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded-none border border-[#d8d1bf] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[#2b3543] hover:border-[#2b3543] transition-colors"
      style={{ fontFamily: MONO }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ── Card / Stripe ─────────────────────────────────────────────────────── */

function ReadinessCard({ readiness }: { readiness: FulfillmentReadiness | null }) {
  if (!readiness || readiness.mode === "self_serve") return null;
  const blocked = !readiness.payment_allowed;
  return (
    <div className={`rounded-none border-l-2 px-3.5 py-3 text-[12px] leading-relaxed ${
      blocked ? "border-[#9c2a2a] bg-[#f6e9e9]/50 text-[#7a2020]" : "border-[#b3691a] bg-[#f7efe0]/60 text-[#7a4711]"
    }`}>
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em]"
        style={{ fontFamily: MONO }}
      >
        Fulfillment readiness · {readiness.mode.replace(/_/g, " ")}
      </div>
      <p className="mt-1">{readiness.message}</p>
      {readiness.score_0_10 != null && (
        <p className="mt-1 font-semibold tabular-nums" style={{ fontFamily: MONO }}>
          Source score · {readiness.score_0_10}/10
        </p>
      )}
      {readiness.missing_inputs.length > 0 && (
        <ul className="mt-2 space-y-1">
          {readiness.missing_inputs.slice(0, 5).map((item) => (
            <li key={item}>Missing: {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardTab({ plan, context, disabledReason, freeEligible }: { plan: string | null; context: PayContext; disabledReason?: string; freeEligible?: boolean }) {
  const [status, setStatus] = useState<"idle" | "loading" | "mounted" | "error">("idle");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<{ destroy(): void } | null>(null);

  useEffect(() => {
    return () => { checkoutRef.current?.destroy(); };
  }, []);

  async function startCheckout() {
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
  }

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

/* ── USDT ──────────────────────────────────────────────────────────────── */

function UsdtTab({ plan, context, disabledReason }: { plan: string | null; context: PayContext; disabledReason?: string }) {
  const tier = TIERS.find((t) => t.slug === plan);
  const address = CONFIG.usdt.trc20;
  const [txid, setTxid] = useState("");
  const [email, setEmail] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [verifyMsg, setVerifyMsg] = useState("");

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (disabledReason) { setVerifyMsg(disabledReason); setVerifyStatus("error"); return; }
    if (!context.workOrderId) { setVerifyMsg("No work order ID — please refresh and try again."); setVerifyStatus("error"); return; }
    setVerifyStatus("loading");
    setVerifyMsg("");
    try {
      const res = await fetch("/api/pay/verify-usdt", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ txid: txid.trim(), plan, work_order_id: context.workOrderId, email: email.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) { setVerifyStatus("done"); setVerifyMsg(data.message ?? "Verified!"); }
      else { setVerifyStatus("error"); setVerifyMsg(data.error ?? "Verification failed."); }
    } catch { setVerifyStatus("error"); setVerifyMsg("Network error. Please try again."); }
  }

  if (disabledReason) {
    return (
      <div className="rounded-none border-l-2 border-[#9c2a2a] bg-[#f6e9e9]/50 px-3.5 py-3 text-[12px] text-[#7a2020] leading-relaxed">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tier && (
        <div className="rounded-none border-l-2 border-[#9c6b1f] bg-[#f4ecdb]/60 px-3.5 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9c6b1f]"
            style={{ fontFamily: MONO }}
          >
            Send exactly
          </div>
          <p
            className="mt-0.5 text-[15px] font-medium text-[#0f1620] tabular-nums"
            style={{ fontFamily: SERIF }}
          >
            {tier.price} USDT
          </p>
          <p className="mt-0.5 text-[11.5px] text-[#6b6557]">
            Network: TRC20 (Tron) — lowest fees for MENA region.
          </p>
        </div>
      )}

      {/* Address + QR */}
      <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557] mb-1"
              style={{ fontFamily: MONO }}
            >
              USDT wallet · TRC20
            </div>
            <code
              className="text-[11px] text-[#0f1620] break-all leading-relaxed"
              style={{ fontFamily: MONO }}
            >
              {address}
            </code>
          </div>
          <CopyBtn value={address} />
        </div>
        <div className="flex justify-center border-t border-[#e4ddcb] pt-4">
          <div className="rounded-none border border-[#d8d1bf] bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                address
              )}&margin=4&bgcolor=ffffff`}
              alt="USDT TRC20 wallet QR code"
              width={160}
              height={160}
              className="block"
            />
          </div>
        </div>
      </div>

      <div className="rounded-none border-l-2 border-[#9c2a2a] bg-[#f6e9e9]/50 px-3.5 py-2.5">
        <p className="text-[11.5px] text-[#7a2020] leading-relaxed">
          <strong>TRC20 (Tron) network only.</strong> Sending on the wrong network results in permanent loss of funds.
        </p>
      </div>

      {/* Card onramp */}
      <div className="rounded-none border border-[#d8d1bf]/70 bg-[#ece6d5]/40 p-4">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557] mb-2"
          style={{ fontFamily: MONO }}
        >
          Don&apos;t have USDT?
        </div>
        <p className="text-[12px] text-[#2b3543] leading-relaxed">
          Buy with Visa or Mastercard from any of these on-ramps:
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {[
            ["Binance P2P", "https://p2p.binance.com"],
            ["Bybit P2P", "https://www.bybit.com/fiat/trade/otc"],
            ["MoonPay", "https://www.moonpay.com/buy/usdt"],
          ].map(([name, url]) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-none border border-[#d8d1bf] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#2b3543] hover:border-[#2b3543] transition-colors"
              style={{ fontFamily: MONO }}
            >
              {name} →
            </a>
          ))}
        </div>
      </div>

      {/* TXID auto-verify */}
      {verifyStatus === "done" ? (
        <div className="rounded-none border-l-2 border-[#1f6b3d] bg-[#f3f8f4]/60 px-3.5 py-3 text-[12px] text-[#1f6b3d] leading-relaxed">
          <strong>Payment received.</strong> {verifyMsg}
        </div>
      ) : (
        <form onSubmit={handleVerify} className="rounded-none border border-[#d8d1bf]/70 bg-[#ece6d5]/40 p-4 space-y-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
            style={{ fontFamily: MONO }}
          >
            Confirm your payment automatically
          </div>
          <div>
            <label className="block text-[11px] text-[#6b6557] mb-1" style={{ fontFamily: MONO }}>
              Your email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-none border border-[#d8d1bf] bg-white px-3 py-2 text-[12px] text-[#0f1620] focus:border-[#2b3543] focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          <div>
            <label className="block text-[11px] text-[#6b6557] mb-1" style={{ fontFamily: MONO }}>
              Transaction ID (TXID) from TronScan
            </label>
            <input
              type="text"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder="64-character hex hash"
              className="w-full rounded-none border border-[#d8d1bf] bg-white px-3 py-2 text-[11.5px] text-[#0f1620] focus:border-[#2b3543] focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          {verifyStatus === "error" && (
            <p className="rounded-none border-l-2 border-[#9c2a2a] bg-[#f6e9e9]/50 px-3 py-2 text-[11.5px] text-[#9c2a2a]">
              {verifyMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={verifyStatus === "loading" || !txid.trim() || Boolean(disabledReason)}
            className="w-full rounded-none bg-[#0f1620] px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-[#2b3543] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifyStatus === "loading" ? "Verifying…" : "Verify transaction →"}
          </button>
          <p className="text-center text-[10.5px] text-[#8c8676]" style={{ fontFamily: MONO }}>
            Or email your receipt to{" "}
            <a href={`mailto:${CONFIG.supportEmail}`} className="underline underline-offset-2 hover:text-[#2b3543]">
              {CONFIG.supportEmail}
            </a>
          </p>
        </form>
      )}
    </div>
  );
}

/* ── Wire ──────────────────────────────────────────────────────────────── */

function WireTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const w = CONFIG.wire;
  const wireRows: [string, string][] = (
    [
      ["Bank", w.bankName],
      ["Account name", w.accountName],
      ["IBAN", w.iban],
      ["SWIFT / BIC", w.swift],
    ] as [string, string][]
  ).filter(([, v]) => Boolean(v));

  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [uploadMsg, setUploadMsg] = useState("");

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (!context.workOrderId) { setUploadMsg("No work order ID — please refresh and try again."); setUploadStatus("error"); return; }
    setUploadStatus("loading");
    setUploadMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("work_order_id", context.workOrderId);
      if (email.trim()) fd.append("email", email.trim());
      if (plan) fd.append("plan", plan);
      const res = await fetch("/api/pay/wire-proof", { method: "POST", headers: authHeaders(), body: fd });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) { setUploadStatus("done"); setUploadMsg("Receipt uploaded. We'll verify and activate your order within 1–3 business days."); }
      else { setUploadStatus("error"); setUploadMsg(data.error ?? "Upload failed. Please try again."); }
    } catch { setUploadStatus("error"); setUploadMsg("Network error. Please try again."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-[#d8d1bf]/70 overflow-hidden">
        {wireRows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-3 px-4 py-3 border-b border-[#e4ddcb] last:border-0"
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557] w-28 shrink-0"
              style={{ fontFamily: MONO }}
            >
              {label}
            </span>
            <span
              className="text-[11.5px] text-[#0f1620] flex-1 break-all"
              style={{ fontFamily: MONO }}
            >
              {value}
            </span>
            <CopyBtn value={value} />
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-[#6b6557]">
        Use your <strong className="text-[#0f1620]">email address</strong> as the payment reference so we can match your transfer. Wire transfers are reflected within 1–3 business days.
      </p>

      {/* Screenshot upload */}
      {uploadStatus === "done" ? (
        <div className="rounded-none border-l-2 border-[#1f6b3d] bg-[#f3f8f4]/60 px-3.5 py-3 text-[12px] text-[#1f6b3d] leading-relaxed">
          <strong>Receipt received.</strong> {uploadMsg}
        </div>
      ) : (
        <form onSubmit={handleUpload} className="rounded-none border border-[#d8d1bf]/70 bg-[#ece6d5]/40 p-4 space-y-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
            style={{ fontFamily: MONO }}
          >
            Upload your payment receipt
          </div>
          <div>
            <label className="block text-[11px] text-[#6b6557] mb-1" style={{ fontFamily: MONO }}>
              Your email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-none border border-[#d8d1bf] bg-white px-3 py-2 text-[12px] text-[#0f1620] focus:border-[#2b3543] focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          <div>
            {file ? (
              <div className="flex items-center gap-2 rounded-none border border-[#bfe0cc] bg-[#f3f8f4]/80 px-3 py-2 text-[11.5px] text-[#1f6b3d]" style={{ fontFamily: MONO }}>
                <span className="flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="shrink-0 underline underline-offset-2 hover:text-[#1a5c34]">Remove</button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-none border border-dashed border-[#d8d1bf] px-3.5 py-3 text-[11.5px] text-[#6b6557] hover:border-[#2b3543] hover:text-[#2b3543] transition-colors">
                <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="leading-snug flex-1" style={{ fontFamily: MONO }}>
                  <span className="font-semibold text-[#2b3543]">Choose file</span> — screenshot or PDF of bank transfer receipt
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
          {uploadStatus === "error" && (
            <p className="rounded-none border-l-2 border-[#9c2a2a] bg-[#f6e9e9]/50 px-3 py-2 text-[11.5px] text-[#9c2a2a]">
              {uploadMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={uploadStatus === "loading" || !file}
            className="w-full rounded-none bg-[#0f1620] px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-[#2b3543] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadStatus === "loading" ? "Uploading…" : "Upload receipt →"}
          </button>
          <p className="text-center text-[10.5px] text-[#8c8676]" style={{ fontFamily: MONO }}>
            Or email your receipt to{" "}
            <a href={`mailto:${CONFIG.supportEmail}`} className="underline underline-offset-2 hover:text-[#2b3543]">
              {CONFIG.supportEmail}
            </a>
          </p>
        </form>
      )}
    </div>
  );
}

/* ── Context card ──────────────────────────────────────────────────────── */

function ContextCard({ context }: { context: PayContext }) {
  if (!context.tender && !context.agency && !context.pipelineItemId && !context.workOrderId) return null;
  return (
    <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8c8676] mb-3"
        style={{ fontFamily: MONO }}
      >
        Work context
      </div>
      <div className="space-y-3">
        {context.tender && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
              style={{ fontFamily: MONO }}
            >
              Tender
            </div>
            <p
              className="mt-0.5 text-[14px] font-medium text-[#0f1620] leading-snug"
              style={{ fontFamily: SERIF }}
            >
              {context.tender}
            </p>
          </div>
        )}
        {context.agency && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6b6557]"
              style={{ fontFamily: MONO }}
            >
              Agency
            </div>
            <p className="mt-0.5 text-[13px] text-[#2b3543]">{context.agency}</p>
          </div>
        )}
        {(context.pipelineItemId || context.workOrderId) && (
          <p
            className="text-[11px] text-[#6b6557]"
            style={{ fontFamily: MONO }}
          >
            {context.pipelineItemId ? `Pipeline item · #${context.pipelineItemId}` : null}
            {context.pipelineItemId && context.workOrderId ? "  ·  " : null}
            {context.workOrderId ? `Work order · #${context.workOrderId}` : null}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

function PayPage() {
  const searchParams = useSearchParams();
  const planSlug = searchParams.get("plan");
  const context: PayContext = {
    tender: searchParams.get("tender"),
    agency: searchParams.get("agency"),
    pipelineItemId: searchParams.get("pipeline_item_id"),
    workOrderId: searchParams.get("work_order_id"),
    submissionType: searchParams.get("submission_type"),
  };
  const [selectedSlug, setSelectedSlug] = useState<string | null>(planSlug);
  const [storedTab, setStoredTab] = useState<Tab>("card");
  const [readiness, setReadiness] = useState<FulfillmentReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [freeEligible, setFreeEligible] = useState(false);

  // PR-I (2026-05-23): when a user arrives from a service intake (e.g.
  // /dashboard/services/bid-no-bid) they've ALREADY chosen the service —
  // forcing them to pick it again from a 4-tile grid was needless friction.
  // If `?plan=…` is present in the URL, hide step 01 entirely and let them
  // jump straight to payment method.
  const planPrelocked = Boolean(planSlug);
  // The new flat-subscription slugs aren't TIERS entries; give them a display
  // shape so the checkout shows a locked summary (not the tier grid). Only the
  // name/price/billingPeriod/featured fields are read by the summary below.
  const EXTRA_PLAN_DISPLAY: Record<string, { name: string; price: string; billingPeriod: string; featured: boolean }> = {
    "sub-monthly": { name: "Workbench subscription", price: "$49", billingPeriod: "/mo", featured: false },
    "sub-annual": { name: "Workbench subscription", price: "$324", billingPeriod: "/yr", featured: true },
  };
  const preselectedTier = planSlug
    ? (TIERS.find((t) => t.slug === planSlug) ?? EXTRA_PLAN_DISPLAY[planSlug] ?? null)
    : null;

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    const params = new URLSearchParams({ plan: selectedSlug });
    if (context.workOrderId) params.set("work_order_id", context.workOrderId);
    fetch(`/api/pay/readiness?${params.toString()}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          readiness?: FulfillmentReadiness;
          free_submission_eligible?: boolean;
          error?: string;
        };
        if (!res.ok || !data.readiness) throw new Error(data.error ?? "Could not check fulfillment readiness.");
        if (!cancelled) {
          setReadiness(data.readiness);
          setFreeEligible(Boolean(data.free_submission_eligible));
          setReadinessError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReadiness(null);
          setFreeEligible(false);
          setReadinessError(err instanceof Error ? err.message : "Could not check fulfillment readiness.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [context.workOrderId, selectedSlug]);

  // Wire payments cannot be auto-fulfilled today (manual proof review), so they
  // are hidden on one-time service plans where the user expects an immediate
  // AI-generated deliverable. Keep wire for monthly/annual subscription tiers
  // where the longer delivery window is acceptable.
  const ONE_TIME_NO_WIRE = new Set(["bid-no-bid", "proposal-draft", "roster-fast-track"]);
  const hideWire = selectedSlug ? ONE_TIME_NO_WIRE.has(selectedSlug) : false;

  // Derive the rendered tab so a plan change can never leave the user on a
  // hidden tab — no useEffect ping-pong required.
  const activeTab: Tab = freeEligible ? "card" : hideWire && storedTab === "wire" ? "card" : storedTab;
  const setActiveTab = setStoredTab;

  // When the first submission is free, collapse the payment methods to a single
  // "claim" path — paying via USDT/wire would charge for something that's free.
  const tabs: { id: Tab; label: string }[] = freeEligible
    ? [{ id: "card", label: "Free" }]
    : [
        { id: "card", label: "Card" },
        { id: "usdt", label: "USDT" },
        ...(hideWire ? [] : [{ id: "wire" as Tab, label: "Wire" }]),
      ];
  // Product-wide "coming soon" gate (e.g. Roster/LTA). When the selected plan
  // is held back, disabledReason flows into CardTab (button disabled) and
  // UsdtTab (renders the gate notice instead of the address/form); Wire is
  // already hidden for one-time service plans. The /api/pay/checkout route is
  // the hard server-side backstop.
  const planComingSoon = isComingSoonTier(selectedSlug);
  const disabledReason = planComingSoon
    ? "This service is coming soon — checkout is paused. We'll announce when it opens."
    : readiness && !readiness.payment_allowed
      ? readiness.message
      : undefined;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f6f3ec" }}>
      {/* Nav */}
      <nav className="border-b border-[#d8d1bf]/70 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-lg px-5 sm:px-6 flex h-14 items-center justify-between">
          <Link
            href="/"
            className="text-[15px] font-semibold text-[#0f1620]"
            style={{ fontFamily: SERIF }}
          >
            Tender<span style={{ color: "#9c6b1f" }}>·</span>Path
          </Link>
          <Link
            href="/dashboard"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b6557] hover:text-[#0f1620] transition-colors"
            style={{ fontFamily: MONO }}
          >
            ← Dashboard
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-lg px-4 sm:px-5 py-8 sm:py-10 space-y-5">
        {/* Header */}
        <div className="px-1">
          <div
            className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-[#8c8676]"
            style={{ fontFamily: MONO }}
          >
            Checkout · payment
          </div>
          <h1
            className="mt-1 text-[30px] sm:text-[36px] leading-[1.05] font-medium text-[#0f1620] tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Complete your purchase
          </h1>
          <p className="mt-1.5 text-[13px] text-[#6b6557]">
            Select a plan, then choose how to pay.
          </p>
        </div>

        <ContextCard context={context} />
        {planComingSoon && (
          <div className="rounded-none border-l-2 border-[#b3691a] bg-[#f7efe0]/80 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b3691a]"
              style={{ fontFamily: MONO }}
            >
              Coming soon
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#7a4711]">
              {preselectedTier?.name ?? "This service"} isn&rsquo;t available for purchase yet — we&rsquo;ve paused checkout. Explore the other services in the meantime, and we&rsquo;ll announce when this one opens.
            </p>
          </div>
        )}
        {freeEligible && !planComingSoon && (
          <div className="rounded-none border-l-2 border-[#1f6b3d] bg-[#f3f8f4]/80 px-4 py-3.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1f6b3d]"
              style={{ fontFamily: MONO }}
            >
              First submission · on us
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[#174d2b]">
              Your first proposal submission is free while you&rsquo;re on trial — no card needed. Claim it below and we&rsquo;ll start assembling it right away.
            </p>
          </div>
        )}
        {!planComingSoon && <ReadinessCard readiness={readiness} />}
        {!planComingSoon && readinessError && (
          <div className="rounded-none border-l-2 border-[#b3691a] bg-[#f7efe0]/60 px-3.5 py-3 text-[12px] text-[#8a5114] leading-relaxed">
            {readinessError}
          </div>
        )}

        {/* Step 1 — plan. Hidden when arriving from a service intake with
            ?plan=… already locked in (PR-I 2026-05-23). In that case we
            render a compact summary card so the user knows what they're
            paying for without having to re-pick from a grid. */}
        {planPrelocked && preselectedTier ? (
          <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-3">
              <span
                className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
                style={{ fontFamily: MONO }}
              >
                01
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
                style={{ fontFamily: MONO }}
              >
                Your selected service
              </h2>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <p
                  className="text-[14px] font-medium text-[#0f1620] leading-snug truncate"
                  style={{ fontFamily: SERIF }}
                >
                  {preselectedTier.name}
                </p>
                {preselectedTier.featured && (
                  <span
                    className="inline-block mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9c6b1f]"
                    style={{ fontFamily: MONO }}
                  >
                    · Popular ·
                  </span>
                )}
              </div>
              <p
                className="text-[22px] font-medium text-[#0f1620] tabular-nums tracking-tight shrink-0"
                style={{ fontFamily: SERIF }}
              >
                {preselectedTier.price}
                <span
                  className="text-[10px] font-medium text-[#6b6557] ml-1"
                  style={{ fontFamily: MONO }}
                >
                  {preselectedTier.billingPeriod}
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-4">
              <span
                className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
                style={{ fontFamily: MONO }}
              >
                01
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
                style={{ fontFamily: MONO }}
              >
                Select your plan
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {TIERS.map((t) => (
                <button
                  key={t.slug}
                  onClick={() => setSelectedSlug(t.slug)}
                  className={`rounded-none border p-3.5 text-left transition-colors ${
                    selectedSlug === t.slug
                      ? "border-[#0f1620] bg-[#ece6d5]/40"
                      : "border-[#d8d1bf]/70 hover:border-[#8c8676] bg-white"
                  }`}
                >
                  {t.featured && (
                    <span
                      className="inline-block text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9c6b1f] mb-1.5"
                      style={{ fontFamily: MONO }}
                    >
                      · Popular ·
                    </span>
                  )}
                  <p
                    className="text-[12px] font-medium text-[#2b3543] leading-snug"
                    style={{ fontFamily: MONO }}
                  >
                    {t.name}
                  </p>
                  <p
                    className="mt-1.5 text-[20px] font-medium text-[#0f1620] tabular-nums tracking-tight"
                    style={{ fontFamily: SERIF }}
                  >
                    {t.price}
                    <span
                      className="text-[10px] font-medium text-[#6b6557] ml-1"
                      style={{ fontFamily: MONO }}
                    >
                      {t.billingPeriod}
                    </span>
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2 — method */}
        <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5 mb-4">
            <span
              className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
              style={{ fontFamily: MONO }}
            >
              02
            </span>
            <h2
              className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
              style={{ fontFamily: MONO }}
            >
              Choose how to pay
            </h2>
          </div>

          {/* Tabs */}
          <div
            className={`grid gap-1 rounded-none border border-[#d8d1bf]/70 p-0.5 bg-[#ece6d5]/40 mb-5 ${
              tabs.length === 2 ? "grid-cols-2" : "grid-cols-3"
            }`}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-none py-2.5 sm:py-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] transition-colors ${
                  activeTab === tab.id
                    ? "bg-white text-[#0f1620] shadow-sm"
                    : "text-[#6b6557] hover:text-[#2b3543]"
                }`}
                style={{ fontFamily: MONO }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab body */}
          {/* key={selectedSlug} forces a remount when the plan changes — clears
              stale "Unknown plan" error state from a previous selection and
              tears down any half-mounted Stripe checkout iframe. Audit
              2026-05-19 P0 #2. */}
          {activeTab === "card" && <CardTab key={selectedSlug ?? "no-plan"} plan={selectedSlug} context={context} disabledReason={disabledReason} freeEligible={freeEligible} />}
          {activeTab === "usdt" && <UsdtTab plan={selectedSlug} context={context} disabledReason={disabledReason} />}
          {activeTab === "wire" && <WireTab plan={selectedSlug} context={context} />}
        </div>

        {/* After payment */}
        {activeTab !== "card" && (
          <div className="rounded-none border border-[#d8d1bf]/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-4">
              <span
                className="text-[10px] font-semibold tabular-nums text-[#8c8676]"
                style={{ fontFamily: MONO }}
              >
                03
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-[#2b3543]"
                style={{ fontFamily: MONO }}
              >
                After payment
              </h2>
            </div>
            <ol className="space-y-3">
              {[
                "Screenshot or save your transaction receipt / TXID.",
                `Email it to ${CONFIG.supportEmail} — include your plan name and the email you signed up with.`,
                "We verify and activate your account within 4 business hours.",
              ].map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[12.5px] leading-relaxed text-[#2b3543]"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#d8d1bf] bg-white text-[9px] font-semibold text-[#2b3543] tabular-nums mt-0.5"
                    style={{ fontFamily: MONO }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <footer className="py-7 text-center">
        <p
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8c8676]"
          style={{ fontFamily: MONO }}
        >
          © {new Date().getFullYear()} Tender·Path ·{" "}
          <a
            href={`mailto:${CONFIG.supportEmail}`}
            className="underline underline-offset-2 hover:text-[#2b3543]"
          >
            {CONFIG.supportEmail}
          </a>
        </p>
      </footer>
    </div>
  );
}

export default function PayPageWrapper() {
  return (
    <Suspense>
      <PayPage />
    </Suspense>
  );
}
