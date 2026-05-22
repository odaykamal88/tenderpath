import Anthropic from "@anthropic-ai/sdk";
import {
  type BidNoBidOutput,
  type TenderRequirements,
  type TenderType,
  type EvidenceLabel,
  type DocumentPriority,
  type EligibilityAction,
  type CommercialTerms,
  type ProjectedScore,
  type ProjectedScoreBand,
  type ProjectedScoreCriterion,
  DEFAULT_BID_OUTPUT,
  DEFAULT_COMMERCIAL_TERMS,
  DEFAULT_TENDER_REQUIREMENTS,
} from "./types";

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    // Sprint 18. Bump retries from the SDK default (2) and pin a per-request
    // timeout so a stalled generation can't hold the Vercel function open
    // until maxDuration. The SDK backs off exponentially on 429/5xx between
    // attempts, which absorbs the rate-limit bursts we expect during the
    // marketing blitz.
    _anthropic = new Anthropic({ apiKey: key, maxRetries: 5, timeout: 90_000 });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  // Strategy 1: strip fenced code block, parse what's inside.
  // Strategy 2: locate the first balanced top-level JSON object and parse it.
  // Falls back to the supplied default on failure.
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Locate first balanced top-level JSON object. Tolerates trailing prose.
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
    console.error("[bid-no-bid:json_parse_failed]", {
      preview: text.slice(0, 240),
      tail: text.slice(-160),
      length: text.length,
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
  /**
   * Structured per-document section — fully formatted block from
   * `formatDocumentsForPrompt(loadBidNoBidDocuments(...))`. Empty string
   * when nothing was uploaded or pasted. PR-F (2026-05-21).
   */
  applicantDocumentsContext: string;
  /**
   * Filenames passed in so the LLM can be reminded of the exact strings
   * to use in `applicant_documents_cited`. Same names as the [doc] file:
   * labels in `applicantDocumentsContext`.
   */
  documentFileNames: string[];
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
    // Sprint 8 schema (tender_type, eligibility_findings, commercial_terms,
    // required_documents priority split, evidence_label on findings) typically
    // emits ~3.5k tokens of JSON; the previous 3500 budget was truncating
    // Sonnet mid-string, which made safeParseJSON discard the whole reply
    // and the renderer fall back to the empty default. 6000 leaves headroom.
    max_tokens: 6000,
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

APPLICANT-PROVIDED DOCUMENTS (uploaded or pasted at intake — these are the
primary source of truth; cite them by filename when reasoning):
${inputs.applicantDocumentsContext || "No applicant documents were uploaded or pasted for this analysis."}

Return a Bid/No-Bid analysis as a JSON object with this exact shape:
{
  "recommendation": "bid" | "no-bid" | "conditional",
  "win_probability_band": "<10%" | "10-25%" | "25-50%" | "50-75%" | ">75%",
  "headline": string — one declarative sentence summarising the call (max 160 chars),
  "tender_type": "RFQ" | "ITB" | "RFP" | "EOI" | "EOI-RFP" | "LTA" | "unknown",
  "tender_type_note": string — one line on what this solicitation type means for effort
                                (e.g. "ITB — sealed-bid; lowest compliant wins; price + compliance heavy"),
  "fit_reasoning": string[] — 4-6 bullets explaining alignment between company and tender,
                              citing the company's capabilities or geography specifically,
  "gap_analysis": [
    {
      "gap": string,
      "severity": "high" | "medium" | "low",
      "fix": string,
      "evidence_label": "evidence" | "inference" | "gap" | "unverified"
    }
  ] — 3-5 items. Label each: "evidence" = direct from tender or profile, "inference" = reasoning,
                              "gap" = known absence, "unverified" = applicant claim we cannot confirm,
  "eligibility_findings": [
    {
      "requirement": string — eligibility line being assessed (verbatim or close),
      "status": "met" | "gap" | "unverified",
      "recommended_action": "ok" | "bring_jv_partner" | "subcontract" |
                            "supplier_authorization" | "no_bid" | "verify",
      "rationale": string — one sentence,
      "evidence_label": "evidence" | "inference" | "gap" | "unverified"
    }
  ] — 3-6 items covering every mandatory eligibility line; advise STRUCTURAL responses
       (JV partner / subcontract / supplier authorization) before defaulting to no_bid,
  "required_documents": [
    {
      "document": string,
      "why_needed": string,
      "estimated_effort_hours": number | null,
      "priority": "mandatory" | "recommended"
    }
  ] — 6-12 items. Split into "mandatory" (the tender requires them) and
       "recommended" (improves competitiveness but not strictly required),
  "commercial_terms": {
    "payment_terms": string | null    — e.g. "net 60 from invoice" or null,
    "performance_bond_pct": number | null    — percent, e.g. 10,
    "bid_security_pct": number | null    — percent,
    "advance_payment_pct": number | null    — percent,
    "retention_pct": number | null    — percent,
    "bid_validity_days": number | null,
    "completion_period": string | null    — e.g. "12 months" or "180 days",
    "currency": string | null    — ISO code where possible (USD, EUR, KES, LBP),
    "notes": string[] — escalation clauses, retention release schedule, anything else
                         a vendor would price into the bid
  },
  "effort_estimate_hours": number — total hours from "decision to submit",
  "red_flags": string[] — 0-4 items, e.g. ineligibility, geographic mismatch, unrealistic deadline,
  "conditions_for_bid": string[] — only when recommendation === "conditional",
                                    e.g. "Find a local partner registered in agency Y",
  "next_steps": string[] — 3-5 immediate actions ordered by urgency,
  "evidence": {
    "tender_excerpt": string — up to 240 chars of the most decisive tender text,
    "company_capabilities_matched": string[] — capabilities directly evidenced by the profile,
    "company_capabilities_missing": string[] — capabilities the tender requires but the profile lacks
  },
  "applicant_documents_cited": string[] — list filenames from the
                                          APPLICANT-PROVIDED DOCUMENTS section above
                                          that you directly drew evidence from. Use the EXACT
                                          filename string as shown in the [doc] file: labels.
                                          Empty array if no documents were provided.
                                          Available filenames: ${JSON.stringify(inputs.documentFileNames)},
  "projected_score": {
    "rubric_source": "stated_in_tender" | "inferred_from_text" | "absent",
    "total_points_possible": number | null,
    "total_points_projected": number | null,
    "band": "A" | "B" | "C" | "D" | null,
    "band_label": string | null,
    "caveat": string | null,
    "criteria": [
      {
        "name": string,
        "max_points": number,
        "projected_points": number,
        "rationale": string — one sentence anchored in document or profile evidence,
        "confidence": "high" | "medium" | "low"
      }
    ]
  }
}

Document grounding rules (PR-F):
- When the tender requirements come from a [doc] in APPLICANT-PROVIDED DOCUMENTS labeled
  class:tor / eligibility_criteria / evaluation_criteria, quote or closely paraphrase them
  rather than inventing requirements.
- When fit_reasoning or eligibility_findings claims are backed by a [doc] labeled
  class:capability_statement / cv / compliance / financial / reference_letter, mention the
  source ("Per CV.pdf, ..." or "The capability statement evidences ...") AND list that
  filename in applicant_documents_cited.
- evidence_label="evidence" requires a tender or applicant-document source — do not use it
  for inferences. When the only support is the company profile (not a document), use
  evidence_label="inference".

Projected score rules (PR-G):
- ONLY produce a non-empty rubric when the tender text or a class:tor / class:evaluation_criteria
  [doc] above explicitly states one (point allocations, weights, or scoring bands).
  If the rubric is fully stated, set rubric_source="stated_in_tender".
  If the rubric is implied by prose but not in a clean table (e.g. "the strongest bidder on
  technical excellence will win"), set rubric_source="inferred_from_text" and add a one-line
  caveat starting with "Rubric inferred from prose — verify in tender".
  If neither, set rubric_source="absent", criteria=[], totals=null, band=null. DO NOT invent.
- Each criterion's projected_points must be evidence-anchored — the rationale must cite a
  document filename, a profile fact, or a specific gap. No "8/10 looks good".
- Bands when totals are present:
    A → projected ≥ 80% of total → "Strong bid candidate"
    B → 60-79% → "Competitive — close the listed gaps"
    C → 40-59% → "Borderline — only bid with a structural fix"
    D → < 40% → "Likely no-bid unless eligibility cleared"
- confidence="high" only when the criterion is backed by uploaded applicant docs or
  explicit tender text. confidence="low" when the rationale is mostly inference.

Rules:
- Be specific. Reference the company's actual capabilities, geography, and certifications.
- Do NOT invent facts about the company; if evidence is thin, label findings "inference" or
  "unverified" rather than "evidence".
- Severity high = blocks bid; medium = costs days; low = cosmetic.
- effort_estimate_hours must be realistic for an SME vendor.
- recommendation "bid" only when fit is strong and no high-severity gaps remain.
- recommendation "conditional" only when one specific change unlocks the bid.
- For eligibility_findings: prefer "bring_jv_partner" / "subcontract" / "supplier_authorization"
  over "no_bid" whenever a structural move would unlock the requirement.
- For commercial_terms: extract everything you can find in the tender text; leave fields null
  when the tender does not state them. Do not invent.
- For tender_type_note: keep under 120 chars and make it operationally useful (what the bidder
  should expect in effort and submission style).
- Return ONLY valid JSON. No prose outside the JSON.`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON(text, DEFAULT_BID_OUTPUT);
  return normalize(parsed);
}

const TENDER_TYPES = ["RFQ", "ITB", "RFP", "EOI", "EOI-RFP", "LTA", "unknown"] as const;
const EVIDENCE_LABELS = ["evidence", "inference", "gap", "unverified"] as const;
const DOC_PRIORITIES = ["mandatory", "recommended"] as const;
const ELIGIBILITY_STATUS = ["met", "gap", "unverified"] as const;
const ELIGIBILITY_ACTIONS = [
  "ok",
  "bring_jv_partner",
  "subcontract",
  "supplier_authorization",
  "no_bid",
  "verify",
] as const;

function asEvidenceLabel(v: unknown, fallback: EvidenceLabel = "inference"): EvidenceLabel {
  return EVIDENCE_LABELS.includes(v as EvidenceLabel) ? (v as EvidenceLabel) : fallback;
}

function asNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function normalizeCommercialTerms(raw: unknown): CommercialTerms {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_COMMERCIAL_TERMS };
  const t = raw as Record<string, unknown>;
  const notes = Array.isArray(t.notes)
    ? t.notes.filter((n) => typeof n === "string" && n.trim().length > 0).slice(0, 6) as string[]
    : [];
  return {
    payment_terms: asNullableString(t.payment_terms),
    performance_bond_pct: asNullableNumber(t.performance_bond_pct),
    bid_security_pct: asNullableNumber(t.bid_security_pct),
    advance_payment_pct: asNullableNumber(t.advance_payment_pct),
    retention_pct: asNullableNumber(t.retention_pct),
    bid_validity_days: asNullableNumber(t.bid_validity_days),
    completion_period: asNullableString(t.completion_period),
    currency: asNullableString(t.currency),
    notes,
  };
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
    evidence_label: asEvidenceLabel((g as { evidence_label?: unknown }).evidence_label),
  })).filter((g) => g.gap.trim().length > 0);
  out.required_documents = (out.required_documents ?? []).slice(0, 15).map((d) => ({
    document: String(d.document ?? ""),
    why_needed: String(d.why_needed ?? ""),
    estimated_effort_hours: typeof d.estimated_effort_hours === "number" ? d.estimated_effort_hours : null,
    priority: DOC_PRIORITIES.includes((d as { priority?: DocumentPriority }).priority as DocumentPriority)
      ? (d as { priority?: DocumentPriority }).priority
      : "mandatory",
  })).filter((d) => d.document.trim().length > 0);
  out.red_flags = (out.red_flags ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.conditions_for_bid = (out.conditions_for_bid ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.next_steps = (out.next_steps ?? []).filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 6);
  out.evidence.tender_excerpt = String(out.evidence.tender_excerpt ?? "").slice(0, 320);
  out.evidence.company_capabilities_matched = (out.evidence.company_capabilities_matched ?? []).slice(0, 10);
  out.evidence.company_capabilities_missing = (out.evidence.company_capabilities_missing ?? []).slice(0, 10);
  // PR-F: clamp applicant_documents_cited so a hallucinating model can't
  // pad the list. Defer the "documents_ingested" populate to generate.ts
  // (server-known, not from the LLM).
  out.applicant_documents_cited = Array.isArray(raw.applicant_documents_cited)
    ? raw.applicant_documents_cited
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 12)
    : [];

  // PR-G: projected score normalization. Strict — anything off-shape from
  // the LLM degrades to an "absent" rubric so the UI hides the card
  // rather than rendering hallucinated point totals.
  out.projected_score = normalizeProjectedScore(raw.projected_score);
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

  /* Sprint 8.2 additions */
  out.tender_type = TENDER_TYPES.includes((raw.tender_type as TenderType) ?? "unknown")
    ? (raw.tender_type as TenderType)
    : "unknown";
  out.tender_type_note = asNullableString(raw.tender_type_note);
  if (out.tender_type_note && out.tender_type_note.length > 200) {
    out.tender_type_note = out.tender_type_note.slice(0, 200);
  }
  out.commercial_terms = normalizeCommercialTerms(raw.commercial_terms);
  out.eligibility_findings = (raw.eligibility_findings ?? []).slice(0, 8).map((f) => {
    const requirement = String((f as { requirement?: unknown }).requirement ?? "").trim();
    const rationale = String((f as { rationale?: unknown }).rationale ?? "").trim();
    const status = (f as { status?: unknown }).status;
    const action = (f as { recommended_action?: unknown }).recommended_action;
    return {
      requirement,
      status: ELIGIBILITY_STATUS.includes(status as typeof ELIGIBILITY_STATUS[number])
        ? (status as "met" | "gap" | "unverified")
        : "unverified",
      recommended_action: ELIGIBILITY_ACTIONS.includes(action as EligibilityAction)
        ? (action as EligibilityAction)
        : "verify",
      rationale,
      evidence_label: asEvidenceLabel((f as { evidence_label?: unknown }).evidence_label),
    };
  }).filter((f) => f.requirement.length > 0);

  return out;
}

const PROJECTED_BANDS = ["A", "B", "C", "D"] as const;
const RUBRIC_SOURCES = ["stated_in_tender", "inferred_from_text", "absent"] as const;
const CONFIDENCE = ["high", "medium", "low"] as const;

const ABSENT_SCORE: ProjectedScore = {
  rubric_source: "absent",
  total_points_possible: null,
  total_points_projected: null,
  band: null,
  band_label: null,
  criteria: [],
  caveat: null,
};

/**
 * PR-G normalizer for the projected_score field. Strict — anything that
 * doesn't fit the published schema collapses to ABSENT so the UI hides
 * the card rather than rendering hallucinated point totals.
 */
function normalizeProjectedScore(raw: unknown): ProjectedScore {
  if (!raw || typeof raw !== "object") return { ...ABSENT_SCORE };
  const r = raw as Record<string, unknown>;
  const source = RUBRIC_SOURCES.includes(r.rubric_source as typeof RUBRIC_SOURCES[number])
    ? (r.rubric_source as ProjectedScore["rubric_source"])
    : "absent";

  if (source === "absent") return { ...ABSENT_SCORE };

  const rawCriteria = Array.isArray(r.criteria) ? r.criteria : [];
  const criteria: ProjectedScoreCriterion[] = [];
  for (const item of rawCriteria.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const name = String(c.name ?? "").trim();
    if (!name) continue;
    const max = Number(c.max_points);
    const projected = Number(c.projected_points);
    if (!Number.isFinite(max) || max <= 0) continue;
    const safeProjected = Number.isFinite(projected)
      ? Math.max(0, Math.min(projected, max))
      : 0;
    criteria.push({
      name: name.slice(0, 120),
      max_points: max,
      projected_points: safeProjected,
      rationale: String(c.rationale ?? "").trim().slice(0, 280),
      confidence: CONFIDENCE.includes(c.confidence as typeof CONFIDENCE[number])
        ? (c.confidence as ProjectedScoreCriterion["confidence"])
        : "low",
    });
  }
  // If the model claimed a rubric exists but couldn't enumerate any
  // valid criteria, collapse to absent.
  if (criteria.length === 0) return { ...ABSENT_SCORE };

  // Authoritative totals: prefer model's numbers when they roughly match
  // the per-criterion math; otherwise recompute from the criteria list to
  // protect against arithmetic slip in the model output.
  const computedMax = criteria.reduce((acc, c) => acc + c.max_points, 0);
  const computedProjected = criteria.reduce((acc, c) => acc + c.projected_points, 0);
  const modelMax = Number(r.total_points_possible);
  const modelProjected = Number(r.total_points_projected);
  const totalMax = Number.isFinite(modelMax) && Math.abs(modelMax - computedMax) <= 1
    ? modelMax
    : computedMax;
  const totalProjected = Number.isFinite(modelProjected) && Math.abs(modelProjected - computedProjected) <= 1
    ? modelProjected
    : computedProjected;

  // Band: prefer model's if valid AND consistent with the percentage.
  const pct = totalMax > 0 ? totalProjected / totalMax : 0;
  let band: ProjectedScoreBand;
  if (pct >= 0.8) band = "A";
  else if (pct >= 0.6) band = "B";
  else if (pct >= 0.4) band = "C";
  else band = "D";
  const modelBand = PROJECTED_BANDS.includes(r.band as ProjectedScoreBand)
    ? (r.band as ProjectedScoreBand)
    : null;
  const finalBand: ProjectedScoreBand = modelBand && modelBand === band ? modelBand : band;

  const bandLabels: Record<ProjectedScoreBand, string> = {
    A: "Strong bid candidate",
    B: "Competitive — close the listed gaps",
    C: "Borderline — only bid with a structural fix",
    D: "Likely no-bid unless eligibility cleared",
  };
  const modelLabel = asNullableString(r.band_label);
  const finalLabel = modelLabel ?? bandLabels[finalBand];

  return {
    rubric_source: source,
    total_points_possible: totalMax,
    total_points_projected: totalProjected,
    band: finalBand,
    band_label: finalLabel,
    criteria,
    caveat: source === "inferred_from_text"
      ? (asNullableString(r.caveat) ?? "Rubric inferred from prose — verify in the tender document.")
      : asNullableString(r.caveat),
  };
}
