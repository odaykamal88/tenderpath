import type {
  BidDocumentChecklist,
  BidEligibilityAction,
  BidNoBidOutput,
  BidRequirement,
  CommercialTerm,
  TenderRequirements,
  TenderTypeCode,
  TenderTypeSummary,
} from "./types";
import type { ProposalRequirementModel } from "@/lib/proposal-package/types";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
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

function inferTenderType(text: string, extractedType?: string | null): TenderTypeSummary {
  const candidates: Array<{
    code: TenderTypeCode;
    label: string;
    effort_level: TenderTypeSummary["effort_level"];
    guidance: string;
    pattern: RegExp;
  }> = [
    {
      code: "rfq",
      label: "RFQ",
      effort_level: "low",
      guidance: "Usually price-led. Confirm technical compliance quickly, then focus on quote structure, delivery terms, and mandatory documents.",
      pattern: /\b(rfq|request for quotation|request for quotations|quotation)\b/i,
    },
    {
      code: "itb",
      label: "ITB",
      effort_level: "medium",
      guidance: "Usually compliance-led. Treat mandatory eligibility, bid security, delivery schedule, and administrative forms as pass/fail.",
      pattern: /\b(itb|invitation to bid|invitation for bids?)\b/i,
    },
    {
      code: "rfp",
      label: "RFP",
      effort_level: "high",
      guidance: "Usually narrative and scoring-led. Budget time for methodology, staffing, evidence, financial proposal, and compliance matrix.",
      pattern: /\b(rfp|request for proposal|request for proposals)\b/i,
    },
    {
      code: "eoi",
      label: "EOI",
      effort_level: "medium",
      guidance: "Usually a shortlisting step. Prioritize eligibility proof, relevant references, and a concise capability narrative.",
      pattern: /\b(eoi|expression of interest|expressions of interest|request for expression)\b/i,
    },
    {
      code: "lta",
      label: "LTA",
      effort_level: "high",
      guidance: "Long-term arrangements reward operational proof, pricing discipline, and repeat-delivery capacity. Check renewal and volume terms closely.",
      pattern: /\b(lta|long[- ]term agreement|long[- ]term arrangement|framework agreement)\b/i,
    },
    {
      code: "roster",
      label: "Roster",
      effort_level: "medium",
      guidance: "Roster calls are qualification-led. Focus on registrations, references, categories, and profile completeness before drafting.",
      pattern: /\b(roster|vendor roster|supplier roster|prequalification|pre-qualification)\b/i,
    },
  ];

  for (const candidate of candidates) {
    const match = candidate.pattern.exec(`${extractedType ?? ""}\n${text}`);
    if (!match) continue;
    return {
      code: candidate.code,
      label: candidate.label,
      effort_level: candidate.effort_level,
      guidance: candidate.guidance,
      evidence: match[0],
    };
  }

  return {
    code: "unknown",
    label: "Unknown tender type",
    effort_level: "unknown",
    guidance: "Confirm the opportunity type before committing proposal time; document burden and pricing risk differ sharply between RFQ, ITB, RFP, EOI, roster, and LTA calls.",
    evidence: null,
  };
}

function toBidRequirement(requirement: string, priority: "mandatory" | "recommended"): BidRequirement {
  return {
    document: requirement,
    why_needed:
      priority === "mandatory"
        ? "Mandatory submission item or eligibility proof; missing it can make the bid non-responsive."
        : "Useful supporting evidence; include it if available or if it strengthens the technical narrative.",
    estimated_effort_hours: priority === "mandatory" ? 1 : 0.5,
  };
}

function buildDocumentChecklist(
  output: BidNoBidOutput,
  model: ProposalRequirementModel,
): BidDocumentChecklist {
  const modelDocs = model.items.filter((item) => item.category === "document");
  const mandatory = unique([
    ...modelDocs.filter((item) => item.priority === "mandatory").map((item) => item.requirement),
    ...output.required_documents.map((doc) => doc.document),
  ]).slice(0, 12);
  const recommended = unique([
    ...modelDocs.filter((item) => item.priority !== "mandatory").map((item) => item.requirement),
  ]).filter((doc) => !mandatory.some((m) => m.toLowerCase() === doc.toLowerCase())).slice(0, 8);

  return {
    mandatory: mandatory.map((doc) => toBidRequirement(doc, "mandatory")),
    recommended: recommended.map((doc) => toBidRequirement(doc, "recommended")),
  };
}

function eligibilityActionFor(requirement: string): BidEligibilityAction {
  const text = requirement.toLowerCase();
  if (/\b(manufacturer|authori[sz]ation|authorized distributor|authorised distributor|dealer letter|reseller)\b/.test(text)) {
    return {
      requirement,
      action: "supplier_authorization",
      label: "Get supplier authorization",
      rationale: "This reads like a manufacturer, distributor, or reseller proof requirement. Do not bid until the authorization path is clear.",
      severity: "high",
    };
  }
  if (/\b(joint venture|\bjv\b|consortium|local partner|local presence|registered in country|national partner)\b/.test(text)) {
    return {
      requirement,
      action: "jv_partner",
      label: "Bring in a JV/local partner",
      rationale: "The eligibility language points to local presence or partner coverage as the likely unlock.",
      severity: "high",
    };
  }
  if (/\b(subcontract|sub-contract|specialist subcontractor)\b/.test(text)) {
    return {
      requirement,
      action: "subcontract",
      label: "Line up a subcontractor",
      rationale: "This requirement can likely be covered by a named specialist subcontractor if the tender allows it.",
      severity: "medium",
    };
  }
  if (/\b(turnover|revenue|audited|financial statement|bank reference|similar contracts?|past performance|years of experience|license|licence|certification|certificate)\b/.test(text)) {
    return {
      requirement,
      action: "collect_proof",
      label: "Collect proof before bidding",
      rationale: "This is likely pass/fail evidence. Confirm the document exists before spending proposal time.",
      severity: "medium",
    };
  }
  if (/\b(eligible|eligibility|mandatory|must|shall|required)\b/.test(text)) {
    return {
      requirement,
      action: "clarify_with_buyer",
      label: "Clarify eligibility",
      rationale: "The requirement appears mandatory but does not point to one obvious fix. Confirm interpretation before deciding.",
      severity: "medium",
    };
  }
  return {
    requirement,
    action: "collect_proof",
    label: "Collect proof before bidding",
    rationale: "Treat this as eligibility evidence until verified.",
    severity: "low",
  };
}

function buildEligibilityActions(model: ProposalRequirementModel, output: BidNoBidOutput): BidEligibilityAction[] {
  const fromModel = model.items
    .filter((item) => item.category === "eligibility")
    .map((item) => eligibilityActionFor(item.requirement));

  const fromGaps = output.gap_analysis
    .filter((gap) => gap.severity === "high" || /\b(eligib|certif|license|licence|authori[sz]|turnover|financial|partner|jv|subcontract)\b/i.test(gap.gap))
    .map((gap) => eligibilityActionFor(`${gap.gap}: ${gap.fix}`));

  const byRequirement = new Map<string, BidEligibilityAction>();
  for (const action of [...fromModel, ...fromGaps]) {
    const key = action.requirement.toLowerCase();
    if (!byRequirement.has(key)) byRequirement.set(key, action);
  }
  return [...byRequirement.values()].slice(0, 6);
}

function nearbyPhrase(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match || match.index == null) return null;
  const start = Math.max(0, match.index - 80);
  const end = Math.min(text.length, match.index + 180);
  return clean(text.slice(start, end)).slice(0, 240);
}

function term(label: string, value: string | null, risk: CommercialTerm["risk"], note: string): CommercialTerm | null {
  if (!value) return null;
  return { label, value, risk, note };
}

function buildCommercialTerms(requirements: TenderRequirements, tenderText: string): CommercialTerm[] {
  const text = clean([
    tenderText,
    ...requirements.key_constraints,
    ...(requirements.commercial_terms ?? []),
  ].join("\n"));
  const terms = [
    term(
      "Bid security",
      nearbyPhrase(text, /\b(bid security|bid bond|tender security)\b[^.\n;]*/i),
      "high",
      "Pass/fail commercial requirement. Confirm amount, validity, issuing bank, and format.",
    ),
    term(
      "Performance security",
      nearbyPhrase(text, /\b(performance (bond|security|guarantee)|performance guarantee)\b[^.\n;]*/i),
      "high",
      "Can tie up cash or bank lines. Check percentage, duration, and release conditions.",
    ),
    term(
      "Payment terms",
      nearbyPhrase(text, /\b(payment terms?|paid within|payment shall|invoice|advance payment)\b[^.\n;]*/i),
      "medium",
      "Affects working capital. Confirm whether milestone, advance, or post-delivery payment applies.",
    ),
    term(
      "Retention",
      nearbyPhrase(text, /\b(retention|retainage)\b[^.\n;]*/i),
      "medium",
      "Retention reduces cash received during delivery. Confirm percentage and release trigger.",
    ),
    term(
      "Bid validity",
      nearbyPhrase(text, /\b(bid validity|proposal validity|valid for)\b[^.\n;]*/i),
      "medium",
      "Long validity can lock pricing and currency assumptions.",
    ),
    term(
      "Completion period",
      nearbyPhrase(text, /\b(completion period|delivery period|implementation period|contract duration|within \d+ (days|weeks|months))\b[^.\n;]*/i),
      "medium",
      "Check whether the timeline is realistic for staffing, shipping, permits, or mobilization.",
    ),
    term(
      "Currency",
      nearbyPhrase(text, /\b(currency|usd|eur|gbp|xaf|kes|jod|egp|aed|sar)\b[^.\n;]*/i),
      "medium",
      "Confirm pricing currency and FX exposure before quoting.",
    ),
  ].filter((item): item is CommercialTerm => Boolean(item));

  const seen = new Set<string>();
  return terms.filter((item) => {
    const key = `${item.label}:${item.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 7);
}

export function enrichBidNoBidOutput(args: {
  output: BidNoBidOutput;
  requirements: TenderRequirements;
  requirementModel: ProposalRequirementModel;
  tenderText: string;
}): BidNoBidOutput {
  const documentChecklist = buildDocumentChecklist(args.output, args.requirementModel);
  const commercialTerms = buildCommercialTerms(args.requirements, args.tenderText);
  return {
    ...args.output,
    tender_type: inferTenderType(args.tenderText, args.requirements.tender_type),
    document_checklist: {
      mandatory: args.output.document_checklist?.mandatory?.length
        ? args.output.document_checklist.mandatory
        : documentChecklist.mandatory,
      recommended: args.output.document_checklist?.recommended?.length
        ? args.output.document_checklist.recommended
        : documentChecklist.recommended,
    },
    eligibility_actions: args.output.eligibility_actions?.length
      ? args.output.eligibility_actions
      : buildEligibilityActions(args.requirementModel, args.output),
    commercial_terms: args.output.commercial_terms?.length
      ? args.output.commercial_terms
      : commercialTerms,
  };
}
