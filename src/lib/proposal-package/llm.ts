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
  // Two strategies. (1) Strip fenced code block and parse what's inside.
  // (2) Walk the text and parse the first balanced top-level JSON object,
  // tolerating trailing prose (Haiku sometimes appends a "Note:" paragraph
  // after the JSON, which the naive replace-based strip cannot handle).
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try { return JSON.parse(candidate.slice(start, i + 1)) as T; } catch { break; }
          }
        }
      }
    }
    console.error(`[proposal-package:${tag}:json_parse_failed]`, {
      preview: text.slice(0, 240),
      tail: text.slice(-160),
      length: text.length,
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

export interface ExtractRequirementsInputs {
  tenderText: string;
  /** Optional. When provided, the extractor cross-checks each high-leverage
   *  requirement against the company profile and populates capability_match
   *  so the generator has a hard signal instead of inferring from prose. */
  companyContext?: string;
  /** Sprint 10. Optional summary of the applicant's evidence library (CVs,
   *  audits, certifications, past performance, etc.) generated via
   *  formatEvidenceLibraryForPrompt(). When supplied, "evidenced" status on
   *  capability_match REQUIRES a matching library item and the citation in
   *  company_evidence MUST reference the library entry verbatim. */
  evidenceLibrarySummary?: string;
}

export async function extractTenderRequirements(
  input: string | ExtractRequirementsInputs,
  evidenceProfile?: ProposalEvidenceProfile,
): Promise<TenderRequirements> {
  // Accept legacy single-string callers for backwards compatibility; new
  // callers should pass {tenderText, companyContext} so Sprint 9 capability
  // cross-checking activates.
  const inputs: ExtractRequirementsInputs =
    typeof input === "string" ? { tenderText: input } : input;
  const { tenderText, companyContext, evidenceLibrarySummary } = inputs;
  const client = getClient();
  const sourceQuality = evidenceProfile ? formatProposalEvidenceProfile(evidenceProfile) : "";
  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: companyContext ? 2500 : 1500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `Extract structured requirements from this tender or opportunity.

TENDER/OPPORTUNITY:
${tenderText}

${companyContext ? `COMPANY PROFILE (for capability cross-check only — do not paraphrase into requirements):\n${companyContext}\n` : ""}
${evidenceLibrarySummary ? `${evidenceLibrarySummary}\n` : ""}
${sourceQuality ? `SOURCE QUALITY CHECK:\n${sourceQuality}\n` : ""}

Return a JSON object with:
- "eligibility_criteria": string[] — who is eligible
- "technical_requirements": string[] — technical/delivery scope
- "required_documents": string[] — documents to submit
- "evaluation_criteria": string[] — how submissions will be scored
- "key_constraints": string[] — budget limits, geography, language, timeline
- "submission_format": string — portal, email, physical, or unknown
${companyContext ? `- "capability_match": [{ "requirement": string, "status": "evidenced" | "claimed" | "missing", "company_evidence": string }]
   — 6-10 items covering the highest-leverage requirements. For each:
     * "evidenced" = a matching item exists in the APPLICANT EVIDENCE LIBRARY${evidenceLibrarySummary ? "" : " (or the company profile contains direct proof if no library is supplied)"}. Cite the library entry by file name in company_evidence.
     * "claimed"   = the applicant claims it (profile or intake) but no library item proves it.
     * "missing"   = nothing in profile, intake, or library addresses this.` : ""}

Rules:
- Extract only what is present in the tender/source text.
- If a section is not present, return an empty array or "unknown"; do not infer it from generic procurement practice.
${companyContext ? `- For capability_match, anchor every "company_evidence" sentence in the profile${evidenceLibrarySummary ? " or library" : ""}. If nothing supports the requirement, status MUST be "missing".
- Do NOT mark a requirement "evidenced" based on the user's intake notes alone — that is "claimed".
${evidenceLibrarySummary ? `- "evidenced" is reserved for requirements where the APPLICANT EVIDENCE LIBRARY contains a matching item. If only the company profile mentions a capability without a library document backing it, use "claimed".` : ""}` : ""}

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
    // Sprint 10: with the evidence library wired in, every compliance item
    // can carry a long evidence_or_action citation, and the model echoes
    // file names. Observed output on the EU CIM call: ~34k chars (>8500
    // tokens). 7500 was still truncating. 12000 leaves comfortable headroom
    // for richer compliance evidence while staying well below Sonnet's 64K
    // output budget. Sprint 8/9 saw the same class of bug — keep monitoring.
    max_tokens: 12000,
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
- If the extracted requirements include "capability_match", use it as the source of truth for compliance_checklist statuses:
  capability_match.status="evidenced" → compliance_checklist.status="compliant" and cite the evidence in evidence_or_action.
  capability_match.status="claimed"   → compliance_checklist.status="partial" with evidence_or_action stating what proof is still needed.
  capability_match.status="missing"   → compliance_checklist.status="needs_action" and put the specific gap in missing_information too.
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
