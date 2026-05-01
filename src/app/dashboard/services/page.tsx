"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import RecentWorkOrders from "./RecentWorkOrders";

type ServiceKey = "bid-no-bid" | "proposal" | "lta-roster" | "digest";

const SERVICES: Record<ServiceKey, {
  label: string;
  price: string;
  title: string;
  body: string;
  bestFor: string;
  path: string;
  steps: string[];
}> = {
  "bid-no-bid": {
    label: "Bid / No-Bid Analysis",
    price: "$39",
    title: "Decide whether a tender is worth pursuing",
    body: "A paid decision memo with fit assessment, blockers, required documents, effort estimate, and a clear pursue / skip recommendation.",
    bestFor: "Shortlisted tenders where proposal effort is expensive or the deadline is tight.",
    path: "/dashboard/services/bid-no-bid",
    steps: [
      "Select a matched tender from your pipeline.",
      "Tenderpath checks eligibility, fit, and known blockers.",
      "Receive a decision memo: pursue, skip, or conditional.",
      "If pursuing, move the tender to Preparing.",
    ],
  },
  "proposal": {
    label: "Proposal Package",
    price: "$299",
    title: "Turn a live tender into a submission pack",
    body: "Technical narrative, compliance checklist, cover letter, and financial template — fully structured for review before submission.",
    bestFor: "Strong-fit tenders where the team needs speed and structure before the deadline.",
    path: "/dashboard/services/proposal",
    steps: [
      "Link to a tender in the Preparing stage.",
      "Upload or confirm required documents from your vault.",
      "Tenderpath drafts the technical and financial sections.",
      "Review, refine, and export the final package.",
    ],
  },
  "lta-roster": {
    label: "LTA / Roster Application",
    price: "$749",
    title: "Prepare vendor registration and LTA readiness",
    body: "Agency-specific registration package, capability statement, document formatting, and follow-up support for UN and donor agency eligibility.",
    bestFor: "UN and donor agencies where vendor readiness affects future eligibility and pipeline access.",
    path: "/dashboard/services/lta-roster",
    steps: [
      "Identify the target agency and roster window.",
      "Tenderpath checks your current readiness gaps.",
      "Receive a registration package and capability statement.",
      "Submit and track your vendor registration status.",
    ],
  },
  "digest": {
    label: "Weekly Digest",
    price: "$49/mo",
    title: "Keep relevant opportunities flowing",
    body: "A weekly matched shortlist scored against your company profile, with reminders, tender links, and deadline tracking.",
    bestFor: "Teams that want Tenderpath to keep sourcing while they focus on active bids.",
    path: "/dashboard/services/digest",
    steps: [
      "Confirm your business profile is up to date.",
      "Tenderpath runs weekly matching against live sources.",
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
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Services
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Procurement services
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Each service maps to a specific moment in the tender workflow: decide, prepare, register, or monitor.
          </p>
        </div>
        <Link
          href="/dashboard/pipeline"
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
        >
          Open pipeline
        </Link>
      </div>

      {topItem && (
        <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <span className="font-semibold">Using pipeline context: </span>
          {topItem.tender_title}
          {topItem.tender_agency ? ` — ${topItem.tender_agency}` : ""}
        </div>
      )}

      {/* In-page tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TAB_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === key
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {SERVICES[key].label}
          </button>
        ))}
      </div>

      {/* Service detail */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{service.title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 max-w-2xl">{service.body}</p>
          </div>
          <div className="shrink-0 rounded-full bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-700">
            {service.price}
          </div>
        </div>

        <div className="mt-5 rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <span className="font-semibold text-gray-900">Best for: </span>
          {service.bestFor}
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">How it works</h3>
          <ol className="space-y-2.5">
            {service.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-6 pt-5 border-t border-gray-100">
          <Link
            href={serviceHref(service.path)}
            className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 transition-colors"
          >
            Start — {service.label}
          </Link>
        </div>
      </div>

      <RecentWorkOrders />
    </div>
  );
}
