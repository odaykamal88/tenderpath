"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface ServiceIntakeFormProps {
  service: ServiceSlug;
  plan: string;
  pipelineItemId?: string | null;
  tenderTitle?: string | null;
  agency?: string | null;
  docId?: string | null;
  label: string;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

const SERVICE_FIELDS: Record<ServiceSlug, Array<{ key: string; label: string; placeholder: string; required?: boolean; rows?: number }>> = {
  "bid-no-bid": [
    { key: "decision_deadline", label: "When do you need the decision?", placeholder: "e.g. Tomorrow, before the Friday bid meeting" },
    { key: "main_concern", label: "What is your biggest concern?", placeholder: "e.g. Eligibility, references, pricing, deadline, required documents" },
    { key: "tender_context", label: "Paste eligibility or evaluation criteria", placeholder: "Copy the key requirements from the TOR, RFP, or tender notice — the more specific, the sharper the analysis", rows: 6 },
  ],
  digest: [
    { key: "focus", label: "What should the digest prioritize?", placeholder: "Countries, agencies, sectors, contract types, or exclusions" },
    { key: "must_not_include", label: "What should we avoid?", placeholder: "e.g. individual consultancies, construction, expired opportunities" },
  ],
  proposal: [
    { key: "submission_deadline", label: "Submission deadline", placeholder: "Date/time and timezone if known", required: true },
    { key: "submission_channel", label: "Submission channel", placeholder: "Portal, email, e-tendering system, or unknown" },
    { key: "package_notes", label: "What should the proposal package account for?", placeholder: "Compliance concerns, required sections, pricing notes, partner roles" },
  ],
  "lta-roster": [
    { key: "target_agency", label: "Target agency or roster", placeholder: "e.g. WFP logistics LTA, UNICEF vendor registration", required: true },
    { key: "current_status", label: "Current registration status", placeholder: "Not registered, profile started, submitted before, active vendor, unknown" },
    { key: "category", label: "Product/service category", placeholder: "What category should the roster/LTA package target?" },
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
  label,
}: ServiceIntakeFormProps) {
  const router = useRouter();
  const [tenderUrl, setTenderUrl] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/dashboard/vault/upload", { method: "POST", headers, body: formData });
      const data = (await res.json().catch(() => ({}))) as { url?: string; name?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "File upload failed. Try again or skip.");
        return;
      }
      setUploadedFile({ url: data.url, name: data.name ?? file.name });
    } catch {
      setError("File upload failed. Try again or skip.");
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const intakeWithFile = {
        ...fields,
        ...(uploadedFile ? { vault_url: uploadedFile.url, vault_filename: uploadedFile.name } : {}),
        ...(docId ? { vault_doc_id: docId } : {}),
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
    "bid-no-bid": "Upload TOR or eligibility criteria · optional",
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
                <span className="flex-1 truncate">{uploadedFile.name} · uploaded</span>
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
