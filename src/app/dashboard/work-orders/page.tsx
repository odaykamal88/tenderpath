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

const STATUS_DOT: Record<string, string> = {
  new: "bg-stone-400",
  in_progress: "bg-amber-500",
  waiting_on_client: "bg-sky-500",
  delivered: "bg-emerald-500",
  canceled: "bg-stone-300",
};

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function label(value: string): string {
  return value.replace(/-/g, " ").replace(/_/g, " ");
}

function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "Unpaid";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

function expectedDelivery(slug: string | null, createdAt: string): string {
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return "—";
  if (slug === "bid-no-bid") return "Instant after payment";
  if (slug === "proposal" || slug === "proposal-draft") {
    const d = new Date(base.getTime() + 2 * 60 * 60 * 1000);
    return `~${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
  }
  if (slug === "lta-roster" || slug === "roster-fast-track") {
    const d = new Date(base.getTime() + 3 * 24 * 60 * 60 * 1000);
    return `~${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
  }
  if (slug === "digest" || slug === "grants-tenders-matching") {
    const d = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    return `~${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
  }
  return "Confirmed after intake";
}

function orderRef(id: number): string {
  return `WO-${id.toString(16).toUpperCase().padStart(4, "0")}`;
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

  // Stats: counts by status
  const counts = {
    new: orders.filter((o) => o.status === "new").length,
    in_progress: orders.filter((o) => o.status === "in_progress").length,
    waiting_on_client: orders.filter((o) => o.status === "waiting_on_client").length,
    delivered: orders.filter((o) => o.status === "delivered").length,
  };

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Header */}
      <header className="flex items-end justify-between gap-6 mb-2">
        <div>
          <div className="flex items-center gap-3 text-[11px] text-stone-500">
            <span className="font-semibold uppercase tracking-[0.18em] text-stone-400">Workbench · Billing</span>
            <span className="text-stone-300">·</span>
            <span style={{ fontFamily: MONO }}>{loading ? "loading…" : `${orders.length} on record`}</span>
          </div>
          <h1
            className="mt-1 text-[56px] leading-[1.05] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF, fontFeatureSettings: "'ss01'" }}
          >
            Work <em className="italic text-stone-500">orders</em>
          </h1>
          <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-stone-600">
            Every paid intake from checkout to delivery — proposals, bid-analyses, roster fast-tracks, and matching subscriptions in one ledger.
          </p>
        </div>
        <Link
          href="/dashboard/services"
          className="shrink-0 rounded-sm border border-stone-300 bg-white px-4 py-2.5 text-[12.5px] font-semibold uppercase tracking-wider text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
        >
          Start a service →
        </Link>
      </header>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-px bg-stone-200/70 rounded-md overflow-hidden">
        {[
          { label: "New", value: counts.new, sub: "intake received" },
          { label: "In progress", value: counts.in_progress, sub: "team working" },
          { label: "Waiting", value: counts.waiting_on_client, sub: "on you" },
          { label: "Delivered", value: counts.delivered, sub: "complete" },
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

      {/* Status filter */}
      <div className="mt-6 flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setStatus(option)}
            className={`rounded-sm border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
              status === option
                ? "border-stone-900 bg-stone-900 text-white"
                : "border-stone-300 bg-white text-stone-600 hover:border-stone-700 hover:text-stone-900"
            }`}
            style={{ fontFamily: MONO }}
          >
            {label(option)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-5 rounded-md border-l-2 border-red-600 bg-red-50/40 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Orders list */}
      <section className="mt-6 rounded-md border border-stone-200/70 bg-white">
        <div className="border-b border-stone-200/70 px-5 py-4 flex items-baseline justify-between">
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
            {status === "all" ? "All work orders" : label(status)}
          </h2>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            {orders.length.toString().padStart(2, "0")} records
          </span>
        </div>

        {loading ? (
          <div className="p-5 text-[13px] text-stone-500">Loading work orders…</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-[13.5px] text-stone-500 max-w-md mx-auto">
              No work orders {status !== "all" ? `with status "${label(status)}"` : "yet"}. Start with a matched tender, or open a service path and submit the intake.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200/70">
            {orders.map((order) => {
              const isProposalService =
                order.service_slug === "proposal-draft" || order.service_slug === "roster-fast-track";
              const dot = STATUS_DOT[order.status] ?? "bg-stone-300";
              return (
                <div key={order.id} className="flex gap-4 px-5 py-4 hover:bg-stone-50/60 transition-colors">
                  <Link href={`/dashboard/work-orders/${order.id}`} className="min-w-0 flex-1">
                    {/* Top meta row */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`shrink-0 h-1.5 w-1.5 rounded-full ${dot}`} />
                      <span
                        className="text-[10px] tracking-wider text-stone-400"
                        style={{ fontFamily: MONO }}
                      >
                        {orderRef(order.id)}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span
                        className="text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-700"
                        style={{ fontFamily: MONO }}
                      >
                        {label(order.status)}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span
                        className="text-[10px] uppercase tracking-[0.15em] font-semibold text-stone-500"
                        style={{ fontFamily: MONO }}
                      >
                        {label(order.service_slug ?? order.plan)}
                      </span>
                      <span className="text-stone-300">·</span>
                      <span
                        className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${order.payment_status === "paid" ? "text-emerald-700" : "text-stone-500"}`}
                        style={{ fontFamily: MONO }}
                      >
                        {order.payment_status ?? "pending"}
                      </span>
                    </div>

                    {/* Title */}
                    <h3
                      className="text-[16px] font-medium text-stone-900 leading-snug"
                      style={{ fontFamily: SERIF }}
                    >
                      {order.tender_title ?? label(order.plan)}
                    </h3>

                    {/* Meta */}
                    <div
                      className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-stone-500"
                      style={{ fontFamily: MONO }}
                    >
                      {order.agency && <span className="text-stone-700">{order.agency}</span>}
                      {order.pipeline_item_id && <span>Pipeline #{order.pipeline_item_id}</span>}
                      <span>{money(order.amount_cents, order.currency)}</span>
                      <span>Opened {shortDate(order.created_at)}</span>
                      <span>Expected: {expectedDelivery(order.service_slug, order.created_at)}</span>
                    </div>

                    {order.fulfillment_notes && (
                      <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-stone-600 max-w-3xl">
                        {order.fulfillment_notes}
                      </p>
                    )}
                  </Link>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
                    {isProposalService && (
                      <Link
                        href={`/dashboard/proposals/${order.id}`}
                        className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-emerald-700 border border-emerald-300 rounded-sm px-2 py-1 bg-emerald-50/60 hover:border-emerald-600 transition-colors whitespace-nowrap"
                      >
                        View package →
                      </Link>
                    )}
                    <Link
                      href={`/dashboard/work-orders/${order.id}`}
                      className="text-[10.5px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:text-stone-900 whitespace-nowrap"
                    >
                      View status →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
