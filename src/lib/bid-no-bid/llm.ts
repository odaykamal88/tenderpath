import Anthropic from "@anthropic-ai/sdk";
import {
  type BidNoBidOutput,
  type TenderRequirements,
  DEFAULT_BID_OUTPUT,
  DEFAULT_TENDER_REQUIREMENTS,
} from "./types";

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _anthropic = new Anthropic({ apiKey: key });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const cleaned = text
      .replace(/^```json?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned) as T;
  } catch (err) {
    console.error("[bid-no-bid:json_parse_failed]", {
      preview: text.slice(0, 240),
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const SONNET_MODEL = "claude-sonnet-4-6";

export interface BidGenerationInputs {
  tenderText: string;
  companyContext: string;
  intakeSummary: string;
}

export async function extractTenderRequirements(
  tenderText: string,
): Promise<TenderRequirements> {
  const client = getClient();
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

Return a JSON object with:
- "eligibility_criteria": string[] — who is eligible
- "technical_requirements": string[] — technical/delivery scope
- "required_documents": string[] — documents to submit
- "evaluation_criteria": string[] — how submissions will be scored
- "key_constraints": string[] — budget limits, geography, language, timeline
- "submission_format": string — portal, email, physical, or unknown
- "tender_type": string — RFQ, ITB, RFP, EOI, LTA, roster, or unknown
- "commercial_terms": string[] — payment terms, bid security, performance bond, bid validity, retention, advance payment, currency, completion period, or other commercial/pricing constraints found

Return ONLY valid JSON.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  return safeParseJSON(text, DEFAULT_TENDER_REQUIREMENTS);
}

export async function generateBidNoBidAnalysis(
  inputs: BidGenerationInputs,
  requirements: TenderRequirements,
): Promise<BidNoBidOutput> {
  const client = getClient();
  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 3500,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: `You are a senior bid manager for UN procurement, donor contracts, and public-sector tenders.
You produce sharp, founder-grade Bid/No-Bid analyses that protect 30 hours of proposal time.

COMPANY PROFILE:
${inputs.companyContext}

TENDER/OPPORTUNITY (raw):
${inputs.tenderText}

EXTRACTED REQUIREMENTS:
${JSON.stringify(requirements, null, 2)}

USER INTAKE NOTES:
${inputs.intakeSummary || "None provided."}

Return a Bid/No-Bid analysis as a JSON object with this exact shape:
{
  "recommendation": "bid" | "no-bid" | "conditional",
  "win_probability_band": "<10%" | "10-25%" | "25-50%" | "50-75%" | ">75%",
  "headline": string — one declarative sentence summarising the call (max 160 chars),
  "tender_type": {
    "code": "rfq" | "itb" | "rfp" | "eoi" | "lta" | "roster" | "unknown",
    "label": string,
    "effort_level": "low" | "medium" | "high" | "unknown",
    "guidance": string,
    "evidence": string | null
  },
  "fit_reasoning": string[] — 4-6 bullets explaining alignment between company and tender,
                              citing the company's capabilities or geography specifically,
  "gap_analysis": [
    { "gap": string, "severity": "high" | "medium" | "low", "fix": string }
  ] — 3-5 items,
  "required_documents": [
    { "document": string, "why_needed": string, "estimated_effort_hours": number }
  ] — 6-12 items,
  "document_checklist": {
    "mandatory": [{ "document": string, "why_needed": string, "estimated_effort_hours": number }],
    "recommended": [{ "document": string, "why_needed": string, "estimated_effort_hours": number }]
  },
  "eligibility_actions": [
    {
      "requirement": string,
      "action": "collect_proof" | "jv_partner" | "subcontract" | "supplier_authorization" | "clarify_with_buyer" | "no_bid",
      "label": string,
      "rationale": string,
      "severity": "high" | "medium" | "low"
    }
  ],
  "commercial_terms": [
    { "label": string, "value": string, "risk": "low" | "medium" | "high" | "unknown", "note": string }
  ],
  "effort_estimate_hours": number — total hours from "decision to submit",
  "red_flags": string[] — 0-4 items, e.g. ineligibility, geographic mismatch, unrealistic deadline,
  "conditions_for_bid": string[] — only when recommendation === "conditional",
                                    e.g. "Find a local partner registered in agency Y",
  "next_steps": string[] — 3-5 immediate actions ordered by urgency,
  "evidence": {
    "tender_excerpt": string — up to 240 chars of the most decisive tender text,
    "company_capabilities_matched": string[] — capabilities directly evidenced by the profile,
    "company_capabilities_missing": string[] — capabilities the tender requires but the profile lacks
  }
}

Rules:
- Be specific. Reference the company's actual capabilities, geography, and certifications.
- Do NOT invent facts about the company; if evidence is thin, say so in red_flags.
- Severity high = blocks bid; medium = costs days; low = cosmetic.
- Required documents must separate mandatory/pass-fail documents from recommended/supporting documents.
- Eligibility actions must say whether to bid directly, bring in a JV/local partner, subcontract, get supplier authorization, collect proof, clarify, or no-bid.
- Commercial terms must be concrete. If payment terms, bid security, performance bond, bid validity, retention, completion period, or currency are absent, leave them out rather than inventing them.
- effort_estimate_hours must be realistic for an SME vendor.
- recommendation "bid" only when fit is strong and no high-severity gaps remain.
- recommendation "conditional" only when one specific change unlocks the bid.
- Return ONLY valid JSON. No prose outside the JSON.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(text, DEFAULT_BID_OUTPUT);
  return normalize(parsed);
}

function normalize(raw: Partial<BidNoBidOutput>): BidNoBidOutput {
  const out: BidNoBidOutput = {
    ...DEFAULT_BID_OUTPUT,
    ...raw,
    evidence: { ...DEFAULT_BID_OUTPUT.evidence, ...(raw.evidence ?? {}) },
  };
  // Clamp arrays to sensible sizes and types so the PDF and dashboard
  // never have to defend against pathological LLM outputs.
  out.fit_reasoning = (out.fit_reasoning ?? []).filter((s) => typeof s === "string").slice(0, 8);
  out.gap_analysis = (out.gap_analysis ?? []).slice(0, 8).map((g) => ({
    gap: String(g.gap ?? ""),
    severity: (["high", "medium", "low"] as const).includes(g.severity) ? g.severity : "medium",
    fix: String(g.fix ?? ""),
  })).filter((g) => g.gap.trim().length > 0);
  out.required_documents = (out.required_documents ?? []).slice(0, 15).map((d) => ({
    document: String(d.document ?? ""),
    why_needed: String(d.why_needed ?? ""),
    estimated_effort_hours: typeof d.estimated_effort_hours === "number" ? d.estimated_effort_hours : null,
  })).filter((d) => d.document.trim().length > 0);
  out.document_checklist = {
    mandatory: (out.document_checklist?.mandatory ?? []).slice(0, 12).map((d) => ({
      document: String(d.document ?? ""),
      why_needed: String(d.why_needed ?? ""),
      estimated_effort_hours: typeof d.estimated_effort_hours === "number" ? d.estimated_effort_hours : null,
    })).filter((d) => d.document.trim().length > 0),
    recommended: (out.document_checklist?.recommended ?? []).slice(0, 8).map((d) => ({
      document: String(d.document ?? ""),
      why_needed: String(d.why_needed ?? ""),
      estimated_effort_hours: typeof d.estimated_effort_hours === "number" ? d.estimated_effort_hours : null,
    })).filter((d) => d.document.trim().length > 0),
  };
  out.eligibility_actions = (out.eligibility_actions ?? []).slice(0, 8).map((action) => ({
    requirement: String(action.requirement ?? ""),
    action: ([
      "collect_proof",
      "jv_partner",
      "subcontract",
      "supplier_authorization",
      "clarify_with_buyer",
      "no_bid",
    ] as const).includes(action.action) ? action.action : "collect_proof",
    label: String(action.label ?? "Collect proof before bidding"),
    rationale: String(action.rationale ?? ""),
    severity: (["high", "medium", "low"] as const).includes(action.severity) ? action.severity : "medium",
  })).filter((action) => action.requirement.trim().length > 0);
  out.commercial_terms = (out.commercial_terms ?? []).slice(0, 8).map((term) => ({
    label: String(term.label ?? ""),
    value: String(term.value ?? ""),
    risk: (["low", "medium", "high", "unknown"] as const).includes(term.risk) ? term.risk : "unknown",
    note: String(term.note ?? ""),
  })).filter((term) => term.label.trim().length > 0 && term.value.trim().length > 0);
  out.tender_type = {
    ...DEFAULT_BID_OUTPUT.tender_type,
    ...(out.tender_type ?? {}),
    code: (["rfq", "itb", "rfp", "eoi", "lta", "roster", "unknown"] as const).includes(out.tender_type?.code)
      ? out.tender_type.code
      : "unknown",
    effort_level: (["low", "medium", "high", "unknown"] as const).includes(out.tender_type?.effort_level)
      ? out.tender_type.effort_level
      : "unknown",
    evidence: typeof out.tender_type?.evidence === "string" ? out.tender_type.evidence.slice(0, 160) : null,
  };
  out.red_flags = (out.red_flags ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.conditions_for_bid = (out.conditions_for_bid ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.next_steps = (out.next_steps ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.evidence.tender_excerpt = String(out.evidence.tender_excerpt ?? "").slice(0, 320);
  out.evidence.company_capabilities_matched = (out.evidence.company_capabilities_matched ?? []).slice(0, 10);
  out.evidence.company_capabilities_missing = (out.evidence.company_capabilities_missing ?? []).slice(0, 10);
  out.headline = String(out.headline ?? "").slice(0, 200);
  out.effort_estimate_hours = Math.max(0, Math.round(Number(out.effort_estimate_hours ?? 0)));
  if (!(["bid", "no-bid", "conditional"] as const).includes(out.recommendation)) {
    out.recommendation = "conditional";
  }
  if (!([
    "<10%",
    "10-25%",
    "25-50%",
    "50-75%",
    ">75%",
  ] as const).includes(out.win_probability_band)) {
    out.win_probability_band = "10-25%";
  }
  return out;
}
