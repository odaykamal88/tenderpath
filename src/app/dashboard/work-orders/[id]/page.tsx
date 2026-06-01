"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BidNoBidPanel from "./BidNoBidPanel";
import ProposalPackagePanel from "./ProposalPackagePanel";
import OutcomeCapture from "./OutcomeCapture";
import RosterWorkspacePanel from "./RosterWorkspacePanel";

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

// PR-K (2026-05-23): formatDate kept in case future blocks render dates.
// Currently unused since Intake/Tender-context cards were removed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function orderRef(id: number): string {
  return `WO-${id.toString(16).toUpperCase().padStart(4, "0")}`;
}

const BID_SLUG = "bid-no-bid";
const PROPOSAL_SLUG = "proposal-draft";
const ROSTER_SLUG = "roster-fast-track";

function isBidNoBidOrder(order: WorkOrder): boolean {
  return order.plan === BID_SLUG || order.service_slug === BID_SLUG;
}

function isProposalOrder(order: WorkOrder): boolean {
  return order.plan === PROPOSAL_SLUG || order.service_slug === PROPOSAL_SLUG;
}

function isRosterOrder(order: WorkOrder): boolean {
  return order.plan === ROSTER_SLUG || order.service_slug === ROSTER_SLUG;
}

export default function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // PR-K (2026-05-23): intakeRows useMemo removed alongside the Intake card.

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

  return (
    <div className="px-8 py-8 max-w-[1400px]">
      {/* Back link */}
      <Link
        href="/dashboard/work-orders"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.15em] text-stone-600 hover:text-stone-900 transition-colors border-b border-stone-300 hover:border-stone-900 pb-0.5"
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

      {/* Auto-fulfilled deliverable panel — routed by plan */}
      {isBidNoBidOrder(order) && (
        <div className="mt-6">
          <BidNoBidPanel workOrderId={order.id} paymentStatus={order.payment_status} />
        </div>
      )}

      {isProposalOrder(order) && (
        <div className="mt-6">
          <ProposalPackagePanel workOrderId={order.id} paymentStatus={order.payment_status} />
          {/* Loop 1: capture the real outcome once the proposal is delivered.
              Self-gates — renders nothing until a ready package exists. */}
          <OutcomeCapture workOrderId={order.id} />
        </div>
      )}

      {isRosterOrder(order) && (
        <div className="mt-6">
          <RosterWorkspacePanel
            workOrderId={order.id}
            paymentStatus={order.payment_status}
            initialWorkOrderStatus={order.status}
          />
        </div>
      )}

      {/* PR-K (2026-05-23): Intake + Tender Context cards removed. They
          showed [object Object] for service_context and a "No pipeline item
          attached" placeholder that didn't help users do anything. The
          actual useful info (tender title, agency, deadline, fit score) is
          already in the header strip + bid/no-bid panel. If we need a
          source-link affordance again, surface it inline on the panel
          instead of as a standalone card. */}
      {order.tender_url && (
        <div className="mt-6">
          <a
            href={order.tender_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-sm border border-stone-300 bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-stone-700 hover:border-stone-700 hover:text-stone-900 transition-colors"
            style={{ fontFamily: MONO }}
          >
            Open tender source ↗
          </a>
        </div>
      )}
    </div>
  );
}
