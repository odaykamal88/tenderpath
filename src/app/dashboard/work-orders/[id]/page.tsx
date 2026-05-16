"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildServiceEvidencePack,
  type EvidencePackDocument,
  type EvidenceRequirementKey,
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

interface VaultDocument {
  id: number;
  name: string;
  type: string;
  expiry_date: string | null;
  file_url: string;
  created_at: string;
  extraction_status: string | null;
  extraction_char_count: number | null;
  extraction_error: string | null;
}

type ProofFeedback = { type: "success" | "error"; message: string } | null;

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function authJsonHeaders(): HeadersInit {
  return { ...authHeaders(), "content-type": "application/json" };
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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function evidenceDocumentsFromIntake(intake: Record<string, unknown> | null | undefined): Partial<Record<EvidenceRequirementKey, EvidencePackDocument>> {
  const raw = asRecord(intake?.evidence_pack_documents);
  if (!raw) return {};
  const docs: Partial<Record<EvidenceRequirementKey, EvidencePackDocument>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const record = asRecord(value);
    if (!record) continue;
    docs[key as EvidenceRequirementKey] = {
      vault_document_id: numberOrNull(record.vault_document_id),
      document_type: stringOrNull(record.document_type),
      file_name: stringOrNull(record.file_name),
      file_url: stringOrNull(record.file_url),
      extraction_status: stringOrNull(record.extraction_status),
      char_count: numberOrNull(record.char_count),
      error: stringOrNull(record.error),
    };
  }
  return docs;
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

function vaultTypeForRequirement(key: EvidenceRequirementKey): string {
  if (key === "financial_capacity") return "financial";
  if (key === "team_cvs") return "cv";
  if (key === "past_performance") return "past_performance";
  if (key === "certifications_licenses") return "certification";
  return "other";
}

function evidenceDocFromVault(doc: VaultDocument): EvidencePackDocument {
  return {
    vault_document_id: doc.id,
    document_type: doc.type,
    file_name: doc.name,
    file_url: doc.file_url,
    extraction_status: doc.extraction_status,
    char_count: doc.extraction_char_count,
    error: doc.extraction_error,
  };
}

function vaultScoreForRequirement(doc: VaultDocument, key: EvidenceRequirementKey): number {
  const text = `${doc.name} ${doc.type}`.toLowerCase();
  let score = 0;
  if (doc.type === vaultTypeForRequirement(key)) score += 8;
  if (key === "tor_rfp" || key === "tender_source") score += /\b(tor|rfp|tender|bid|solicitation|terms|reference)\b/.test(text) ? 7 : 0;
  if (key === "agency_guide") score += /\b(roster|vendor|supplier|portal|ungm|guide|registration)\b/.test(text) ? 7 : 0;
  if (key === "company_registration") score += /\b(registration|license|licence|tax|articles|incorporation)\b/.test(text) ? 7 : 0;
  if (key === "financial_capacity") score += /\b(financial|audit|bank|turnover|accounts|statement)\b/.test(text) ? 7 : 0;
  if (key === "past_performance") score += /\b(reference|contract|completion|performance|project|case)\b/.test(text) ? 7 : 0;
  if (key === "certifications_licenses") score += /\b(certificate|certification|iso|haccp|license|licence|policy)\b/.test(text) ? 7 : 0;
  if (key === "team_cvs") score += /\b(cv|resume|expert|team|profile)\b/.test(text) ? 7 : 0;
  if (key === "capability_statement") score += /\b(capability|profile|statement|catalog|catalogue|deck)\b/.test(text) ? 7 : 0;
  if (key === "product_datasheets") score += /\b(datasheet|spec|catalog|catalogue|technical|sku|product)\b/.test(text) ? 7 : 0;
  if (key === "manufacturer_authorization") score += /\b(authorization|authorisation|manufacturer|distributor|reseller|dealer)\b/.test(text) ? 7 : 0;
  if (key === "support_warranty") score += /\b(warranty|support|maintenance|service|coverage)\b/.test(text) ? 7 : 0;
  if (doc.extraction_status === "extracted") score += 1;
  return score;
}

function rankedVaultDocsForRequirement(docs: VaultDocument[], key: EvidenceRequirementKey): VaultDocument[] {
  return [...docs]
    .map((doc) => ({ doc, score: vaultScoreForRequirement(doc, key) }))
    .sort((a, b) => b.score - a.score || a.doc.name.localeCompare(b.doc.name))
    .map(({ doc }) => doc);
}

function EvidencePackPanel({
  pack,
  evidenceDocs,
  vaultDocs,
  vaultLoading,
  vaultError,
  busyKey,
  feedback,
  orderStatus,
  onAttachVault,
  onUploadProof,
}: {
  pack: ServiceEvidencePack;
  evidenceDocs: Partial<Record<EvidenceRequirementKey, EvidencePackDocument>>;
  vaultDocs: VaultDocument[];
  vaultLoading: boolean;
  vaultError: string | null;
  busyKey: EvidenceRequirementKey | null;
  feedback: ProofFeedback;
  orderStatus: string;
  onAttachVault: (key: EvidenceRequirementKey, docId: string) => void;
  onUploadProof: (key: EvidenceRequirementKey, file: File | undefined) => void;
}) {
  const required = pack.requirements.filter((requirement) => requirement.required);
  const satisfiedRequired = required.filter((requirement) => requirement.satisfied).length;
  const missingRequired = pack.missing_required.length;
  const missingRecommended = pack.missing_recommended.length;
  const isWaitingOnClient = orderStatus === "waiting_on_client";

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
          {isWaitingOnClient && (
            <p className="mt-2 rounded-sm border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
              This order is waiting on client proof. Upload or attach the missing required items below; when the pack becomes ready, TenderPath moves it back into fulfillment.
            </p>
          )}
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
        {pack.requirements.map((requirement) => {
          const attachedDoc = evidenceDocs[requirement.key];
          const attachedVaultId = attachedDoc?.vault_document_id ? String(attachedDoc.vault_document_id) : "";
          const rankedDocs = rankedVaultDocsForRequirement(vaultDocs, requirement.key);
          const isBusy = busyKey === requirement.key;
          return (
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
              {attachedDoc?.file_name && (
                <p className="mt-2 rounded-sm border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-800" style={{ fontFamily: MONO }}>
                  Attached: {attachedDoc.file_name}
                </p>
              )}
              {!requirement.satisfied && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    value={attachedVaultId}
                    disabled={isBusy || vaultLoading || Boolean(vaultError)}
                    onChange={(event) => onAttachVault(requirement.key, event.target.value)}
                    className="min-w-0 rounded-sm border border-stone-300 bg-white px-2.5 py-2 text-[11px] text-stone-700 focus:border-stone-700 focus:outline-none disabled:opacity-60"
                    style={{ fontFamily: MONO }}
                  >
                    <option value="">
                      {vaultLoading ? "Loading vault..." : vaultError ? "Vault unavailable" : "Attach from vault..."}
                    </option>
                    {rankedDocs.slice(0, 12).map((doc) => (
                      <option key={doc.id} value={doc.id}>
                        {doc.name}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-sm border border-dashed border-stone-300 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-stone-500 hover:border-stone-700 hover:text-stone-800 transition-colors">
                    <span style={{ fontFamily: MONO }}>
                      {isBusy ? "Saving..." : "Upload"}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                      className="sr-only"
                      disabled={isBusy}
                      onChange={(event) => onUploadProof(requirement.key, event.target.files?.[0])}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {feedback && (
        <div className={`mt-3 rounded-sm border px-3 py-2 text-[12px] leading-relaxed ${
          feedback.type === "success"
            ? "border-emerald-200 bg-emerald-50/70 text-emerald-800"
            : "border-red-200 bg-red-50/70 text-red-800"
        }`}>
          {feedback.message}
        </div>
      )}

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
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const [vaultLoading, setVaultLoading] = useState(true);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [proofBusyKey, setProofBusyKey] = useState<EvidenceRequirementKey | null>(null);
  const [proofFeedback, setProofFeedback] = useState<ProofFeedback>(null);

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
    (async () => {
      try {
        const res = await fetch("/api/dashboard/vault", { headers: authHeaders() });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const body = await res.json();
        setVaultDocs(Array.isArray(body.documents) ? body.documents : []);
      } catch (err) {
        setVaultError(err instanceof Error ? err.message : "Could not load vault documents");
      } finally {
        setVaultLoading(false);
      }
    })();
  }, []);

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
  const evidenceDocs = useMemo(() => evidenceDocumentsFromIntake(order?.intake), [order]);

  async function saveEvidenceDoc(key: EvidenceRequirementKey, doc: EvidencePackDocument) {
    if (!order) return;
    setProofBusyKey(key);
    setProofFeedback(null);
    try {
      const nextDocs = {
        ...evidenceDocumentsFromIntake(order.intake),
        [key]: doc,
      };
      const res = await fetch(`/api/dashboard/work-orders/${order.id}`, {
        method: "PATCH",
        headers: authJsonHeaders(),
        body: JSON.stringify({ intake: { evidence_pack_documents: nextDocs } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
      setOrder(body.workOrder ?? order);
      setProofFeedback({
        type: "success",
        message: body.resumed
          ? "Proof saved. Required evidence is now complete, so this order moved back into fulfillment."
          : "Proof saved. The checklist has been refreshed.",
      });
    } catch (err) {
      setProofFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Could not save proof.",
      });
    } finally {
      setProofBusyKey(null);
    }
  }

  async function handleAttachVault(key: EvidenceRequirementKey, docId: string) {
    if (!docId) return;
    const doc = vaultDocs.find((item) => String(item.id) === docId);
    if (!doc) return;
    await saveEvidenceDoc(key, evidenceDocFromVault(doc));
  }

  async function handleUploadProof(key: EvidenceRequirementKey, file: File | undefined) {
    if (!file || !order) return;
    setProofBusyKey(key);
    setProofFeedback(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const uploadRes = await fetch("/api/dashboard/vault/upload", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const uploadBody = await uploadRes.json().catch(() => null);
      if (!uploadRes.ok) throw new Error(uploadBody?.error ?? `${uploadRes.status} ${uploadRes.statusText}`);

      let evidenceDoc: EvidencePackDocument = {
        vault_document_id: null,
        document_type: vaultTypeForRequirement(key),
        file_name: uploadBody.name ?? file.name,
        file_url: uploadBody.url,
        extraction_status: uploadBody.extraction?.status ?? null,
        char_count: uploadBody.extraction?.charCount ?? uploadBody.extraction?.char_count ?? null,
        error: uploadBody.extraction?.error ?? null,
      };

      const vaultRes = await fetch("/api/dashboard/vault", {
        method: "POST",
        headers: authJsonHeaders(),
        body: JSON.stringify({
          name: evidenceDoc.file_name,
          type: vaultTypeForRequirement(key),
          file_url: evidenceDoc.file_url,
        }),
      });
      if (vaultRes.ok) {
        const vaultBody = await vaultRes.json();
        const vaultDoc = vaultBody.document as VaultDocument | undefined;
        if (vaultDoc) {
          const normalizedVaultDoc: VaultDocument = {
            ...vaultDoc,
            extraction_status: evidenceDoc.extraction_status ?? null,
            extraction_char_count: evidenceDoc.char_count ?? null,
            extraction_error: evidenceDoc.error ?? null,
          };
          evidenceDoc = evidenceDocFromVault(normalizedVaultDoc);
          setVaultDocs((prev) => [normalizedVaultDoc, ...prev.filter((item) => item.id !== normalizedVaultDoc.id)]);
        }
      }

      await saveEvidenceDoc(key, evidenceDoc);
    } catch (err) {
      setProofFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Could not upload proof.",
      });
    } finally {
      setProofBusyKey(null);
    }
  }

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

      {evidencePack && (
        <EvidencePackPanel
          pack={evidencePack}
          evidenceDocs={evidenceDocs}
          vaultDocs={vaultDocs}
          vaultLoading={vaultLoading}
          vaultError={vaultError}
          busyKey={proofBusyKey}
          feedback={proofFeedback}
          orderStatus={order.status}
          onAttachVault={handleAttachVault}
          onUploadProof={handleUploadProof}
        />
      )}

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
