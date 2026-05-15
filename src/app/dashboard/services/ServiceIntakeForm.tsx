"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildServiceEvidencePack,
  type EvidenceRequirementKey,
  type ServiceEvidencePack,
} from "@/lib/service-evidence-pack";

type ServiceSlug = "bid-no-bid" | "digest" | "proposal" | "lta-roster";

interface ServiceIntakeFormProps {
  service: ServiceSlug;
  plan: string;
  pipelineItemId?: string | null;
  tenderTitle?: string | null;
  agency?: string | null;
  docId?: string | null;
  initialTenderUrl?: string | null;
  label: string;
}

interface PipelineEvidenceContext {
  id: number;
  source_url: string | null;
  manual_source_url?: string | null;
  tender_deadline: string | null;
  fit_score: number | null;
  match_reasons: Record<string, unknown> | null;
  has_broken_link: boolean | null;
}

interface UploadedFile {
  name: string;
  url: string;
  vaultDocumentId?: number | null;
  documentType?: string | null;
  extraction?: {
    status: string;
    charCount: number;
    error: string | null;
  };
}

type ProofFileMap = Partial<Record<EvidenceRequirementKey, UploadedFile>>;

interface VaultDocument {
  id: number;
  name: string;
  type: "certification" | "financial" | "cv" | "past_performance" | "other";
  expiry_date: string | null;
  file_url: string;
  created_at: string;
  extraction_status: string | null;
  extraction_char_count: number | null;
  extraction_error: string | null;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

const PROPOSAL_REQUIREMENT_FIELDS = [
  {
    key: "requirement_eligibility",
    label: "Eligibility / mandatory fit",
    placeholder: "Paste mandatory eligibility, registration, license, experience, geography, or pass/fail requirements",
    help: "eligibility and mandatory requirements",
  },
  {
    key: "requirement_scope",
    label: "Scope, deliverables, methodology",
    placeholder: "Paste scope of work, deliverables, methodology, work plan, or team requirements",
    help: "technical scope and deliverables",
  },
  {
    key: "requirement_documents",
    label: "Required documents",
    placeholder: "Paste required forms, certificates, CVs, references, financial proposal, legal docs, or attachments",
    help: "required document list",
  },
  {
    key: "requirement_evaluation",
    label: "Evaluation / scoring",
    placeholder: "Paste evaluation criteria, points, weights, pass marks, best-value rules, or scoring method",
    help: "evaluation criteria or scoring method",
  },
  {
    key: "requirement_submission",
    label: "Submission instructions",
    placeholder: "Paste portal/email instructions, file naming, separate technical/financial submission, language, validity, deadline rules",
    help: "submission format and instructions",
  },
] as const;

const SERVICE_FIELDS: Record<ServiceSlug, Array<{ key: string; label: string; placeholder: string; required?: boolean; rows?: number }>> = {
  "bid-no-bid": [
    { key: "decision_deadline", label: "When do you need the decision?", placeholder: "e.g. Tomorrow, before the Friday bid meeting" },
    { key: "tender_context", label: "Paste eligibility or evaluation criteria", placeholder: "Copy the key requirements from the TOR, RFP, or tender notice — the more specific, the sharper the analysis", rows: 6 },
    { key: "additional_details", label: "Additional details we should know", placeholder: "Anything else that would help sharpen the analysis — competitive concerns, partner constraints, timeline pressure", rows: 3 },
  ],
  digest: [
    { key: "focus", label: "What should the digest prioritize?", placeholder: "Countries, agencies, sectors, contract types, or exclusions" },
    { key: "must_not_include", label: "What should we avoid?", placeholder: "e.g. individual consultancies, construction, expired opportunities" },
  ],
  proposal: [
    { key: "submission_deadline", label: "Submission deadline", placeholder: "Date/time and timezone if known", required: true },
    ...PROPOSAL_REQUIREMENT_FIELDS.map((field) => ({ ...field, rows: 3 })),
    { key: "additional_details", label: "Additional details we should know", placeholder: "Compliance concerns, required sections, pricing notes, partner roles, or anything else we should account for", rows: 4 },
  ],
  "lta-roster": [
    { key: "target_agency", label: "Target agency or roster", placeholder: "e.g. UNOPS supplier registration, FAO agriculture roster, WHO e-tendering, WFP logistics LTA", required: true },
    { key: "target_category", label: "Product / service category", placeholder: "e.g. food-safety advisory, WHO/PQS cold-chain monitoring device, mini-grid O&M, EPC contractor, agriculture inputs", required: true },
    { key: "additional_details", label: "Additional details we should know", placeholder: "Current registration status, product/service category, or anything specific to this application", rows: 4 },
  ],
};

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasList(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => hasText(item));
}

function proposalRequirementChecks(args: {
  fields: Record<string, string>;
  extractedRequirements: boolean;
}): Array<{ label: string; ok: boolean; help: string }> {
  return PROPOSAL_REQUIREMENT_FIELDS.map((field) => ({
    label: field.label,
    ok: args.extractedRequirements || hasText(args.fields[field.key]),
    help: args.extractedRequirements
      ? "TenderPath will extract this from the uploaded TOR/RFP after intake is saved."
      : `Paste ${field.help}, or upload an extractable TOR/RFP above.`,
  }));
}

function hasMatchEvidence(item: PipelineEvidenceContext | null): boolean {
  if (!item?.match_reasons) return false;
  return hasList(item.match_reasons.summary)
    || hasList(item.match_reasons.matchedSectors)
    || hasList(item.match_reasons.matchedCapabilities)
    || (typeof item.fit_score === "number" && item.fit_score > 0);
}

function buildEvidenceReview(args: {
  service: ServiceSlug;
  pipelineItemId?: string | null;
  pipelineContext: PipelineEvidenceContext | null;
  contextLoadError: string | null;
  tenderUrl: string;
  fields: Record<string, string>;
  uploadedFile: UploadedFile | null;
  proofFiles: ProofFileMap;
  docId?: string | null;
}) {
  if (args.service === "digest") return null;
  const attachedSourceProof = args.proofFiles.tender_source || args.proofFiles.tor_rfp || args.proofFiles.agency_guide;
  const uploadedRequirements = Boolean(args.uploadedFile || args.docId || attachedSourceProof);
  const sourceUrlAvailable = hasText(args.tenderUrl) || hasText(args.pipelineContext?.source_url) || hasText(args.pipelineContext?.manual_source_url);
  const sourceAvailable = sourceUrlAvailable || uploadedRequirements;
  const extractedRequirements = Boolean(
    args.uploadedFile?.extraction?.status === "extracted"
      && args.uploadedFile.extraction.charCount > 0,
  ) || Boolean(
    attachedSourceProof?.extraction?.status === "extracted"
      && attachedSourceProof.extraction.charCount > 0,
  );
  const pastedRequirements = hasText(args.fields.tender_context) || hasText(args.fields.additional_details);
  const hasRequirements = extractedRequirements || pastedRequirements;
  const hasTargetAgency = hasText(args.fields.target_agency);
  const hasTargetCategory = hasText(args.fields.target_category) || hasText(args.fields.additional_details);
  const matchEvidence = hasMatchEvidence(args.pipelineContext);
  const hasDeadline = hasText(args.pipelineContext?.tender_deadline) || hasText(args.fields.submission_deadline);
  const checks: Array<{ label: string; ok: boolean; help: string }> = [];

  if (args.service === "bid-no-bid" || args.service === "proposal") {
    checks.push({
      label: "Pipeline tender",
      ok: Boolean(args.pipelineItemId),
      help: "Select a matched pipeline item so the service can use saved fit evidence.",
    });
  }
  checks.push({
    label: args.service === "bid-no-bid" ? "Tender source" : "Source URL",
    ok: sourceAvailable,
    help: args.service === "bid-no-bid"
      ? "Paste the tender source URL or upload the TOR/RFP before checkout."
      : "Add the tender, TOR, portal, or source page URL.",
  });
  checks.push({
    label: "Dashboard match evidence",
    ok: matchEvidence,
    help: "Match reasons are missing, so fulfillment will need manual review.",
  });
  if (args.service === "bid-no-bid" || args.service === "proposal") {
    checks.push({
      label: args.service === "proposal" ? "TOR/RFP detail" : "Eligibility/evaluation criteria",
      ok: hasRequirements,
      help: uploadedRequirements && !extractedRequirements
        ? "The uploaded document was not extractable yet; paste key criteria here so the automated output is grounded."
        : args.service === "proposal"
          ? "Upload an extractable PDF/DOCX/XLSX TOR or paste the TOR/RFP before checkout for a submission-ready draft."
          : "Paste criteria or upload an extractable PDF/DOCX/XLSX before checkout for a decisive memo.",
    });
    if (args.service === "proposal") {
      checks.push(...proposalRequirementChecks({
        fields: args.fields,
        extractedRequirements,
      }));
    }
    checks.push({
      label: "Deadline",
      ok: hasDeadline,
      help: "Add the deadline so effort and urgency are grounded.",
    });
  }
  if (args.service === "lta-roster") {
    checks.push({
      label: "Target agency",
      ok: hasTargetAgency,
      help: "Confirm the roster, LTA, or agency before checkout.",
    });
    checks.push({
      label: "Category lane",
      ok: hasTargetCategory,
      help: "Name the exact product or service category so the package does not drift into generic supplier registration.",
    });
    checks.push({
      label: "Agency guide or call document",
      ok: sourceAvailable || uploadedRequirements,
      help: "Add a vendor guide, roster notice, or call document to avoid generic instructions.",
    });
  }
  checks.push({
    label: "Working source link",
    ok: args.pipelineContext?.has_broken_link !== true,
    help: "The saved source link is marked broken; paste a working URL if you have one.",
  });

  const missing = checks.filter((check) => !check.ok);
  const status = args.contextLoadError
    ? "needs review"
    : missing.length === 0
      ? "ready"
      : missing.length <= 2
        ? "needs context"
        : "high risk";
  const tone = status === "ready" ? "green" : status === "needs context" ? "amber" : "red";

  return { status, tone, checks, missing };
}

function evidencePackDocuments(proofFiles: ProofFileMap) {
  return Object.fromEntries(
    Object.entries(proofFiles).map(([key, file]) => [
      key,
      {
        vault_document_id: file?.vaultDocumentId ?? null,
        document_type: file?.documentType ?? null,
        file_name: file?.name ?? null,
        file_url: file?.url ?? null,
        extraction_status: file?.extraction?.status ?? null,
        char_count: file?.extraction?.charCount ?? 0,
        error: file?.extraction?.error ?? null,
      },
    ]),
  );
}

function uploadedFileFromVaultDocument(doc: VaultDocument): UploadedFile {
  return {
    name: doc.name,
    url: doc.file_url,
    vaultDocumentId: doc.id,
    documentType: doc.type,
    extraction: doc.extraction_status
      ? {
        status: doc.extraction_status,
        charCount: doc.extraction_char_count ?? 0,
        error: doc.extraction_error ?? null,
      }
      : undefined,
  };
}

function vaultDocRelevanceScore(key: EvidenceRequirementKey, doc: VaultDocument): number {
  const text = `${doc.name} ${doc.type}`.toLowerCase();
  if (key === "financial_capacity") return doc.type === "financial" ? 10 : /audit|financial|bank|turnover|statement|balance/.test(text) ? 8 : 1;
  if (key === "past_performance") return doc.type === "past_performance" ? 10 : /reference|past|performance|portfolio|completion|contract|case stud/.test(text) ? 8 : 1;
  if (key === "team_cvs") return doc.type === "cv" ? 10 : /\bcv\b|resume|expert|team|personnel/.test(text) ? 8 : 1;
  if (key === "certifications_licenses") return doc.type === "certification" ? 10 : /cert|license|licence|iso|haccp|pqs|insurance|quality|tax|registration/.test(text) ? 8 : 1;
  if (key === "company_registration") return /registration|incorporation|tax|legal|articles|commercial/.test(text) ? 9 : doc.type === "certification" ? 5 : 1;
  if (key === "product_datasheets") return /datasheet|catalog|catalogue|product|sku|spec|technical|test report/.test(text) ? 9 : 1;
  if (key === "manufacturer_authorization") return /manufacturer|authorization|authorisation|authorized|authorised|distributor|dealer|reseller/.test(text) ? 9 : 1;
  if (key === "support_warranty") return /warranty|support|maintenance|service coverage|after-sales|after sales/.test(text) ? 9 : 1;
  if (key === "operational_capacity") return /capacity|fleet|warehouse|route|production|delivery|distribution|equipment|facility/.test(text) ? 9 : 1;
  if (key === "capability_statement") return /capability|company profile|profile|statement|brochure|service catalog/.test(text) ? 9 : 1;
  if (key === "tender_source" || key === "tor_rfp" || key === "agency_guide") return /tor|rfp|tender|terms|reference|call|guide|roster|agency|lta|eoi|rfq/.test(text) ? 9 : 1;
  return 1;
}

function rankedVaultDocsForRequirement(docs: VaultDocument[], key: EvidenceRequirementKey): VaultDocument[] {
  return [...docs].sort((a, b) => {
    const scoreDiff = vaultDocRelevanceScore(key, b) - vaultDocRelevanceScore(key, a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function buildEvidencePackPreview(args: {
  service: ServiceSlug;
  tenderUrl: string;
  fields: Record<string, string>;
  uploadedFile: UploadedFile | null;
  financialFile: UploadedFile | null;
  proofFiles: ProofFileMap;
  pipelineContext: PipelineEvidenceContext | null;
  docId?: string | null;
  tenderTitle?: string | null;
  agency?: string | null;
}): ServiceEvidencePack | null {
  if (args.service === "digest") return null;
  const intake = {
    ...args.fields,
    ...(args.uploadedFile ? { vault_url: args.uploadedFile.url, vault_filename: args.uploadedFile.name } : {}),
    ...(args.financialFile ? { financial_documents_url: args.financialFile.url, financial_documents_filename: args.financialFile.name } : {}),
    ...(args.docId ? { vault_doc_id: args.docId } : {}),
    evidence_pack_documents: evidencePackDocuments(args.proofFiles),
  };
  return buildServiceEvidencePack({
    serviceSlug: args.service,
    intake,
    tenderSourceAvailable: hasText(args.tenderUrl) || hasText(args.pipelineContext?.source_url) || hasText(args.pipelineContext?.manual_source_url),
    targetAgency: args.fields.target_agency || args.agency,
    targetCategory: args.fields.target_category,
    contextText: [
      args.tenderTitle,
      args.agency,
      args.fields.target_agency,
      args.fields.target_category,
      args.fields.tender_context,
      args.fields.additional_details,
      args.fields.requirement_eligibility,
      args.fields.requirement_scope,
      args.fields.requirement_documents,
      args.fields.requirement_evaluation,
      args.fields.requirement_submission,
    ].filter(Boolean).join(" "),
  });
}

const EXISTING_UPLOAD_KEYS = new Set<EvidenceRequirementKey>([
  "tender_source",
  "tor_rfp",
  "agency_guide",
  "financial_capacity",
]);

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
  const [proofFiles, setProofFiles] = useState<ProofFileMap>({});
  const [uploadingProofKey, setUploadingProofKey] = useState<EvidenceRequirementKey | null>(null);
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [pipelineContext, setPipelineContext] = useState<PipelineEvidenceContext | null>(null);
  const [contextLoadError, setContextLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!pipelineItemId) {
      setPipelineContext(null);
      setContextLoadError(null);
      return;
    }
    let cancelled = false;
    setContextLoadError(null);
    fetch(`/api/dashboard/pipeline/${encodeURIComponent(pipelineItemId)}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { item?: PipelineEvidenceContext; error?: string };
        if (!res.ok || !data.item) throw new Error(data.error ?? "Could not load pipeline evidence");
        if (!cancelled) setPipelineContext(data.item);
      })
      .catch((err) => {
        if (!cancelled) {
          setPipelineContext(null);
          setContextLoadError(err instanceof Error ? err.message : "Could not load pipeline evidence");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineItemId]);

  useEffect(() => {
    if (service === "digest") {
      setVaultDocs([]);
      setVaultError(null);
      return;
    }
    let cancelled = false;
    setVaultLoading(true);
    setVaultError(null);
    fetch("/api/dashboard/vault", { headers: authHeaders() })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { documents?: VaultDocument[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Could not load vault documents");
        if (!cancelled) setVaultDocs(data.documents ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setVaultDocs([]);
          setVaultError(err instanceof Error ? err.message : "Could not load vault documents");
        }
      })
      .finally(() => {
        if (!cancelled) setVaultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [service]);

  const evidenceReview = useMemo(() => buildEvidenceReview({
    service,
    pipelineItemId,
    pipelineContext,
    contextLoadError,
    tenderUrl,
    fields,
    uploadedFile,
    proofFiles,
    docId,
  }), [contextLoadError, docId, fields, pipelineContext, pipelineItemId, proofFiles, service, tenderUrl, uploadedFile]);
  const evidencePackPreview = useMemo(() => buildEvidencePackPreview({
    service,
    tenderUrl,
    fields,
    uploadedFile,
    financialFile,
    proofFiles,
    pipelineContext,
    docId,
    tenderTitle,
    agency,
  }), [agency, docId, fields, financialFile, pipelineContext, proofFiles, service, tenderTitle, tenderUrl, uploadedFile]);
  const checkoutBlocked = Boolean(
    evidenceReview
      && (
        (service === "bid-no-bid" && evidenceReview.missing.some((item) => item.label === "Pipeline tender" || item.label === "Tender source"))
        || (service === "proposal" && evidenceReview.status === "high risk")
        || (service === "lta-roster" && evidenceReview.missing.some((item) => item.label === "Target agency" || item.label === "Category lane"))
      ),
  );

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

  async function handleProofFileChange(key: EvidenceRequirementKey, file: File | undefined) {
    if (!file) return;
    setUploadingProofKey(key);
    setError(null);
    const result = await uploadOne(file);
    if ("error" in result) setError(result.error);
    else setProofFiles((prev) => ({ ...prev, [key]: result }));
    setUploadingProofKey(null);
  }

  function attachVaultDocument(key: EvidenceRequirementKey, rawId: string) {
    const id = Number(rawId);
    if (!Number.isInteger(id)) return;
    const doc = vaultDocs.find((item) => item.id === id);
    if (!doc) return;
    setProofFiles((prev) => ({ ...prev, [key]: uploadedFileFromVaultDocument(doc) }));
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
        ...(Object.keys(proofFiles).length ? { evidence_pack_documents: evidencePackDocuments(proofFiles) } : {}),
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
    "bid-no-bid": "Upload tender / TOR",
    "proposal": "Upload TOR / RFP / call document",
    "lta-roster": "Upload vendor guide / call for applications",
    "digest": "",
  };

  const uploadHint: Record<ServiceSlug, string> = {
    "bid-no-bid": "PDF or Word tender notice, TOR, RFP, or eligibility page extract",
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

      {/* Financial documents — captured here instead of being scored on the
          dashboard. The deliverable templates use audited financials, bank
          references, and balance sheets to populate the financial section. */}
      {(service === "bid-no-bid" || service === "proposal" || service === "lta-roster") && (
        <div>
          <label className={labelCls} style={{ fontFamily: MONO }}>
            Upload financial documents
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
                  {uploadingFinancial ? "Uploading…" : <><span className="font-semibold text-stone-700">Choose file</span> — Audited financials, bank reference, or balance sheet (optional, sharpens the financial section)</>}
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

      {evidenceReview && (
        <div
          className={[
            "rounded-sm border-l-2 px-3.5 py-3 text-[12px] leading-relaxed",
            evidenceReview.tone === "green" && "border-emerald-600 bg-emerald-50/50 text-emerald-950",
            evidenceReview.tone === "amber" && "border-amber-600 bg-amber-50/50 text-amber-950",
            evidenceReview.tone === "red" && "border-red-600 bg-red-50/50 text-red-900",
          ].filter(Boolean).join(" ")}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold uppercase tracking-[0.16em]" style={{ fontFamily: MONO }}>
              Fulfillment context · {evidenceReview.status}
            </span>
            {pipelineContext?.fit_score != null && (
              <span className="font-semibold tabular-nums" style={{ fontFamily: MONO }}>
                {pipelineContext.fit_score}% fit
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            {evidenceReview.checks.map((check) => (
              <div key={check.label} className="flex gap-2">
                <span className="shrink-0 font-semibold tabular-nums" style={{ fontFamily: MONO }}>
                  {check.ok ? "OK" : "MISS"}
                </span>
                <span>
                  <span className="font-medium">{check.label}</span>
                  {!check.ok && <span className="text-current/80"> — {check.help}</span>}
                </span>
              </div>
            ))}
          </div>
          {contextLoadError && (
            <div className="mt-2 text-[11px]" style={{ fontFamily: MONO }}>
              Pipeline evidence could not be loaded: {contextLoadError}
            </div>
          )}
          {checkoutBlocked && (
            <div className="mt-2 rounded-sm bg-white/50 px-2.5 py-2 text-[11.5px] font-medium">
              Automated checkout is paused until the missing source context is added. This keeps the paid output out of false-confidence territory.
            </div>
          )}
        </div>
      )}

      {evidencePackPreview && (
        <div className="rounded-sm border border-stone-200/80 bg-stone-50/40 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500"
              style={{ fontFamily: MONO }}
            >
              Evidence pack · {evidencePackPreview.status.replace(/_/g, " ")}
            </span>
            <span className="text-[11px] font-semibold tabular-nums text-stone-700" style={{ fontFamily: MONO }}>
              {evidencePackPreview.score_0_10}/10
            </span>
          </div>
          <div className="mt-2 space-y-2">
            {evidencePackPreview.requirements.map((requirement) => {
              const proof = proofFiles[requirement.key];
              const handledAbove = EXISTING_UPLOAD_KEYS.has(requirement.key);
              const rankedVaultDocs = rankedVaultDocsForRequirement(vaultDocs, requirement.key);
              const attachedVaultDoc = proof?.vaultDocumentId
                ? vaultDocs.find((doc) => doc.id === proof.vaultDocumentId)
                : null;
              const vaultChoices = attachedVaultDoc && !rankedVaultDocs.slice(0, 12).some((doc) => doc.id === attachedVaultDoc.id)
                ? [attachedVaultDoc, ...rankedVaultDocs.slice(0, 11)]
                : rankedVaultDocs.slice(0, 12);
              const attachedVaultId = proof?.vaultDocumentId ? String(proof.vaultDocumentId) : "";
              return (
                <div key={requirement.key} className="rounded-sm border border-stone-200 bg-white px-3 py-2.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${
                            requirement.satisfied ? "text-emerald-700" : requirement.required ? "text-red-700" : "text-amber-700"
                          }`}
                          style={{ fontFamily: MONO }}
                        >
                          {requirement.satisfied ? "on file" : requirement.required ? "needed" : "optional"}
                        </span>
                        <span className="text-[12.5px] font-semibold text-stone-900">
                          {requirement.label}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-stone-600">
                        {requirement.satisfied
                          ? `Source: ${requirement.sources.slice(0, 2).join(", ")}`
                          : requirement.missing_reason}
                      </p>
                      {!requirement.satisfied && (
                        <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                          Examples: {requirement.examples.slice(0, 3).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 space-y-1.5 sm:w-[220px]">
                      {vaultDocs.length > 0 ? (
                        <select
                          value={attachedVaultId}
                          onChange={(e) => attachVaultDocument(requirement.key, e.target.value)}
                          className="w-full rounded-sm border border-stone-300 bg-white px-2.5 py-2 text-[11px] text-stone-700 focus:border-stone-700 focus:outline-none"
                          style={{ fontFamily: MONO }}
                        >
                          <option value="">Attach from vault...</option>
                          {vaultChoices.map((doc) => (
                            <option key={doc.id} value={doc.id}>
                              {doc.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="rounded-sm border border-stone-200 bg-stone-50 px-2.5 py-2 text-[11px] leading-relaxed text-stone-500">
                          {vaultLoading
                            ? "Loading vault..."
                            : vaultError
                              ? "Vault unavailable here"
                              : "No vault docs yet"}
                        </p>
                      )}
                      {proof ? (
                        <div
                          className="flex items-center gap-2 rounded-sm border border-emerald-200 bg-emerald-50/60 px-2.5 py-2 text-[11px] text-emerald-800"
                          style={{ fontFamily: MONO }}
                        >
                          <span className="min-w-0 flex-1 truncate">{proof.name}</span>
                          <button
                            type="button"
                            onClick={() => setProofFiles((prev) => {
                              const next = { ...prev };
                              delete next[requirement.key];
                              return next;
                            })}
                            className="shrink-0 underline underline-offset-2 hover:text-emerald-900"
                          >
                            Remove
                          </button>
                        </div>
                      ) : handledAbove ? (
                        <p className="text-[11px] leading-relaxed text-stone-500">
                          New files use the matching upload field above.
                        </p>
                      ) : (
                        <label className="flex cursor-pointer justify-center rounded-sm border border-dashed border-stone-300 px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-stone-500 hover:border-stone-700 hover:text-stone-800 transition-colors">
                          <span style={{ fontFamily: MONO }}>
                            {uploadingProofKey === requirement.key ? "Uploading..." : "Upload proof"}
                          </span>
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.xls,.xlsx"
                            className="sr-only"
                            disabled={uploadingProofKey === requirement.key}
                            onChange={(e) => handleProofFileChange(requirement.key, e.target.files?.[0])}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {evidencePackPreview.status !== "ready" && (
            <div className="mt-2 rounded-sm bg-white px-2.5 py-2 text-[11.5px] leading-relaxed text-stone-600">
              Missing proof does not hide the service. It routes the order through human QA and keeps automated output from overclaiming readiness.
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="rounded-sm border-l-2 border-red-600 bg-red-50/40 px-3.5 py-2.5 text-[12px] text-red-700">
          {error}
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={busy || requiresPipeline || checkoutBlocked}
        className="w-full rounded-sm bg-stone-900 px-4 py-3 text-[13px] font-semibold text-white hover:bg-stone-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Saving intake…" : checkoutBlocked ? "Add missing context to continue" : `${label} →`}
      </button>
    </form>
  );
}
