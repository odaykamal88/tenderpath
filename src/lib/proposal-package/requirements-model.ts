import type {
  ComplianceItem,
  ProposalEvidenceProfile,
  ProposalOutput,
  ProposalRequirementCategory,
  ProposalRequirementCategoryCounts,
  ProposalRequirementItem,
  ProposalRequirementModel,
  ProposalRequirementPriority,
  TenderRequirements,
} from "./types";

const CATEGORIES: ProposalRequirementCategory[] = [
  "eligibility",
  "technical",
  "document",
  "evaluation",
  "submission",
  "financial",
  "constraint",
];

const CORE_CATEGORIES: ProposalRequirementCategory[] = [
  "eligibility",
  "technical",
  "document",
  "evaluation",
  "submission",
];

const STOPWORDS = new Set([
  "about",
  "after",
  "against",
  "also",
  "and",
  "are",
  "authority",
  "before",
  "bid",
  "bidder",
  "bidders",
  "can",
  "contract",
  "contracting",
  "each",
  "for",
  "from",
  "have",
  "include",
  "including",
  "into",
  "must",
  "not",
  "offer",
  "proposal",
  "provide",
  "required",
  "requirements",
  "shall",
  "should",
  "submission",
  "submit",
  "tender",
  "that",
  "the",
  "their",
  "this",
  "will",
  "with",
]);

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

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, Number(value.toFixed(1))));
}

function emptyCategoryCounts(): ProposalRequirementCategoryCounts {
  return {
    eligibility: 0,
    technical: 0,
    document: 0,
    evaluation: 0,
    submission: 0,
    financial: 0,
    constraint: 0,
  };
}

function words(value: string): string[] {
  return clean(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

function stableRequirementKey(value: string): string {
  return words(value).slice(0, 10).join(" ");
}

function requirementOverlap(a: string, b: string): number {
  const aWords = new Set(words(a));
  const bWords = new Set(words(b));
  if (!aWords.size || !bWords.size) return 0;
  let hits = 0;
  for (const word of aWords) {
    if (bWords.has(word)) hits++;
  }
  return hits / Math.min(aWords.size, bWords.size);
}

function isSimilarRequirement(a: string, b: string): boolean {
  const aKey = stableRequirementKey(a);
  const bKey = stableRequirementKey(b);
  return aKey === bKey || aKey.includes(bKey) || bKey.includes(aKey) || requirementOverlap(a, b) >= 0.58;
}

function priorityFor(category: ProposalRequirementCategory, requirement: string): ProposalRequirementPriority {
  const text = requirement.toLowerCase();
  if (/\b(points?|score|scoring|weighted?|weighting|percent|%)\b/.test(text)) return "weighted";
  if (category === "evaluation") return "weighted";
  if (/\b(mandatory|required|must|shall|eligible|eligibility|deadline|no later than|submit|provide)\b/.test(text)) {
    return "mandatory";
  }
  if (category === "eligibility" || category === "document" || category === "submission") return "mandatory";
  if (category === "technical" || category === "constraint" || category === "financial") return "recommended";
  return "unknown";
}

function responseSectionFor(category: ProposalRequirementCategory): string {
  switch (category) {
    case "eligibility":
      return "Eligibility response and supporting documents";
    case "technical":
      return "Technical approach";
    case "document":
      return "Required documents checklist";
    case "evaluation":
      return "Win themes and evaluation mapping";
    case "submission":
      return "Submission instructions";
    case "financial":
      return "Financial proposal template";
    case "constraint":
      return "Compliance caveats";
  }
}

function defaultStatusFor(
  category: ProposalRequirementCategory,
  profile?: ProposalEvidenceProfile,
): ComplianceItem["status"] {
  if (!profile || profile.status === "blocked") return "needs_action";
  if (category === "document" || category === "eligibility" || category === "financial") return "needs_action";
  return "partial";
}

function defaultActionFor(
  category: ProposalRequirementCategory,
  priority: ProposalRequirementPriority,
  profile?: ProposalEvidenceProfile,
): string {
  if (!profile || profile.status === "blocked") {
    return "Upload or paste the primary TOR/RFP text before this can be treated as submission-ready.";
  }
  const prefix = priority === "mandatory" ? "Mandatory: " : priority === "weighted" ? "Scored: " : "";
  switch (category) {
    case "eligibility":
      return `${prefix}Confirm company evidence, licenses, registrations, references, and any mandatory eligibility proof.`;
    case "technical":
      return `${prefix}Map this into the technical methodology, work plan, deliverables, and quality assurance response.`;
    case "document":
      return `${prefix}Collect the document, check date/signature/format requirements, and place it in the submission pack.`;
    case "evaluation":
      return `${prefix}Tie proposal win themes and proof points directly to this scoring criterion.`;
    case "submission":
      return `${prefix}Verify portal/email format, deadline, language, page limits, and file naming before submission.`;
    case "financial":
      return `${prefix}Mirror this requirement in the financial template and confirm taxes, currency, and assumptions.`;
    case "constraint":
      return `${prefix}Confirm the bid can satisfy this constraint before final sign-off.`;
  }
}

function sourceLabelFor(category: ProposalRequirementCategory): string {
  switch (category) {
    case "eligibility":
      return "extracted eligibility criteria";
    case "technical":
      return "extracted technical requirements";
    case "document":
      return "extracted required documents";
    case "evaluation":
      return "extracted evaluation criteria";
    case "submission":
      return "extracted submission format";
    case "financial":
      return "source-text financial signal";
    case "constraint":
      return "extracted constraints";
  }
}

function candidateChunks(text: string): string[] {
  return unique(
    text
      .replace(/\r/g, "\n")
      .split(/\n+|\. +|; +/)
      .map(clean)
      .filter((line) => line.length >= 28 && line.length <= 360),
  ).slice(0, 180);
}

function evidenceSnippetFor(requirement: string, tenderText: string): string | undefined {
  if (!tenderText.trim()) return undefined;
  const terms = words(requirement).slice(0, 8);
  if (!terms.length) return undefined;
  const chunks = candidateChunks(tenderText);
  let best = "";
  let bestHits = 0;

  for (const chunk of chunks) {
    const lower = chunk.toLowerCase();
    const hits = terms.filter((term) => lower.includes(term)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = chunk;
    }
  }

  if (bestHits < Math.min(2, terms.length)) return undefined;
  return best.slice(0, 360);
}

function inferredCandidates(
  tenderText: string,
  category: ProposalRequirementCategory,
  limit: number,
): string[] {
  const patterns: Record<ProposalRequirementCategory, RegExp> = {
    eligibility: /\b(eligible|eligibility|qualified|minimum qualification|mandatory requirement|vendor shall|bidder shall)\b/i,
    technical: /\b(scope of work|deliverables?|technical requirement|methodology|work plan|services include|terms of reference)\b/i,
    document: /\b(required documents?|documents to submit|certificate|registration|technical proposal|financial proposal|forms?)\b/i,
    evaluation: /\b(evaluation criteria|scoring|weighted?|points?|award criteria|technical score|financial score)\b/i,
    submission: /\b(submit|submission|portal|email|sealed envelope|deadline|closing date|due date|upload)\b/i,
    financial: /\b(financial proposal|price schedule|pricing schedule|budget|commercial proposal|boq|bill of quantities)\b/i,
    constraint: /\b(language|currency|timeline|deadline|geograph|location|budget ceiling|validity period)\b/i,
  };
  return candidateChunks(tenderText)
    .filter((line) => patterns[category].test(line))
    .slice(0, limit);
}

function addRequirement(args: {
  items: ProposalRequirementItem[];
  seen: Set<string>;
  category: ProposalRequirementCategory;
  requirement: string;
  tenderText: string;
  source: ProposalRequirementItem["source"];
  sourceLabel?: string;
  evidenceProfile?: ProposalEvidenceProfile;
}): void {
  const requirement = clean(args.requirement);
  if (!requirement || requirement.length < 8) return;

  const key = stableRequirementKey(requirement);
  if (!key || args.seen.has(key)) return;
  if (args.items.some((item) => isSimilarRequirement(item.requirement, requirement))) return;

  args.seen.add(key);
  const priority = priorityFor(args.category, requirement);
  args.items.push({
    id: `REQ-${String(args.items.length + 1).padStart(2, "0")}`,
    category: args.category,
    priority,
    requirement,
    source: args.source,
    source_label: args.sourceLabel ?? sourceLabelFor(args.category),
    evidence_snippet: evidenceSnippetFor(requirement, args.tenderText),
    response_section: responseSectionFor(args.category),
    status: defaultStatusFor(args.category, args.evidenceProfile),
    evidence_or_action: defaultActionFor(args.category, priority, args.evidenceProfile),
  });
}

export function buildProposalRequirementModel(args: {
  requirements: TenderRequirements;
  tenderText: string;
  evidenceProfile?: ProposalEvidenceProfile;
  maxItems?: number;
}): ProposalRequirementModel {
  const maxItems = args.maxItems ?? 20;
  const items: ProposalRequirementItem[] = [];
  const seen = new Set<string>();
  const add = (
    category: ProposalRequirementCategory,
    requirement: string,
    source: ProposalRequirementItem["source"] = "tender_requirements",
  ) => addRequirement({
    items,
    seen,
    category,
    requirement,
    tenderText: args.tenderText,
    source,
    evidenceProfile: args.evidenceProfile,
  });

  args.requirements.eligibility_criteria.forEach((item) => add("eligibility", item));
  args.requirements.technical_requirements.forEach((item) => add("technical", item));
  args.requirements.evaluation_criteria.forEach((item) => add("evaluation", item));
  if (args.requirements.submission_format && args.requirements.submission_format !== "unknown") {
    add("submission", args.requirements.submission_format);
  }
  args.requirements.required_documents.forEach((item) => add("document", item));
  args.requirements.key_constraints.forEach((item) => add("constraint", item));

  const countsBeforeInference = categoryCounts(items);
  for (const category of CATEGORIES) {
    if (items.length >= maxItems) break;
    const perCategoryLimit = countsBeforeInference[category] === 0 ? 3 : 1;
    for (const candidate of inferredCandidates(args.tenderText, category, perCategoryLimit)) {
      if (items.length >= maxItems) break;
      add(category, candidate, "source_text");
    }
  }

  const finalItems = items.slice(0, maxItems).map((item, index) => ({
    ...item,
    id: `REQ-${String(index + 1).padStart(2, "0")}`,
  }));
  const counts = categoryCounts(finalItems);
  const missingCategories = CORE_CATEGORIES.filter((category) => counts[category] === 0);
  const mandatoryCount = finalItems.filter((item) => item.priority === "mandatory").length;
  const weightedCount = finalItems.filter((item) => item.priority === "weighted").length;
  const snippetCount = finalItems.filter((item) => item.evidence_snippet).length;

  const sourceScore = args.evidenceProfile
    ? args.evidenceProfile.score_0_10
    : args.tenderText.length >= 1800
      ? 6.5
      : args.tenderText.length >= 800
        ? 4.5
        : 2.5;
  const coverageScore = (CORE_CATEGORIES.length - missingCategories.length) / CORE_CATEGORIES.length * 10;
  const densityScore = Math.min(10, finalItems.length * 1.25);
  const snippetScore = finalItems.length ? (snippetCount / finalItems.length) * 10 : 0;
  const score = clampScore(
    0.32 * sourceScore +
      0.38 * coverageScore +
      0.18 * densityScore +
      0.12 * snippetScore -
      Math.max(0, missingCategories.length - 1) * 0.35,
  );

  const warnings = unique([
    finalItems.length === 0 ? "No requirement-level items could be extracted from the TOR/RFP text." : "",
    ...missingCategories.map((category) => `Missing ${category} requirements in the parsed TOR/RFP context.`),
    snippetCount === 0 && finalItems.length > 0 ? "Requirement items lack source snippets, so human verification is required." : "",
    ...(args.evidenceProfile?.warnings ?? []),
  ]);

  const status: ProposalRequirementModel["status"] =
    score >= 8 &&
    finalItems.length >= 8 &&
    !missingCategories.some((category) => category === "technical" || category === "document" || category === "submission")
      ? "ready"
      : score >= 5
        ? "needs_review"
        : "blocked";

  return {
    status,
    score_0_10: score,
    total_requirements: finalItems.length,
    mandatory_count: mandatoryCount,
    weighted_count: weightedCount,
    category_counts: counts,
    missing_categories: missingCategories,
    warnings,
    items: finalItems,
  };
}

function categoryCounts(items: ProposalRequirementItem[]): ProposalRequirementCategoryCounts {
  const counts = emptyCategoryCounts();
  for (const item of items) {
    counts[item.category] += 1;
  }
  return counts;
}

export function formatProposalRequirementModelForPrompt(model: ProposalRequirementModel): string {
  const lines = [
    `Requirement model: ${model.status} (${model.score_0_10}/10), ${model.total_requirements} extracted items, ${model.mandatory_count} mandatory, ${model.weighted_count} weighted.`,
    model.missing_categories.length ? `Missing categories: ${model.missing_categories.join(", ")}` : null,
    model.warnings.length ? `Warnings: ${model.warnings.join(" | ")}` : null,
    "Items:",
    ...model.items.slice(0, 18).map((item) => [
      `- ${item.id} [${item.category}; ${item.priority}; ${item.status}] ${item.requirement}`,
      `  Response section: ${item.response_section}`,
      item.evidence_snippet ? `  Source snippet: ${item.evidence_snippet}` : null,
      `  Required action: ${item.evidence_or_action}`,
    ].filter(Boolean).join("\n")),
  ].filter((line): line is string => Boolean(line));
  return lines.join("\n");
}

export function applyProposalRequirementModelGuardrails(
  output: ProposalOutput,
  model: ProposalRequirementModel,
): ProposalOutput {
  const usedOutputIndexes = new Set<number>();
  const mergedFromModel = model.items.map((item) => {
    const matchedIndex = output.compliance_checklist.findIndex((candidate, index) => (
      !usedOutputIndexes.has(index) && isSimilarRequirement(candidate.requirement, item.requirement)
    ));
    const matched = matchedIndex >= 0 ? output.compliance_checklist[matchedIndex] : null;
    if (matchedIndex >= 0) usedOutputIndexes.add(matchedIndex);

    const status = model.status !== "ready" && matched?.status === "compliant"
      ? "partial"
      : matched?.status ?? item.status;

    return {
      requirement: matched?.requirement || item.requirement,
      status,
      evidence_or_action: matched?.evidence_or_action || item.evidence_or_action,
      category: item.category,
      priority: item.priority,
      source: item.source,
      evidence_snippet: item.evidence_snippet,
      response_section: item.response_section,
    } satisfies ComplianceItem;
  });

  const unmatchedOutputItems = output.compliance_checklist
    .filter((_, index) => !usedOutputIndexes.has(index))
    .slice(0, 4)
    .map((item) => ({
      ...item,
      status: model.status !== "ready" && item.status === "compliant" ? "partial" as const : item.status,
    }));

  const modelMissingInformation = [
    model.status === "ready" ? "" : `Requirement model status is ${model.status}; verify the compliance matrix against the primary TOR/RFP before submission.`,
    ...model.missing_categories.map((category) => `Requirement category missing from parsed TOR/RFP: ${category}.`),
    ...model.warnings,
  ];

  const nextSteps = unique([
    model.status === "ready" ? "" : "Upload or paste the complete TOR/RFP, evaluation criteria, required documents, and submission instructions before final submission.",
    "Review the requirement-level compliance matrix and assign one owner to every needs-action row.",
    ...output.next_steps,
  ]).slice(0, 14);

  return {
    ...output,
    compliance_checklist: [...mergedFromModel, ...unmatchedOutputItems].slice(0, 24),
    missing_information: unique([
      ...modelMissingInformation,
      ...output.missing_information,
    ]).slice(0, 18),
    next_steps: nextSteps,
    requirement_model: model,
  };
}
