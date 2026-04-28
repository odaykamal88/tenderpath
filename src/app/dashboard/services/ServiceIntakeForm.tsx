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
  label: string;
}

const SERVICE_FIELDS: Record<ServiceSlug, Array<{ key: string; label: string; placeholder: string; required?: boolean }>> = {
  "bid-no-bid": [
    { key: "decision_deadline", label: "When do you need the decision?", placeholder: "e.g. Tomorrow, before the Friday bid meeting" },
    { key: "main_concern", label: "What is your biggest concern?", placeholder: "e.g. Eligibility, references, pricing, deadline, required documents" },
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
  label,
}: ServiceIntakeFormProps) {
  const router = useRouter();
  const [tenderUrl, setTenderUrl] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/service-orders", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          service,
          pipeline_item_id: pipelineItemId,
          tender_title: tenderTitle,
          agency,
          tender_url: tenderUrl,
          intake: fields,
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

      if (service === "bid-no-bid" && pipelineItemId) {
        const checkoutRes = await fetch("/api/analysis/bid-no-bid/checkout", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            pipeline_item_id: Number(pipelineItemId),
            tender_title: tenderTitle,
            work_order_id: data.workOrder.id,
          }),
        });
        const checkout = (await checkoutRes.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!checkoutRes.ok || !checkout.url) {
          setError(checkout.error ?? "Intake saved, but checkout could not start.");
          return;
        }
        window.location.href = checkout.url;
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

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      {requiresPipeline && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Bid/no-bid analysis needs a selected pipeline tender so the recommendation can use your saved match evidence.
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
          Tender or document URL
        </label>
        <input
          value={tenderUrl}
          onChange={(e) => setTenderUrl(e.target.value)}
          placeholder="Paste source page, TOR, or portal link if available"
          className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
        />
      </div>

      {SERVICE_FIELDS[service].map((field) => (
        <div key={field.key}>
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
            {field.label}{field.required ? " *" : ""}
          </label>
          <textarea
            required={field.required}
            value={fields[field.key] ?? ""}
            onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
            placeholder={field.placeholder}
            rows={3}
            className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-gray-900 focus:outline-none"
          />
        </div>
      ))}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || requiresPipeline}
        className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Saving intake..." : label}
      </button>
    </form>
  );
}
