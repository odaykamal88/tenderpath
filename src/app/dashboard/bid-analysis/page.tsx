"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import UpgradeGate from "../components/UpgradeGate";

type Stage = "matched" | "evaluating" | "preparing" | "submitted" | "won" | "lost";

interface PipelineItem {
  id: number;
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  fit_score: number;
  stage: Stage;
  match_reasons?: {
    summary?: string[];
    opportunityBucketLabel?: string | null;
    opportunityBucketReason?: string | null;
  } | null;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function serviceHref(item: PipelineItem): string {
  const params = new URLSearchParams({
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/dashboard/services/bid-no-bid?${params.toString()}`;
}

function deadlineLabel(deadline: string | null): string {
  if (!deadline) return "No deadline";
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "No deadline";
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return `Expired ${date.toLocaleDateString()}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `${days} days left`;
}

export default function BidAnalysisPage() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/pipeline", { headers: authHeaders() });
        if (!res.ok) throw new Error(`Pipeline GET failed: ${res.status}`);
        const body = await res.json();
        setItems(body.items ?? []);
      } catch (err) {
        console.error("[tp:bid-analysis:load_failed]", err);
        setError("We could not load your tender pipeline. Please refresh or sign in again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const decisionQueue = useMemo(() => {
    return items
      .filter((item) => ["matched", "evaluating"].includes(item.stage))
      .sort((a, b) => {
        const aTime = a.tender_deadline ? new Date(a.tender_deadline).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.tender_deadline ? new Date(b.tender_deadline).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime || b.fit_score - a.fit_score;
      });
  }, [items]);

  const analysedOrReady = items.filter((item) => ["preparing", "submitted", "won", "lost"].includes(item.stage)).length;

  return (
    <UpgradeGate
      title="Unlock bid analysis"
      description="Preview the decision queue and process flow. A subscription opens the full bid/no-bid workspace so your team can qualify tenders before writing proposals."
    >
    <div>
      {/* Sub-tab bar */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        <Link
          href="/dashboard/pipeline"
          className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 -mb-px"
        >
          Kanban
        </Link>
        <Link
          href="/dashboard/applications"
          className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 -mb-px"
        >
          Applications
        </Link>
        <Link
          href="/dashboard/bid-analysis"
          className="px-4 py-2.5 text-sm font-medium border-b-2 border-gray-900 text-gray-900 -mb-px"
        >
          Bid Analysis
        </Link>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Bid analysis
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Decide before you write
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
            Use this queue to choose which matched tenders deserve a paid bid/no-bid analysis before the team spends proposal time.
          </p>
        </div>
        <Link
          href="/dashboard/pipeline"
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
        >
          Open pipeline
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { label: "Need decision", value: decisionQueue.length, note: "Matched or evaluating" },
          { label: "Moved past decision", value: analysedOrReady, note: "Preparing or later" },
          { label: "Decision product", value: "$39", note: "Per tender analysis" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="mt-0.5 text-xs text-gray-500">{stat.label}</div>
            <div className="mt-1 text-[11px] text-gray-400">{stat.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-base font-semibold text-gray-900">Decision queue</h2>
            <p className="mt-1 text-xs text-gray-500">
              Prioritized by deadline first, then fit score.
            </p>
          </div>
          {loading ? (
            <div className="p-5 text-sm text-gray-500">Loading...</div>
          ) : error ? (
            <div className="p-5 text-sm text-red-700">{error}</div>
          ) : decisionQueue.length === 0 ? (
            <div className="p-5 text-sm text-gray-500">
              No tenders are waiting for a bid/no-bid decision. New assessment matches will appear here automatically after they seed your pipeline.
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {decisionQueue.map((item) => (
                <div key={item.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-700">
                          {item.stage}
                        </span>
                        {item.match_reasons?.opportunityBucketLabel && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                            {item.match_reasons.opportunityBucketLabel}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-2 text-sm font-semibold text-gray-900">{item.tender_title}</h3>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {item.tender_agency && <span>{item.tender_agency}</span>}
                        <span>{deadlineLabel(item.tender_deadline)}</span>
                        {item.tender_value && <span>{item.tender_value}</span>}
                        {item.fit_score > 0 && <span>{item.fit_score}% fit</span>}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-gray-600">
                        {item.match_reasons?.opportunityBucketReason
                          ?? item.match_reasons?.summary?.[0]
                          ?? "Run the decision memo to confirm fit, risks, missing documents, and effort before pursuing."}
                      </p>
                    </div>
                    <Link
                      href={serviceHref(item)}
                      className="shrink-0 rounded-md bg-gray-900 px-3 py-2 text-center text-xs font-semibold text-white hover:bg-gray-700"
                    >
                      Start analysis
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Process flow</h2>
          <ol className="mt-4 space-y-3">
            {[
              "Pick a matched tender from the decision queue.",
              "Tenderpath checks whether an analysis already exists.",
              "If needed, checkout opens for the $39 bid/no-bid product.",
              "The analysis page generates a recommendation, gap list, required documents, risks, and next steps.",
              "If the tender is worth pursuing, move it to Preparing and start the proposal package.",
            ].map((step, index) => (
              <li key={step} className="flex gap-3 text-sm text-gray-600">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
    </UpgradeGate>
  );
}
