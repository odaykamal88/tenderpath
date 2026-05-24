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
    // Sprint 18. See bid-no-bid/llm.ts for the rationale. Per-request timeout
    // is set above the maximum observed Sonnet+12k-token completion (~60s)
    // with headroom for retry exponential backoff.
    _anthropic = new Anthropic({ apiKey: key, maxRetries: 5, timeout: 120_000 });
  }
  return _anthropic;
}

export function safeParseJSON<T>(text: string, fallback: T, tag: string): T {
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
  /** Sprint 14. Compressed catalogue of ALL plausible agencies so the
   *  generator can produce agency_readiness_breakdown — not just the
   *  picked agency. Format: one block per agency with slug/label/why/
   *  required-docs/category-hints. Roster-only. */
  rosterAgencyCatalogue?: string;
  /** Sprint 14. Evidence library summary so the LLM can score per-agency
   *  document_coverage against what the applicant actually has in their
   *  vault. Reuses formatEvidenceLibraryForPrompt from Sprint 10. */
  evidenceLibrarySummary?: string;
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
    {
      "requirement": string,
      "status": "compliant" | "partial" | "needs_action",
      "evidence_or_action": string,
      "priority": "mandatory" | "recommended",
      "evidence_label": "evidence_from_library" | "user_claim" | "inference" | "gap"
    }
  ] — 8-15 items mapping each tender requirement to a compliance status,
       either evidence or a specific action, an administrative priority,
       and a label describing what backs the claim.,
  "required_documents": string[] — complete list of documents to compile (10-20 items),
  "cover_letter_draft": string — full cover letter addressed to the contracting agency. Include date placeholder, salutation, 3 body paragraphs (interest, capability, request for evaluation), and a signature block. Plain prose, no markdown.,
  "financial_template_notes": string[] — guidance on pricing structure, cost line items, taxes/contingency, and pricing strategy (5-10 items, each 1-3 sentences),
  "missing_information": string[] — specific gaps the user must fill before submission (e.g. "Confirm DUNS number", "Add 2 reference letters from prior UN clients"),
  "next_steps": string[] — ordered immediate actions to complete submission (4-8 items)
}

Rules:
- Use the company's actual capabilities, geography, and certifications. Reference them by name.
- Do NOT invent facts. If evidence is thin, flag it in missing_information.
- If source quality is "needs_review" or "blocked", produce a conservative draft scaffold and mark uncertain compliance items as "partial" or "needs_action"; do not claim a requirement is compliant without company/source evidence.
- Treat missing evaluation criteria, required documents, submission format, or TOR scope as explicit missing_information.
- Cover letter must be a complete draft — NO bracketed placeholders of any kind (no [Name], [Email], [PADOR ID], [Date]). The only literal text that should appear in the cover letter is the actual company name, the actual signatory role drawn from the company profile (use "Executive Director" as the default role when the profile does not specify a person), and the literal date string "[DATE]" exactly once at the top. Do not insert placeholders for contact email, phone, registration numbers, or signatory name — if those are absent from the profile, they belong in missing_information, not in the letter.
- The cover letter MUST NOT claim that any capability is "established", "in place", "delivered", or otherwise settled if the corresponding compliance_checklist item is status="needs_action". Phrase such capabilities as "in preparation", "planned", "being established", or describe the bridging mechanism (e.g. "a co-applicant with this expertise is being onboarded"). Read your own compliance_checklist before writing the cover letter and treat its statuses as the source of truth.
- The technical_approach MUST NOT describe capabilities marked needs_action as if they are operational; use the same "in preparation / via partnership" framing as the cover letter.
- Each financial_template_notes item should be 1-3 sentences (under ~800 chars) and stand alone as advice — do not write a single long note that gets truncated.
- compliance_checklist.status MUST be one of the three exact strings: "compliant", "partial", "needs_action".
- If the extracted requirements include "capability_match", use it as the source of truth for compliance_checklist statuses:
  capability_match.status="evidenced" → compliance_checklist.status="compliant" and cite the evidence in evidence_or_action.
  capability_match.status="claimed"   → compliance_checklist.status="partial" with evidence_or_action stating what proof is still needed.
  capability_match.status="missing"   → compliance_checklist.status="needs_action" and put the specific gap in missing_information too.
- compliance_checklist.priority is "mandatory" when failing the requirement causes administrative rejection (eligibility, registration, signed declaration, audited statements floor, mandatory documents list). It is "recommended" when it only affects scoring (methodology depth, M&E rigour, indicators detail, narrative quality). When uncertain, default to "mandatory" if the requirement appears in the tender's eligibility or required-documents lists; otherwise "recommended".
- compliance_checklist.evidence_label maps from capability_match:
  capability_match.status="evidenced" → evidence_label="evidence_from_library" (a vault file was cited).
  capability_match.status="claimed"   → evidence_label="user_claim".
  capability_match.status="missing"   → evidence_label="gap".
  If no capability_match exists for this item, use "inference".
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
    // Sprint 14. Bumped 4000 -> 12000 to accommodate the new
    // agency_readiness_breakdown. First live MEFOSA run hit 8000 and
    // truncated at ~31k chars of output. 12000 matches the
    // Proposal Draft budget (same Sonnet model, similar output shape
    // with the breakdown items pushing roster past 8k). Same class of
    // failure as the Proposal Draft schema expansions in Sprints 8-11.
    max_tokens: 12000,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: `You are a senior procurement advisor specialising in UN-agency vendor rosters and Long-Term Agreements.
You prepare a self-serve roster registration package that the user can submit themselves.

COMPANY PROFILE:
${inputs.companyContext}

APPLICANT EVIDENCE LIBRARY (documents the applicant has already uploaded):
${inputs.evidenceLibrarySummary || "No evidence library available — score document_coverage based on what the COMPANY PROFILE states the applicant has."}

PRIMARY TARGET AGENCY / ROSTER (write the full narrative against this one):
${inputs.rosterAgencyContext ?? "(none specified — use the user intake)"}

ALL PLAUSIBLE AGENCIES (compute agency_readiness_breakdown against ALL of these):
${inputs.rosterAgencyCatalogue ?? "(none provided — return an empty agency_readiness_breakdown)"}

EXTRACTED REQUIREMENTS / SOURCE TEXT:
${JSON.stringify(requirements, null, 2)}

USER INTAKE NOTES:
${inputs.intakeSummary || "None provided."}

Return a strict-shape JSON object with EXACTLY these keys:
{
  "registration_checklist": string[] — 8-15 step-by-step actions the user follows to register WITH THE PRIMARY TARGET AGENCY, in order.,
  "capability_statement_draft": string — a 3-4 paragraph capability statement tailored to the PRIMARY TARGET AGENCY. Include the company name, primary sector, geographies served, and 2-3 differentiators.,
  "required_documents": string[] — complete list of documents required by the PRIMARY TARGET AGENCY (10-20 items),
  "organization_profile_notes": string[] — guidance on the profile fields the PRIMARY TARGET AGENCY expects (e.g. UNSPSC codes, NCAGE, financial statements format),
  "cover_letter_draft": string — short cover letter for the registration submission to the PRIMARY TARGET AGENCY (1-2 paragraphs),
  "submission_guidance": string[] — practical submission tips, common rejection reasons, and portal navigation notes for the PRIMARY TARGET AGENCY,
  "document_renaming_rules": [
    { "document_type": string, "required_filename": string, "note": string | null }
  ] — 5-12 items. Even if the PRIMARY TARGET AGENCY does not publish a strict filename convention, propose a standard UN-friendly numbering convention (e.g. "01_Company_Profile_<COMPANY_LEGAL_NAME>.pdf", "02_Commercial_Registration_<COUNTRY>.pdf", "03_Audited_Financials_<YEAR>.pdf"). Include a note explaining "agency does not enforce filenames — convention follows UN procurement best practice" when applicable. Empty array is only acceptable when the agency uploads via a structured form (not file upload).,
  "missing_information": string[] — specific gaps the user must fill (cross-agency, not just primary),
  "next_steps": string[] — ordered immediate actions,
  "agency_readiness_breakdown": [
    {
      "agency_slug": string — must match a slug from ALL PLAUSIBLE AGENCIES,
      "agency_label": string — must match the label,
      "readiness_0_10": integer 0-10 — average of the three sub-scores, rounded,
      "document_coverage_0_10": integer 0-10 — fraction of the agency's required documents that the applicant can produce TODAY from their evidence library + company profile. 10 = all docs covered; 5 = roughly half; 0 = effectively none.,
      "category_fit_0_10": integer 0-10 — how well the applicant's actual capabilities map onto the agency's procurement categories (categoryHints). A food-safety advisor scores 9-10 on WFP/FAO, 2-3 on UNICEF supply contracts.,
      "geographic_fit_0_10": integer 0-10 — geographic and operational reach alignment. A Lebanon-only vendor scores 7-8 on UNGM (global), 5-6 on FAO (Rome HQ + regional), 4-5 on agencies that route primarily through country offices the applicant has no presence in.,
      "recommendation": "start_here" | "viable" | "blocked" — exactly ONE agency may be "start_here". CRITICAL: "start_here" is awarded purely on the highest composite readiness_0_10 score in the breakdown, NOT on whether the user named that agency as the primary target. If the user's PRIMARY TARGET AGENCY is not the highest-scoring agency, the PRIMARY narrative still targets it (capability_statement, cover_letter, registration_checklist) but the breakdown honestly flags the higher-scoring agency as "start_here" and routes the user there for fastest wins. "viable" means ≥6.0 composite readiness with at most 1-2 missing docs. "blocked" means <6.0 OR ≥3 missing critical docs.,
      "rationale": string — ONE sentence citing specific evidence and specific gaps. e.g. "HACCP cert (HACCP_2024.pdf) + KPMG audit + 3 SIDA references cover 8 of 10 WFP required documents; only fleet capacity statement and humanitarian-response reference are missing.",
      "missing_documents": string[] — specific documents from the agency's requiredDocuments list that the applicant cannot currently produce. Empty array if fully covered.,
      "next_actions": string[] — 1-4 specific, time-boxed actions to lift readiness for THIS agency. e.g. "Obtain HACCP recertification from BSI Lebanon (4-6 weeks, ~$2,400)" not "improve documentation".
    }
  ] — Include EVERY agency from ALL PLAUSIBLE AGENCIES (do not skip any). Order: highest readiness first.
}

Rules:
- The PRIMARY narrative (capability_statement, cover_letter, registration_checklist, etc.) targets ONE agency — the one the user selected or the one with the highest plausible readiness.
- The agency_readiness_breakdown is per-agency, evidence-anchored, and brutally honest. If the applicant has no presence in West Africa, FAO West Africa rosters are blocked, not viable.
- Score document_coverage by mapping the agency's requiredDocuments list against the evidence library + company profile capabilities. Cite specific file names where possible.
- Exactly ONE agency carries "start_here" — typically the PRIMARY TARGET AGENCY if its score is highest, otherwise the highest-scoring agency.
- missing_documents in each breakdown item names ONLY documents from THAT agency's requiredDocuments list, not generic ones.
- Do NOT invent facts about the company; missing details go in missing_information.
- Do NOT invent facts about agencies; rely on the ALL PLAUSIBLE AGENCIES catalogue.
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
  // Sprint 13b. Widened from 400 -> 1200 chars/item. The grader caught
  // financial_template_notes being truncated mid-word on real EU CIM runs
  // because the model often writes 2-3 sentence guidance per note (e.g.
  // "EU grants typically follow pre-financing on contract signature,
  // interim payments on report approval, balance on final report — budget
  // your cashflow accordingly"). The prompt now asks for 1-3 sentences;
  // the clamp follows so a well-formed note doesn't get cut.
  out.financial_template_notes = clampStringArray(out.financial_template_notes, 15, 1200);
  out.missing_information = clampStringArray(out.missing_information, 12, 400);
  out.next_steps = clampStringArray(out.next_steps, 12, 400);
  out.compliance_checklist = Array.isArray(out.compliance_checklist)
    ? out.compliance_checklist
        .slice(0, 20)
        .map((c) => {
          const priority = (["mandatory", "recommended"] as const).includes(c.priority as never)
            ? (c.priority as "mandatory" | "recommended")
            : undefined;
          const label = (["evidence_from_library", "user_claim", "inference", "gap"] as const).includes(c.evidence_label as never)
            ? (c.evidence_label as "evidence_from_library" | "user_claim" | "inference" | "gap")
            : undefined;
          return {
            requirement: clampString(c.requirement, 400),
            status: (["compliant", "partial", "needs_action"] as const).includes(c.status) ? c.status : "needs_action",
            evidence_or_action: clampString(c.evidence_or_action, 600),
            priority,
            evidence_label: label,
          };
        })
        .filter((c) => c.requirement.length > 0)
    : [];
  return out;
}

function clamp010(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, Math.round(v)));
}

function normalizeRoster(raw: Partial<RosterOutput>): RosterOutput {
  const out: RosterOutput = { ...DEFAULT_ROSTER_OUTPUT, ...raw };
  out.capability_statement_draft = clampString(out.capability_statement_draft, 4000);
  out.cover_letter_draft = clampString(out.cover_letter_draft, 3000);
  out.registration_checklist = clampStringArray(out.registration_checklist, 20, 400);
  out.required_documents = clampStringArray(out.required_documents, 25, 280);
  out.organization_profile_notes = clampStringArray(out.organization_profile_notes, 15, 400);
  // Sprint 14. Widened 400 -> 800 chars/item. Sprint 14 grader caught
  // submission_guidance item 0 truncated mid-word at the old 400 clamp
  // ("before investing in a full portal sub"). The prompt now asks for
  // multi-sentence guidance per item so the clamp follows the same
  // pattern as financial_template_notes (Sprint 13b: 400 -> 1200).
  out.submission_guidance = clampStringArray(out.submission_guidance, 15, 800);
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
  // Sprint 14. Per-agency readiness breakdown. Clamp every numeric to
  // 0-10, enforce single "start_here", validate recommendation enum,
  // cap missing_documents/next_actions sizes. Order by readiness desc
  // so the dashboard can render the leaderboard without re-sorting.
  if (Array.isArray(out.agency_readiness_breakdown) && out.agency_readiness_breakdown.length > 0) {
    const VALID_REC = new Set(["start_here", "viable", "blocked"] as const);
    const normalized = out.agency_readiness_breakdown
      .slice(0, 12)
      .map((a) => {
        const recommendation = (typeof a?.recommendation === "string" && VALID_REC.has(a.recommendation as never))
          ? (a.recommendation as "start_here" | "viable" | "blocked")
          : "blocked";
        return {
          agency_slug: clampString(a?.agency_slug, 64),
          agency_label: clampString(a?.agency_label, 120),
          readiness_0_10: clamp010(a?.readiness_0_10),
          document_coverage_0_10: clamp010(a?.document_coverage_0_10),
          category_fit_0_10: clamp010(a?.category_fit_0_10),
          geographic_fit_0_10: clamp010(a?.geographic_fit_0_10),
          recommendation,
          rationale: clampString(a?.rationale, 600),
          missing_documents: clampStringArray(a?.missing_documents, 12, 200),
          next_actions: clampStringArray(a?.next_actions, 6, 400),
        };
      })
      .filter((a) => a.agency_slug.length > 0)
      .sort((a, b) => b.readiness_0_10 - a.readiness_0_10);
    // Enforce single "start_here": demote any extras to "viable".
    let startHereSeen = false;
    for (const a of normalized) {
      if (a.recommendation === "start_here") {
        if (startHereSeen) a.recommendation = "viable";
        else startHereSeen = true;
      }
    }
    out.agency_readiness_breakdown = normalized;
  } else {
    out.agency_readiness_breakdown = [];
  }
  return out;
}
