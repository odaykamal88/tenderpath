"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildServiceEvidencePack,
  type EvidenceRequirementState,
  type ServiceEvidencePack,
} from "@/lib/service-evidence-pack";
import BidNoBidPanel from "./BidNoBidPanel";
import ProposalPackagePanel from "./ProposalPackagePanel";
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
const HIDDEN_INTAKE_KEYS = new Set([
  "service_context",
  "evidence_pack",
  "evidence_pack_documents",
]);

function isBidNoBidOrder(order: WorkOrder): boolean {
  return order.plan === BID_SLUG || order.service_slug === BID_SLUG;
}

function isProposalOrder(order: WorkOrder): boolean {
  return order.plan === PROPOSAL_SLUG || order.service_slug === PROPOSAL_SLUG;
}

function isRosterOrder(order: WorkOrder): boolean {
  return order.plan === ROSTER_SLUG || order.service_slug === ROSTER_SLUG;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatIntakeValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatIntakeValue).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function isEvidencePack(value: unknown): value is ServiceEvidencePack {
  const record = asRecord(value);
  return Boolean(
    record
      && record.version === "sprint6-service-evidence-pack-v1"
      && Array.isArray(record.requirements),
  );
}

function evidencePackForOrder(order: WorkOrder): ServiceEvidencePack {
  const intake = order.intake ?? null;
  const serviceContext = asRecord(intake?.service_context);
  const storedPack = serviceContext?.evidence_pack ?? intake?.evidence_pack;
  if (isEvidencePack(storedPack)) return storedPack;

  return buildServiceEvidencePack({
    serviceSlug: order.service_slug ?? order.plan,
    intake,
    tenderSourceAvailable: Boolean(order.tender_url),
    targetAgency: stringOrNull(intake?.target_agency) ?? order.agency,
    targetCategory: stringOrNull(intake?.target_category),
    contextText: [
      order.tender_title,
      order.agency,
      order.tender_url,
      stringOrNull(intake?.tender_context),
      stringOrNull(intake?.requirement_scope),
      stringOrNull(intake?.additional_details),
    ].filter(Boolean).join(" "),
  });
}

function evidenceStatusClasses(status: ServiceEvidencePack["status"]): string {
  if (status === "ready") return "border-emerald-200 bg-emerald-50/70 text-emerald-800";
  if (status === "blocked") return "border-red-200 bg-red-50/70 text-red-800";
  return "border-amber-200 bg-amber-50/70 text-amber-800";
}

function requirementStatusClasses(requirement: EvidenceRequirementState): string {
  if (requirement.satisfied) return "text-emerald-700";
  if (requirement.required) return "text-red-700";
  return "text-amber-700";
}

function requirementStatusLabel(requirement: EvidenceRequirementState): string {
  if (requirement.satisfied) return "On file";
  if (requirement.required) return "Needed";
  return "Useful";
}

function EvidencePackPanel({ pack }: { pack: ServiceEvidencePack }) {
  const required = pack.requirements.filter((requirement) => requirement.required);
  const satisfiedRequired = required.filter((requirement) => requirement.satisfied).length;
  const missingRequired = pack.missing_required.length;
  const missingRecommended = pack.missing_recommended.length;

  return (
    <section className="mt-6 rounded-md border border-stone-200/70 bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2
            className="text-[20px] font-medium text-stone-900"
            style={{ fontFamily: SERIF }}
          >
            <span
              className="text-[10px] font-semibold tabular-nums text-stone-400 mr-2 align-middle"
              style={{ fontFamily: MONO }}
            >
              Proof ·
            </span>
            Evidence pack readiness
          </h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-stone-600">
            The order can move cleanly only when the source, eligibility, and vendor proof are visible here. Missing required proof routes the work through human QA instead of letting automation overstate readiness.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-sm border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${evidenceStatusClasses(pack.status)}`}
            style={{ fontFamily: MONO }}
          >
            {pack.status.replace(/_/g, " ")}
          </span>
          <span
            className="rounded-sm border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-700"
            style={{ fontFamily: MONO }}
          >
            {pack.score_0_10}/10
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-sm bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400" style={{ fontFamily: MONO }}>
            Required proof
          </div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-stone-900" style={{ fontFamily: SERIF }}>
            {satisfiedRequired}/{required.length}
          </div>
        </div>
        <div className="rounded-sm bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400" style={{ fontFamily: MONO }}>
            Missing required
          </div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-stone-900" style={{ fontFamily: SERIF }}>
            {missingRequired}
          </div>
        </div>
        <div className="rounded-sm bg-stone-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400" style={{ fontFamily: MONO }}>
            Useful extras
          </div>
          <div className="mt-1 text-[18px] font-medium tabular-nums text-stone-900" style={{ fontFamily: SERIF }}>
            {missingRecommended}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {pack.requirements.map((requirement) => (
          <div key={requirement.key} className="rounded-sm border border-stone-200 bg-stone-50/40 px-3.5 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${requirementStatusClasses(requirement)}`}
                style={{ fontFamily: MONO }}
              >
                {requirementStatusLabel(requirement)}
              </span>
              <span className="text-[13px] font-semibold text-stone-900">{requirement.label}</span>
              {requirement.critical && (
                <span className="rounded-sm bg-stone-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white" style={{ fontFamily: MONO }}>
                  Critical
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-stone-600">
              {requirement.satisfied
                ? `Source: ${requirement.sources.slice(0, 3).join(", ")}`
                : requirement.missing_reason}
            </p>
            {!requirement.satisfied && (
              <p className="mt-1 text-[11.5px] leading-relaxed text-stone-500">
                Examples: {requirement.examples.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>

      {pack.warnings.length > 0 && (
        <div className="mt-3 rounded-sm border border-amber-200 bg-amber-50/60 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
          {pack.warnings.slice(0, 3).join(" · ")}
        </div>
      )}
    </section>
  );
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

  const intakeRows = useMemo(() => {
    if (!order?.intake) return [];
    return Object.entries(order.intake)
      .filter(([key]) => !HIDDEN_INTAKE_KEYS.has(key))
      .map(([key, value]) => {
        const rendered = formatIntakeValue(value);
        return [label(key), rendered] as const;
      })
      .filter(([, value]) => value.trim().length > 0);
  }, [order]);

  const evidencePack = useMemo(() => order ? evidencePackForOrder(order) : null, [order]);

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

      {evidencePack && <EvidencePackPanel pack={evidencePack} />}

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
              01 ·
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
              02 ·
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
