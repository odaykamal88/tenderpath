"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import RecentWorkOrders from "./RecentWorkOrders";

type ServiceKey = "bid-no-bid" | "proposal" | "lta-roster" | "digest";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

const SERVICES: Record<ServiceKey, {
  index: string;
  label: string;
  short: string;
  price: string;
  cadence: string;
  title: string;
  body: string;
  bestFor: string;
  path: string;
  steps: string[];
}> = {
  "bid-no-bid": {
    index: "01",
    label: "Bid / no-bid analysis",
    short: "Bid / no-bid",
    price: "$39",
    cadence: "per tender",
    title: "Decide whether a tender is worth pursuing.",
    body: "A paid decision memo with fit assessment, blockers, required documents, effort estimate, and a clear pursue / skip recommendation.",
    bestFor: "Shortlisted tenders where proposal effort is expensive or the deadline is tight.",
    path: "/dashboard/services/bid-no-bid",
    steps: [
      "Select a matched tender from your pipeline.",
      "TenderPath checks eligibility, fit, and known blockers.",
      "Receive a decision memo: pursue, skip, or conditional.",
      "If pursuing, move the tender to Preparing.",
    ],
  },
  "proposal": {
    index: "02",
    label: "Proposal package",
    short: "Proposal",
    price: "$299",
    cadence: "per tender",
    title: "Turn a live tender into a submission pack.",
    body: "Technical narrative, compliance checklist, cover letter, and financial template — fully structured for review before submission.",
    bestFor: "Strong-fit tenders where the team needs speed and structure before the deadline.",
    path: "/dashboard/services/proposal",
    steps: [
      "Link to a tender in the Preparing stage.",
      "Upload or confirm required documents from your vault.",
      "TenderPath drafts the technical and financial sections.",
      "Review, refine, and export the final package.",
    ],
  },
  "lta-roster": {
    index: "03",
    label: "LTA / roster application",
    short: "LTA / roster",
    price: "$749",
    cadence: "per agency",
    title: "Prepare vendor registration and LTA readiness.",
    body: "Agency-specific registration package, capability statement, document formatting, and follow-up support for UN and donor agency eligibility.",
    bestFor: "UN and donor agencies where vendor readiness affects future eligibility and pipeline access.",
    path: "/dashboard/services/lta-roster",
    steps: [
      "Identify the target agency and roster window.",
      "TenderPath checks your current readiness gaps.",
      "Receive a registration package and capability statement.",
      "Submit and track your vendor registration status.",
    ],
  },
  "digest": {
    index: "04",
    label: "Weekly digest",
    short: "Digest",
    price: "$49",
    cadence: "per month",
    title: "Keep relevant opportunities flowing.",
    body: "A weekly matched shortlist scored against your company profile, with reminders, tender links, and deadline tracking.",
    bestFor: "Teams that want TenderPath to keep sourcing while they focus on active bids.",
    path: "/dashboard/services/digest",
    steps: [
      "Confirm your business profile is up to date.",
      "TenderPath runs weekly matching against live sources.",
      "Receive a digest with scored, ranked opportunities.",
      "Act on the highest-fit tenders directly from the email.",
    ],
  },
};

const TAB_ORDER: ServiceKey[] = ["bid-no-bid", "proposal", "lta-roster", "digest"];

interface TopItem {
  id: number;
  tender_title: string;
  tender_agency: string | null;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export default function ServicesPage() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as ServiceKey | null) ?? "bid-no-bid";
  const [activeTab, setActiveTab] = useState<ServiceKey>(
    TAB_ORDER.includes(initialTab) ? initialTab : "bid-no-bid"
  );
  const [topItem, setTopItem] = useState<TopItem | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/pipeline?stage=matched", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { items?: TopItem[] } | null) => {
        const first = data?.items?.[0] ?? null;
        if (first) setTopItem(first);
      })
      .catch(() => {});
  }, []);

  function serviceHref(path: string): string {
    if (!topItem) return path;
    const params = new URLSearchParams({
      pipeline_item_id: String(topItem.id),
      tender: topItem.tender_title,
      ...(topItem.tender_agency ? { agency: topItem.tender_agency } : {}),
    });
    return `${path}?${params.toString()}`;
  }

  const service = SERVICES[activeTab];

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1400px]">
      {/* Header */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-7">
        <div>
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench</span>
            <span className="text-stone-300">·</span>
            <span style={{ fontFamily: MONO }}>4 services · pay per outcome</span>
          </div>
          <h1
            className="mt-1 text-[36px] sm:text-[48px] lg:text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            Services
          </h1>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
            Each service maps to a specific moment in the tender workflow: <em>decide</em>, <em>prepare</em>, <em>register</em>, or <em>monitor</em>.
          </p>
        </div>
        <Link
          href="/dashboard/pipeline"
          className="shrink-0 rounded-sm border border-stone-300 bg-white px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
        >
          ← Open pipeline
        </Link>
      </header>

      {/* Pipeline context note */}
      {topItem && (
        <div className="mb-5 border-l-2 border-stone-900 bg-stone-50 px-4 py-3 flex items-baseline gap-3">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 shrink-0"
            style={{ fontFamily: MONO }}
          >
            Pipeline context
          </span>
          <span className="text-[13px] text-stone-700 leading-snug">
            <span className="font-medium text-stone-900">{topItem.tender_title}</span>
            {topItem.tender_agency ? <span className="text-stone-500"> · {topItem.tender_agency}</span> : null}
          </span>
        </div>
      )}

      {/* Service navigator (tabbed list — index + price) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-200/70 rounded-md overflow-hidden mb-6">
        {TAB_ORDER.map((key) => {
          const s = SERVICES[key];
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`text-left px-4 py-4 transition-colors ${
                active ? "bg-stone-900 text-white" : "bg-stone-50/60 text-stone-900 hover:bg-white"
              }`}
            >
              <div
                className={`text-[10px] font-semibold tabular-nums tracking-wider ${
                  active ? "text-white/60" : "text-stone-400"
                }`}
                style={{ fontFamily: MONO }}
              >
                {s.index}
              </div>
              <div
                className={`mt-1 text-[15px] font-medium leading-tight ${
                  active ? "text-white" : "text-stone-900"
                }`}
                style={{ fontFamily: SERIF }}
              >
                {s.short}
              </div>
              <div
                className={`mt-1.5 text-[10.5px] tabular-nums tracking-wider uppercase ${
                  active ? "text-white/70" : "text-stone-500"
                }`}
                style={{ fontFamily: MONO }}
              >
                {s.price} · {s.cadence}
              </div>
            </button>
          );
        })}
      </div>

      {/* Service detail */}
      <article className="rounded-md border border-stone-200/70 bg-white p-7 lg:p-9">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              {service.index} · {service.label}
            </div>
            <h2
              className="mt-2 text-[34px] leading-[1.1] font-medium text-stone-900 tracking-tight"
              style={{ fontFamily: SERIF }}
            >
              {service.title}
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-stone-600 max-w-2xl">
              {service.body}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div
              className="text-[40px] leading-none font-medium text-stone-900 tabular-nums"
              style={{ fontFamily: SERIF }}
            >
              {service.price}
            </div>
            <div
              className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              {service.cadence}
            </div>
          </div>
        </div>

        {/* Best for */}
        <div className="mt-7 grid grid-cols-[auto_1fr] gap-4 border-t border-stone-200/70 pt-5">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 pt-0.5"
            style={{ fontFamily: MONO }}
          >
            Best for
          </span>
          <span className="text-[14px] leading-relaxed text-stone-700">{service.bestFor}</span>
        </div>

        {/* How it works */}
        <div className="mt-7 border-t border-stone-200/70 pt-6">
          <h3
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-4"
            style={{ fontFamily: MONO }}
          >
            How it works · 4 steps
          </h3>
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {service.steps.map((step, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] gap-3">
                <span
                  className="text-[10px] font-semibold tabular-nums text-stone-400 pt-1"
                  style={{ fontFamily: MONO }}
                >
                  0{i + 1}
                </span>
                <span className="text-[13.5px] leading-relaxed text-stone-700">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* CTA */}
        <div className="mt-8 pt-6 border-t border-stone-200/70 flex flex-wrap items-center gap-4">
          <Link
            href={serviceHref(service.path)}
            className="inline-flex items-center gap-2 rounded-sm bg-stone-900 px-5 py-3 text-[12.5px] font-semibold uppercase tracking-wider text-white hover:bg-stone-700 transition-colors"
          >
            Start · {service.short} →
          </Link>
          {!topItem && (service.path === "/dashboard/services/bid-no-bid" || service.path === "/dashboard/services/proposal") && (
            <span
              className="text-[11px] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              No pipeline context — you'll select a tender on the next screen.
            </span>
          )}
        </div>
      </article>

      <div className="mt-7">
        <RecentWorkOrders />
      </div>
    </div>
  );
}
