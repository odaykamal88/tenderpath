"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TIERS } from "@/lib/pricing";

/* ── Payment config ─────────────────────────────────────────────────────────
   Env vars are read at build time (NEXT_PUBLIC_*). Known values are provided
   as fallbacks so the page works on Vercel without manual env configuration.
──────────────────────────────────────────────────────────────────────────── */
const CONFIG = {
  usdt: {
    trc20: process.env.NEXT_PUBLIC_USDT_TRC20_ADDRESS || "TKh1rcVFrbLX6mTKw9gJcZYoJZR4VSuCWF",
  },
  whish: process.env.NEXT_PUBLIC_WHISH_LINK || "",
  omt:   process.env.NEXT_PUBLIC_OMT_LINK   || "",
  wire: {
    bankName:    process.env.NEXT_PUBLIC_WIRE_EG_BANK_NAME    || "Commercial International Bank (CIB)",
    accountName: process.env.NEXT_PUBLIC_WIRE_EG_ACCOUNT_NAME || "Oday Kamal",
    iban:        process.env.NEXT_PUBLIC_WIRE_EG_IBAN         || "EG020010001800000100041263622",
    swift:       process.env.NEXT_PUBLIC_WIRE_EG_SWIFT        || "",
  },
  supportEmail: "info@tenderpath.me",
};

type Tab = "card" | "usdt" | "whish" | "wire";

interface PayContext {
  tender: string | null;
  agency: string | null;
  pipelineItemId: string | null;
  workOrderId: string | null;
}

/* ── Shared helpers ─────────────────────────────────────────────────────────*/

function CopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function contextLines(context: PayContext): string[] {
  return [
    context.tender ? `Tender: ${context.tender}` : null,
    context.agency ? `Agency: ${context.agency}` : null,
    context.pipelineItemId ? `Pipeline item ID: ${context.pipelineItemId}` : null,
  ].filter((line): line is string => Boolean(line));
}

function NotifyButton({ plan, context }: { plan: string; context: PayContext }) {
  const subject = encodeURIComponent(`Payment sent – ${plan}`);
  const lines = contextLines(context);
  const body = encodeURIComponent(
    `Hi TenderPath team,\n\nI have completed my payment for: ${plan}\nMy account email: [your email here]${lines.length ? `\n\nWork context:\n${lines.join("\n")}` : ""}\n\nI have attached my payment receipt / transaction ID.\n\nPlease activate my account.\n\nThank you.`
  );
  return (
    <a
      href={`mailto:${CONFIG.supportEmail}?subject=${subject}&body=${body}`}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-3 text-sm font-semibold text-white hover:bg-navy/90 transition"
    >
      I&apos;ve sent payment — notify us
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
      </svg>
    </a>
  );
}

/* ── Tab: Credit Card (Stripe) ──────────────────────────────────────────────*/

function CardTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plan) { setError("Please select a plan first."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/pay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          email,
          tender: context.tender,
          agency: context.agency,
          pipeline_item_id: context.pipelineItemId,
          work_order_id: context.workOrderId,
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error ?? "Something went wrong. Please try another payment method.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">
          Email address
        </label>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20 transition"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !plan}
        className="w-full rounded-xl bg-gold py-3.5 text-sm font-semibold text-white hover:bg-gold-dark shadow-md shadow-gold/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Redirecting to checkout…" : "Continue to Secure Checkout →"}
      </button>

      <div className="flex items-center justify-center gap-2 pt-1">
        <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="text-[11px] text-gray-400">Secured by Stripe · Visa · Mastercard · Amex</span>
      </div>
    </form>
  );
}

/* ── Tab: USDT ──────────────────────────────────────────────────────────────*/

function UsdtTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const tier = TIERS.find((t) => t.slug === plan);
  const address = CONFIG.usdt.trc20;

  return (
    <div className="space-y-4">
      {tier && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            Send exactly <span className="text-gold">{tier.price} USDT</span> to the address below
          </p>
          <p className="text-xs text-amber-700 mt-0.5">Network: TRC20 (Tron) — lowest fees for MENA region</p>
        </div>
      )}

      {/* Address + QR */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              USDT Wallet · TRC20 Network
            </p>
            <code className="text-xs font-mono text-gray-900 break-all leading-relaxed">
              {address}
            </code>
          </div>
          <CopyBtn value={address} />
        </div>

        <div className="flex justify-center border-t border-gray-200 pt-4">
          <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(address)}&margin=4&bgcolor=ffffff`}
              alt="USDT TRC20 wallet QR code"
              width={160}
              height={160}
              className="block"
            />
          </div>
        </div>
      </div>

      <p className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600 font-medium">
        ⚠ Send on <strong>TRC20 (Tron)</strong> network only. Sending on the wrong network results in permanent loss of funds.
      </p>

      {/* Card onramp */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-semibold text-blue-800 mb-1">Don&apos;t have USDT? Buy with Visa / Mastercard:</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {[
            ["Binance P2P", "https://p2p.binance.com"],
            ["Bybit P2P",   "https://www.bybit.com/fiat/trade/otc"],
            ["MoonPay",     "https://www.moonpay.com/buy/usdt"],
          ].map(([name, url]) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition"
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

/* ── Tab: Whish / OMT ───────────────────────────────────────────────────────*/

function WhishTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const hasAny = CONFIG.whish || CONFIG.omt;

  if (!hasAny) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-gray-700">Whish & OMT links coming soon</p>
          <p className="text-xs text-gray-500">
            Contact us to arrange payment directly.
          </p>
          <a
            href={`mailto:${CONFIG.supportEmail}?subject=Payment%20via%20Whish%2FOMT`}
            className="inline-block mt-1 text-sm font-medium text-gold underline"
          >
            {CONFIG.supportEmail}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Pay directly from your Whish Money or OMT wallet — tap to open the payment link.
      </p>

      {CONFIG.whish && (
        <a
          href={CONFIG.whish}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 hover:border-green-300 hover:bg-green-50 transition group"
        >
          <div className="h-11 w-11 shrink-0 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-lg">
            W
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Pay with Whish Money</p>
            <p className="text-xs text-gray-500 mt-0.5">Tap to open in Whish app</p>
          </div>
          <span className="text-gray-400 group-hover:text-green-600 transition text-lg">→</span>
        </a>
      )}

      {CONFIG.omt && (
        <a
          href={CONFIG.omt}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 hover:border-blue-300 hover:bg-blue-50 transition group"
        >
          <div className="h-11 w-11 shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm">
            OMT
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-gray-900">Pay with OMT</p>
            <p className="text-xs text-gray-500 mt-0.5">Tap to open in OMT app</p>
          </div>
          <span className="text-gray-400 group-hover:text-blue-600 transition text-lg">→</span>
        </a>
      )}

      <NotifyButton plan={plan ?? "unknown plan"} context={context} />
    </div>
  );
}

/* ── Tab: Wire Transfer ─────────────────────────────────────────────────────*/

function WireTab({ plan, context }: { plan: string | null; context: PayContext }) {
  const w = CONFIG.wire;
  const rows: [string, string][] = ([
    ["Bank",         w.bankName],
    ["Account Name", w.accountName],
    ["IBAN",         w.iban],
    ["SWIFT / BIC",  w.swift],
  ] as [string, string][]).filter(([, v]) => Boolean(v));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0"
          >
            <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
            <span className="text-xs font-mono text-gray-900 flex-1 break-all">{value}</span>
            <CopyBtn value={value} />
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-500 leading-relaxed">
        Use your <strong>email address</strong> as the payment reference so we can match your transfer.
        Wire transfers are reflected within 1–3 business days.
      </p>

      <NotifyButton plan={plan ?? "unknown plan"} context={context} />
    </div>
  );
}

function ContextCard({ context }: { context: PayContext }) {
  if (!context.tender && !context.agency && !context.pipelineItemId && !context.workOrderId) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">
        Work context
      </p>
      <div className="space-y-2 text-sm">
        {context.tender && (
          <div>
            <p className="text-xs text-gray-400">Tender</p>
            <p className="font-medium text-gray-900 leading-snug">{context.tender}</p>
          </div>
        )}
        {context.agency && (
          <div>
            <p className="text-xs text-gray-400">Agency</p>
            <p className="font-medium text-gray-900">{context.agency}</p>
          </div>
        )}
        {context.pipelineItemId && (
          <p className="text-xs text-gray-500">Pipeline item #{context.pipelineItemId}</p>
        )}
        {context.workOrderId && (
          <p className="text-xs text-gray-500">Work order #{context.workOrderId}</p>
        )}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────────────────*/

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
    { id: "card",  label: "💳 Card" },
    { id: "usdt",  label: "₮ USDT" },
    { id: "whish", label: "🇱🇧 Whish" },
    { id: "wire",  label: "🏦 Wire" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
        <div className="mx-auto max-w-lg px-6 flex h-14 items-center justify-between">
          <Link href="/" className="text-base font-semibold text-gray-900">
            Tender<span className="text-gold">Path</span>
          </Link>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-900 transition">
            ← Back
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-lg px-4 py-10 space-y-5">
        {/* Header */}
        <div className="px-2">
          <h1 className="text-2xl font-bold text-gray-900">Complete your purchase</h1>
          <p className="text-sm text-gray-500 mt-1">Select a plan and pay your preferred way.</p>
        </div>

        <ContextCard context={context} />

        {/* Step 1: Plan selector */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">
            1 · Select your plan
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {TIERS.map((t) => (
              <button
                key={t.slug}
                onClick={() => setSelectedSlug(t.slug)}
                className={`rounded-xl border p-3.5 text-left transition-all ${
                  selectedSlug === t.slug
                    ? "border-gold bg-gold/5 ring-1 ring-gold/30"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                {t.featured && (
                  <span className="inline-block rounded-full bg-gold/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gold mb-1.5">
                    Popular
                  </span>
                )}
                <p className="text-xs font-semibold text-gray-900 leading-snug">{t.name}</p>
                <p className="mt-2 text-lg font-bold text-gray-900">
                  {t.price}
                  <span className="text-[11px] font-normal text-gray-400 ml-0.5">{t.billingPeriod}</span>
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Payment method */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-4">
            2 · Choose how to pay
          </p>

          {/* Tabs */}
          <div className="grid grid-cols-4 gap-1 bg-gray-100 rounded-xl p-1 mb-5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg py-2 text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "card"  && <CardTab  plan={selectedSlug} context={context} />}
          {activeTab === "usdt"  && <UsdtTab  plan={selectedSlug} context={context} />}
          {activeTab === "whish" && <WhishTab plan={selectedSlug} context={context} />}
          {activeTab === "wire"  && <WireTab  plan={selectedSlug} context={context} />}
        </div>

        {/* After payment instructions (manual methods only) */}
        {activeTab !== "card" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              After payment
            </p>
            <ol className="space-y-3">
              {[
                "Screenshot or save your transaction receipt / TXID",
                `Email it to ${CONFIG.supportEmail} — include your plan name and the email you signed up with`,
                "We'll verify and activate your account within 4 business hours",
              ].map((step, i) => (
                <li key={i} className="flex gap-3 text-xs text-gray-600">
                  <span className="h-5 w-5 rounded-full bg-gold/10 text-gold text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <footer className="py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} TenderPath &nbsp;·&nbsp;{" "}
        <a href={`mailto:${CONFIG.supportEmail}`} className="hover:text-gray-600 underline">
          {CONFIG.supportEmail}
        </a>
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
