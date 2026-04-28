"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "all" | "new" | "in_progress" | "waiting_on_client" | "delivered" | "canceled";

interface WorkOrder {
  id: number;
  plan: string;
  status: Exclude<Status, "all">;
  payment_status: string | null;
  amount_cents: number | null;
  currency: string | null;
  email: string | null;
  user_email: string | null;
  service_slug: string | null;
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

const STATUS_OPTIONS: Status[] = ["all", "new", "in_progress", "waiting_on_client", "delivered", "canceled"];
const EDITABLE_STATUSES: Exclude<Status, "all">[] = ["new", "in_progress", "waiting_on_client", "delivered", "canceled"];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function label(value: string): string {
  return value.replace(/-/g, " ").replace(/_/g, " ");
}

function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
  }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function intakePreview(intake: Record<string, unknown> | null): Array<[string, string]> {
  if (!intake) return [];
  return Object.entries(intake)
    .map<[string, string]>(([key, value]) => {
      const labelText = label(key);
      if (Array.isArray(value)) return [labelText, value.join(", ")];
      if (typeof value === "string") return [labelText, value];
      if (typeof value === "boolean") return [labelText, value ? "Yes" : "No"];
      return [labelText, value == null ? "" : String(value)];
    })
    .filter(([, value]) => value.trim().length > 0)
    .slice(0, 4);
}

function StatusPill({ status }: { status: string }) {
  const cls = status === "new"
    ? "border-violet-500/30 bg-violet-500/15 text-violet-300"
    : status === "in_progress"
      ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
      : status === "waiting_on_client"
        ? "border-blue-500/30 bg-blue-500/15 text-blue-300"
        : status === "delivered"
          ? "border-green-500/30 bg-green-500/15 text-green-300"
          : "border-slate-500/30 bg-slate-500/15 text-slate-300";
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>
      {label(status)}
    </span>
  );
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [status, setStatus] = useState<Status>("all");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyCustomer, setNotifyCustomer] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/work-orders?status=${status}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      setOrders(body.workOrders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work orders");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateOrder(id: number, patch: { status?: string; fulfillment_notes?: string; notify_customer?: boolean }) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/admin/work-orders/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      setOrders((prev) => prev.map((order) => order.id === id ? { ...order, ...body.workOrder } : order));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update work order");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Work Orders</h1>
          <p className="mt-1 text-sm text-slate-500">
            Service intakes, payment status, and fulfillment notes.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400 hover:border-white/20 hover:text-white"
        >
          Refresh
        </button>
      </div>

      <label className="mb-5 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={notifyCustomer}
          onChange={(e) => setNotifyCustomer(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-white/20 bg-slate-950"
        />
        Email customer when status changes
      </label>

      <div className="mb-5 flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setStatus(option)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium capitalize ${
              status === option
                ? "border-violet-500/40 bg-violet-500/20 text-violet-200"
                : "border-white/10 text-slate-500 hover:text-slate-300"
            }`}
          >
            {label(option)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-white/8 bg-white/5">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading work orders...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No work orders for this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 text-left font-medium">Order</th>
                  <th className="px-5 py-3 text-left font-medium">Context</th>
                  <th className="px-5 py-3 text-left font-medium">Customer</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {orders.map((order) => (
                  <tr key={order.id} className="align-top">
                    <td className="px-5 py-4">
                      <div className="font-medium text-white capitalize">{label(order.plan)}</div>
                      <div className="mt-1 text-xs text-slate-500">#{order.id} · {money(order.amount_cents, order.currency)}</div>
                      {order.service_slug && (
                        <div className="mt-1 text-xs text-slate-600">Service: {label(order.service_slug)}</div>
                      )}
                      <div className="mt-1 text-xs text-slate-600">{formatDate(order.created_at)}</div>
                    </td>
                    <td className="px-5 py-4 min-w-72">
                      <div className="font-medium text-slate-200">{order.tender_title ?? "No tender attached"}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {order.agency ?? "No agency"} · Pipeline {order.pipeline_item_id ?? "—"}
                      </div>
                      <div className="mt-1 text-xs text-slate-600">
                        Due {formatDate(order.tender_deadline)} · Fit {order.fit_score ?? "—"}% · {order.pipeline_stage ?? "no stage"}
                      </div>
                      {order.tender_url && (
                        <a
                          href={order.tender_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-block text-xs text-violet-300 underline hover:text-violet-200"
                        >
                          Open tender/doc link
                        </a>
                      )}
                      {intakePreview(order.intake).length > 0 && (
                        <div className="mt-3 space-y-1 rounded-lg border border-white/8 bg-slate-950/60 px-3 py-2">
                          {intakePreview(order.intake).map(([key, value]) => (
                            <div key={key} className="text-xs">
                              <span className="font-medium text-slate-400 capitalize">{key}: </span>
                              <span className="text-slate-300">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-slate-300">{order.email ?? order.user_email ?? "—"}</div>
                      <div className="mt-1 text-xs text-slate-500">{order.payment_status ?? "paid"}</div>
                    </td>
                    <td className="px-5 py-4">
                      <StatusPill status={order.status} />
                      <select
                        value={order.status}
                        disabled={savingId === order.id}
                        onChange={(e) => updateOrder(order.id, {
                          status: e.target.value,
                          notify_customer: notifyCustomer,
                        })}
                        className="mt-3 block w-full rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                      >
                        {EDITABLE_STATUSES.map((option) => (
                          <option key={option} value={option}>{label(option)}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-5 py-4 min-w-80">
                      <textarea
                        defaultValue={order.fulfillment_notes ?? ""}
                        rows={3}
                        onBlur={(e) => updateOrder(order.id, { fulfillment_notes: e.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600"
                        placeholder="Fulfillment notes, missing docs, delivery link..."
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
