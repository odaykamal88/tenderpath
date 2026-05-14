"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null;
import { TIERS } from "@/lib/pricing";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

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
  metadata?: Record<string, string>;
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
      className="shrink-0 rounded-sm border border-stone-300 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 transition-colors"
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
  const requirementScore = readiness.metadata?.requirement_model_score;
  const sourceScore = readiness.metadata?.source_quality_score;
  const missingCategories = (readiness.metadata?.missing_requirement_categories ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    <div className={`rounded-sm border-l-2 px-3.5 py-3 text-[12px] leading-relaxed ${
      blocked ? "border-red-600 bg-red-50/40 text-red-800" : "border-amber-600 bg-amber-50/40 text-amber-950"
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
          Readiness score · {readiness.score_0_10}/10
        </p>
      )}
      {(sourceScore || requirementScore) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ fontFamily: MONO }}>
          {sourceScore && <span>Source coverage {sourceScore}/10</span>}
          {requirementScore && <span>Requirement model {requirementScore}/10</span>}
        </div>
      )}
      {missingCategories.length > 0 && (
        <div className="mt-2 rounded-sm bg-white/50 px-2.5 py-2">
          <div className="font-semibold uppercase tracking-[0.14em]" style={{ fontFamily: MONO }}>
            Missing requirement categories
          </div>
          <ul className="mt-1 space-y-0.5">
            {missingCategories.slice(0, 5).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
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

function CardTab({ plan, context, disabledReason }: { plan: string | null; context: PayContext; disabledReason?: string }) {
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          tender: context.tender,
          agency: context.agency,
          pipeline_item_id: context.pipelineItemId,
          work_order_id: context.workOrderId,
        }),
      });
      const data = (await res.json()) as { clientSecret?: string; error?: string };
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
            <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[11.5px] text-red-700">
              {error}
            </p>
          )}
          <button
            onClick={startCheckout}
            disabled={status === "loading" || !plan || Boolean(disabledReason)}
            className="w-full rounded-sm bg-stone-900 px-4 py-3 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? "Loading secure checkout…" : "Pay with card →"}
          </button>
          <p
            className="flex items-center justify-center gap-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Secured by Stripe · Visa · Mastercard · Amex
          </p>
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txid: txid.trim(), plan, work_order_id: context.workOrderId, email: email.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) { setVerifyStatus("done"); setVerifyMsg(data.message ?? "Verified!"); }
      else { setVerifyStatus("error"); setVerifyMsg(data.error ?? "Verification failed."); }
    } catch { setVerifyStatus("error"); setVerifyMsg("Network error. Please try again."); }
  }

  if (disabledReason) {
    return (
      <div className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-3 text-[12px] text-red-800 leading-relaxed">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tier && (
        <div className="rounded-sm border-l-2 border-orange-600 bg-orange-50/40 px-3.5 py-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-700"
            style={{ fontFamily: MONO }}
          >
            Send exactly
          </div>
          <p
            className="mt-0.5 text-[15px] font-medium text-stone-900 tabular-nums"
            style={{ fontFamily: SERIF }}
          >
            {tier.price} USDT
          </p>
          <p className="mt-0.5 text-[11.5px] text-stone-600">
            Network: TRC20 (Tron) — lowest fees for MENA region.
          </p>
        </div>
      )}

      {/* Address + QR */}
      <div className="rounded-md border border-stone-200/70 bg-white p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-1"
              style={{ fontFamily: MONO }}
            >
              USDT wallet · TRC20
            </div>
            <code
              className="text-[11px] text-stone-900 break-all leading-relaxed"
              style={{ fontFamily: MONO }}
            >
              {address}
            </code>
          </div>
          <CopyBtn value={address} />
        </div>
        <div className="flex justify-center border-t border-stone-100 pt-4">
          <div className="rounded-sm border border-stone-200 bg-white p-2">
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

      <div className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-2.5">
        <p className="text-[11.5px] text-red-800 leading-relaxed">
          <strong>TRC20 (Tron) network only.</strong> Sending on the wrong network results in permanent loss of funds.
        </p>
      </div>

      {/* Card onramp */}
      <div className="rounded-md border border-stone-200/70 bg-stone-50/40 p-4">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-2"
          style={{ fontFamily: MONO }}
        >
          Don&apos;t have USDT?
        </div>
        <p className="text-[12px] text-stone-700 leading-relaxed">
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
              className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-stone-700 hover:border-stone-700 transition-colors"
              style={{ fontFamily: MONO }}
            >
              {name} →
            </a>
          ))}
        </div>
      </div>

      {/* TXID auto-verify */}
      {verifyStatus === "done" ? (
        <div className="rounded-sm border-l-2 border-emerald-600 bg-emerald-50/40 px-3.5 py-3 text-[12px] text-emerald-800 leading-relaxed">
          <strong>Payment received.</strong> {verifyMsg}
        </div>
      ) : (
        <form onSubmit={handleVerify} className="rounded-md border border-stone-200/70 bg-stone-50/40 p-4 space-y-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
            style={{ fontFamily: MONO }}
          >
            Confirm your payment automatically
          </div>
          <div>
            <label className="block text-[11px] text-stone-600 mb-1" style={{ fontFamily: MONO }}>
              Your email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-[12px] text-stone-900 focus:border-stone-700 focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          <div>
            <label className="block text-[11px] text-stone-600 mb-1" style={{ fontFamily: MONO }}>
              Transaction ID (TXID) from TronScan
            </label>
            <input
              type="text"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder="64-character hex hash"
              className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-[11.5px] text-stone-900 focus:border-stone-700 focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          {verifyStatus === "error" && (
            <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[11.5px] text-red-700">
              {verifyMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={verifyStatus === "loading" || !txid.trim() || Boolean(disabledReason)}
            className="w-full rounded-sm bg-stone-900 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {verifyStatus === "loading" ? "Verifying…" : "Verify transaction →"}
          </button>
          <p className="text-center text-[10.5px] text-stone-400" style={{ fontFamily: MONO }}>
            Or email your receipt to{" "}
            <a href={`mailto:${CONFIG.supportEmail}`} className="underline underline-offset-2 hover:text-stone-700">
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
      const res = await fetch("/api/pay/wire-proof", { method: "POST", body: fd });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) { setUploadStatus("done"); setUploadMsg("Receipt uploaded. We'll verify and activate your order within 1–3 business days."); }
      else { setUploadStatus("error"); setUploadMsg(data.error ?? "Upload failed. Please try again."); }
    } catch { setUploadStatus("error"); setUploadMsg("Network error. Please try again."); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-stone-200/70 overflow-hidden">
        {wireRows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-3 px-4 py-3 border-b border-stone-100 last:border-0"
          >
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 w-28 shrink-0"
              style={{ fontFamily: MONO }}
            >
              {label}
            </span>
            <span
              className="text-[11.5px] text-stone-900 flex-1 break-all"
              style={{ fontFamily: MONO }}
            >
              {value}
            </span>
            <CopyBtn value={value} />
          </div>
        ))}
      </div>
      <p className="text-[12px] leading-relaxed text-stone-600">
        Use your <strong className="text-stone-900">email address</strong> as the payment reference so we can match your transfer. Wire transfers are reflected within 1–3 business days.
      </p>

      {/* Screenshot upload */}
      {uploadStatus === "done" ? (
        <div className="rounded-sm border-l-2 border-emerald-600 bg-emerald-50/40 px-3.5 py-3 text-[12px] text-emerald-800 leading-relaxed">
          <strong>Receipt received.</strong> {uploadMsg}
        </div>
      ) : (
        <form onSubmit={handleUpload} className="rounded-md border border-stone-200/70 bg-stone-50/40 p-4 space-y-3">
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
            style={{ fontFamily: MONO }}
          >
            Upload your payment receipt
          </div>
          <div>
            <label className="block text-[11px] text-stone-600 mb-1" style={{ fontFamily: MONO }}>
              Your email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-[12px] text-stone-900 focus:border-stone-700 focus:outline-none"
              style={{ fontFamily: MONO }}
            />
          </div>
          <div>
            {file ? (
              <div className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11.5px] text-emerald-800" style={{ fontFamily: MONO }}>
                <span className="flex-1 truncate">{file.name}</span>
                <button type="button" onClick={() => setFile(null)} className="shrink-0 underline underline-offset-2 hover:text-emerald-900">Remove</button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-dashed border-stone-300 px-3.5 py-3 text-[11.5px] text-stone-500 hover:border-stone-700 hover:text-stone-700 transition-colors">
                <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="leading-snug flex-1" style={{ fontFamily: MONO }}>
                  <span className="font-semibold text-stone-700">Choose file</span> — screenshot or PDF of bank transfer receipt
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
            <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3 py-2 text-[11.5px] text-red-700">
              {uploadMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={uploadStatus === "loading" || !file}
            className="w-full rounded-sm bg-stone-900 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadStatus === "loading" ? "Uploading…" : "Upload receipt →"}
          </button>
          <p className="text-center text-[10.5px] text-stone-400" style={{ fontFamily: MONO }}>
            Or email your receipt to{" "}
            <a href={`mailto:${CONFIG.supportEmail}`} className="underline underline-offset-2 hover:text-stone-700">
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
    <div className="rounded-md border border-stone-200/70 bg-white p-5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-3"
        style={{ fontFamily: MONO }}
      >
        Work context
      </div>
      <div className="space-y-3">
        {context.tender && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Tender
            </div>
            <p
              className="mt-0.5 text-[14px] font-medium text-stone-900 leading-snug"
              style={{ fontFamily: SERIF }}
            >
              {context.tender}
            </p>
          </div>
        )}
        {context.agency && (
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Agency
            </div>
            <p className="mt-0.5 text-[13px] text-stone-700">{context.agency}</p>
          </div>
        )}
        {(context.pipelineItemId || context.workOrderId) && (
          <p
            className="text-[11px] text-stone-500"
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
  };
  const [selectedSlug, setSelectedSlug] = useState<string | null>(planSlug);
  const [storedTab, setStoredTab] = useState<Tab>("card");
  const [readiness, setReadiness] = useState<FulfillmentReadiness | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    const params = new URLSearchParams({ plan: selectedSlug });
    if (context.workOrderId) params.set("work_order_id", context.workOrderId);
    fetch(`/api/pay/readiness?${params.toString()}`)
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          readiness?: FulfillmentReadiness;
          error?: string;
        };
        if (!res.ok || !data.readiness) throw new Error(data.error ?? "Could not check fulfillment readiness.");
        if (!cancelled) {
          setReadiness(data.readiness);
          setReadinessError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setReadiness(null);
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
  const activeTab: Tab = hideWire && storedTab === "wire" ? "card" : storedTab;
  const setActiveTab = setStoredTab;

  const tabs: { id: Tab; label: string }[] = [
    { id: "card", label: "Card" },
    { id: "usdt", label: "USDT" },
    ...(hideWire ? [] : [{ id: "wire" as Tab, label: "Wire" }]),
  ];
  const disabledReason = readiness && !readiness.payment_allowed ? readiness.message : undefined;

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#fafaf7" }}>
      {/* Nav */}
      <nav className="border-b border-stone-200/70 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-lg px-5 sm:px-6 flex h-14 items-center justify-between">
          <Link
            href="/"
            className="text-[15px] font-semibold text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            Tender<span style={{ color: "#ea580c" }}>·</span>Path
          </Link>
          <Link
            href="/dashboard"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
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
            className="text-[10.5px] sm:text-[11px] font-semibold uppercase tracking-[0.16em] sm:tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Checkout · payment
          </div>
          <h1
            className="mt-1 text-[30px] sm:text-[36px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Complete your purchase
          </h1>
          <p className="mt-1.5 text-[13px] text-stone-600">
            Select a plan, then choose how to pay.
          </p>
        </div>

        <ContextCard context={context} />
        <ReadinessCard readiness={readiness} />
        {readinessError && (
          <div className="rounded-sm border-l-2 border-amber-600 bg-amber-50/40 px-3.5 py-3 text-[12px] text-amber-900 leading-relaxed">
            {readinessError}
          </div>
        )}

        {/* Step 1 — plan */}
        <div className="rounded-md border border-stone-200/70 bg-white p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5 mb-4">
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400"
              style={{ fontFamily: MONO }}
            >
              01
            </span>
            <h2
              className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-stone-700"
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
                className={`rounded-sm border p-3.5 text-left transition-colors ${
                  selectedSlug === t.slug
                    ? "border-stone-900 bg-stone-50/40"
                    : "border-stone-200/70 hover:border-stone-400 bg-white"
                }`}
              >
                {t.featured && (
                  <span
                    className="inline-block text-[9px] font-semibold uppercase tracking-[0.18em] text-orange-700 mb-1.5"
                    style={{ fontFamily: MONO }}
                  >
                    · Popular ·
                  </span>
                )}
                <p
                  className="text-[12px] font-medium text-stone-700 leading-snug"
                  style={{ fontFamily: MONO }}
                >
                  {t.name}
                </p>
                <p
                  className="mt-1.5 text-[20px] font-medium text-stone-900 tabular-nums tracking-tight"
                  style={{ fontFamily: SERIF }}
                >
                  {t.price}
                  <span
                    className="text-[10px] font-medium text-stone-500 ml-1"
                    style={{ fontFamily: MONO }}
                  >
                    {t.billingPeriod}
                  </span>
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 — method */}
        <div className="rounded-md border border-stone-200/70 bg-white p-4 sm:p-5">
          <div className="flex items-baseline gap-2.5 mb-4">
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400"
              style={{ fontFamily: MONO }}
            >
              02
            </span>
            <h2
              className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-stone-700"
              style={{ fontFamily: MONO }}
            >
              Choose how to pay
            </h2>
          </div>

          {/* Tabs */}
          <div
            className={`grid gap-1 rounded-sm border border-stone-200/70 p-0.5 bg-stone-50/40 mb-5 ${
              tabs.length === 2 ? "grid-cols-2" : "grid-cols-3"
            }`}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-sm py-2.5 sm:py-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] transition-colors ${
                  activeTab === tab.id
                    ? "bg-white text-stone-900 shadow-sm"
                    : "text-stone-500 hover:text-stone-700"
                }`}
                style={{ fontFamily: MONO }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab body */}
          {activeTab === "card" && <CardTab plan={selectedSlug} context={context} disabledReason={disabledReason} />}
          {activeTab === "usdt" && <UsdtTab plan={selectedSlug} context={context} disabledReason={disabledReason} />}
          {activeTab === "wire" && <WireTab plan={selectedSlug} context={context} />}
        </div>

        {/* After payment */}
        {activeTab !== "card" && (
          <div className="rounded-md border border-stone-200/70 bg-white p-4 sm:p-5">
            <div className="flex items-baseline gap-2.5 mb-4">
              <span
                className="text-[10px] font-semibold tabular-nums text-stone-400"
                style={{ fontFamily: MONO }}
              >
                03
              </span>
              <h2
                className="text-[13px] sm:text-[15px] font-semibold uppercase tracking-[0.13em] sm:tracking-[0.15em] text-stone-700"
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
                  className="flex gap-3 text-[12.5px] leading-relaxed text-stone-700"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-[9px] font-semibold text-stone-700 tabular-nums mt-0.5"
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
          className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          © {new Date().getFullYear()} Tender·Path ·{" "}
          <a
            href={`mailto:${CONFIG.supportEmail}`}
            className="underline underline-offset-2 hover:text-stone-700"
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
