"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
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

// Multi-stage upload progress. The previous single-boolean "uploading" left
// the UI stuck on a generic "Uploading…" label for the whole pipeline (blob
// upload + server-side text extraction), which read as "frozen" for large
// PDFs. Splitting the state makes it obvious that work is still happening.
type UploadStage = "uploading" | "extracting";

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
  const [uploading, setUploading] = useState<UploadStage | null>(null);
  const [financialFile, setFinancialFile] = useState<UploadedFile | null>(null);
  const [uploadingFinancial, setUploadingFinancial] = useState<UploadStage | null>(null);
  // Bid-no-bid only: lets the user attach the tender document directly in the
  // "Tender or document" section instead of through a separate "Upload your
  // documents" field (which was removed for bid-no-bid).
  const [tenderFile, setTenderFile] = useState<UploadedFile | null>(null);
  const [uploadingTender, setUploadingTender] = useState<UploadStage | null>(null);
  // Bid-no-bid only: list of supporting-document URLs the user has pasted in.
  // Previously a single string field that just flagged "URL added" — the
  // user (2026-05-21) asked for a chip-list pattern so multiple supporting
  // links can ride along with the bid/no-bid submission. The input clears
  // after each add so the next paste fits cleanly.
  const [supportingUrls, setSupportingUrls] = useState<string[]>([]);
  const [supportingUrlInput, setSupportingUrlInput] = useState("");
  // Fetch-criteria flow (bid-no-bid): loading state + last error message.
  const [fetchingCriteria, setFetchingCriteria] = useState(false);
  const [criteriaError, setCriteriaError] = useState<string | null>(null);
  /** Confirmed primary line of business for this order (from ConfidenceGate). */
  const [confirmedPrimarySector, setConfirmedPrimarySector] = useState<string | null>(null);

  // ConfidenceGate scope key: prefer pipeline-item-id; fall back to plan+title
  // so disambiguation persists per opportunity even without a pipeline anchor.
  const confidenceScopeKey = useMemo(() => {
    if (pipelineItemId) return `pi-${pipelineItemId}`;
    if (tenderTitle) return `t-${tenderTitle.slice(0, 64)}`;
    return `s-${plan}`;
  }, [pipelineItemId, tenderTitle, plan]);

  // Direct-to-Blob upload. The browser uploads straight to Vercel Blob via
  // the @vercel/blob/client SDK, bypassing the Vercel function body limit
  // (4.5 MB on Pro plan) that was masquerading as "File upload failed. Try
  // again or skip." for any tender doc larger than that. The companion
  // /api/dashboard/vault/extract endpoint runs extraction + persistence
  // once the upload returns.
  //
  // onStage is called as the pipeline crosses milestones so the caller can
  // surface a stage-specific label ("Uploading file…" / "Reading document…")
  // instead of a single opaque "Uploading…" state.
  /**
   * `purpose` controls the vault row tag the server stamps on this file.
   * `tender_main` flags the primary tender PDF/TOR; `supporting` flags
   * capability docs / CVs / certs / financials. Both are bundled into the
   * bid-no-bid analysis prompt with their Haiku classification.
   */
  async function uploadOne(
    file: File,
    onStage: (stage: UploadStage) => void,
    purpose: "tender_main" | "supporting" = "supporting",
  ): Promise<UploadedFile | { error: string }> {
    // Browser console trail so user-reported "stuck spinner" bug reports can
    // be triaged from a screenshot of devtools. Mirrors the server-side
    // [vault:upload-token:*] / [vault:extract:*] tags.
    console.info("[upload:client:start]", {
      name: file.name,
      size: file.size,
      type: file.type,
    });

    if (file.size > 50 * 1024 * 1024) {
      return {
        error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Limit is 50 MB.`,
      };
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) {
      return { error: "You are signed out. Refresh the page and try again." };
    }

    // Cap the blob upload at 5 min and stream transfer-progress events so
    // a stuck spinner has a diagnosable trail.
    //
    // A user reported a 2.1 MB file timing out at the previous 120 s cap
    // — that's a network / SDK problem, not a legitimate slow upload, so
    // we now (a) wire @vercel/blob/client's onUploadProgress callback so
    // browser devtools show per-chunk progress, (b) emit a [stalled]
    // warning every 15 s of inactivity, and (c) bump the hard cap to 300 s
    // so genuinely slow connections (e.g. spotty mobile on a 50 MB tender
    // doc) can still complete.
    //
    // stallTimer is declared outside the try so the catch / finally branch
    // can clean it up regardless of how the upload exits.
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    try {
      onStage("uploading");
      console.info("[upload:client:blob_start]", { name: file.name });
      let lastProgressAt = Date.now();
      let lastPercentage = 0;
      stallTimer = setInterval(() => {
        const idleMs = Date.now() - lastProgressAt;
        if (idleMs > 15_000) {
          console.warn("[upload:client:blob_stalled]", {
            idleMs,
            lastPercentage,
          });
        }
      }, 5_000);
      const blob = (await Promise.race([
        upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/dashboard/vault/upload-token",
          clientPayload: JSON.stringify({ token }),
          onUploadProgress: ({ loaded, total, percentage }) => {
            lastProgressAt = Date.now();
            lastPercentage = percentage;
            console.info("[upload:client:blob_progress]", {
              loaded,
              total,
              percentage,
            });
          },
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "Upload timed out after 5 minutes. The file did not finish transferring — check your connection or try a smaller file.",
                ),
              ),
            300_000,
          ),
        ),
      ])) as Awaited<ReturnType<typeof upload>>;
      if (stallTimer) {
        clearInterval(stallTimer);
        stallTimer = null;
      }
      console.info("[upload:client:blob_done]", { url: blob.url });

      onStage("extracting");
      console.info("[upload:client:extract_start]");
      const extractRes = await fetch("/api/dashboard/vault/extract", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          url: blob.url,
          name: file.name,
          mimeType: file.type,
          // tenderTitle + purpose tell the server how to tag the vault row
          // so future bid-no-bid runs on the same tender can pre-load every
          // doc the user has attached to it.
          tenderTitle: tenderTitle ?? null,
          purpose,
        }),
        // Server side maxDuration is 45 s; give the network a small headroom
        // on top of that so a genuinely slow function still surfaces a real
        // response rather than a client-side abort masquerading as a hang.
        signal: AbortSignal.timeout(60_000),
      });
      const rawExtract = await extractRes.text();
      let extractData: { extraction?: UploadedFile["extraction"]; error?: string } = {};
      try {
        extractData = rawExtract ? JSON.parse(rawExtract) : {};
      } catch {
        extractData = {};
      }
      console.info("[upload:client:extract_done]", {
        status: extractRes.status,
        extractionStatus: extractData.extraction?.status,
      });
      // Extraction failure is non-fatal — the file is uploaded and usable.
      // We surface the issue but still hand back the URL so the rest of the
      // form keeps working.
      return {
        url: blob.url,
        name: file.name,
        extraction: extractData.extraction,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed for an unknown reason.";
      console.error("[upload:client:failed]", {
        name: file.name,
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: message,
      });
      return { error: `Upload failed: ${message}` };
    } finally {
      // Always cancel the stall watcher — leaking it would keep firing
      // console.warns indefinitely after a failed/aborted upload.
      if (stallTimer) clearInterval(stallTimer);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // The general "Upload your documents" slot — used on proposal /
    // lta-roster pages. We treat these as the primary tender doc since
    // that's what those flows are uploading (TOR / vendor guide).
    const result = await uploadOne(file, setUploading, "tender_main");
    if ("error" in result) setError(result.error);
    else setUploadedFile(result);
    setUploading(null);
  }

  async function handleFinancialFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Supporting docs — capability statements, certifications, financials,
    // partner letters. Bid-no-bid analysis weighs these against the tender.
    const result = await uploadOne(file, setUploadingFinancial, "supporting");
    if ("error" in result) setError(result.error);
    else setFinancialFile(result);
    setUploadingFinancial(null);
  }

  async function handleTenderFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Bid-no-bid-only "Tender or document" upload — this is the primary
    // tender doc (TOR / RFP / EOI). Gets the "bid-no-bid-tender" vault tag.
    const result = await uploadOne(file, setUploadingTender, "tender_main");
    if ("error" in result) setError(result.error);
    else setTenderFile(result);
    setUploadingTender(null);
  }

  // Supporting-URL chip list (bid-no-bid). addSupportingUrl normalizes and
  // dedupes; removeSupportingUrl drops an index. Pressing Enter in the input
  // adds without submitting the parent form (we e.preventDefault() inline).
  function addSupportingUrl() {
    const next = supportingUrlInput.trim();
    if (!next) return;
    setSupportingUrls((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setSupportingUrlInput("");
  }

  function removeSupportingUrl(idx: number) {
    setSupportingUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleFetchCriteria() {
    if (!tenderUrl.trim()) {
      setCriteriaError("Paste a tender URL first.");
      return;
    }
    setFetchingCriteria(true);
    setCriteriaError(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      if (!token) {
        setCriteriaError("You are signed out. Refresh the page and try again.");
        return;
      }
      const res = await fetch("/api/dashboard/services/fetch-criteria", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: tenderUrl.trim() }),
      });
      // Read once as text so we can fall back gracefully when the response
      // isn't JSON (e.g. an upstream 502/504 from the Vercel function layer
      // before our handler runs). Without this fallback the user always saw
      // a generic "Could not fetch criteria (500)." with no signal as to why.
      const rawText = await res.text();
      let data: { criteria?: string; error?: string; stage?: string } = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = {};
      }
      if (!res.ok || !data.criteria) {
        const snippet = rawText && !data.error
          ? ` — ${rawText.replace(/<[^>]+>/g, " ").trim().slice(0, 160)}`
          : "";
        setCriteriaError(
          data.error
            ? data.error
            : `Could not fetch criteria (${res.status}).${snippet}`,
        );
        return;
      }
      // Append to whatever the user has already typed so we don't blow away
      // their notes; a clear separator makes it obvious where the fetched
      // content starts.
      setFields((prev) => {
        const existing = prev.tender_context?.trim();
        const fetched = data.criteria!.trim();
        const next = existing
          ? `${existing}\n\n— FETCHED FROM ${tenderUrl.trim()} —\n${fetched}`
          : fetched;
        return { ...prev, tender_context: next };
      });
    } catch (err) {
      setCriteriaError(
        err instanceof Error ? `Network error: ${err.message}` : "Network error fetching criteria.",
      );
    } finally {
      setFetchingCriteria(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      // If the user typed a URL but never pressed Enter / clicked Add, fold
      // it into the list so they don't lose it on submit.
      const trailing = supportingUrlInput.trim();
      const finalSupportingUrls = trailing && !supportingUrls.includes(trailing)
        ? [...supportingUrls, trailing]
        : supportingUrls;

      const intakeWithFile = {
        ...fields,
        ...(uploadedFile ? { vault_url: uploadedFile.url, vault_filename: uploadedFile.name } : {}),
        ...(financialFile ? { financial_documents_url: financialFile.url, financial_documents_filename: financialFile.name } : {}),
        // Bid-no-bid-only: tender file attached in the "Tender or document"
        // section, and the supporting-documents URL list pasted alongside the
        // file upload. Both are additive keys so downstream LLM context
        // builders (src/lib/bid-no-bid/generate.ts) can pick them up without
        // breaking the existing intake shape for proposal / lta-roster.
        //
        // supporting_link_urls (plural, list) replaces the older
        // supporting_link_url singular — downstream code should treat the
        // singular as a 1-length list for backward compat.
        ...(tenderFile ? { tender_file_url: tenderFile.url, tender_file_name: tenderFile.name } : {}),
        ...(finalSupportingUrls.length ? { supporting_link_urls: finalSupportingUrls } : {}),
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

  // The "needs a selected pipeline tender" gate was dropped 2026-05-21 —
  // bid-no-bid now accepts pasted URLs, uploaded tender docs, and pasted
  // criteria as sufficient context. Forcing a pipeline selection blocked
  // first-touch users who hadn't built one yet.

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

      {/* Tender or document — URL input. On bid-no-bid this section also
          carries the tender file upload (the standalone "Upload your
          documents" field is removed for bid-no-bid). */}
      <div>
        <label className={labelCls} style={{ fontFamily: MONO }}>
          Tender or document
        </label>
        <input
          value={tenderUrl}
          onChange={(e) => setTenderUrl(e.target.value)}
          placeholder="Paste source page, TOR, or portal link"
          className={inputCls}
          style={{ fontFamily: MONO }}
        />
        {service === "bid-no-bid" && (
          <div className="mt-2">
            {tenderFile ? (
              <div
                className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-[12px] text-emerald-800"
                style={{ fontFamily: MONO }}
              >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                </svg>
                <span className="flex-1 truncate">
                  {tenderFile.name} · {tenderFile.extraction?.status === "extracted"
                    ? `extracted ${tenderFile.extraction.charCount.toLocaleString()} chars`
                    : tenderFile.extraction?.status
                      ? `uploaded, extraction ${tenderFile.extraction.status}`
                      : "uploaded"}
                </span>
                <button
                  type="button"
                  onClick={() => setTenderFile(null)}
                  className="shrink-0 text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-sm border border-dashed border-stone-300 px-3.5 py-3 text-[12px] text-stone-500 hover:border-stone-700 hover:text-stone-700 transition-colors">
                {uploadingTender ? (
                  <svg className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="leading-snug flex-1">
                  {uploadingTender === "uploading"
                    ? "Uploading file…"
                    : uploadingTender === "extracting"
                    ? "Reading document…"
                    : <>…or <span className="font-semibold text-stone-700">upload the tender document</span> (PDF / Word / Excel, up to 50 MB)</>}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  disabled={!!uploadingTender}
                  onChange={handleTenderFileChange}
                />
              </label>
            )}
          </div>
        )}
      </div>

      {/* "Upload your documents" — kept for proposal + lta-roster only. The
          equivalent slot for bid-no-bid is now embedded in the Tender section
          above, so we drop the standalone field there per user request. */}
      {(service === "proposal" || service === "lta-roster") && (
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
                {uploading ? (
                  <svg className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="leading-snug flex-1">
                  {uploading === "uploading"
                    ? "Uploading file…"
                    : uploading === "extracting"
                    ? "Reading document…"
                    : <><span className="font-semibold text-stone-700">Choose file</span> — {uploadHint[service]}</>}
                </span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                  className="sr-only"
                  disabled={!!uploading}
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
                {uploadingFinancial ? (
                  <svg className="h-4 w-4 shrink-0 mt-0.5 animate-spin text-stone-500" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 2v8M5 5l3-3 3 3M2 12h12v2H2z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="leading-snug flex-1">
                  {uploadingFinancial === "uploading"
                    ? "Uploading file…"
                    : uploadingFinancial === "extracting"
                    ? "Reading document…"
                    : (
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
                  disabled={!!uploadingFinancial}
                  onChange={handleFinancialFileChange}
                />
              </label>
            )}
          </div>
          {service === "bid-no-bid" && (
            <>
              {/* Chip-list URL input. The user can paste a link and either
                  press Enter or click Add — the URL moves into the list
                  below and the input clears so they can paste another. */}
              <div className="mt-2 flex items-stretch gap-2">
                <input
                  value={supportingUrlInput}
                  onChange={(e) => setSupportingUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSupportingUrl();
                    }
                  }}
                  placeholder="…or paste a supporting document URL (capability statement, certifications, partner letter)"
                  className={`${inputCls} flex-1 mt-0`}
                  style={{ fontFamily: MONO }}
                />
                <button
                  type="button"
                  onClick={addSupportingUrl}
                  disabled={!supportingUrlInput.trim()}
                  className="shrink-0 rounded-sm border border-stone-300 bg-white px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-700 hover:border-stone-700 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                  style={{ fontFamily: MONO }}
                >
                  Add
                </button>
              </div>
              {supportingUrls.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {supportingUrls.map((url, idx) => (
                    <li
                      key={`${url}-${idx}`}
                      className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-[12px] text-emerald-800"
                      style={{ fontFamily: MONO }}
                    >
                      <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
                      </svg>
                      <span className="flex-1 truncate" title={url}>{url}</span>
                      <button
                        type="button"
                        onClick={() => removeSupportingUrl(idx)}
                        className="shrink-0 text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* Custom fields. tender_context on bid-no-bid gets a "Fetch from URL"
          button rendered in the label row — clicking it hits the Haiku-backed
          /api/dashboard/services/fetch-criteria endpoint which downloads the
          tender URL, extracts the text, and appends the eligibility +
          evaluation criteria into this textarea. */}
      {SERVICE_FIELDS[service].map((field) => {
        const showFetchCriteria = service === "bid-no-bid" && field.key === "tender_context";
        return (
          <div key={field.key}>
            <div className="flex items-baseline justify-between gap-3">
              <label className={labelCls} style={{ fontFamily: MONO }}>
                {field.label}
                {field.required && <span className="text-red-600 ml-1">*</span>}
              </label>
              {showFetchCriteria && (
                <button
                  type="button"
                  onClick={handleFetchCriteria}
                  disabled={fetchingCriteria || !tenderUrl.trim()}
                  className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-700 hover:text-stone-900 disabled:text-stone-300 disabled:cursor-not-allowed border-b border-stone-300 hover:border-stone-700 disabled:border-stone-200 transition-colors"
                  style={{ fontFamily: MONO }}
                  title={!tenderUrl.trim() ? "Paste a tender URL above first" : "Fetch eligibility + evaluation criteria from the URL"}
                >
                  {fetchingCriteria ? "Fetching…" : "Fetch from URL ↗"}
                </button>
              )}
            </div>
            <textarea
              required={field.required}
              value={fields[field.key] ?? ""}
              onChange={(e) => setFields((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={field.placeholder}
              rows={field.rows ?? 3}
              className={inputCls + " resize-none"}
            />
            {showFetchCriteria && criteriaError && (
              <p className="mt-1.5 text-[11.5px] text-red-700" style={{ fontFamily: MONO }}>
                {criteriaError}
              </p>
            )}
          </div>
        );
      })}

      {/* Error */}
      {error && (
        <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-2.5 text-[12px] text-red-700">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-sm bg-stone-900 px-4 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Saving intake…" : `${label} →`}
      </button>
    </form>
  );
}
