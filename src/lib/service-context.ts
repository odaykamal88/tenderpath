import { sql } from "@/lib/db";
import {
  buildServiceEvidencePack,
  evidencePackDocumentsFromIntake,
} from "@/lib/service-evidence-pack";

type JsonRecord = Record<string, unknown>;

export interface BuildServiceContextArgs {
  userId: number;
  userEmail?: string | null;
  serviceSlug?: string | null;
  pipelineItemId?: number | null;
  tenderTitle?: string | null;
  agency?: string | null;
  tenderUrl?: string | null;
  intake?: JsonRecord | null;
}

type PipelineContextRow = {
  id: number;
  tender_id: number | null;
  assessment_id: number | null;
  tender_title: string | null;
  tender_agency: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  manual_source_url: string | null;
  fit_score: number | null;
  stage: string | null;
  notes: string | null;
  match_reasons: unknown;
  reference_id: string | null;
  source_name: string | null;
  source_url: string | null;
  opportunity_type: string | null;
  tender_sector: string | null;
  eligibility_summary: string | null;
  required_registrations: string | null;
  estimated_value: string | null;
  tender_country: string | null;
  tender_region: string | null;
  has_broken_link: boolean | null;
  company_name: string | null;
  website: string | null;
  company_description: string | null;
  company_sector: string | null;
  countries: unknown;
  ai_analysis: unknown;
  readiness_score: number | null;
  gaps: unknown;
  crawled_data: unknown;
};

type AssessmentContextRow = {
  id: number;
  company_name: string | null;
  website: string | null;
  company_description: string | null;
  company_sector: string | null;
  countries: unknown;
  ai_analysis: unknown;
  readiness_score: number | null;
  gaps: unknown;
  crawled_data: unknown;
};

type DocumentExtractionRow = {
  file_name: string | null;
  file_url: string | null;
  status: string | null;
  text_content: string | null;
  char_count: number | null;
  error: string | null;
};

const PACKET_VERSION = "sprint0-service-context-v1";
const MAX_TEXT = 600;

function cleanText(value: unknown, max = MAX_TEXT): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, max);
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asStringArray(value: unknown, maxItems = 6, maxItemLength = 180): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxItemLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function intOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed != null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasIntakeText(intake: JsonRecord | null | undefined, keys: string[]): boolean {
  if (!intake) return false;
  return keys.some((key) => cleanText(intake[key], 20) != null);
}

function hasUploadedDocument(intake: JsonRecord | null | undefined): boolean {
  if (!intake) return false;
  const evidenceDocs = evidencePackDocumentsFromIntake(intake);
  return Boolean(
    cleanText(intake.vault_url, 50)
      || cleanText(intake.financial_documents_url, 50)
      || cleanText(intake.vault_doc_id, 50)
      || Object.values(evidenceDocs).some((doc) => cleanText(doc.file_url, 50) || cleanText(doc.file_name, 50)),
  );
}

function hasTenderDocument(intake: JsonRecord | null | undefined): boolean {
  if (!intake) return false;
  const evidenceDocs = evidencePackDocumentsFromIntake(intake);
  return Boolean(
    cleanText(intake.vault_url, 50)
      || cleanText(intake.vault_doc_id, 50)
      || (typeof intake.vault_doc_id === "number" && Number.isFinite(intake.vault_doc_id))
      || cleanText(evidenceDocs.tender_source?.file_url, 50)
      || cleanText(evidenceDocs.tor_rfp?.file_url, 50)
      || cleanText(evidenceDocs.agency_guide?.file_url, 50),
  );
}

function hasTenderRequirementContext(intake: JsonRecord | null | undefined, pipeline: PipelineContextRow | null): boolean {
  return hasIntakeText(intake, ["tender_context", "additional_details"])
    || Boolean(cleanText(pipeline?.eligibility_summary, 80))
    || Boolean(cleanText(pipeline?.required_registrations, 80));
}

async function loadDocumentExtraction(userId: number, fileUrl: string): Promise<DocumentExtractionRow | null> {
  try {
    const rows = await sql`
      SELECT file_name, file_url, status, text_content, char_count, error
      FROM document_extractions
      WHERE user_id = ${userId}
        AND file_url = ${fileUrl}
      ORDER BY updated_at DESC
      LIMIT 1
    ` as unknown as DocumentExtractionRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[tp:service_context:document_extraction_lookup_failed]", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function loadVaultDocumentExtraction(userId: number, documentId: number): Promise<DocumentExtractionRow | null> {
  try {
    const rows = await sql`
      SELECT
        COALESCE(de.file_name, vd.name) AS file_name,
        vd.file_url,
        de.status,
        de.text_content,
        de.char_count,
        de.error
      FROM vault_documents vd
      LEFT JOIN document_extractions de
        ON de.user_id = vd.user_id
       AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
      WHERE vd.user_id = ${userId}
        AND vd.id = ${documentId}
      ORDER BY de.updated_at DESC NULLS LAST
      LIMIT 1
    ` as unknown as DocumentExtractionRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[tp:service_context:vault_document_lookup_failed]", {
      userId,
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function uploadedDocumentContexts(userId: number, intake: JsonRecord | null | undefined): Promise<JsonRecord[]> {
  if (!intake) return [];
  const evidenceDocs = evidencePackDocumentsFromIntake(intake);
  const candidates = [
    {
      kind: "requirements",
      url: cleanText(intake.vault_url, 2000),
      fileName: cleanText(intake.vault_filename, 255),
      documentId: intOrNull(intake.vault_doc_id),
    },
    {
      kind: "financial",
      url: cleanText(intake.financial_documents_url, 2000),
      fileName: cleanText(intake.financial_documents_filename, 255),
      documentId: null,
    },
    ...Object.entries(evidenceDocs).map(([key, doc]) => ({
      kind: `evidence_pack:${key}`,
      url: cleanText(doc.file_url, 2000),
      fileName: cleanText(doc.file_name, 255),
      documentId: intOrNull(doc.vault_document_id),
    })),
  ].filter((item) => item.url || item.documentId);

  const documents: JsonRecord[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const candidateKey = `${candidate.kind}:${candidate.url ?? candidate.documentId ?? ""}`;
    if (seen.has(candidateKey)) continue;
    seen.add(candidateKey);
    const extraction = candidate.url
      ? await loadDocumentExtraction(userId, candidate.url)
      : candidate.documentId
        ? await loadVaultDocumentExtraction(userId, candidate.documentId)
        : null;
    const excerptMax = candidate.kind === "requirements" || candidate.kind.startsWith("evidence_pack:")
      ? 14_000
      : 5_000;
    documents.push({
      kind: candidate.kind,
      file_name: candidate.fileName ?? extraction?.file_name ?? null,
      file_url: candidate.url ?? extraction?.file_url ?? null,
      vault_document_id: candidate.documentId ?? null,
      extraction_status: extraction?.status ?? "not_found",
      char_count: extraction?.char_count ?? 0,
      text_excerpt: cleanText(extraction?.text_content, excerptMax),
      error: cleanText(extraction?.error, 300),
    });
  }
  return documents;
}

async function loadPipelineContext(userId: number, pipelineItemId: number | null): Promise<PipelineContextRow | null> {
  if (!pipelineItemId) return null;
  const rows = await sql`
    SELECT
      pi.id,
      pi.tender_id,
      pi.assessment_id,
      pi.tender_title,
      pi.tender_agency,
      pi.tender_deadline,
      pi.tender_value,
      pi.source_url AS manual_source_url,
      pi.fit_score,
      pi.stage,
      pi.notes,
      pi.match_reasons,
      t.reference_id,
      t.source_name,
      COALESCE(t.source_url, pi.source_url) AS source_url,
      t.opportunity_type,
      t.sector AS tender_sector,
      t.eligibility_summary,
      t.required_registrations,
      t.estimated_value,
      t.country AS tender_country,
      t.region AS tender_region,
      t.has_broken_link,
      a.company_name,
      a.website,
      a.description AS company_description,
      a.sector AS company_sector,
      a.countries,
      a.ai_analysis,
      a.readiness_score,
      a.gaps,
      a.crawled_data
    FROM pipeline_items pi
    LEFT JOIN tenders t ON t.id = pi.tender_id
    LEFT JOIN assessments a ON a.id = pi.assessment_id
    WHERE pi.id = ${pipelineItemId} AND pi.user_id = ${userId}
    LIMIT 1
  ` as unknown as PipelineContextRow[];
  return rows[0] ?? null;
}

async function loadLatestAssessment(userEmail: string | null | undefined): Promise<AssessmentContextRow | null> {
  const email = cleanText(userEmail, 255);
  if (!email) return null;
  const rows = await sql`
    SELECT
      id,
      company_name,
      website,
      description AS company_description,
      sector AS company_sector,
      countries,
      ai_analysis,
      readiness_score,
      gaps,
      crawled_data
    FROM assessments
    WHERE email = ${email}
    ORDER BY created_at DESC
    LIMIT 1
  ` as unknown as AssessmentContextRow[];
  return rows[0] ?? null;
}

function matchContext(matchReasons: unknown, fallbackFitScore: number | null): JsonRecord {
  const reasons = asRecord(matchReasons);
  const procurement = asRecord(reasons?.procurement);
  const geography = asRecord(reasons?.geographyAlignment);
  const confidenceRaw = reasons?.confidence;
  const confidenceNumber = numberOrNull(confidenceRaw);

  return {
    fit_score: fallbackFitScore,
    summary: asStringArray(reasons?.summary, 4, 220),
    caveats: asStringArray(reasons?.caveats, 4, 220),
    matched_sectors: asStringArray(reasons?.matchedSectors, 6, 100),
    matched_capabilities: asStringArray(reasons?.matchedCapabilities, 6, 120),
    matched_keywords: asStringArray(reasons?.matchedKeywords, 8, 80),
    opportunity_bucket: cleanText(reasons?.opportunityBucket, 80),
    opportunity_bucket_label: cleanText(reasons?.opportunityBucketLabel, 120),
    opportunity_bucket_reason: cleanText(reasons?.opportunityBucketReason, 260),
    confidence: confidenceNumber != null ? confidenceNumber : cleanText(confidenceRaw, 40),
    procurement_category: cleanText(procurement?.category, 120),
    source_provenance: cleanText(procurement?.sourceProvenance, 40),
    geography_mode: cleanText(geography?.mode, 80),
    geography_country: cleanText(geography?.tenderCountry, 120),
  };
}

function assessmentContext(row: PipelineContextRow | AssessmentContextRow | null): JsonRecord | null {
  if (!row) return null;
  const ai = asRecord(row.ai_analysis);
  const crawledData = asRecord(row.crawled_data);
  const assessmentId = "tender_id" in row ? row.assessment_id : row.id;

  return {
    assessment_id: assessmentId,
    company_name: cleanText(row.company_name, 255),
    website: cleanText(row.website, 500),
    description: cleanText(row.company_description, 500),
    sector: cleanText(row.company_sector, 120),
    countries: asStringArray(row.countries, 8, 100),
    readiness_score: row.readiness_score,
    detected_industry: cleanText(ai?.detected_industry, 120),
    sectors: asStringArray(ai?.sectors, 6, 100),
    capabilities: asStringArray(ai?.capabilities, 8, 120),
    strengths: asStringArray(ai?.strengths, 5, 160),
    gaps: Array.isArray(row.gaps)
      ? row.gaps
        .map((gap) => cleanText(asRecord(gap)?.gap ?? gap, 180))
        .filter((gap): gap is string => Boolean(gap))
        .slice(0, 5)
      : [],
    evidence: {
      final_url: cleanText(crawledData?.finalUrl, 500),
      render_method: cleanText(crawledData?.renderMethod, 40),
      thin_content: Boolean(crawledData?.isThinContent),
    },
  };
}

function missingInputs(args: BuildServiceContextArgs, pipeline: PipelineContextRow | null, assessment: JsonRecord | null): string[] {
  const intake = args.intake ?? {};
  const missing: string[] = [];
  const sourceUrl = cleanText(args.tenderUrl, 1000) ?? cleanText(pipeline?.source_url, 1000) ?? cleanText(pipeline?.manual_source_url, 1000);
  const isBidNoBid = args.serviceSlug === "bid-no-bid";
  const hasSourceContext = Boolean(sourceUrl) || (isBidNoBid && hasTenderDocument(intake));

  if (args.pipelineItemId && !pipeline) missing.push("pipeline item could not be loaded for this user");
  if (!args.pipelineItemId) missing.push("selected dashboard pipeline item");
  if (!hasSourceContext) missing.push(isBidNoBid ? "primary tender source URL or uploaded TOR/RFP" : "primary tender or roster source URL");
  if (pipeline && !pipeline.match_reasons) missing.push("saved dashboard match reasons");
  if (pipeline && !pipeline.tender_deadline) missing.push("deadline");
  if (!assessment) missing.push("linked company assessment profile");
  if (pipeline?.has_broken_link) missing.push("working source link");

  if (isBidNoBid && !hasTenderRequirementContext(intake, pipeline)) {
    missing.push("eligibility/evaluation criteria or TOR excerpt");
  }
  if ((args.serviceSlug === "proposal" || args.serviceSlug === "proposal-draft") && !hasUploadedDocument(intake) && !hasIntakeText(intake, ["tender_context", "package_notes", "additional_details"])) {
    missing.push("TOR/RFP package");
  }
  if ((args.serviceSlug === "lta-roster" || args.serviceSlug === "roster-fast-track") && !hasIntakeText(intake, ["target_agency"])) {
    missing.push("target roster or agency");
  }
  if ((args.serviceSlug === "lta-roster" || args.serviceSlug === "roster-fast-track") && !hasIntakeText(intake, ["target_category", "additional_details"])) {
    missing.push("target product/service category");
  }

  return [...new Set(missing)];
}

function qualityScore(args: BuildServiceContextArgs, pipeline: PipelineContextRow | null, assessment: JsonRecord | null, missing: string[]): number {
  const intake = args.intake ?? {};
  const isBidNoBid = args.serviceSlug === "bid-no-bid";
  const hasSourceContext = Boolean(
    cleanText(args.tenderUrl, 1000)
      ?? cleanText(pipeline?.source_url, 1000)
      ?? cleanText(pipeline?.manual_source_url, 1000),
  ) || (isBidNoBid && hasTenderDocument(intake));
  let score = 4;
  if (pipeline) score += 1.5;
  if (hasSourceContext) score += 1;
  if (pipeline?.match_reasons || (pipeline?.fit_score ?? 0) > 0) score += 1;
  if (assessment) score += 1;
  if (hasUploadedDocument(intake) || hasIntakeText(intake, ["tender_context", "additional_details", "target_agency", "target_category"])) score += 1;
  if (isBidNoBid && hasTenderRequirementContext(intake, pipeline)) score += 0.7;
  if (pipeline?.has_broken_link) score -= 1.5;
  if (missing.length >= 3) score -= 1;
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

export async function buildServiceContextPacket(args: BuildServiceContextArgs): Promise<JsonRecord> {
  const pipeline = await loadPipelineContext(args.userId, args.pipelineItemId ?? null);
  const pipelineHasAssessment = Boolean(pipeline?.company_name || pipeline?.ai_analysis || pipeline?.readiness_score != null);
  const fallbackAssessment = pipelineHasAssessment ? null : await loadLatestAssessment(args.userEmail);
  const assessment = assessmentContext(pipelineHasAssessment ? pipeline : fallbackAssessment);
  const documents = await uploadedDocumentContexts(args.userId, args.intake);
  const missing = missingInputs(args, pipeline, assessment);
  const score = qualityScore(args, pipeline, assessment, missing);
  const sourceUrl = cleanText(args.tenderUrl, 1000) ?? cleanText(pipeline?.source_url, 1000) ?? cleanText(pipeline?.manual_source_url, 1000);
  const match = matchContext(pipeline?.match_reasons, pipeline?.fit_score ?? null);
  const matchSummary = asStringArray(match.summary, 4, 220);
  const isBidNoBid = args.serviceSlug === "bid-no-bid";
  const evidencePack = buildServiceEvidencePack({
    serviceSlug: args.serviceSlug,
    intake: args.intake,
    tenderSourceAvailable: Boolean(sourceUrl),
    targetAgency: cleanText(args.intake?.target_agency, 220) ?? cleanText(args.agency, 200) ?? cleanText(pipeline?.tender_agency, 200),
    targetCategory: cleanText(args.intake?.target_category, 220),
    contextText: [
      args.tenderTitle,
      args.agency,
      pipeline?.tender_title,
      pipeline?.tender_agency,
      pipeline?.opportunity_type,
      pipeline?.tender_sector,
      pipeline?.eligibility_summary,
      pipeline?.required_registrations,
      args.intake?.additional_details,
      args.intake?.tender_context,
    ].filter(Boolean).join(" "),
  });

  return {
    version: PACKET_VERSION,
    created_at: new Date().toISOString(),
    service_slug: cleanText(args.serviceSlug, 80),
    source: pipeline ? "dashboard_pipeline" : "manual_or_checkout",
    tender: {
      pipeline_item_id: pipeline?.id ?? args.pipelineItemId ?? null,
      pipeline_item_found: Boolean(pipeline),
      tender_id: pipeline?.tender_id ?? null,
      reference_id: cleanText(pipeline?.reference_id, 120),
      title: cleanText(args.tenderTitle, 500) ?? cleanText(pipeline?.tender_title, 500),
      agency: cleanText(args.agency, 200) ?? cleanText(pipeline?.tender_agency, 200),
      source_url: sourceUrl,
      source_name: cleanText(pipeline?.source_name, 200),
      deadline: cleanText(pipeline?.tender_deadline, 80),
      value: cleanText(pipeline?.tender_value, 120) ?? cleanText(pipeline?.estimated_value, 120),
      sector: cleanText(pipeline?.tender_sector, 120),
      country: cleanText(pipeline?.tender_country, 120),
      region: cleanText(pipeline?.tender_region, 120),
      opportunity_type: cleanText(pipeline?.opportunity_type, 80),
      stage: cleanText(pipeline?.stage, 40),
      eligibility_summary: cleanText(pipeline?.eligibility_summary, 500),
      required_registrations: cleanText(pipeline?.required_registrations, 300),
      has_broken_link: Boolean(pipeline?.has_broken_link),
    },
    match,
    assessment,
    documents,
    evidence_pack: evidencePack,
    input_coverage: {
      has_pipeline_item: Boolean(pipeline),
      has_source_url: Boolean(sourceUrl),
      has_tender_source_context: Boolean(sourceUrl) || (isBidNoBid && hasTenderDocument(args.intake)),
      has_match_reasons: matchSummary.length > 0,
      has_assessment: Boolean(assessment),
      has_uploaded_document: hasUploadedDocument(args.intake),
      has_uploaded_tender_document: hasTenderDocument(args.intake),
      has_extracted_document_text: documents.some((doc) => doc.extraction_status === "extracted" && cleanText(doc.text_excerpt, 20)),
      has_pipeline_eligibility_summary: Boolean(cleanText(pipeline?.eligibility_summary, 80)),
      has_bid_requirements_context: isBidNoBid ? hasTenderRequirementContext(args.intake, pipeline) : null,
      has_user_requirements: hasIntakeText(args.intake, [
        "tender_context",
        "additional_details",
        "target_agency",
        "target_category",
        "package_notes",
        "requirement_eligibility",
        "requirement_scope",
        "requirement_documents",
        "requirement_evaluation",
        "requirement_submission",
      ]),
      has_service_evidence_pack: evidencePack.satisfied_keys.length > 0,
    },
    missing_inputs: missing,
    context_quality: {
      score_0_10: score,
      status: score >= 8 && missing.length <= 1 ? "ready" : score >= 5.5 ? "needs_review" : "blocked",
      reason: missing.length
        ? `Missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "..." : ""}`
        : "Core assessment, match, and source context available.",
    },
  };
}

export function mergeServiceContextIntoIntake(intake: JsonRecord | null | undefined, packet: JsonRecord): JsonRecord {
  return {
    ...(intake ?? {}),
    service_context: packet,
  };
}

export function serviceContextFromIntake(intake: JsonRecord | null | undefined): JsonRecord | null {
  return asRecord(intake?.service_context);
}

export function formatServiceContextForPrompt(intake: JsonRecord | null | undefined): string {
  const context = serviceContextFromIntake(intake);
  if (!context) return "";

  const tender = asRecord(context.tender);
  const match = asRecord(context.match);
  const assessment = asRecord(context.assessment);
  const quality = asRecord(context.context_quality);
  const documents = Array.isArray(context.documents)
    ? context.documents.map(asRecord).filter((doc): doc is JsonRecord => Boolean(doc))
    : [];
  const missing = asStringArray(context.missing_inputs, 6, 160);
  const evidencePack = asRecord(context.evidence_pack);
  const extractedDocs = documents.filter((doc) => doc.extraction_status === "extracted" && cleanText(doc.text_excerpt, 20));
  const evidenceRequirements = Array.isArray(evidencePack?.requirements)
    ? evidencePack.requirements.map(asRecord).filter((item): item is JsonRecord => Boolean(item))
    : [];
  const missingEvidence = evidenceRequirements
    .filter((item) => item.satisfied !== true && item.required === true)
    .map((item) => cleanText(item.label, 160))
    .filter((item): item is string => Boolean(item));

  const lines = [
    "TenderPath saved service context:",
    `Context quality: ${cleanText(quality?.status, 40) ?? "unknown"}${quality?.score_0_10 != null ? ` (${quality.score_0_10}/10)` : ""}`,
    tender?.title ? `Selected opportunity: ${cleanText(tender.title, 500)}` : null,
    tender?.agency ? `Agency: ${cleanText(tender.agency, 200)}` : null,
    tender?.source_url ? `Source URL: ${cleanText(tender.source_url, 1000)}` : null,
    tender?.deadline ? `Deadline: ${cleanText(tender.deadline, 80)}` : null,
    match?.fit_score != null ? `Dashboard fit score: ${match.fit_score}` : null,
    asStringArray(match?.summary, 4, 220).length ? `Match reasons: ${asStringArray(match?.summary, 4, 220).join(" | ")}` : null,
    asStringArray(match?.caveats, 3, 220).length ? `Match caveats: ${asStringArray(match?.caveats, 3, 220).join(" | ")}` : null,
    assessment?.company_name ? `Company profile: ${cleanText(assessment.company_name, 255)}` : null,
    assessment?.readiness_score != null ? `Readiness score: ${assessment.readiness_score}` : null,
    asStringArray(assessment?.capabilities, 6, 120).length ? `Capabilities: ${asStringArray(assessment?.capabilities, 6, 120).join(", ")}` : null,
    evidencePack
      ? `Evidence pack: ${cleanText(evidencePack.status, 40) ?? "unknown"}${evidencePack.score_0_10 != null ? ` (${evidencePack.score_0_10}/10)` : ""}`
      : null,
    missingEvidence.length ? `Missing proof evidence: ${missingEvidence.slice(0, 6).join(" | ")}` : null,
    extractedDocs.length ? `Uploaded document excerpts:\n${extractedDocs.map((doc) => [
      `File: ${cleanText(doc.file_name, 255) ?? "uploaded document"} (${cleanText(doc.kind, 80) ?? "document"})`,
      cleanText(doc.text_excerpt, 2500),
    ].filter(Boolean).join("\n")).join("\n\n")}` : null,
    documents.some((doc) => doc.extraction_status && doc.extraction_status !== "extracted")
      ? `Document extraction caveats: ${documents
        .filter((doc) => doc.extraction_status !== "extracted")
        .map((doc) => `${cleanText(doc.file_name, 160) ?? "uploaded document"}: ${cleanText(doc.extraction_status, 60) ?? "unknown"}${doc.error ? ` (${cleanText(doc.error, 180)})` : ""}`)
        .join(" | ")}`
      : null,
    missing.length ? `Missing inputs: ${missing.join(" | ")}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function formatServiceDocumentsForTenderText(intake: JsonRecord | null | undefined): string {
  const context = serviceContextFromIntake(intake);
  if (!context) return "";
  const documents = Array.isArray(context.documents)
    ? context.documents.map(asRecord).filter((doc): doc is JsonRecord => Boolean(doc))
    : [];
  const extractedDocs = documents.filter((doc) => {
    const kind = cleanText(doc.kind, 80);
    return kind !== "financial"
      && kind !== "evidence_pack:financial_capacity"
      && doc.extraction_status === "extracted"
      && cleanText(doc.text_excerpt, 20);
  });
  if (!extractedDocs.length) return "";

  return [
    "UPLOADED TENDER / REQUIREMENTS DOCUMENT EXCERPTS:",
    ...extractedDocs.map((doc) => [
      `File: ${cleanText(doc.file_name, 255) ?? "uploaded document"}`,
      cleanText(doc.text_excerpt, 12_000),
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}

export async function ensureWorkOrderServiceContext(workOrderId: number, userId: number): Promise<void> {
  const rows = await sql`
    SELECT id, user_id, email, plan, service_slug, pipeline_item_id, tender_title, agency, tender_url, intake
    FROM work_orders
    WHERE id = ${workOrderId}
    LIMIT 1
  ` as unknown as Array<{
    id: number;
    user_id: number | null;
    email: string | null;
    plan: string | null;
    service_slug: string | null;
    pipeline_item_id: number | null;
    tender_title: string | null;
    agency: string | null;
    tender_url: string | null;
    intake: JsonRecord | null;
  }>;
  const order = rows[0];
  if (!order) {
    console.warn("[tp:service_context:work_order_not_found]", { workOrderId, userId });
    return;
  }

  const intake = asRecord(order.intake) ?? {};
  if (serviceContextFromIntake(intake)) return;
  const contextUserId = order.user_id ?? userId;

  const packet = await buildServiceContextPacket({
    userId: contextUserId,
    userEmail: order.email,
    serviceSlug: order.service_slug ?? order.plan,
    pipelineItemId: order.pipeline_item_id,
    tenderTitle: order.tender_title,
    agency: order.agency,
    tenderUrl: order.tender_url,
    intake,
  });
  const nextIntake = JSON.stringify(mergeServiceContextIntoIntake(intake, packet));

  await sql`
    UPDATE work_orders
    SET intake = ${nextIntake}::jsonb,
        updated_at = NOW()
    WHERE id = ${workOrderId}
  `;
}
