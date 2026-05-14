"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../admin.module.css";
import { StatusDot, StatusTag } from "../_components/StatusTag";

type Status = "all" | "new" | "in_progress" | "waiting_on_client" | "delivered" | "canceled";
type FilterValue = "all" | string;

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
  generation_status: string | null;
  package_error_message: string | null;
  package_pdf_url: string | null;
  package_created_at: string | null;
  qa_status: string | null;
  created_at: string;
  updated_at: string;
}

const TABS: { key: Status; label: string }[] = [
  { key: "all",                label: "All" },
  { key: "new",                label: "New" },
  { key: "in_progress",        label: "In progress" },
  { key: "waiting_on_client",  label: "Waiting on client" },
  { key: "delivered",          label: "Delivered" },
  { key: "canceled",           label: "Canceled" },
];
const EDITABLE: Exclude<Status, "all">[] = ["new", "in_progress", "waiting_on_client", "delivered", "canceled"];
const PLAN_FILTERS = [
  ["all", "All plans"],
  ["bid-no-bid", "Bid/No-Bid"],
  ["proposal-draft", "Proposal Draft"],
  ["roster-fast-track", "Roster Fast-Track"],
  ["grants-tenders-matching", "Digest"],
] as const;
const PAYMENT_FILTERS = [
  ["all", "All payments"],
  ["paid", "Paid"],
  ["pending", "Pending"],
  ["unpaid", "Unpaid"],
] as const;
const GENERATION_FILTERS = [
  ["all", "All generation"],
  ["pending", "Pending"],
  ["generating", "Generating"],
  ["completed", "Completed"],
  ["failed", "Failed"],
  ["none", "No package"],
] as const;
const QA_FILTERS = [
  ["all", "All QA"],
  ["needs_review", "Needs review"],
  ["generating", "Generating"],
  ["ready_to_review", "Ready to review"],
  ["blocked", "Blocked"],
  ["delivered", "Delivered"],
  ["no_package", "No package"],
] as const;

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function label(value: string): string {
  return value.replace(/-/g, " ").replace(/_/g, " ");
}
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
function money(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency ?? "usd").toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
function fmtDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function intakePreview(intake: Record<string, unknown> | null): Array<[string, string]> {
  if (!intake) return [];
  return Object.entries(intake)
    .filter(([key]) => key !== "service_context")
    .map<[string, string]>(([key, value]) => {
      const labelText = label(key);
      if (Array.isArray(value)) return [labelText, value.join(", ")];
      if (typeof value === "string") return [labelText, value];
      if (typeof value === "boolean") return [labelText, value ? "Yes" : "No"];
      if (value && typeof value === "object") return [labelText, JSON.stringify(value).slice(0, 160)];
      return [labelText, value == null ? "" : String(value)];
    })
    .filter(([, v]) => v.trim().length > 0)
    .slice(0, 4);
}
function serviceContextPreview(intake: Record<string, unknown> | null) {
  const context = asRecord(intake?.service_context);
  if (!context) return null;
  const quality = asRecord(context.context_quality);
  const match = asRecord(context.match);
  const inputCoverage = asRecord(context.input_coverage);
  const score = typeof quality?.score_0_10 === "number" ? quality.score_0_10 : null;

  return {
    status: typeof quality?.status === "string" ? quality.status : "unknown",
    score,
    reasons: stringList(match?.summary).slice(0, 2),
    caveats: stringList(match?.caveats).slice(0, 2),
    missing: stringList(context.missing_inputs).slice(0, 3),
    hasSourceUrl: inputCoverage?.has_source_url === true,
    hasAssessment: inputCoverage?.has_assessment === true,
    hasMatchReasons: inputCoverage?.has_match_reasons === true,
  };
}

export default function WorkOrdersPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [filter, setFilter] = useState<Status>("all");
  const [planFilter, setPlanFilter] = useState<FilterValue>("all");
  const [paymentFilter, setPaymentFilter] = useState<FilterValue>("all");
  const [generationFilter, setGenerationFilter] = useState<FilterValue>("all");
  const [qaFilter, setQaFilter] = useState<FilterValue>("all");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notify, setNotify] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status: filter,
        plan: planFilter,
        payment_status: paymentFilter,
        generation_status: generationFilter,
        qa_status: qaFilter,
      });
      const res = await fetch(`/api/admin/work-orders?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      setOrders(body.workOrders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work orders");
    } finally {
      setLoading(false);
    }
  }, [filter, generationFilter, paymentFilter, planFilter, qaFilter]);

  useEffect(() => { load(); }, [load]);

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
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, ...body.workOrder } : o));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update work order");
    } finally {
      setSavingId(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length };
    orders.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1; });
    return c;
  }, [orders]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>02 — Work Orders</div>
          <h1 className={styles.pageTitle}>Service intakes</h1>
          <p className={styles.pageSub}>
            Paid services in flight. Edit status and fulfillment notes inline.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnGhost} onClick={load}>Refresh</button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.woControls}>
        <div className={styles.woTabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`${styles.woTab} ${filter === t.key ? styles.woTabActive : ""}`}
            >
              <span>{t.label}</span>
              <span className={styles.woTabCount}>{counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <label className={styles.woNotify}>
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify customer on status change
        </label>
        <div className={styles.woFilterRow}>
          <label className={styles.woFilter}>
            <span>Plan</span>
            <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
              {PLAN_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className={styles.woFilter}>
            <span>Payment</span>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              {PAYMENT_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className={styles.woFilter}>
            <span>Generation</span>
            <select value={generationFilter} onChange={(e) => setGenerationFilter(e.target.value)}>
              {GENERATION_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          <label className={styles.woFilter}>
            <span>QA</span>
            <select value={qaFilter} onChange={(e) => setQaFilter(e.target.value)}>
              {QA_FILTERS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <div className={styles.woEmpty}>Loading work orders…</div>
      ) : orders.length === 0 ? (
        <div className={styles.woEmpty}>No work orders for this filter.</div>
      ) : (
        <section className={styles.woList}>
          {orders.map((o) => {
            const intake = intakePreview(o.intake);
            const serviceContext = serviceContextPreview(o.intake);
            return (
              <article key={o.id} className={styles.woCard}>
                <div className={styles.woCardRail}>
                  <StatusDot status={o.status} />
                  <div className={styles.woId}>#{o.id}</div>
                </div>

                <div className={styles.woCardMain}>
                  <header className={styles.woHead}>
                    <div style={{ minWidth: 0 }}>
                      <div className={styles.eyebrow}>{label(o.plan)}</div>
                      <h3 className={styles.woTitle}>
                        {o.tender_title ?? "No tender attached"}
                      </h3>
                      <div className={styles.woMeta}>
                        {o.agency ?? "—"}
                        {o.tender_deadline && <> · Due {fmtDate(o.tender_deadline)}</>}
                        {o.fit_score != null && <> · Fit {o.fit_score}%</>}
                        {o.pipeline_stage && <> · {o.pipeline_stage}</>}
                      </div>
                      {o.tender_url && (
                        <a
                          href={o.tender_url}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.woTenderLink}
                        >
                          Open tender link ↗
                        </a>
                      )}
                    </div>
                    <div className={styles.woMoney}>
                      <div className={styles.woAmount}>{money(o.amount_cents, o.currency)}</div>
                      <div className={styles.woPayment}>{o.payment_status ?? "paid"}</div>
                    </div>
                  </header>

                  <div className={styles.woGrid}>
                    <div>
                      <div className={styles.woColLabel}>Customer</div>
                      <div className={styles.woColValue}>
                        {o.email ?? o.user_email ?? "—"}
                      </div>
                      <div className={styles.woColMeta}>
                        Ordered {fmtDate(o.created_at)}
                        {o.service_slug && <> · {label(o.service_slug)}</>}
                      </div>
                      {intake.length > 0 && (
                        <div className={styles.woIntake}>
                          {intake.map(([k, v]) => (
                            <div key={k}><b>{k}:</b> {v}</div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className={styles.woColLabel}>Status</div>
                      <div className={styles.woStatusRow}>
                        <StatusTag status={o.status} />
                        <select
                          className={styles.woSelect}
                          value={o.status}
                          disabled={savingId === o.id}
                          onChange={(e) => updateOrder(o.id, {
                            status: e.target.value,
                            notify_customer: notify,
                          })}
                        >
                          {EDITABLE.map((opt) => (
                            <option key={opt} value={opt}>{label(opt)}</option>
                          ))}
                        </select>
                      </div>
                      <div className={styles.woQaLine}>
                        <span>QA {label(o.qa_status ?? "needs_review")}</span>
                        <span>Generation {label(o.generation_status ?? "none")}</span>
                      </div>
                      {serviceContext && (
                        <div className={styles.woContextLine}>
                          <div>
                            Context {label(serviceContext.status)}
                            {serviceContext.score != null && <> · {serviceContext.score}/10</>}
                          </div>
                          <div>
                            {serviceContext.hasSourceUrl ? "source" : "no source"}
                            {" · "}
                            {serviceContext.hasAssessment ? "assessment" : "no assessment"}
                            {" · "}
                            {serviceContext.hasMatchReasons ? "match reasons" : "no match reasons"}
                          </div>
                          {serviceContext.reasons.length > 0 && (
                            <div>{serviceContext.reasons.join(" | ")}</div>
                          )}
                          {serviceContext.missing.length > 0 && (
                            <div>Missing: {serviceContext.missing.join(", ")}</div>
                          )}
                          {serviceContext.caveats.length > 0 && (
                            <div>Caveats: {serviceContext.caveats.join(", ")}</div>
                          )}
                        </div>
                      )}
                      {o.package_error_message && (
                        <div className={styles.woErrorLine}>{o.package_error_message}</div>
                      )}
                    </div>

                    <div>
                      <div className={styles.woColLabel}>Fulfillment notes</div>
                      <textarea
                        className={styles.woNotes}
                        rows={3}
                        defaultValue={o.fulfillment_notes ?? ""}
                        onBlur={(e) => updateOrder(o.id, { fulfillment_notes: e.target.value })}
                        placeholder="Delivery link, missing docs, blockers…"
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
