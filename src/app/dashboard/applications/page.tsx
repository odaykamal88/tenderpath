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
  notes: string | null;
}

const APPLICATION_STAGES: Stage[] = ["preparing", "submitted", "won", "lost"];

const STAGE_META: Record<Stage, { label: string; sub: string }> = {
  matched:    { label: "Matched",    sub: "shortlist" },
  evaluating: { label: "Evaluating", sub: "fit check" },
  preparing:  { label: "Preparing",  sub: "drafting" },
  submitted:  { label: "Submitted",  sub: "awaiting" },
  won:        { label: "Won",        sub: "secured" },
  lost:       { label: "Lost",       sub: "archive" },
};

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function serviceHref(service: "proposal" | "lta-roster", item: PipelineItem): string {
  const params = new URLSearchParams({
    pipeline_item_id: String(item.id),
    tender: item.tender_title,
  });
  if (item.tender_agency) params.set("agency", item.tender_agency);
  return `/dashboard/services/${service}?${params.toString()}`;
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

function isRosterAgency(agency: string | null): boolean {
  if (!agency) return false;
  return /\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(agency);
}

function tenderRef(id: number): string {
  return `TP-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

export default function ApplicationsPage() {
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
        console.error("[tp:applications:load_failed]", err);
        setError("We could not load your applications. Please refresh or sign in again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const applicationItems = useMemo(
    () => items.filter((item) => APPLICATION_STAGES.includes(item.stage)),
    [items],
  );

  const byStage = useMemo(() => {
    const map: Record<Stage, PipelineItem[]> = {
      matched: [], evaluating: [], preparing: [], submitted: [], won: [], lost: [],
    };
    for (const item of applicationItems) map[item.stage].push(item);
    for (const stage of APPLICATION_STAGES) {
      map[stage].sort((a, b) => {
        const aTime = a.tender_deadline ? new Date(a.tender_deadline).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.tender_deadline ? new Date(b.tender_deadline).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime || b.fit_score - a.fit_score;
      });
    }
    return map;
  }, [applicationItems]);

  return (
    <UpgradeGate
      title="Unlock application workflows"
      description="Preview the submission board, preparation steps, and proposal actions. A subscription opens the full workflow for moving tenders from decision to submitted."
    >
      <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-[1400px]">
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
            className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-900 border-b border-stone-900 -mb-px"
          >
            Applications
          </Link>
          <Link
            href="/dashboard/bid-analysis"
            className="pb-3 text-[12px] font-semibold uppercase tracking-[0.15em] text-stone-400 hover:text-stone-700 transition-colors"
          >
            Bid analysis
          </Link>
        </div>

        {/* Header */}
        <header className="flex items-end justify-between gap-6 mb-2">
          <div>
            <div className="flex items-center gap-3 text-[11px] text-stone-500">
              <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench</span>
              <span className="text-stone-300">·</span>
              <span style={{ fontFamily: MONO }}>Submission workflow</span>
            </div>
            <h1
              className="mt-1 text-[36px] sm:text-[48px] lg:text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
              style={{ fontFamily: SERIF }}
            >
              Applications
            </h1>
            <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
              Track tenders once the bid decision is made: prepare the package, submit, follow up, and record outcomes.
            </p>
          </div>
        </header>

        {/* Stats strip */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-200/70 rounded-md overflow-hidden">
          {[
            { label: "Preparing", value: byStage.preparing.length, sub: "package in progress" },
            { label: "Submitted", value: byStage.submitted.length, sub: "awaiting result" },
            { label: "Won", value: byStage.won.length, sub: "evidence to archive" },
            { label: "Lost", value: byStage.lost.length, sub: "lessons to capture" },
          ].map((s) => (
            <div key={s.label} className="bg-stone-50/60 px-4 py-3.5">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-500">{s.label}</div>
              <div
                className="mt-1 text-[28px] leading-none font-medium tabular-nums text-stone-900"
                style={{ fontFamily: SERIF }}
              >
                {loading ? "—" : s.value}
              </div>
              <div className="mt-1 text-[11px] text-stone-500">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Workflow strip */}
        <section className="mt-7 border border-stone-200/70 rounded-md bg-white p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2
              className="text-[20px] font-medium text-stone-900"
              style={{ fontFamily: SERIF }}
            >
              The workflow
            </h2>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              4 stages · prepare → outcome
            </span>
          </div>
          <div className="grid grid-cols-1 gap-px bg-stone-200/70 sm:grid-cols-4 rounded-sm overflow-hidden">
            {[
              ["01", "Prepare", "Confirm requirements, assemble documents, draft technical and financial sections."],
              ["02", "Review",  "Check compliance, signatures, eligibility, pricing, and submission format."],
              ["03", "Submit",  "Record submission date, portal/email used, and any confirmation reference."],
              ["04", "Follow up", "Track clarification requests, debrief notes, outcome, and reusable evidence."],
            ].map(([num, title, body]) => (
              <div key={num} className="bg-white px-4 py-4">
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[10px] font-semibold tabular-nums text-stone-400"
                    style={{ fontFamily: MONO }}
                  >
                    {num}
                  </span>
                  <span className="text-[14px] font-medium text-stone-900">{title}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-stone-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Active application work */}
        <section className="mt-7 border border-stone-200/70 rounded-md bg-white">
          <div className="border-b border-stone-200/70 px-5 py-4 flex items-baseline justify-between">
            <div>
              <h2
                className="text-[20px] font-medium text-stone-900"
                style={{ fontFamily: SERIF }}
              >
                Active application work
              </h2>
              <p className="mt-0.5 text-[12px] text-stone-500">
                Tenders appear here after they move to Preparing or later.
              </p>
            </div>
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400 tabular-nums"
              style={{ fontFamily: MONO }}
            >
              {applicationItems.length.toString().padStart(2, "0")} active
            </span>
          </div>

          {loading ? (
            <div className="p-5 text-[13px] text-stone-500">Loading…</div>
          ) : error ? (
            <div className="p-5 text-[13px] text-red-700 border-l-2 border-red-700 bg-red-50/40">{error}</div>
          ) : applicationItems.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[13px] text-stone-500 max-w-md mx-auto">
                No applications are active yet. Move a tender from <span className="text-stone-900">Evaluating</span> to <span className="text-stone-900">Preparing</span> when you decide to pursue it.
              </p>
              <Link
                href="/dashboard/pipeline"
                className="inline-block mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-stone-700 border border-stone-300 rounded-sm px-3 py-1.5 hover:border-stone-700 hover:text-stone-900 transition-colors"
              >
                → Open pipeline
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-2">
              {APPLICATION_STAGES.flatMap((stage) =>
                byStage[stage].map((item) => {
                  const dl = deadlineLabel(item.tender_deadline);
                  return (
                    <article
                      key={item.id}
                      className="rounded-md border border-stone-200/70 bg-white p-4 hover:border-stone-300 transition-colors"
                    >
                      {/* Top row: ref + stage + fit */}
                      <div className="flex items-center gap-2 mb-2">
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
                          {STAGE_META[stage].label}
                        </span>
                        <span className="text-stone-300">·</span>
                        <span
                          className="text-[10px] uppercase tracking-[0.15em] text-stone-400"
                          style={{ fontFamily: MONO }}
                        >
                          {STAGE_META[stage].sub}
                        </span>
                        {item.fit_score > 0 && (
                          <span
                            className="ml-auto text-[11px] font-semibold tabular-nums"
                            style={{
                              fontFamily: MONO,
                              color: item.fit_score >= 70 ? "#0f766e" : item.fit_score >= 50 ? "#a16207" : "#78716c",
                            }}
                          >
                            {item.fit_score}%
                          </span>
                        )}
                      </div>

                      {/* Title */}
                      <h3
                        className="text-[15.5px] font-medium text-stone-900 leading-snug"
                        style={{ fontFamily: SERIF }}
                      >
                        {item.tender_title}
                      </h3>

                      {/* Meta row */}
                      <div
                        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-stone-500 border-t border-stone-100 pt-2"
                        style={{ fontFamily: MONO }}
                      >
                        {item.tender_agency && <span className="text-stone-700">{item.tender_agency}</span>}
                        <span className={dl.urgent ? "font-semibold text-red-600" : ""}>{dl.text}</span>
                        {item.tender_value && <span>{item.tender_value}</span>}
                      </div>

                      {/* Actions */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Link
                          href={serviceHref("proposal", item)}
                          className="text-[10.5px] font-semibold uppercase tracking-wider text-white bg-stone-900 rounded-sm px-2.5 py-1 hover:bg-stone-700 transition-colors"
                        >
                          Proposal package →
                        </Link>
                        {isRosterAgency(item.tender_agency) && (
                          <Link
                            href={serviceHref("lta-roster", item)}
                            className="text-[10.5px] font-semibold uppercase tracking-wider text-amber-800 border border-amber-300 rounded-sm px-2 py-1 bg-amber-50 hover:border-amber-500 transition-colors"
                          >
                            LTA / roster
                          </Link>
                        )}
                        <Link
                          href="/dashboard/vault"
                          className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-700 border border-stone-300 rounded-sm px-2 py-1 bg-white hover:border-stone-700 hover:text-stone-900 transition-colors"
                        >
                          Vault
                        </Link>
                      </div>
                    </article>
                  );
                }),
              )}
            </div>
          )}
        </section>
      </div>
    </UpgradeGate>
  );
}
