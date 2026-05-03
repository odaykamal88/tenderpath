"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface WorkOrder {
  id: number;
  plan: string;
  service_slug: string | null;
  status: string;
  payment_status: string | null;
  amount_cents: number | null;
  currency: string | null;
  pipeline_item_id: number | null;
  tender_title: string | null;
  agency: string | null;
  tender_url: string | null;
  intake: Record<string, unknown> | null;
  tender_deadline: string | null;
  fit_score: number | null;
  pipeline_stage: string | null;
  fulfillment_notes: string | null;
  created_at: string;
  updated_at: string;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function label(value: string): string {
  return value.replace(/-/g, " ").replace(/_/g, " ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "Unpaid";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function statusSteps(status: string) {
  const steps = [
    { key: "new", label: "Intake received", index: "01" },
    { key: "in_progress", label: "In progress", index: "02" },
    { key: "waiting_on_client", label: "Waiting on client", index: "03" },
    { key: "delivered", label: "Delivered", index: "04" },
  ];
  const index = steps.findIndex((step) => step.key === status);
  return { steps, activeIndex: index < 0 ? 0 : index };
}

function orderRef(id: number): string {
  return `WO-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

const PROPOSAL_SLUGS = new Set(["proposal-draft", "roster-fast-track"]);

export default function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasPackage, setHasPackage] = useState(false);

  useEffect(() => {
    params.then((value) => setId(value.id));
  }, [params]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`/api/dashboard/work-orders/${id}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = await res.json();
        setOrder(body.workOrder ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load work order");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id || !order) return;
    if (!PROPOSAL_SLUGS.has(order.service_slug ?? "")) return;
    fetch(`/api/proposals/generate?work_order_id=${id}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { exists: boolean } | null) => { if (data?.exists) setHasPackage(true); })
      .catch(() => {});
  }, [id, order]);

  const intakeRows = useMemo(() => {
    if (!order?.intake) return [];
    return Object.entries(order.intake)
      .map(([key, value]) => {
        const rendered = Array.isArray(value)
          ? value.join(", ")
          : typeof value === "boolean"
            ? value ? "Yes" : "No"
            : value == null
              ? ""
              : String(value);
        return [label(key), rendered] as const;
      })
      .filter(([, value]) => value.trim().length > 0);
  }, [order]);

  if (loading) {
    return (
      <div className="px-8 py-16 text-[13px] text-stone-500" style={{ fontFamily: MONO }}>
        Loading work order…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="px-8 py-8 max-w-[1400px]">
        <div className="rounded-md border-l-2 border-red-600 bg-red-50/40 p-5 text-[14px] text-red-700">
          {error ?? "Work order not found"}
        </div>
      </div>
    );
  }

  const progress = statusSteps(order.status);

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Back link */}
      <Link
        href="/dashboard/work-orders"
        className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 hover:text-stone-900 transition-colors"
        style={{ fontFamily: MONO }}
      >
        ← Back to work orders
      </Link>

      {/* Header */}
      <header className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span
              className="font-semibold uppercase tracking-[0.18em] text-stone-400"
              style={{ fontFamily: MONO }}
            >
              Work order
            </span>
            <span className="text-stone-300">·</span>
            <span className="tabular-nums" style={{ fontFamily: MONO }}>{orderRef(order.id)}</span>
            <span className="text-stone-300">·</span>
            <span
              className="uppercase tracking-[0.15em] font-semibold"
              style={{ fontFamily: MONO }}
            >
              {label(order.service_slug ?? order.plan)}
            </span>
          </div>
          <h1
            className="mt-1 text-[44px] leading-[1.1] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            {order.tender_title ?? label(order.plan)}
          </h1>
          <p className="mt-1 text-[13.5px] text-stone-600">
            <span className={order.payment_status === "paid" ? "text-emerald-700 font-semibold" : "text-stone-500"}>
              {order.payment_status ?? "pending"}
            </span>
            <span className="mx-2 text-stone-300">·</span>
            <span style={{ fontFamily: MONO }}>{money(order.amount_cents, order.currency)}</span>
          </p>
        </div>
        <span
          className="shrink-0 rounded-sm bg-stone-900 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white self-start"
          style={{ fontFamily: MONO }}
        >
          {label(order.status)}
        </span>
      </header>

      {/* Package ready callout */}
      {hasPackage && (
        <div className="mt-6 flex items-center justify-between gap-4 rounded-md border-l-2 border-emerald-600 bg-emerald-50/40 px-4 py-3.5">
          <div>
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-700"
              style={{ fontFamily: MONO }}
            >
              Package ready
            </div>
            <p className="mt-1 text-[13.5px] text-emerald-900">Your AI-generated package is ready to review.</p>
          </div>
          <Link
            href={`/dashboard/proposals/${id}`}
            className="shrink-0 rounded-sm bg-emerald-700 px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-white hover:bg-emerald-800 transition-colors"
          >
            View package →
          </Link>
        </div>
      )}

      {/* Progress */}
      <section className="mt-7 rounded-md border border-stone-200/70 bg-white p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2
            className="text-[20px] font-medium text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
              style={{ fontFamily: MONO }}
            >
              01 ·
            </span>
            Fulfillment progress
          </h2>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Step {progress.activeIndex + 1} / {progress.steps.length}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {progress.steps.map((step, index) => {
            const active = index === progress.activeIndex;
            const past = index < progress.activeIndex;
            return (
              <div
                key={step.key}
                className={`rounded-sm border px-3.5 py-3 ${
                  active
                    ? "border-stone-900 bg-stone-900 text-white"
                    : past
                    ? "border-stone-300 bg-stone-100/60 text-stone-700"
                    : "border-stone-200 bg-stone-50/40 text-stone-400"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`text-[10px] font-semibold tabular-nums ${active ? "text-white/70" : "text-stone-400"}`}
                    style={{ fontFamily: MONO }}
                  >
                    {step.index}
                  </span>
                  {past && !active && (
                    <span
                      className="text-[10px] uppercase tracking-[0.18em] text-emerald-700 font-semibold"
                      style={{ fontFamily: MONO }}
                    >
                      ✓
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[12.5px] font-medium">{step.label}</div>
              </div>
            );
          })}
        </div>
        {order.fulfillment_notes ? (
          <div className="mt-5 rounded-md border-l-2 border-amber-600 bg-amber-50/40 px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700"
              style={{ fontFamily: MONO }}
            >
              Latest note · from the team
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-amber-950">{order.fulfillment_notes}</p>
          </div>
        ) : (
          <p className="mt-5 text-[12.5px] text-stone-500">
            The TenderPath team will add fulfillment notes here as work progresses.
          </p>
        )}
      </section>

      {/* Two-column: Intake + Tender context */}
      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <section className="rounded-md border border-stone-200/70 bg-white p-5">
          <h2
            className="text-[20px] font-medium text-stone-900 mb-4"
            style={{ fontFamily: SERIF }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
              style={{ fontFamily: MONO }}
            >
              02 ·
            </span>
            Intake
          </h2>
          {intakeRows.length === 0 ? (
            <p className="text-[13px] text-stone-500">No intake fields were captured for this work order.</p>
          ) : (
            <dl className="space-y-4">
              {intakeRows.map(([key, value]) => (
                <div key={key} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-4 gap-y-1">
                  <dt
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                    style={{ fontFamily: MONO }}
                  >
                    {key}
                  </dt>
                  <dd className="whitespace-pre-wrap text-[13px] leading-relaxed text-stone-800">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <aside className="rounded-md border border-stone-200/70 bg-white p-5">
          <h2
            className="text-[20px] font-medium text-stone-900 mb-4"
            style={{ fontFamily: SERIF }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
              style={{ fontFamily: MONO }}
            >
              03 ·
            </span>
            Tender context
          </h2>
          <dl className="space-y-3.5">
            {order.agency && (
              <div>
                <dt
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                  style={{ fontFamily: MONO }}
                >
                  Agency
                </dt>
                <dd className="mt-0.5 text-[13.5px] text-stone-900">{order.agency}</dd>
              </div>
            )}
            <div>
              <dt
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                Pipeline
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-stone-900">
                {order.pipeline_item_id
                  ? <span style={{ fontFamily: MONO }}>#{order.pipeline_item_id} · {label(order.pipeline_stage ?? "no stage")}</span>
                  : "No pipeline item attached"}
              </dd>
            </div>
            <div>
              <dt
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                Deadline
              </dt>
              <dd className="mt-0.5 text-[13.5px] text-stone-900" style={{ fontFamily: MONO }}>
                {formatDate(order.tender_deadline)}
              </dd>
            </div>
            {order.fit_score != null && (
              <div>
                <dt
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
                  style={{ fontFamily: MONO }}
                >
                  Fit score
                </dt>
                <dd
                  className="mt-0.5 text-[24px] tabular-nums font-medium text-stone-900"
                  style={{ fontFamily: SERIF }}
                >
                  {order.fit_score}
                  <span className="text-[14px] text-stone-500 ml-0.5">%</span>
                </dd>
              </div>
            )}
          </dl>
          {order.tender_url && (
            <a
              href={order.tender_url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex rounded-sm border border-stone-300 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            >
              Open tender ↗
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
