import type { ProposalEvidenceProfile, ProposalOutput, TenderRequirements } from "./types";

const UPLOADED_REQUIREMENTS_MARKER = "UPLOADED TENDER / REQUIREMENTS DOCUMENT EXCERPTS:";
const FINANCIAL_MARKER_RE = /\bfinancial_documents_provided:\s*yes\b/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function sectionLengthAfter(text: string, marker: string): number {
  const idx = text.indexOf(marker);
  if (idx < 0) return 0;
  return text.slice(idx + marker.length).trim().length;
}

function has(pattern: RegExp, text: string): boolean {
  return pattern.test(text);
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = clean(item);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
}

export function buildProposalEvidenceProfile(args: {
  tenderText: string;
  intakeSummary?: string | null;
}): ProposalEvidenceProfile {
  const tenderText = args.tenderText ?? "";
  const intakeSummary = args.intakeSummary ?? "";
  const combined = `${tenderText}\n${intakeSummary}`;
  const lower = combined.toLowerCase();
  const uploadedRequirementChars = sectionLengthAfter(tenderText, UPLOADED_REQUIREMENTS_MARKER);
  const pastedRequirementChars = Math.max(
    0,
    [
      /tender_context:\s*([\s\S]{80,})/i.exec(intakeSummary)?.[1]?.length ?? 0,
      /additional_details:\s*([\s\S]{80,})/i.exec(intakeSummary)?.[1]?.length ?? 0,
      /package_notes:\s*([\s\S]{80,})/i.exec(intakeSummary)?.[1]?.length ?? 0,
    ].reduce((max, len) => Math.max(max, len), 0),
  );

  const signals = {
    has_source_url: has(/\bsource url:\s*https?:\/\/|https?:\/\/\S+/i, combined),
    has_deadline: has(/\b(deadline|closing date|submission deadline|due date)\b/i, lower),
    has_scope_or_deliverables: has(/\b(scope of work|terms of reference|tor\b|deliverables?|objectives?|activities|tasks|methodology|technical requirements?|statement of work|sow\b)\b/i, lower),
    has_eligibility: has(/\b(eligib(?:le|ility)|qualification requirements?|minimum qualifications?|mandatory requirements?|vendor requirements?|bidder requirements?|pre-qualification|prequalification)\b/i, lower),
    has_required_documents: has(/\b(required documents?|documents to submit|submission documents?|forms?|certificates?|audited financial|tax certificate|company registration|technical proposal|financial proposal|cv|curriculum vitae)\b/i, lower),
    has_evaluation_criteria: has(/\b(evaluation criteria|scoring|weighted|points?|technical score|financial score|award criteria|selection criteria|evaluation method|pass\/fail)\b/i, lower),
    has_submission_format: has(/\b(submit|submission|portal|e[- ]?tender|email|hard cop(?:y|ies)|sealed envelope|upload|deadline|bid form|proposal format)\b/i, lower),
    has_financial_context: FINANCIAL_MARKER_RE.test(intakeSummary) || has(/\b(financial proposal|budget|pricing schedule|price schedule|boq|bill of quantities|commercial proposal)\b/i, lower),
  };

  let score = 0;
  if (signals.has_source_url) score += 0.8;
  if (signals.has_deadline) score += 0.9;
  if (tenderText.length >= 800) score += 1.0;
  if (tenderText.length >= 1800) score += 0.8;
  if (uploadedRequirementChars >= 1200 || pastedRequirementChars >= 900) score += 1.7;
  else if (uploadedRequirementChars >= 400 || pastedRequirementChars >= 300) score += 0.8;
  if (signals.has_scope_or_deliverables) score += 1.4;
  if (signals.has_eligibility) score += 1.1;
  if (signals.has_required_documents) score += 1.1;
  if (signals.has_evaluation_criteria) score += 1.1;
  if (signals.has_submission_format) score += 0.8;
  if (signals.has_financial_context) score += 0.4;

  const missing: string[] = [];
  if (!signals.has_source_url) missing.push("source URL or primary tender page");
  if (!signals.has_deadline) missing.push("submission deadline");
  if (!signals.has_scope_or_deliverables) missing.push("scope of work, TOR, deliverables or technical requirements");
  if (!signals.has_eligibility) missing.push("eligibility or mandatory qualification criteria");
  if (!signals.has_required_documents) missing.push("required document list");
  if (!signals.has_evaluation_criteria) missing.push("evaluation criteria or scoring method");
  if (!signals.has_submission_format) missing.push("submission format or portal instructions");

  const warnings: string[] = [];
  if (uploadedRequirementChars === 0 && pastedRequirementChars < 300) {
    warnings.push("No extractable TOR/RFP text or substantial pasted requirements were found.");
  }
  if (tenderText.length < 800) {
    warnings.push("Tender text is thin; proposal content must stay conservative.");
  }
  if (!signals.has_evaluation_criteria) {
    warnings.push("Evaluation criteria are missing, so win themes cannot be mapped to scoring weights.");
  }
  if (!signals.has_required_documents) {
    warnings.push("Required submission documents are not explicit.");
  }

  const finalScore = clampScore(score);
  const status: ProposalEvidenceProfile["status"] =
    finalScore >= 7.5 && signals.has_scope_or_deliverables && signals.has_required_documents
      ? "ready"
      : finalScore >= 4.5
        ? "needs_review"
        : "blocked";

  return {
    status,
    score_0_10: finalScore,
    source_text_chars: tenderText.length,
    uploaded_requirement_chars: uploadedRequirementChars,
    pasted_requirement_chars: pastedRequirementChars,
    signals,
    missing_inputs: missing,
    warnings,
  };
}

export function formatProposalEvidenceProfile(profile: ProposalEvidenceProfile): string {
  return [
    `Source quality: ${profile.status} (${profile.score_0_10}/10)`,
    `Text coverage: ${profile.source_text_chars} chars source; ${profile.uploaded_requirement_chars} chars uploaded requirements; ${profile.pasted_requirement_chars} chars pasted requirements.`,
    `Signals: ${Object.entries(profile.signals).filter(([, ok]) => ok).map(([key]) => key).join(", ") || "none"}`,
    profile.missing_inputs.length ? `Missing inputs: ${profile.missing_inputs.join(" | ")}` : null,
    profile.warnings.length ? `Warnings: ${profile.warnings.join(" | ")}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function attachEvidenceProfileToRequirements(
  requirements: TenderRequirements,
  profile: ProposalEvidenceProfile,
): TenderRequirements {
  return {
    ...requirements,
    source_quality: profile,
  };
}

export function applyProposalEvidenceGuardrails(
  output: ProposalOutput,
  requirements: TenderRequirements,
  profile: ProposalEvidenceProfile,
): ProposalOutput {
  const evidenceActions = profile.missing_inputs.map((input) => `Provide ${input} before final submission.`);
  const warningActions = profile.warnings.map((warning) => `Source warning: ${warning}`);
  const missingInformation = unique([
    ...evidenceActions,
    ...warningActions,
    ...output.missing_information,
  ]).slice(0, 16);

  const requirementRows = [
    ...requirements.eligibility_criteria,
    ...requirements.technical_requirements,
    ...requirements.required_documents,
    ...requirements.evaluation_criteria,
    ...requirements.key_constraints,
  ].filter(Boolean);

  const complianceChecklist = output.compliance_checklist.length > 0
    ? output.compliance_checklist
    : requirementRows.slice(0, 12).map((requirement) => ({
        requirement,
        status: "needs_action" as const,
        evidence_or_action: "Confirm evidence and exact response location before submission.",
      }));

  const normalizedChecklist = complianceChecklist.map((item) => {
    if (profile.status !== "ready" && item.status === "compliant") {
      return {
        ...item,
        status: "partial" as const,
        evidence_or_action: item.evidence_or_action || "Evidence is not complete enough to mark this fully compliant.",
      };
    }
    return item;
  });

  const nextSteps = unique([
    profile.status === "ready" ? "" : "Upload or paste the missing TOR/RFP sections listed in the source-quality warning.",
    ...output.next_steps,
  ]).slice(0, 12);

  return {
    ...output,
    compliance_checklist: normalizedChecklist,
    missing_information: missingInformation,
    next_steps: nextSteps,
    source_quality: profile,
  };
}
