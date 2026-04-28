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
  return date.toLocaleDateString("en-GB", { dateStyle: "medium" });
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
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Recent work</h2>
          <p className="mt-1 text-xs text-gray-500">Follow intake and fulfillment status after checkout.</p>
        </div>
        <Link href="/dashboard/work-orders" className="text-xs font-semibold text-gray-500 underline hover:text-gray-900">
          View all
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/dashboard/work-orders/${order.id}`}
            className="rounded-md border border-gray-200 bg-gray-50 px-3 py-3 transition hover:border-gray-400"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold capitalize text-gray-900">
                {label(order.service_slug ?? order.plan)}
              </div>
              <div className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-600">
                {label(order.status)}
              </div>
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-medium text-gray-900">
              {order.tender_title ?? label(order.plan)}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
              {order.agency && <span>{order.agency}</span>}
              <span>{order.payment_status ?? "pending"}</span>
              <span>Updated {formatDate(order.updated_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
