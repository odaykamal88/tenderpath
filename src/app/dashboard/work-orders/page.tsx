"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Status = "all" | "new" | "in_progress" | "waiting_on_client" | "delivered" | "canceled";

interface WorkOrder {
  id: number;
  plan: string;
  service_slug: string | null;
  status: Exclude<Status, "all">;
  payment_status: string | null;
  amount_cents: number | null;
  currency: string | null;
  pipeline_item_id: number | null;
  tender_title: string | null;
  agency: string | null;
  tender_deadline: string | null;
  fit_score: number | null;
  pipeline_stage: string | null;
  fulfillment_notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_OPTIONS: Status[] = ["all", "new", "in_progress", "waiting_on_client", "delivered", "canceled"];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function label(value: string): string {
  return value.replace(/-/g, " ").replace(/_/g, " ");
}

function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "Not paid yet";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "new"
    ? "bg-gray-100 text-gray-700"
    : status === "in_progress"
      ? "bg-amber-100 text-amber-800"
      : status === "waiting_on_client"
        ? "bg-blue-100 text-blue-800"
        : status === "delivered"
          ? "bg-green-100 text-green-800"
          : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {label(status)}
    </span>
  );
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [status, setStatus] = useState<Status>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/dashboard/work-orders?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      setOrders(body.workOrders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load work orders");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Work orders
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            Paid work status
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
            Track every intake and paid service request from checkout to delivery.
          </p>
        </div>
        <Link
          href="/dashboard/services"
          className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
        >
          Start a service
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setStatus(option)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold capitalize ${
              status === option
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-400"
            }`}
          >
            {label(option)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="mt-5 rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="p-5 text-sm text-gray-500">Loading work orders...</div>
        ) : orders.length === 0 ? (
          <div className="p-5 text-sm text-gray-500">
            No work orders yet. Start with a matched tender, or open a service path and submit the intake.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/dashboard/work-orders/${order.id}`}
                className="block px-5 py-4 transition hover:bg-gray-50"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={order.status} />
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-700">
                        {label(order.service_slug ?? order.plan)}
                      </span>
                      <span className="text-xs text-gray-500">{order.payment_status ?? "pending"}</span>
                    </div>
                    <h2 className="mt-2 text-sm font-semibold text-gray-900">
                      {order.tender_title ?? label(order.plan)}
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                      {order.agency && <span>{order.agency}</span>}
                      {order.pipeline_item_id && <span>Pipeline #{order.pipeline_item_id}</span>}
                      <span>{money(order.amount_cents, order.currency)}</span>
                      <span>Opened {formatDate(order.created_at)}</span>
                    </div>
                    {order.fulfillment_notes && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-600">
                        {order.fulfillment_notes}
                      </p>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-gray-500">View status</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
