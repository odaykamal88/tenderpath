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
  if (cents == null) return "Not paid yet";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function statusSteps(status: string) {
  const steps = [
    { key: "new", label: "Intake received" },
    { key: "in_progress", label: "In progress" },
    { key: "waiting_on_client", label: "Waiting on client" },
    { key: "delivered", label: "Delivered" },
  ];
  const index = steps.findIndex((step) => step.key === status);
  return { steps, activeIndex: index < 0 ? 0 : index };
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

  if (loading) return <div className="text-sm text-gray-500">Loading work order...</div>;

  if (error || !order) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {error ?? "Work order not found"}
      </div>
    );
  }

  const progress = statusSteps(order.status);

  return (
    <div>
      <Link href="/dashboard/work-orders" className="text-sm font-semibold text-gray-500 hover:text-gray-900 underline">
        Back to work orders
      </Link>

      <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Work order #{order.id}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {order.tender_title ?? label(order.plan)}
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            {label(order.service_slug ?? order.plan)} · {order.payment_status ?? "pending"} · {money(order.amount_cents, order.currency)}
          </p>
        </div>
        <div className="rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold capitalize text-white">
          {label(order.status)}
        </div>
      </div>

      {hasPackage && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-green-800">Package ready</div>
            <p className="text-xs text-green-700">Your AI-generated package is ready to review.</p>
          </div>
          <Link
            href={`/dashboard/proposals/${id}`}
            className="shrink-0 rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
          >
            View Package →
          </Link>
        </div>
      )}

      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Fulfillment progress</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          {progress.steps.map((step, index) => (
            <div
              key={step.key}
              className={`rounded-md border px-3 py-3 ${
                index <= progress.activeIndex
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-gray-50 text-gray-500"
              }`}
            >
              <div className="text-xs font-semibold">{step.label}</div>
            </div>
          ))}
        </div>
        {order.fulfillment_notes ? (
          <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Latest note</div>
            <p className="mt-1 text-sm leading-6 text-amber-950">{order.fulfillment_notes}</p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-500">
            The TenderPath team will add fulfillment notes here as work progresses.
          </p>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Intake</h2>
          {intakeRows.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">No intake fields were captured for this work order.</p>
          ) : (
            <dl className="mt-4 space-y-3">
              {intakeRows.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{key}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-800">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <aside className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Tender context</h2>
          <dl className="mt-4 space-y-3 text-sm">
            {order.agency && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Agency</dt>
                <dd className="mt-1 text-gray-900">{order.agency}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pipeline</dt>
              <dd className="mt-1 text-gray-900">
                {order.pipeline_item_id ? `#${order.pipeline_item_id} · ${order.pipeline_stage ?? "no stage"}` : "No pipeline item attached"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Deadline</dt>
              <dd className="mt-1 text-gray-900">{formatDate(order.tender_deadline)}</dd>
            </div>
            {order.fit_score != null && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">Fit score</dt>
                <dd className="mt-1 text-gray-900">{order.fit_score}%</dd>
              </div>
            )}
          </dl>
          {order.tender_url && (
            <a
              href={order.tender_url}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex rounded-md border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 hover:border-gray-400"
            >
              Open tender / document
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}
