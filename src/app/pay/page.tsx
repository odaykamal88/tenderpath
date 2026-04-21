"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TIERS } from "@/lib/pricing";

/* ── env-driven payment config ─────────────────────────────────────────────
   All sensitive values are read from env vars at build time via
   NEXT_PUBLIC_* so they're safe to expose in client components.
   Populate them in .env.local — never commit real values.
──────────────────────────────────────────────────────────────────────────── */
const CONFIG = {
  usdt: {
    trc20:  process.env.NEXT_PUBLIC_USDT_TRC20_ADDRESS  ?? "",
    erc20:  process.env.NEXT_PUBLIC_USDT_ERC20_ADDRESS  ?? "",
    bep20:  process.env.NEXT_PUBLIC_USDT_BEP20_ADDRESS  ?? "",
  },
  whish:   process.env.NEXT_PUBLIC_WHISH_LINK          ?? "",
  omt:     process.env.NEXT_PUBLIC_OMT_LINK            ?? "",
  wire: {
    us: {
      bankName:      process.env.NEXT_PUBLIC_WIRE_US_BANK_NAME      ?? "",
      accountName:   process.env.NEXT_PUBLIC_WIRE_US_ACCOUNT_NAME   ?? "",
      accountNumber: process.env.NEXT_PUBLIC_WIRE_US_ACCOUNT_NUMBER ?? "",
      routingNumber: process.env.NEXT_PUBLIC_WIRE_US_ROUTING        ?? "",
      swift:         process.env.NEXT_PUBLIC_WIRE_US_SWIFT          ?? "",
      address:       process.env.NEXT_PUBLIC_WIRE_US_BANK_ADDRESS   ?? "",
    },
    eg: {
      bankName:      process.env.NEXT_PUBLIC_WIRE_EG_BANK_NAME      ?? "",
      accountName:   process.env.NEXT_PUBLIC_WIRE_EG_ACCOUNT_NAME   ?? "",
      accountNumber: process.env.NEXT_PUBLIC_WIRE_EG_ACCOUNT_NUMBER ?? "",
      swift:         process.env.NEXT_PUBLIC_WIRE_EG_SWIFT          ?? "",
      iban:          process.env.NEXT_PUBLIC_WIRE_EG_IBAN           ?? "",
      address:       process.env.NEXT_PUBLIC_WIRE_EG_BANK_ADDRESS   ?? "",
    },
    lb: {
      bankName:      process.env.NEXT_PUBLIC_WIRE_LB_BANK_NAME      ?? "",
      accountName:   process.env.NEXT_PUBLIC_WIRE_LB_ACCOUNT_NAME   ?? "",
      accountNumber: process.env.NEXT_PUBLIC_WIRE_LB_ACCOUNT_NUMBER ?? "",
      swift:         process.env.NEXT_PUBLIC_WIRE_LB_SWIFT          ?? "",
      iban:          process.env.NEXT_PUBLIC_WIRE_LB_IBAN           ?? "",
      address:       process.env.NEXT_PUBLIC_WIRE_LB_BANK_ADDRESS   ?? "",
    },
  },
  supportEmail: "payments@tenderpath.co",
};

type Tab = "usdt" | "whish" | "wire";
type UsdtNetwork = "trc20" | "erc20" | "bep20";
type WireRegion = "us" | "eg" | "lb";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-200 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function WireRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 w-36 flex-shrink-0">{label}</span>
      <span className="text-xs font-mono text-gray-900 break-all">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

function UsdtTab() {
  const [network, setNetwork] = useState<UsdtNetwork>("trc20");

  const networks: { id: UsdtNetwork; label: string; note: string; recommended?: boolean }[] = [
    { id: "trc20", label: "TRC20 (Tron)", note: "Lowest fees · ~$1 · Fastest — recommended for Lebanon, Jordan, Turkey", recommended: true },
    { id: "bep20", label: "BEP20 (BSC)", note: "Low fees · ~$0.50 · Best for Binance users" },
    { id: "erc20", label: "ERC20 (Ethereum)", note: "Higher gas fees — use only if TRC20/BEP20 unavailable" },
  ];

  const address = CONFIG.usdt[network];

  return (
    <div className="space-y-6">
      {/* Network selector */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Select network</p>
        <div className="space-y-2">
          {networks.map((n) => (
            <button
              key={n.id}
              onClick={() => setNetwork(n.id)}
              className={`w-full flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                network === n.id
                  ? "border-amber-400 bg-amber-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                network === n.id ? "border-amber-500" : "border-gray-300"
              }`}>
                {network === n.id && <div className="h-2 w-2 rounded-full bg-amber-500" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{n.label}</span>
                  {n.recommended && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{n.note}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Address + QR */}
      {address ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">USDT Wallet Address</p>
          <div className="flex flex-col sm:flex-row gap-5 items-start">
            {/* QR code — generated from address via open QR API, no extra dependency */}
            <div className="flex-shrink-0 rounded-lg border border-amber-200 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(address)}&margin=0`}
                alt="USDT wallet QR code"
                width={140}
                height={140}
                className="block"
              />
            </div>
            <div className="flex-1">
              <p className="text-[11px] text-gray-500 mb-1">Wallet address</p>
              <div className="flex items-start gap-2 flex-wrap mb-3">
                <code className="text-xs font-mono text-gray-900 break-all leading-relaxed">{address}</code>
                <CopyButton value={address} />
              </div>
              <p className="text-xs text-red-600 font-medium leading-relaxed">
                ⚠ Only send USDT on the <strong>{networks.find(n => n.id === network)?.label.split(" ")[0]}</strong> network. Wrong network = permanent loss of funds.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-400">
          Wallet address not configured yet — contact us at{" "}
          <a href={`mailto:${CONFIG.supportEmail}`} className="text-amber-600 underline">{CONFIG.supportEmail}</a>
        </div>
      )}

      {/* Card onramp note */}
      <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-xs font-semibold text-blue-800 mb-1">Paying with Visa or Mastercard?</p>
        <p className="text-xs text-blue-700 mb-2">
          You can buy USDT with your card first, then send to the address above. Use any of these services:
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { name: "MoonPay", url: "https://www.moonpay.com/buy/usdt" },
            { name: "Binance P2P", url: "https://p2p.binance.com" },
            { name: "Bybit P2P", url: "https://www.bybit.com/fiat/trade/otc" },
            { name: "Transak", url: "https://transak.com" },
          ].map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
            >
              {s.name} →
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function WhishOmtTab() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        For clients in Lebanon — pay directly via Whish Money or OMT.
      </p>

      {CONFIG.whish ? (
        <a
          href={CONFIG.whish}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-xl border border-gray-200 p-5 hover:border-amber-300 hover:shadow-md transition-all group"
        >
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-[#00B050]/10 flex items-center justify-center text-[#00B050] font-bold text-lg">
            W
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">Pay with Whish Money</div>
            <div className="text-xs text-gray-500 mt-0.5">Tap to open payment link</div>
          </div>
          <svg className="w-4 h-4 text-gray-400 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-400">Whish link not configured.</div>
      )}

      {CONFIG.omt ? (
        <a
          href={CONFIG.omt}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-4 rounded-xl border border-gray-200 p-5 hover:border-amber-300 hover:shadow-md transition-all group"
        >
          <div className="h-10 w-10 flex-shrink-0 rounded-full bg-blue-600/10 flex items-center justify-center text-blue-600 font-bold text-sm">
            OMT
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-900">Pay with OMT</div>
            <div className="text-xs text-gray-500 mt-0.5">Tap to open payment link</div>
          </div>
          <svg className="w-4 h-4 text-gray-400 group-hover:text-amber-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-sm text-gray-400">OMT link not configured.</div>
      )}
    </div>
  );
}

function WireTab() {
  const [region, setRegion] = useState<WireRegion>("eg");

  const allRegions: { id: WireRegion; label: string; note: string }[] = [
    { id: "us", label: "United States (USD)", note: "ACH / SWIFT — recommended for Jordan, Turkey, international transfers" },
    { id: "eg", label: "Egypt (USD/EGP)", note: "Local transfer within Egypt or USD wire" },
    { id: "lb", label: "Lebanon (USD)", note: "USD account — check with your bank for transfer capability" },
  ];
  // Only show regions that have been configured
  const regions = allRegions.filter((r) => !!CONFIG.wire[r.id].bankName);

  const details = CONFIG.wire[region];

  return (
    <div className="space-y-6">
      {/* Region selector — only shown when multiple accounts are configured */}
      {regions.length === 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-400">
          Wire details not configured yet — contact us at{" "}
          <a href={`mailto:${CONFIG.supportEmail}`} className="text-amber-600 underline">{CONFIG.supportEmail}</a>
        </div>
      )}
      {regions.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Select receiving account</p>
          <div className="space-y-2">
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`w-full flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  region === r.id
                    ? "border-amber-400 bg-amber-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  region === r.id ? "border-amber-500" : "border-gray-300"
                }`}>
                  {region === r.id && <div className="h-2 w-2 rounded-full bg-amber-500" />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{r.label}</div>
                  <p className="text-xs text-gray-500 mt-0.5">{r.note}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Wire details — only when a configured region is active */}
      {regions.length > 0 && details.bankName ? (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Bank Details</p>
          <WireRow label="Bank Name"     value={details.bankName} />
          <WireRow label="Account Name"  value={details.accountName} />
          <WireRow label="Account No."   value={details.accountNumber} />
          {"routingNumber" in details && details.routingNumber && (
            <WireRow label="Routing No." value={(details as typeof CONFIG.wire.us).routingNumber} />
          )}
          {"iban" in details && details.iban && (
            <WireRow label="IBAN" value={(details as typeof CONFIG.wire.eg).iban} />
          )}
          <WireRow label="SWIFT / BIC"  value={details.swift} />
          <WireRow label="Bank Address" value={details.address} />
        </div>
      ) : null}

      {regions.length > 0 && <p className="text-xs text-gray-500">
        Please use your account email as the payment reference so we can match your transfer.
        Wire transfers are typically reflected within 1–3 business days.
      </p>}
    </div>
  );
}

function PayPage() {
  const searchParams = useSearchParams();
  const planSlug = searchParams.get("plan");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(planSlug);
  const tier = TIERS.find((t) => t.slug === selectedSlug);

  const [activeTab, setActiveTab] = useState<Tab>("usdt");

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "usdt",  label: "USDT (Crypto)",    icon: "₮" },
    { id: "whish", label: "Whish / OMT",      icon: "🇱🇧" },
    { id: "wire",  label: "Wire Transfer",    icon: "🏦" },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-6 flex h-14 items-center justify-between">
          <a href="/" className="text-lg font-semibold text-gray-900">
            Tender<span className="text-amber-500">Path</span>
          </a>
          <a href="/" className="text-sm text-gray-500 hover:text-gray-900">← Back to home</a>
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-serif text-3xl font-bold text-gray-900 mb-2">Alternative Payment</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            Pay securely with USDT, Whish Money, OMT, or bank wire transfer.
            After payment, email proof to{" "}
            <a href={`mailto:${CONFIG.supportEmail}`} className="text-amber-600 font-medium underline">
              {CONFIG.supportEmail}
            </a>{" "}
            with your account email and selected plan — we&apos;ll activate your account within 4 hours.
          </p>
        </div>

        {/* Tier selector — always shown so clients can pay directly without going through assessment */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Select service</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {TIERS.map((t) => (
              <button
                key={t.slug}
                onClick={() => setSelectedSlug(t.slug)}
                className={`rounded-xl border p-4 text-left transition-all ${
                  selectedSlug === t.slug
                    ? "border-amber-400 bg-amber-50"
                    : "border-gray-200 hover:border-gray-300 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className={`h-3.5 w-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                        selectedSlug === t.slug ? "border-amber-500" : "border-gray-300"
                      }`}>
                        {selectedSlug === t.slug && <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                      {t.featured && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Popular</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 ml-5">{t.billingNote}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span className="text-base font-bold text-gray-900">{t.price}</span>
                    <span className="text-[10px] text-gray-400 block">{t.billingPeriod}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-amber-500 text-amber-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "usdt"  && <UsdtTab />}
          {activeTab === "whish" && <WhishOmtTab />}
          {activeTab === "wire"  && <WireTab />}
        </div>

        {/* After payment instructions */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">After you pay</h3>
          <ol className="space-y-2">
            {[
              "Take a screenshot or save your transaction receipt / TXID",
              `Email it to ${CONFIG.supportEmail} with subject: "Payment – [your plan] – [your email]"`,
              "We'll verify and activate your account within 4 business hours",
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5 text-xs text-gray-600">
                <span className="h-4 w-4 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Stripe fallback */}
        <p className="mt-6 text-center text-xs text-gray-400">
          Have a card that works internationally?{" "}
          <a href={selectedSlug ? `/login?plan=${selectedSlug}` : "/assessment"} className="text-amber-600 underline font-medium">
            Pay with Stripe instead →
          </a>
        </p>
      </div>

      <footer className="border-t border-gray-100 py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} TenderPath. All rights reserved.
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
