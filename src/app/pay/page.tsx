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

function contextLines(c: PayContext): string[] {
  return [
    c.tender ? `Tender: ${c.tender}` : null,
    c.agency ? `Agency: ${c.agency}` : null,
    c.pipelineItemId ? `Pipeline item ID: ${c.pipelineItemId}` : null,
  ].filter((line): line is string => Boolean(line));
}

function NotifyButton({ plan, context }: { plan: string; context: PayContext }) {
  const subject = encodeURIComponent(`Payment sent – ${plan}`);
  const lines = contextLines(context);
  const body = encodeURIComponent(
    `Hi TenderPath team,\n\nI have completed my payment for: ${plan}\nMy account email: [your email here]${
      lines.length ? `\n\nWork context:\n${lines.join("\n")}` : ""
    }\n\nI have attached my payment receipt / transaction ID.\n\nPlease activate my account.\n\nThank you.`
  );
  return (
    <a
      href={`mailto:${CONFIG.supportEmail}?subject=${subject}&body=${body}`}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-sm bg-stone-900 px-4 py-3 text-[12.5px] font-semibold text-white hover:bg-stone-800 transition-colors"
    >
      I&apos;ve sent payment — notify us →
    </a>
  );
}

/* ── Card / Stripe ─────────────────────────────────────────────────────── */

function CardTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const [status, setStatus] = useState<"idle" | "loading" | "mounted" | "error">("idle");
  const [error, setError] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const checkoutRef = useRef<{ destroy(): void } | null>(null);

  useEffect(() => {
    return () => { checkoutRef.current?.destroy(); };
  }, []);

  async function startCheckout() {
    if (!plan) { setError("Select a plan first."); return; }
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
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: data.clientSecret });
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
            disabled={status === "loading" || !plan}
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

function UsdtTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const tier = TIERS.find((t) => t.slug === plan);
  const address = CONFIG.usdt.trc20;

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

      <NotifyButton plan={plan ?? "unknown plan"} context={context} />
    </div>
  );
}

/* ── Wire ──────────────────────────────────────────────────────────────── */

function WireTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const w = CONFIG.wire;
  const rows: [string, string][] = (
    [
      ["Bank", w.bankName],
      ["Account name", w.accountName],
      ["IBAN", w.iban],
      ["SWIFT / BIC", w.swift],
    ] as [string, string][]
  ).filter(([, v]) => Boolean(v));

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-stone-200/70 overflow-hidden">
        {rows.map(([label, value]) => (
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
      <NotifyButton plan={plan ?? "unknown plan"} context={context} />
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
  const [activeTab, setActiveTab] = useState<Tab>("card");

  const tabs: { id: Tab; label: string }[] = [
    { id: "card", label: "Card" },
    { id: "usdt", label: "USDT" },
    { id: "wire", label: "Wire" },
  ];

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
            href="/"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
            style={{ fontFamily: MONO }}
          >
            ← Home
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
          <div className="grid grid-cols-3 gap-1 rounded-sm border border-stone-200/70 p-0.5 bg-stone-50/40 mb-5">
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
          {activeTab === "card" && <CardTab plan={selectedSlug} context={context} />}
          {activeTab === "usdt" && <UsdtTab plan={selectedSlug} context={context} />}
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
