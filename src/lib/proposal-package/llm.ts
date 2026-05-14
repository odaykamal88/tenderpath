import Anthropic from "@anthropic-ai/sdk";
import {
  type ProposalOutput,
  type RosterOutput,
  type TenderRequirements,
  type ProposalEvidenceProfile,
  DEFAULT_PROPOSAL_OUTPUT,
  DEFAULT_ROSTER_OUTPUT,
  DEFAULT_TENDER_REQUIREMENTS,
} from "./types";
import {
  applyProposalEvidenceGuardrails,
  attachEvidenceProfileToRequirements,
  formatProposalEvidenceProfile,
} from "./evidence";

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T, tag: string): T {
  try {
    const cleaned = text
      .replace(/^```json?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error(`[proposal-package:${tag}:json_parse_failed]`, {
      preview: text.slice(0, 240),
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

export interface GenerationInputs {
  tenderText: string;
  companyContext: string;
  intakeSummary: string;
  rosterAgencyContext?: string;
}

export async function extractTenderRequirements(
  tenderText: string,
  evidenceProfile?: ProposalEvidenceProfile,
): Promise<TenderRequirements> {
  const client = getClient();
  const sourceQuality = evidenceProfile ? formatProposalEvidenceProfile(evidenceProfile) : "";
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `Extract structured requirements from this tender or opportunity.

TENDER/OPPORTUNITY:
${tenderText}

${sourceQuality ? `SOURCE QUALITY CHECK:\n${sourceQuality}\n` : ""}

Return a JSON object with:
- "eligibility_criteria": string[] — who is eligible
- "technical_requirements": string[] — technical/delivery scope
- "required_documents": string[] — documents to submit
- "evaluation_criteria": string[] — how submissions will be scored
- "key_constraints": string[] — budget limits, geography, language, timeline
- "submission_format": string — portal, email, physical, or unknown

Rules:
- Extract only what is present in the tender/source text.
- If a section is not present, return an empty array or "unknown"; do not infer it from generic procurement practice.

Return ONLY valid JSON.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(text, DEFAULT_TENDER_REQUIREMENTS, "tender_requirements");
  return evidenceProfile ? attachEvidenceProfileToRequirements(parsed, evidenceProfile) : parsed;
}

export async function generateProposalDraft(
  inputs: GenerationInputs,
  requirements: TenderRequirements,
  evidenceProfile?: ProposalEvidenceProfile,
): Promise<ProposalOutput> {
  const client = getClient();
  const sourceQuality = evidenceProfile ? formatProposalEvidenceProfile(evidenceProfile) : "";
  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4500,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: `You are a senior proposal writer specialising in UN, donor, and public-sector procurement.
You produce an 80%-complete draft that a senior bid manager can finish in 3-4 hours of review.

COMPANY PROFILE:
${inputs.companyContext}

TENDER REQUIREMENTS (extracted):
${JSON.stringify(requirements, null, 2)}

${sourceQuality ? `SOURCE QUALITY CHECK:\n${sourceQuality}\n` : ""}

TENDER SUMMARY:
${inputs.tenderText}

USER INTAKE NOTES:
${inputs.intakeSummary || "None provided."}

Return a strict-shape JSON object with EXACTLY these keys:
{
  "executive_summary": string — 2-3 paragraph summary opening with company name, sector fit, and key win-themes. Plain prose, no markdown.,
  "technical_approach": string[] — 5-8 paragraphs describing methodology, mobilization, work plan, deliverables, and quality assurance. Each item is a full paragraph.,
  "compliance_checklist": [
    { "requirement": string, "status": "compliant" | "partial" | "needs_action", "evidence_or_action": string }
  ] — 8-15 items mapping each tender requirement to a compliance status and either evidence or a specific action.,
  "required_documents": string[] — complete list of documents to compile (10-20 items),
  "cover_letter_draft": string — full cover letter addressed to the contracting agency. Include date placeholder, salutation, 3 body paragraphs (interest, capability, request for evaluation), and a signature block. Plain prose, no markdown.,
  "financial_template_notes": string[] — guidance on pricing structure, cost line items, taxes/contingency, and pricing strategy (5-10 items),
  "missing_information": string[] — specific gaps the user must fill before submission (e.g. "Confirm DUNS number", "Add 2 reference letters from prior UN clients"),
  "next_steps": string[] — ordered immediate actions to complete submission (4-8 items)
}

Rules:
- Use the company's actual capabilities, geography, and certifications. Reference them by name.
- Do NOT invent facts. If evidence is thin, flag it in missing_information.
- If source quality is "needs_review" or "blocked", produce a conservative draft scaffold and mark uncertain compliance items as "partial" or "needs_action"; do not claim a requirement is compliant without company/source evidence.
- Treat missing evaluation criteria, required documents, submission format, or TOR scope as explicit missing_information.
- Cover letter must be a complete draft — no [bracketed placeholders] except the date and salutation.
- compliance_checklist.status MUST be one of the three exact strings: "compliant", "partial", "needs_action".
- Return ONLY valid JSON, no prose around it.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(text, DEFAULT_PROPOSAL_OUTPUT, "proposal");
  const normalized = normalizeProposal(parsed);
  return evidenceProfile ? applyProposalEvidenceGuardrails(normalized, requirements, evidenceProfile) : normalized;
}

export async function generateRosterPackage(
  inputs: GenerationInputs,
  requirements: TenderRequirements,
): Promise<RosterOutput> {
  const client = getClient();
  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4000,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: `You are a senior procurement advisor specialising in UN-agency vendor rosters and Long-Term Agreements.
You prepare a self-serve roster registration package that the user can submit themselves.

COMPANY PROFILE:
${inputs.companyContext}

TARGET AGENCY / ROSTER:
${inputs.rosterAgencyContext ?? "(none specified — use the user intake)"}

EXTRACTED REQUIREMENTS / SOURCE TEXT:
${JSON.stringify(requirements, null, 2)}

USER INTAKE NOTES:
${inputs.intakeSummary || "None provided."}

Return a strict-shape JSON object with EXACTLY these keys:
{
  "registration_checklist": string[] — 8-15 step-by-step actions the user follows to register, in order.,
  "capability_statement_draft": string — a 3-4 paragraph capability statement tailored to the target agency. Include the company name, primary sector, geographies served, and 2-3 differentiators.,
  "required_documents": string[] — complete list of documents (10-20 items),
  "organization_profile_notes": string[] — guidance on the company's profile fields the agency expects (e.g. UNSPSC codes, NCAGE, financial statements format),
  "cover_letter_draft": string — short cover letter for the registration submission (1-2 paragraphs),
  "submission_guidance": string[] — practical submission tips, common rejection reasons, and portal navigation notes,
  "document_renaming_rules": [
    { "document_type": string, "required_filename": string, "note": string | null }
  ] — 5-12 items. The agency expects specific filenames (e.g. "01_Company_Profile.pdf"). If the agency does not enforce filenames, return an empty array.,
  "missing_information": string[] — specific gaps the user must fill,
  "next_steps": string[] — ordered immediate actions
}

Rules:
- Be specific to the target agency. Reference its actual portal, its actual category codes, its actual submission timing if known.
- Do NOT invent facts about the company; missing details go in missing_information.
- Document filenames in document_renaming_rules should follow the agency's known convention if any.
- Return ONLY valid JSON.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(text, DEFAULT_ROSTER_OUTPUT, "roster");
  return normalizeRoster(parsed);
}

function clampString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function clampStringArray(value: unknown, max: number, perItem = 1200): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((s) => s.trim().slice(0, perItem))
    .slice(0, max);
}

function normalizeProposal(raw: Partial<ProposalOutput>): ProposalOutput {
  const out: ProposalOutput = { ...DEFAULT_PROPOSAL_OUTPUT, ...raw };
  out.executive_summary = clampString(out.executive_summary, 3000);
  out.cover_letter_draft = clampString(out.cover_letter_draft, 4000);
  out.technical_approach = clampStringArray(out.technical_approach, 12, 2500);
  out.required_documents = clampStringArray(out.required_documents, 25, 280);
  out.financial_template_notes = clampStringArray(out.financial_template_notes, 15, 400);
  out.missing_information = clampStringArray(out.missing_information, 12, 400);
  out.next_steps = clampStringArray(out.next_steps, 12, 400);
  out.compliance_checklist = Array.isArray(out.compliance_checklist)
    ? out.compliance_checklist
        .slice(0, 20)
        .map((c) => ({
          requirement: clampString(c.requirement, 400),
          status: (["compliant", "partial", "needs_action"] as const).includes(c.status) ? c.status : "needs_action",
          evidence_or_action: clampString(c.evidence_or_action, 600),
        }))
        .filter((c) => c.requirement.length > 0)
    : [];
  return out;
}

function normalizeRoster(raw: Partial<RosterOutput>): RosterOutput {
  const out: RosterOutput = { ...DEFAULT_ROSTER_OUTPUT, ...raw };
  out.capability_statement_draft = clampString(out.capability_statement_draft, 4000);
  out.cover_letter_draft = clampString(out.cover_letter_draft, 3000);
  out.registration_checklist = clampStringArray(out.registration_checklist, 20, 400);
  out.required_documents = clampStringArray(out.required_documents, 25, 280);
  out.organization_profile_notes = clampStringArray(out.organization_profile_notes, 15, 400);
  out.submission_guidance = clampStringArray(out.submission_guidance, 15, 400);
  out.missing_information = clampStringArray(out.missing_information, 12, 400);
  out.next_steps = clampStringArray(out.next_steps, 12, 400);
  out.document_renaming_rules = Array.isArray(out.document_renaming_rules)
    ? out.document_renaming_rules
        .slice(0, 20)
        .map((r) => ({
          document_type: clampString(r.document_type, 200),
          required_filename: clampString(r.required_filename, 200),
          note: r.note == null ? null : clampString(r.note, 400) || null,
        }))
        .filter((r) => r.document_type.length > 0 && r.required_filename.length > 0)
    : [];
  return out;
}
