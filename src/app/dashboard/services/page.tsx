"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import RecentWorkOrders from "./RecentWorkOrders";

const SERVICES = [
  {
    path: "/dashboard/services/bid-no-bid",
    label: "Bid/no-bid",
    price: "$39",
    title: "Decide whether a tender is worth pursuing",
    body: "A paid decision memo with fit, blockers, required documents, effort, and a clear pursue / skip recommendation.",
    bestFor: "Shortlisted tenders where proposal effort is expensive or the deadline is tight.",
  },
  {
    path: "/dashboard/services/digest",
    label: "Weekly digest",
    price: "$49/mo",
    title: "Keep relevant opportunities flowing",
    body: "A weekly matched shortlist scored against the company profile, with reminders and tender links.",
    bestFor: "Teams that want Tenderpath to keep sourcing while they focus on bids.",
  },
  {
    path: "/dashboard/services/proposal",
    label: "Proposal package",
    price: "$299",
    title: "Turn a live tender into a submission pack",
    body: "Technical narrative, compliance checklist, cover letter, and financial template for review.",
    bestFor: "Strong-fit tenders where the team needs speed and structure before submission.",
  },
  {
    path: "/dashboard/services/lta-roster",
    label: "LTA / roster",
    price: "$749",
    title: "Prepare vendor registration and LTA readiness",
    body: "Agency-specific registration package, capability statement, document formatting, and follow-up support.",
    bestFor: "UN and donor agencies where vendor readiness affects future eligibility.",
  },
];

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

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Service paths
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Pick the next procurement action
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Each service maps to a specific moment in the tender workflow: decide, monitor, prepare, or become eligible.
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
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-800">
          <span className="font-semibold">Using pipeline context: </span>
          {topItem.tender_title}
          {topItem.tender_agency ? ` — ${topItem.tender_agency}` : ""}
        </div>
      )}

      <RecentWorkOrders />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {SERVICES.map((service) => (
          <Link
            key={service.path}
            href={serviceHref(service.path)}
            className="rounded-lg border border-gray-200 bg-white p-5 transition hover:border-gray-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {service.label}
                </div>
                <h2 className="mt-2 text-lg font-semibold text-gray-900">
                  {service.title}
                </h2>
              </div>
              <div className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                {service.price}
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600">{service.body}</p>
            <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <span className="font-semibold text-gray-900">Best for: </span>
              {service.bestFor}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
