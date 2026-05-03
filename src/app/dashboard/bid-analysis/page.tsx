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

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

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

function deadlineLabel(deadline: string | null): { text: string; urgent: boolean } {
  if (!deadline) return { text: "No deadline", urgent: false };
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return { text: "No deadline", urgent: false };
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Expired ${date.toLocaleDateString(undefined, { day: "2-digit", month: "short" })}`, urgent: false };
  if (days === 0) return { text: "Due today", urgent: true };
  if (days === 1) return { text: "Due tomorrow", urgent: true };
  if (days <= 7) return { text: `${days}d left`, urgent: true };
  return { text: `${days}d left`, urgent: false };
}

function tenderRef(id: number): string {
  return `TP-${id.toString(16).toUpperCase().padStart(4, "0")}`;
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
      <div className="px-8 py-8 max-w-[1400px]">
        {/* Sub-tab bar */}
        <div className="flex gap-6 mb-7 border-b border-stone-200/70">
          <Link
            href="/dashboard/pipeline"
            className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 transition-colors"
          >
            Kanban
          </Link>
          <Link
            href="/dashboard/applications"
            className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 transition-colors"
          >
            Applications
          </Link>
          <Link
            href="/dashboard/bid-analysis"
            className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-900 border-b border-stone-900 -mb-px"
          >
            Bid analysis
          </Link>
        </div>

        {/* Header */}
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-2">
          <div>
            <div className="flex items-center gap-3 text-[11px] text-stone-500">
              <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench</span>
              <span className="text-stone-300">·</span>
              <span style={{ fontFamily: MONO }}>$39 per analysis</span>
            </div>
            <h1
              className="mt-1 text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
              style={{ fontFamily: SERIF }}
            >
              Decide <em className="italic text-stone-500">before</em> you write.
            </h1>
            <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
              Use this queue to pick which matched tenders deserve a paid bid/no-bid memo before the team spends proposal time.
            </p>
          </div>
          <Link
            href="/dashboard/pipeline"
            className="shrink-0 rounded-sm border border-stone-300 bg-white px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
          >
            ← Open pipeline
          </Link>
        </header>

        {/* Stats strip */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-px bg-stone-200/70 rounded-md overflow-hidden">
          {[
            { label: "Need decision", value: decisionQueue.length.toString(), sub: "matched or evaluating" },
            { label: "Past decision", value: analysedOrReady.toString(), sub: "preparing or later" },
            { label: "Per analysis", value: "$39", sub: "decision memo" },
          ].map((s) => (
            <div key={s.label} className="bg-stone-50/60 px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500">{s.label}</div>
              <div
                className="mt-1 text-[28px] leading-none font-medium tabular-nums text-stone-900"
                style={{ fontFamily: SERIF }}
              >
                {loading && s.label !== "Per analysis" ? "—" : s.value}
              </div>
              <div className="mt-1 text-[11px] text-stone-500">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Two-column layout */}
        <div className="mt-7 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.8fr)]">
          {/* Decision queue */}
          <section className="rounded-md border border-stone-200/70 bg-white">
            <div className="border-b border-stone-200/70 px-5 py-4 flex items-baseline justify-between">
              <div>
                <h2
                  className="text-[20px] font-medium text-stone-900"
                  style={{ fontFamily: SERIF }}
                >
                  Decision queue
                </h2>
                <p className="mt-0.5 text-[12px] text-stone-500">
                  Prioritized by deadline first, then fit score.
                </p>
              </div>
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 tabular-nums"
                style={{ fontFamily: MONO }}
              >
                {decisionQueue.length.toString().padStart(2, "0")} waiting
              </span>
            </div>

            {loading ? (
              <div className="p-5 text-[13px] text-stone-500">Loading…</div>
            ) : error ? (
              <div className="p-5 text-[13px] text-red-700 border-l-2 border-red-700 bg-red-50/40 m-3">{error}</div>
            ) : decisionQueue.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-[13px] text-stone-500 max-w-md mx-auto">
                  No tenders waiting for a bid/no-bid decision. New assessment matches will appear here automatically after they seed your pipeline.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-stone-200/70">
                {decisionQueue.map((item) => {
                  const dl = deadlineLabel(item.tender_deadline);
                  return (
                    <article key={item.id} className="px-5 py-4 hover:bg-stone-50/60 transition-colors">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          {/* Top row */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="text-[10px] tracking-wider text-stone-400"
                              style={{ fontFamily: MONO }}
                            >
                              {tenderRef(item.id)}
                            </span>
                            <span className="text-stone-300">·</span>
                            <span
                              className="text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-600"
                              style={{ fontFamily: MONO }}
                            >
                              {item.stage}
                            </span>
                            {item.match_reasons?.opportunityBucketLabel && (
                              <>
                                <span className="text-stone-300">·</span>
                                <span
                                  className="text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-700"
                                  style={{ fontFamily: MONO }}
                                >
                                  {item.match_reasons.opportunityBucketLabel}
                                </span>
                              </>
                            )}
                          </div>

                          {/* Title */}
                          <h3
                            className="text-[16px] font-medium text-stone-900 leading-snug"
                            style={{ fontFamily: SERIF }}
                          >
                            {item.tender_title}
                          </h3>

                          {/* Meta row */}
                          <div
                            className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-stone-500"
                            style={{ fontFamily: MONO }}
                          >
                            {item.tender_agency && <span className="text-stone-700">{item.tender_agency}</span>}
                            <span className={dl.urgent ? "font-semibold text-red-600" : ""}>{dl.text}</span>
                            {item.tender_value && <span>{item.tender_value}</span>}
                            {item.fit_score > 0 && (
                              <span
                                style={{
                                  color: item.fit_score >= 70 ? "#0f766e" : item.fit_score >= 50 ? "#a16207" : "#78716c",
                                }}
                                className="font-semibold"
                              >
                                {item.fit_score}% fit
                              </span>
                            )}
                          </div>

                          {/* Reason */}
                          <p className="mt-2 text-[12.5px] leading-relaxed text-stone-600 max-w-2xl">
                            {item.match_reasons?.opportunityBucketReason
                              ?? item.match_reasons?.summary?.[0]
                              ?? "Run the decision memo to confirm fit, risks, missing documents, and effort before pursuing."}
                          </p>
                        </div>

                        <Link
                          href={serviceHref(item)}
                          className="shrink-0 rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-white hover:bg-stone-700 transition-colors self-start"
                        >
                          Start analysis →
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* Process aside */}
          <aside className="rounded-md border border-stone-200/70 bg-white p-5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              How it works
            </div>
            <h2
              className="mt-2 text-[24px] leading-tight font-medium text-stone-900 tracking-tight"
              style={{ fontFamily: SERIF }}
            >
              Process flow
            </h2>

            <ol className="mt-5 space-y-4">
              {[
                "Pick a matched tender from the decision queue.",
                "TenderPath checks whether an analysis already exists.",
                "If needed, checkout opens for the $39 bid/no-bid product.",
                "The analysis page generates a recommendation, gap list, required documents, risks, and next steps.",
                "If worth pursuing, move it to Preparing and start the proposal package.",
              ].map((step, index) => (
                <li key={step} className="grid grid-cols-[auto_1fr] gap-3 items-baseline">
                  <span
                    className="text-[10px] font-semibold tabular-nums text-stone-400"
                    style={{ fontFamily: MONO }}
                  >
                    0{index + 1}
                  </span>
                  <span className="text-[13px] leading-relaxed text-stone-700">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-6 pt-5 border-t border-stone-200/70">
              <div
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 mb-2"
                style={{ fontFamily: MONO }}
              >
                What you get back
              </div>
              <ul className="space-y-1.5 text-[12.5px] text-stone-700">
                {[
                  "Pursue / skip / conditional verdict",
                  "Win-probability score",
                  "Required documents checklist",
                  "Compliance gap list",
                  "Effort estimate (hours)",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <span
                      className="text-stone-400 mt-0.5 shrink-0"
                      style={{ fontFamily: MONO }}
                    >
                      ·
                    </span>
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </UpgradeGate>
  );
}
