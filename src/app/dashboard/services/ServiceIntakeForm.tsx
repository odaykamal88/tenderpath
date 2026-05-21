"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import ConfidenceGate from "./ConfidenceGate";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface AssessmentSnapshot {
  companyName: string;
  sector: string;
  description: string;
}

interface ServiceIntakeFormProps {
  service: ServiceSlug;
  plan: string;
  pipelineItemId?: string | null;
  tenderTitle?: string | null;
  agency?: string | null;
  docId?: string | null;
  initialTenderUrl?: string | null;
  label: string;
  /**
   * Slim view of the current user's assessment, used by ConfidenceGate to
   * detect low-confidence / multi-sector classifications and prompt for
   * disambiguation before the paid order.
   */
  assessmentSnapshot?: AssessmentSnapshot | null;
}

interface UploadedFile {
  name: string;
  url: string;
  extraction?: {
    status: string;
    charCount: number;
    error: string | null;
  };
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

const SERVICE_FIELDS: Record<ServiceSlug, Array<{ key: string; label: string; placeholder: string; required?: boolean; rows?: number }>> = {
  "bid-no-bid": [
    { key: "tender_context", label: "Paste eligibility or evaluation criteria", placeholder: "Copy the key requirements from the TOR, RFP, or tender notice — the more specific, the sharper the analysis", rows: 6 },
    { key: "additional_details", label: "Additional details we should know", placeholder: "Anything else that would help sharpen the analysis — competitive concerns, partner constraints, timeline pressure", rows: 3 },
  ],
  digest: [
    { key: "focus", label: "What should the digest prioritize?", placeholder: "Countries, agencies, sectors, contract types, or exclusions" },
    { key: "must_not_include", label: "What should we avoid?", placeholder: "e.g. individual consultancies, construction, expired opportunities" },
  ],
  proposal: [
    { key: "submission_deadline", label: "Submission deadline", placeholder: "Date/time and timezone if known", required: true },
    { key: "additional_details", label: "Additional details we should know", placeholder: "Compliance concerns, required sections, pricing notes, partner roles, or anything else we should account for", rows: 4 },
  ],
  "lta-roster": [
    { key: "target_agency", label: "Target agency or roster", placeholder: "e.g. UNOPS supplier registration, FAO agriculture roster, WHO e-tendering, WFP logistics LTA", required: true },
    { key: "additional_details", label: "Additional details we should know", placeholder: "Current registration status, product/service category, or anything specific to this application", rows: 4 },
  ],
};

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function payHref(plan: string, context: {
  tenderTitle?: string | null;
  agency?: string | null;
  pipelineItemId?: string | null;
  workOrderId: number;
}) {
  const params = new URLSearchParams({
    plan,
    work_order_id: String(context.workOrderId),
  });
  if (context.tenderTitle) params.set("tender", context.tenderTitle);
  if (context.agency) params.set("agency", context.agency);
  if (context.pipelineItemId) params.set("pipeline_item_id", context.pipelineItemId);
  return `/pay?${params.toString()}`;
}

export default function ServiceIntakeForm({
  service,
  plan,
  pipelineItemId,
  tenderTitle,
  agency,
  docId,
  initialTenderUrl,
  label,
  assessmentSnapshot,
}: ServiceIntakeFormProps) {
  const router = useRouter();
  const [tenderUrl, setTenderUrl] = useState(initialTenderUrl ?? "");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [financialFile, setFinancialFile] = useState<UploadedFile | null>(null);
  const [uploadingFinancial, setUploadingFinancial] = useState(false);
  /** Confirmed primary line of business for this order (from ConfidenceGate). */
  const [confirmedPrimarySector, setConfirmedPrimarySector] = useState<string | null>(null);

  // ConfidenceGate scope key: prefer pipeline-item-id; fall back to plan+title
  // so disambiguation persists per opportunity even without a pipeline anchor.
  const confidenceScopeKey = useMemo(() => {
    if (pipelineItemId) return `pi-${pipelineItemId}`;
    if (tenderTitle) return `t-${tenderTitle.slice(0, 64)}`;
    return `s-${plan}`;
  }, [pipelineItemId, tenderTitle, plan]);

  async function uploadOne(file: File): Promise<UploadedFile | { error: string }> {
    const formData = new FormData();
    formData.append("file", file);
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
    try {
      const res = await fetch("/api/dashboard/vault/upload", { method: "POST", headers, body: formData });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        name?: string;
        error?: string;
        extraction?: UploadedFile["extraction"];
      };
      if (!res.ok || !data.url) {
        return { error: data.error ?? "File upload failed. Try again or skip." };
      }
      return { url: data.url, name: data.name ?? file.name, extraction: data.extraction };
    } catch {
      return { error: "File upload failed. Try again or skip." };
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const result = await uploadOne(file);
    if ("error" in result) setError(result.error);
    else setUploadedFile(result);
    setUploading(false);
  }

  async function handleFinancialFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFinancial(true);
    setError(null);
    const result = await uploadOne(file);
    if ("error" in result) setError(result.error);
    else setFinancialFile(result);
    setUploadingFinancial(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const intakeWithFile = {
        ...fields,
        ...(uploadedFile ? { vault_url: uploadedFile.url, vault_filename: uploadedFile.name } : {}),
        ...(financialFile ? { financial_documents_url: financialFile.url, financial_documents_filename: financialFile.name } : {}),
        ...(docId ? { vault_doc_id: docId } : {}),
        ...(confirmedPrimarySector ? { confirmed_primary_sector: confirmedPrimarySector } : {}),
      };

      const res = await fetch("/api/service-orders", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          service,
          pipeline_item_id: pipelineItemId,
          tender_title: tenderTitle,
          agency,
          tender_url: tenderUrl,
          intake: intakeWithFile,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        workOrder?: { id: number };
        error?: string;
      };
      if (!res.ok || !data.workOrder?.id) {
        setError(data.error ?? "Could not save the intake.");
        return;
      }

      if (service === "bid-no-bid") {
        router.push(payHref("bid-no-bid", {
          tenderTitle,
          agency,
          pipelineItemId: pipelineItemId ?? null,
          workOrderId: data.workOrder.id,
        }));
        return;
      }

      if (service === "proposal" || service === "lta-roster") {
        const proposalPlan = service === "proposal" ? "proposal-draft" : "roster-fast-track";
        router.push(payHref(proposalPlan, {
          tenderTitle,
          agency,
          pipelineItemId: pipelineItemId ?? null,
          workOrderId: data.workOrder.id,
        }));
        return;
      }

      router.push(payHref(plan, {
        tenderTitle,
        agency,
        pipelineItemId,
        workOrderId: data.workOrder.id,
      }));
    } catch {
      setError("Could not submit intake. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const requiresPipeline = service === "bid-no-bid" && !pipelineItemId;

  const uploadLabel: Record<ServiceSlug, string> = {
    "bid-no-bid": "Upload your documents",
    "proposal": "Upload TOR / RFP / call document",
    "lta-roster": "Upload vendor guide / call for applications",
    "digest": "",
  };

  const uploadHint: Record<ServiceSlug, string> = {
    "bid-no-bid": "PDF or Word — paste the eligibility criteria, evaluation criteria, or TOR excerpt so the analysis is grounded",
    "proposal": "PDF, Word, or Excel up to 10 MB",
    "lta-roster": "PDF, Word, or Excel up to 10 MB",
    "digest": "",
  };

  const inputCls =
    "mt-1.5 w-full rounded-sm border border-stone-300 bg-white px-3 py-2.5 text-[13px] text-stone-900 focus:border-stone-700 focus:outline-none";

  const labelCls = "block text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500";

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {assessmentSnapshot && (
        <ConfidenceGate
          sector={assessmentSnapshot.sector ?? null}
          description={assessmentSnapshot.description ?? null}
          companyName={assessmentSnapshot.companyName ?? null}
          scopeKey={confidenceScopeKey}
          onChosen={setConfirmedPrimarySector}
        />
      )}

      {requiresPipeline && (
        <div className="rounded-sm border-l-2 border-amber-600 bg-amber-50/40 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900">
          Bid/no-bid analysis needs a selected pipeline tender so the recommendation can use your saved match evidence.
        </div>
      )}

      {/* Tender URL */}
      <div>
        <label className={labelCls} style={{ fontFamily: MONO }}>
          Tender or document URL
        </label>
        <input
          value={tenderUrl}
          onChange={(e) => setTenderUrl(e.target.value)}
          placeholder="Paste source page, TOR, or portal link if available"
          className={inputCls}
          style={{ fontFamily: MONO }}
        />
      </div>

      {/* File upload */}
      {(service === "bid-no-bid" || service === "proposal" || service === "lta-roster") && (
        <div>
          <label className={labelCls} style={{ fontFamily: MONO }}>
            {uploadLabel[service]}
          </label>
          <div className="mt-1.5">
            {uploadedFile ? (
              <div
                className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] text-emerald-800"
                style={{ fontFamily: MONO }}
              >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                </svg>
                <span className="flex-1 truncate">
                  {uploadedFile.name} · {uploadedFile.extraction?.status === "extracted"
                    ? `extracted ${uploadedFile.extraction.charCount.toLocaleString()} chars`
                    : uploadedFile.extraction?.status
                      ? `uploaded, extraction ${uploadedFile.extraction.status}`
                      : "uploaded"}
                </span>
                <button
                  type="button"
                  onClick={() => setUploadedFile(null)}
                  className="shrink-0 text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-dashed border-stone-300 px-3.5 py-3 text-[12px] text-stone-500 hover:border-stone-700 hover:text-stone-700 transition-colors">
                <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="leading-snug flex-1">
                  {uploading ? "Uploading…" : <><span className="font-semibold text-stone-700">Choose file</span> — {uploadHint[service]}</>}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  disabled={uploading}
                  onChange={handleFileChange}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Supporting documents — for bid-no-bid this captures any relevant
          docs the user wants the analysis to consider (financials, capability
          statements, partner letters, certifications). On proposal/lta-roster
          it still captures financial-specific docs that the deliverable LLM
          uses to populate the financial section. Label flips per service. */}
      {(service === "bid-no-bid" || service === "proposal" || service === "lta-roster") && (
        <div>
          <label className={labelCls} style={{ fontFamily: MONO }}>
            {service === "bid-no-bid" ? "Upload Supporting Documents" : "Upload financial documents"}
          </label>
          <div className="mt-1.5">
            {financialFile ? (
              <div
                className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] text-emerald-800"
                style={{ fontFamily: MONO }}
              >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                </svg>
                <span className="flex-1 truncate">
                  {financialFile.name} · {financialFile.extraction?.status === "extracted"
                    ? `extracted ${financialFile.extraction.charCount.toLocaleString()} chars`
                    : financialFile.extraction?.status
                      ? `uploaded, extraction ${financialFile.extraction.status}`
                      : "uploaded"}
                </span>
                <button
                  type="button"
                  onClick={() => setFinancialFile(null)}
                  className="shrink-0 text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-dashed border-stone-300 px-3.5 py-3 text-[12px] text-stone-500 hover:border-stone-700 hover:text-stone-700 transition-colors">
                <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="leading-snug flex-1">
                  {uploadingFinancial ? "Uploading…" : (
                    <>
                      <span className="font-semibold text-stone-700">Choose file</span> —{" "}
                      {service === "bid-no-bid"
                        ? "Capability statements, certifications, partner letters, financials, or anything else the analysis should weigh"
                        : "Audited financials, bank reference, or balance sheet (optional, sharpens the financial section)"}
                    </>
                  )}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  disabled={uploadingFinancial}
                  onChange={handleFinancialFileChange}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Custom fields */}
      {SERVICE_FIELDS[service].map((field) => (
        <div key={field.key}>
          <label className={labelCls} style={{ fontFamily: MONO }}>
            {field.label}
            {field.required && <span className="text-red-600 ml-1">*</span>}
          </label>
          <textarea
            required={field.required}
            value={fields[field.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            rows={field.rows ?? 3}
            className={inputCls + " resize-none"}
          />
        </div>
      ))}

      {/* Error */}
      {error && (
        <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-2.5 text-[12px] text-red-700">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={busy || requiresPipeline}
        className="w-full rounded-sm bg-stone-900 px-4 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Saving intake…" : `${label} →`}
      </button>
    </form>
  );
}
