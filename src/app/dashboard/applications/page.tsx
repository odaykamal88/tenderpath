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

function isRosterAgency(agency: string | null): boolean {
  if (!agency) return false;
  return /\b(UNDP|UNICEF|WFP|UNHCR|UNOPS|IOM|ILO|FAO|WHO|UNFPA)\b/i.test(agency);
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
      matched: [],
      evaluating: [],
      preparing: [],
      submitted: [],
      won: [],
      lost: [],
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
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Applications
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Submission workflow
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
            Track tenders once the bid decision is made: prepare the package, submit, follow up, and record outcomes.
          </p>
        </div>
        <Link
          href="/dashboard/pipeline"
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
        >
          Open full Kanban
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        {[
          { label: "Preparing", value: byStage.preparing.length, note: "Package in progress" },
          { label: "Submitted", value: byStage.submitted.length, note: "Awaiting result" },
          { label: "Won", value: byStage.won.length, note: "Evidence to archive" },
          { label: "Lost", value: byStage.lost.length, note: "Lessons to capture" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
            <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
            <div className="mt-0.5 text-xs text-gray-500">{stat.label}</div>
            <div className="mt-1 text-[11px] text-gray-400">{stat.note}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Application workflow</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
          {[
            ["1", "Prepare", "Confirm requirements, assemble documents, draft technical and financial sections."],
            ["2", "Review", "Check compliance, signatures, eligibility, pricing, and submission format."],
            ["3", "Submit", "Record submission date, portal/email used, and any confirmation reference."],
            ["4", "Follow up", "Track clarification requests, debrief notes, outcome, and reusable evidence."],
          ].map(([step, title, body]) => (
            <div key={step} className="rounded-md bg-gray-50 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
                  {step}
                </span>
                <div className="text-sm font-semibold text-gray-900">{title}</div>
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-600">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-6 rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Active application work</h2>
          <p className="mt-1 text-xs text-gray-500">
            Tenders appear here after they move to Preparing or later in the pipeline.
          </p>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Loading...</div>
        ) : error ? (
          <div className="p-5 text-sm text-red-700">{error}</div>
        ) : applicationItems.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">
            No applications are active yet. Move a tender from Evaluating to Preparing when you decide to pursue it.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-2">
            {APPLICATION_STAGES.flatMap((stage) =>
              byStage[stage].map((item) => (
                <div key={item.id} className="rounded-lg border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-700">
                      {stage}
                    </span>
                    {item.fit_score > 0 && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                        {item.fit_score}% fit
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">{item.tender_title}</h3>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                    {item.tender_agency && <span>{item.tender_agency}</span>}
                    <span>{deadlineLabel(item.tender_deadline)}</span>
                    {item.tender_value && <span>{item.tender_value}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                    <Link
                      href={serviceHref("proposal", item)}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700"
                    >
                      Proposal package
                    </Link>
                    {isRosterAgency(item.tender_agency) && (
                      <Link
                        href={serviceHref("lta-roster", item)}
                        className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:border-amber-300"
                      >
                        LTA / roster
                      </Link>
                    )}
                    <Link
                      href="/dashboard/vault"
                      className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:border-gray-400"
                    >
                      Document vault
                    </Link>
                  </div>
                </div>
              )),
            )}
          </div>
        )}
      </section>
    </div>
    </UpgradeGate>
  );
}
