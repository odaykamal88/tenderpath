export type EvidencePackStatus = "ready" | "needs_review" | "blocked";

export type EvidencePackService =
  | "bid-no-bid"
  | "proposal"
  | "proposal-draft"
  | "lta-roster"
  | "roster-fast-track";

export type EvidenceRequirementKey =
  | "tender_source"
  | "tor_rfp"
  | "agency_guide"
  | "company_registration"
  | "financial_capacity"
  | "past_performance"
  | "certifications_licenses"
  | "operational_capacity"
  | "team_cvs"
  | "capability_statement"
  | "product_datasheets"
  | "manufacturer_authorization"
  | "support_warranty";

export interface EvidencePackDocument {
  vault_document_id?: number | null;
  document_type?: string | null;
  file_name: string | null;
  file_url: string | null;
  extraction_status?: string | null;
  char_count?: number | null;
  error?: string | null;
}

export interface EvidenceRequirementState {
  key: EvidenceRequirementKey;
  label: string;
  required: boolean;
  critical: boolean;
  why: string;
  examples: string[];
  satisfied: boolean;
  sources: string[];
  missing_reason: string | null;
}

export interface ServiceEvidencePack {
  version: "sprint6-service-evidence-pack-v1";
  service_slug: EvidencePackService;
  status: EvidencePackStatus;
  score_0_10: number;
  requirements: EvidenceRequirementState[];
  satisfied_keys: EvidenceRequirementKey[];
  missing_required: EvidenceRequirementState[];
  missing_recommended: EvidenceRequirementState[];
  warnings: string[];
}

interface RequirementDefinition {
  key: EvidenceRequirementKey;
  label: string;
  required: boolean;
  critical?: boolean;
  why: string;
  examples: string[];
}

export interface BuildServiceEvidencePackArgs {
  serviceSlug?: string | null;
  intake?: Record<string, unknown> | null;
  contextText?: string | null;
  tenderSourceAvailable?: boolean;
  targetAgency?: string | null;
  targetCategory?: string | null;
}

const VERSION = "sprint6-service-evidence-pack-v1" as const;

const SERVICE_ALIASES: Record<string, EvidencePackService> = {
  "bid-no-bid": "bid-no-bid",
  proposal: "proposal-draft",
  "proposal-draft": "proposal-draft",
  "lta-roster": "roster-fast-track",
  "roster-fast-track": "roster-fast-track",
};

const REQUIREMENT_TEXT_KEYS = [
  "tender_context",
  "requirement_eligibility",
  "requirement_scope",
  "requirement_documents",
  "requirement_evaluation",
  "requirement_submission",
  "package_notes",
  "additional_details",
];

function normalizeService(value: string | null | undefined): EvidencePackService {
  const key = value?.trim().toLowerCase() ?? "";
  return SERVICE_ALIASES[key] ?? "proposal-draft";
}

function cleanString(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasIntakeText(intake: Record<string, unknown> | null | undefined, keys: string[]): boolean {
  if (!intake) return false;
  return keys.some((key) => Boolean(cleanString(intake[key], 80)));
}

function hasTenderDocument(intake: Record<string, unknown> | null | undefined): boolean {
  if (!intake) return false;
  return Boolean(
    cleanString(intake.vault_url, 1000)
      || cleanString(intake.vault_doc_id, 80)
      || (typeof intake.vault_doc_id === "number" && Number.isFinite(intake.vault_doc_id)),
  );
}

function hasFinancialDocument(intake: Record<string, unknown> | null | undefined): boolean {
  if (!intake) return false;
  return Boolean(cleanString(intake.financial_documents_url, 1000));
}

export function evidencePackDocumentsFromIntake(intake: Record<string, unknown> | null | undefined): Record<string, EvidencePackDocument> {
  const docs: Record<string, EvidencePackDocument> = {};
  const raw = asRecord(intake?.evidence_pack_documents);
  if (!raw) return docs;

  for (const [key, value] of Object.entries(raw)) {
    const record = asRecord(value);
    if (!record) continue;
    const fileUrl = cleanString(record.file_url ?? record.url, 2000);
    const fileName = cleanString(record.file_name ?? record.name, 255);
    if (!fileUrl && !fileName) continue;
    docs[key] = {
      vault_document_id: numberOrNull(record.vault_document_id ?? record.vaultDocumentId),
      document_type: cleanString(record.document_type ?? record.type, 80),
      file_name: fileName,
      file_url: fileUrl,
      extraction_status: cleanString(record.extraction_status ?? record.status, 80),
      char_count: numberOrNull(record.char_count ?? record.charCount),
      error: cleanString(record.error, 300),
    };
  }

  return docs;
}

function hasEvidenceDoc(
  docs: Record<string, EvidencePackDocument>,
  key: EvidenceRequirementKey,
): EvidencePackDocument | null {
  const doc = docs[key];
  if (!doc) return null;
  return doc.file_url || doc.file_name ? doc : null;
}

function productLane(text: string): boolean {
  return /\b(product|sku|device|equipment|commodity|catalog|catalogue|datasheet|technical data|pqs|cold-chain|cold chain|vaccine|bottled|manufacturer|authorized|authorised|warranty)\b/i.test(text);
}

function advisoryLane(text: string): boolean {
  return /\b(advisory|consulting|technical assistance|research|monitoring|evaluation|training|policy|methodology|capacity building|inspection|audit|lab|testing)\b/i.test(text);
}

function operationalLane(text: string): boolean {
  return /\b(logistics|freight|cargo|customs|warehouse|fleet|transport|dangerous goods|engineering|construction|epc|o&m|installation|maintenance|route|distribution|delivery)\b/i.test(text);
}

function certificationLane(text: string): boolean {
  return /\b(certification|certificate|license|licence|iso|haccp|pqs|ce|gmp|insurance|quality|safety|regulatory|tax|registration)\b/i.test(text);
}

function baseRequirement(def: RequirementDefinition): RequirementDefinition {
  return def;
}

function requirementsFor(args: {
  service: EvidencePackService;
  contextText: string;
}): RequirementDefinition[] {
  const text = args.contextText;
  if (args.service === "bid-no-bid") {
    return [
      baseRequirement({
        key: "tender_source",
        label: "Tender source / TOR",
        required: true,
        critical: true,
        why: "Bid/No-Bid cannot be decisive without the source notice, TOR, or eligibility excerpt.",
        examples: ["Tender source URL", "TOR/RFP PDF", "Eligibility or evaluation criteria extract"],
      }),
      baseRequirement({
        key: "financial_capacity",
        label: "Financial capacity proof",
        required: true,
        why: "Turnover, bid security, audited accounts, or payment terms often decide whether pursuing is realistic.",
        examples: ["Audited accounts", "Bank reference", "Turnover statement"],
      }),
      baseRequirement({
        key: "past_performance",
        label: "Relevant references",
        required: true,
        why: "The recommendation needs recent similar contracts or references to judge credibility.",
        examples: ["Similar contract list", "Completion certificates", "Client references"],
      }),
      baseRequirement({
        key: "certifications_licenses",
        label: "Licenses, registrations, insurance",
        required: certificationLane(text) || operationalLane(text),
        why: "Mandatory licenses, insurance, UNGM status, and sector certifications are common pass/fail gates.",
        examples: ["Trade license", "Tax certificate", "Insurance", "ISO/HACCP/PQS certificate"],
      }),
      baseRequirement({
        key: "operational_capacity",
        label: "Capacity / delivery proof",
        required: operationalLane(text) || productLane(text),
        why: "Operational details prevent optimistic recommendations when capacity, route, stock, or delivery proof is missing.",
        examples: ["Fleet or warehouse list", "Route coverage", "Production capacity", "Service locations"],
      }),
    ];
  }

  if (args.service === "proposal-draft") {
    return [
      baseRequirement({
        key: "tor_rfp",
        label: "TOR / RFP package",
        required: true,
        critical: true,
        why: "Proposal Draft needs the actual requirements, evaluation criteria, and submission instructions.",
        examples: ["TOR/RFP PDF", "Evaluation criteria", "Submission instructions"],
      }),
      baseRequirement({
        key: "past_performance",
        label: "Past-performance evidence",
        required: true,
        why: "The technical proposal needs credible references, project examples, and measurable results.",
        examples: ["Project references", "Case studies", "Completion certificates"],
      }),
      baseRequirement({
        key: "team_cvs",
        label: "Team CVs / key experts",
        required: advisoryLane(text),
        why: "Consulting and technical proposals usually require named personnel or CV-backed qualifications.",
        examples: ["Key expert CVs", "Org chart", "Role summaries"],
      }),
      baseRequirement({
        key: "certifications_licenses",
        label: "Certifications and policies",
        required: certificationLane(text),
        why: "Certifications, registrations, safeguarding, and quality policies should be cited only when evidenced.",
        examples: ["ISO certificate", "Safeguarding policy", "Professional license", "UNGM profile"],
      }),
      baseRequirement({
        key: "financial_capacity",
        label: "Financial / commercial inputs",
        required: false,
        why: "Financial documents and rate assumptions sharpen the budget template and compliance matrix.",
        examples: ["Rate card", "Audited accounts", "Bank reference", "Budget assumptions"],
      }),
      baseRequirement({
        key: "capability_statement",
        label: "Capability statement",
        required: false,
        why: "A reusable capability statement improves executive summary, methodology, and annex quality.",
        examples: ["Capability statement", "Company profile deck", "Service catalog"],
      }),
    ];
  }

  const product = productLane(text);
  const advisory = advisoryLane(text) || !product;
  return [
    baseRequirement({
      key: "agency_guide",
      label: "Agency guide / roster context",
      required: true,
      critical: true,
      why: "Roster Fast-Track needs the target portal, agency guide, call, or roster instructions.",
      examples: ["Vendor guide", "Roster call", "UNGM category page", "Supplier portal instructions"],
    }),
    baseRequirement({
      key: "company_registration",
      label: "Legal registration proof",
      required: true,
      why: "Vendor portals normally require legal registration, tax, ownership, and contact evidence.",
      examples: ["Commercial registration", "Tax certificate", "Articles of association"],
    }),
    baseRequirement({
      key: "financial_capacity",
      label: "Financial capacity proof",
      required: true,
      why: "Agency vendor registration commonly requests financial statements, bank details, or turnover proof.",
      examples: ["Audited accounts", "Bank letter", "Turnover statement"],
    }),
    baseRequirement({
      key: "certifications_licenses",
      label: "Certifications / licenses",
      required: true,
      why: "Certifications and licenses determine category eligibility and reduce manual back-and-forth.",
      examples: ["ISO certificate", "Food safety certificate", "Professional license", "Quality policy"],
    }),
    baseRequirement({
      key: "past_performance",
      label: "References / past performance",
      required: true,
      why: "Roster applications need proof that the vendor has delivered similar work or products before.",
      examples: ["Client references", "Contract list", "Completion certificates"],
    }),
    ...(product ? [
      baseRequirement({
        key: "product_datasheets",
        label: "Product datasheets / catalog",
        required: true,
        why: "Product suppliers need SKU-level specs, certifications, and support details instead of generic capabilities.",
        examples: ["Technical datasheets", "Product catalog", "Test reports", "PQS listing"],
      }),
      baseRequirement({
        key: "manufacturer_authorization",
        label: "Manufacturer / distributor authorization",
        required: /\b(distributor|manufacturer|authorized|authorised|reseller|dealer|supplier|equipment|device|pqs)\b/i.test(text),
        why: "Many agencies reject product suppliers without authorization or distribution proof.",
        examples: ["Manufacturer authorization letter", "Distributor agreement", "Reseller certificate"],
      }),
      baseRequirement({
        key: "support_warranty",
        label: "Warranty and support coverage",
        required: /\b(device|equipment|cold-chain|cold chain|pqs|energy|solar|maintenance|support|warranty)\b/i.test(text),
        why: "Country-office procurement often needs service, warranty, and after-sales coverage evidence.",
        examples: ["Warranty terms", "Service network", "Maintenance plan", "Country support coverage"],
      }),
    ] : []),
    ...(advisory ? [
      baseRequirement({
        key: "capability_statement",
        label: "Capability statement",
        required: true,
        why: "Service/advisory rosters need a concise category-specific capability statement.",
        examples: ["Capability statement", "Company profile", "Service line summary"],
      }),
      baseRequirement({
        key: "team_cvs",
        label: "Team CVs / experts",
        required: false,
        why: "Named experts are often requested for technical-assistance rosters and framework calls.",
        examples: ["Team CVs", "Expert roster", "Org chart"],
      }),
    ] : []),
  ];
}

function sourceForRequirement(args: {
  requirement: RequirementDefinition;
  intake: Record<string, unknown> | null;
  docs: Record<string, EvidencePackDocument>;
  tenderSourceAvailable: boolean;
}): string[] {
  const sources: string[] = [];
  const doc = hasEvidenceDoc(args.docs, args.requirement.key);
  if (doc) sources.push(doc.file_name ?? doc.file_url ?? "uploaded proof");

  if (args.requirement.key === "tender_source" && (args.tenderSourceAvailable || hasTenderDocument(args.intake) || hasIntakeText(args.intake, ["tender_context", "additional_details"]))) {
    sources.push(hasTenderDocument(args.intake) ? "uploaded tender/TOR" : "source URL or pasted tender criteria");
  }
  if (args.requirement.key === "tor_rfp" && (hasTenderDocument(args.intake) || hasIntakeText(args.intake, REQUIREMENT_TEXT_KEYS))) {
    sources.push(hasTenderDocument(args.intake) ? "uploaded TOR/RFP" : "pasted TOR/RFP requirements");
  }
  if (args.requirement.key === "agency_guide" && (args.tenderSourceAvailable || hasTenderDocument(args.intake) || hasIntakeText(args.intake, ["target_agency", "target_category", "additional_details"]))) {
    sources.push(hasTenderDocument(args.intake) ? "uploaded agency guide/call" : "target agency/category context");
  }
  if (args.requirement.key === "financial_capacity" && hasFinancialDocument(args.intake)) {
    sources.push("uploaded financial document");
  }

  return [...new Set(sources)];
}

function missingReason(requirement: RequirementDefinition): string {
  if (requirement.critical) return `${requirement.label} is required before checkout can be fully grounded.`;
  if (requirement.required) return `${requirement.label} is required before automated fulfillment should run.`;
  return `${requirement.label} would sharpen the deliverable and reduce manual follow-up.`;
}

export function buildServiceEvidencePack(args: BuildServiceEvidencePackArgs): ServiceEvidencePack {
  const service = normalizeService(args.serviceSlug);
  const intake = args.intake ?? null;
  const contextText = [
    args.contextText,
    args.targetAgency,
    args.targetCategory,
    ...REQUIREMENT_TEXT_KEYS.map((key) => cleanString(intake?.[key], 2000)),
  ].filter(Boolean).join(" ");
  const docs = evidencePackDocumentsFromIntake(intake);
  const definitions = requirementsFor({ service, contextText });
  const states = definitions.map((definition): EvidenceRequirementState => {
    const sources = sourceForRequirement({
      requirement: definition,
      intake,
      docs,
      tenderSourceAvailable: Boolean(args.tenderSourceAvailable),
    });
    return {
      key: definition.key,
      label: definition.label,
      required: definition.required,
      critical: Boolean(definition.critical),
      why: definition.why,
      examples: definition.examples,
      satisfied: sources.length > 0,
      sources,
      missing_reason: sources.length ? null : missingReason(definition),
    };
  });

  const missingRequired = states.filter((state) => state.required && !state.satisfied);
  const missingRecommended = states.filter((state) => !state.required && !state.satisfied);
  const criticalMissing = missingRequired.some((state) => state.critical);
  const totalWeight = states.reduce((sum, state) => sum + (state.required ? 1.25 : 0.75) + (state.critical ? 0.3 : 0), 0);
  const satisfiedWeight = states.reduce((sum, state) => {
    if (!state.satisfied) return sum;
    return sum + (state.required ? 1.25 : 0.75) + (state.critical ? 0.3 : 0);
  }, 0);
  let score = totalWeight > 0 ? 2 + (satisfiedWeight / totalWeight) * 8 : 0;

  if (criticalMissing) score = Math.min(score, 5.4);
  else if (missingRequired.length > 0) score = Math.min(score, 7.4);
  else if (missingRecommended.length > 0) score = Math.min(score, 8.8);

  const status: EvidencePackStatus = criticalMissing
    ? "blocked"
    : missingRequired.length > 0
      ? "needs_review"
      : "ready";

  const extractionWarnings = Object.values(docs)
    .filter((doc) => doc.extraction_status && doc.extraction_status !== "extracted")
    .map((doc) => `${doc.file_name ?? "uploaded proof"} extraction is ${doc.extraction_status}`);

  return {
    version: VERSION,
    service_slug: service,
    status,
    score_0_10: Math.max(0, Math.min(10, Number(score.toFixed(1)))),
    requirements: states,
    satisfied_keys: states.filter((state) => state.satisfied).map((state) => state.key),
    missing_required: missingRequired,
    missing_recommended: missingRecommended,
    warnings: extractionWarnings.slice(0, 6),
  };
}

export function serviceEvidencePackMetadata(pack: ServiceEvidencePack): Record<string, string> {
  return {
    evidence_pack_status: pack.status,
    evidence_pack_score: String(pack.score_0_10),
    evidence_pack_satisfied: pack.satisfied_keys.slice(0, 8).join(" | "),
    evidence_pack_missing_required: pack.missing_required.map((item) => item.label).slice(0, 8).join(" | "),
    evidence_pack_missing_recommended: pack.missing_recommended.map((item) => item.label).slice(0, 8).join(" | "),
  };
}
