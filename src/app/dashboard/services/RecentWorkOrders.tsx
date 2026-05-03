"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface WorkOrder {
  id: number;
  plan: string;
  service_slug: string | null;
  status: string;
  payment_status: string | null;
  tender_title: string | null;
  agency: string | null;
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

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function statusDot(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("ready") || s.includes("delivered")) return "bg-emerald-500";
  if (s.includes("cancel") || s.includes("fail")) return "bg-red-500";
  if (s.includes("progress") || s.includes("active") || s.includes("draft")) return "bg-amber-500";
  return "bg-stone-400";
}

export default function RecentWorkOrders() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/work-orders?limit=4", { headers: authHeaders() });
        if (!res.ok) return;
        const body = await res.json();
        setOrders(body.workOrders ?? []);
      } catch (err) {
        console.error("[tp:recent_work_orders:load_failed]", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading || orders.length === 0) return null;

  return (
    <section className="mt-8 rounded-md border border-stone-200/70 bg-white p-6">
      <div className="flex items-end justify-between gap-3 mb-4 pb-3 border-b border-stone-100">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
            style={{ fontFamily: MONO }}
          >
            Recent · {orders.length.toString().padStart(2, "0")}
          </div>
          <h2
            className="mt-0.5 text-[20px] font-medium text-stone-900 tracking-tight"
            style={{ fontFamily: SERIF }}
          >
            Recent work
          </h2>
        </div>
        <Link
          href="/dashboard/work-orders"
          className="text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-500 hover:text-stone-900 transition-colors"
          style={{ fontFamily: MONO }}
        >
          View all →
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/dashboard/work-orders/${order.id}`}
            className="group rounded-sm border border-stone-200/70 bg-white px-4 py-3.5 transition-colors hover:border-stone-700"
          >
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 capitalize"
                style={{ fontFamily: MONO }}
              >
                {label(order.service_slug ?? order.plan)}
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot(order.status)}`} />
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.15em] text-stone-600 capitalize"
                  style={{ fontFamily: MONO }}
                >
                  {label(order.status)}
                </span>
              </div>
            </div>
            <div
              className="text-[14px] font-medium leading-snug text-stone-900 line-clamp-2 group-hover:text-stone-700 transition-colors"
              style={{ fontFamily: SERIF }}
            >
              {order.tender_title ?? label(order.plan)}
            </div>
            <div
              className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              {order.agency && <span>{order.agency}</span>}
              {order.agency && <span className="text-stone-300">·</span>}
              <span className="capitalize">{order.payment_status ?? "pending"}</span>
              <span className="text-stone-300">·</span>
              <span>{formatDate(order.updated_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
