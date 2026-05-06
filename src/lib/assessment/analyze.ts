import Anthropic from "@anthropic-ai/sdk";
import type { CrawledData, AIAnalysis, Gap, TierSlug } from "@/lib/types";

type IndustryClassification = {
  detected_industry: string;
  sectors: string[];
  services: string[];
};

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```json?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function buildCompanyContext(
  crawledData: CrawledData | null,
  description: string,
  countries: string[],
  orgType?: string,
  devThemes?: string[]
): string {
  let ctx = `Company Description: ${description}\n`;
  ctx += `Target Countries: ${countries.join(", ")}\n`;
  if (orgType) ctx += `Organisation Type: ${orgType}\n`;
  if (devThemes?.length) ctx += `Development Themes: ${devThemes.join(", ")}\n`;

  if (crawledData) {
    if (crawledData.title) ctx += `Website Title: ${crawledData.title}\n`;
    if (crawledData.metaDescription)
      ctx += `Website Meta: ${crawledData.metaDescription}\n`;
    if (crawledData.ogDescription)
      ctx += `OG Description: ${crawledData.ogDescription}\n`;
    if (crawledData.content)
      ctx += `\nWebsite Content:\n${crawledData.content}\n`;
    if (crawledData.isThinContent) {
      if (crawledData.renderMethod === "parked") {
        ctx += `\nNote: Website appears to be a parked or for-sale domain — no company content available. Rely entirely on the company description above.\n`;
      } else if (crawledData.renderMethod === "failed") {
        ctx += `\nNote: Website could not be crawled (domain redirect, login wall, or browser render failure) — rely primarily on the company description above.\n`;
      } else if (crawledData.renderMethod === "browser") {
        ctx += `\nNote: Website required browser rendering — content may still be incomplete.\n`;
      } else {
        ctx += `\nNote: Website has thin/minimal content — likely SPA or placeholder site.\n`;
      }
    }
  }

  return ctx;
}

function hasAnySignal(text: string, signals: string[]): boolean {
  return signals.some((signal) => text.includes(signal));
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function addUnique(items: string[], additions: string[]): string[] {
  const seen = new Set(items.map((item) => item.toLowerCase()));
  const out = [...items];
  for (const item of additions) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      out.push(item);
      seen.add(key);
    }
  }
  return out;
}

/**
 * Deterministic correction layer for common LLM over-classification.
 *
 * Procurement pages use words like "solutions", "management", and "services"
 * for concrete trades. Without a guard, the model can drift toward
 * "consulting" even when the evidence says warehousing, transport, security,
 * or facility operations. Keep this narrow and evidence-driven.
 */
function applyConcreteIndustryGuards(
  classification: IndustryClassification,
  context: string,
): IndustryClassification {
  const text = [
    context,
    ...classification.services,
  ].join(" ").toLowerCase();

  const logisticsSignals = [
    "warehouse", "warehousing", "supply chain", "logistics",
    "freight", "transport services", "transportation services",
    "distribution services", "last-mile", "last mile",
    "cargo", "fleet", "food packaging", "food distribution",
  ];
  const itSignals = [
    /\b(information technology|ict|it services?|software|saas|platform|systems integration|network solutions?|cybersecurity|data systems?|digital transformation|erp|cloud|managed services?|telecom|telecommunications)\b/i,
  ];
  const researchConsultingSignals = [
    /\b(monitoring and evaluation|monitoring, evaluation|m&e|research consultants?|research and consultancy|policy research|impact evaluation|survey research|data collection|analytics|development consulting|technical assistance|capacity building)\b/i,
  ];
  const engineeringSignals = [
    /\b(engineering|civil engineering|design supervision|construction supervision|geoscience|laboratory services|water engineering|power engineering)\b/i,
  ];
  const securitySignals = [
    "security service", "security services", "guard", "guarding",
    "surveillance", "crowd management", "event security",
    "operational safety", "access control",
  ];
  const facilitySignals = [
    "janitorial", "maintenance", "facility management", "waste management",
    "cleaning service", "catering",
  ];

  const hasIt = hasAnyPattern(text, itSignals);
  const hasResearchConsulting = hasAnyPattern(text, researchConsultingSignals);
  const hasEngineering = hasAnyPattern(text, engineeringSignals);
  const hasLogistics = hasAnySignal(text, logisticsSignals);
  const hasSecurity = hasAnySignal(text, securitySignals);
  const hasFacility = hasAnySignal(text, facilitySignals);

  if (!hasIt && !hasResearchConsulting && !hasEngineering && !hasLogistics && !hasSecurity && !hasFacility) return classification;

  const sectors = addUnique(classification.sectors, [
    ...(hasIt ? ["Information Technology"] : []),
    ...(hasResearchConsulting ? ["Consulting Services", "Research & Evaluation", "Technical Assistance"] : []),
    ...(hasEngineering ? ["Engineering Services"] : []),
    ...(hasLogistics ? ["Logistics & Supply Chain", "Warehousing & Distribution"] : []),
    ...(hasSecurity ? ["Security Services"] : []),
    ...(hasFacility ? ["Facility Management"] : []),
  ]);

  const detected_industry =
    hasIt ? "it"
    : hasResearchConsulting ? "consulting"
    : hasEngineering ? "engineering"
    : hasLogistics ? "logistics"
    : hasSecurity ? "security"
    : hasFacility ? "facilities"
    : classification.detected_industry;

  return {
    ...classification,
    detected_industry,
    sectors,
  };
}

function applyBroadProfileGuards(
  classification: IndustryClassification,
  context: string,
  orgType?: string,
  devThemes?: string[],
): IndustryClassification {
  const contextText = context.toLowerCase();
  const text = [
    context,
    orgType ?? "",
    ...(devThemes ?? []),
    classification.detected_industry,
    ...classification.sectors,
    ...classification.services,
  ].join(" ").toLowerCase();

  const broadSignals = [
    "consulting", "consultancy", "advisory", "technical assistance",
    "monitoring", "evaluation", "research", "strategy", "facilitation",
    "capacity building", "training", "needs assessment", "impact assessment",
    "humanitarian", "development", "livelihood", "livelihoods",
    "early recovery", "protection", "education", "food security",
    "cccm", "camp coordination", "community stabilization",
    "private sector development", "enterprise development", "access to finance",
  ];
  const concreteTradeSignals = [
    "commodity trading", "agri-processor", "agricultural commodity",
    "warehousing", "freight", "transport", "transportation", "food aid",
    "supply chain management", "supply and delivery", "construction",
    "engineering", "software", "platform", "translation", "interpretation",
    "localization",
  ];
  const directSecuritySignals = [
    "guard service", "guarding", "armed security", "security guards",
    "surveillance", "access control", "protective service",
  ];

  const isNgo = ["ngo", "non-profit", "nonprofit", "civil-society"].includes((orgType ?? "").toLowerCase());
  const hasBroadSignal = hasAnySignal(text, broadSignals);
  const hasConcreteTrade = hasAnySignal(contextText, concreteTradeSignals);
  const hasDirectSecurity = hasAnySignal(contextText, directSecuritySignals);
  const hasManyProgramAreas = (devThemes?.length ?? 0) >= 3 || classification.sectors.length >= 4;
  const hasEducationDelivery = hasAnyPattern(text, [
    /\b(education programme|education program|school|teacher|curriculum|e-learning|learning platform|vocational training|skills training provider|training provider)\b/i,
  ]);
  const coreConsulting = hasAnySignal(text, [
    "consulting firm", "consultancy firm", "development consulting",
    "boutique consulting", "advisory services", "evaluation center",
    "research and evaluation", "monitoring evaluation",
  ]);

  if (!hasBroadSignal || hasConcreteTrade) return classification;

  const baseSectors = isNgo && !hasConcreteTrade
    ? classification.sectors.filter((sector) => {
        const s = sector.toLowerCase();
        return !s.includes("logistics")
          && !s.includes("warehousing")
          && !s.includes("security service");
      })
    : classification.sectors;

  const sectors = addUnique(baseSectors, [
    ...(coreConsulting || !isNgo ? ["Consulting Services", "Research & Evaluation", "Technical Assistance"] : []),
    ...((isNgo || hasEducationDelivery) && hasAnySignal(text, ["capacity building", "training"]) ? ["Education & Training"] : []),
    ...(hasAnySignal(text, ["livelihood", "livelihoods", "enterprise development", "private sector development", "access to finance"]) ? ["Economic Development"] : []),
    ...(hasAnySignal(text, ["food security"]) ? ["Food Security"] : []),
    ...(hasAnySignal(text, ["protection", "cccm", "camp coordination", "humanitarian"]) ? ["Humanitarian Response"] : []),
  ]);

  let detected_industry = classification.detected_industry;
  if (coreConsulting) {
    detected_industry = "consulting";
  } else if (isNgo && hasManyProgramAreas) {
    // "Protection" and broad programme delivery are humanitarian evidence,
    // not proof that the organization sells security or logistics services.
    // Use consulting as the broadest available procurement identity unless
    // the raw profile explicitly says it provides a concrete trade.
    if (detected_industry === "security") {
      detected_industry = hasDirectSecurity ? "security" : "consulting";
    } else if ((detected_industry === "logistics" || detected_industry === "") && !hasConcreteTrade) {
      detected_industry = "consulting";
    }
  } else if (!isNgo && hasManyProgramAreas && detected_industry === "") {
    detected_industry = "consulting";
  }

  return {
    ...classification,
    detected_industry,
    sectors,
  };
}

/**
 * Stage 1: Classify the company's industry and extract initial sector/services.
 */
export async function classifyIndustry(
  crawledData: CrawledData | null,
  description: string,
  countries: string[],
  orgType?: string,
  devThemes?: string[],
): Promise<IndustryClassification> {
  const client = getClient();
  const context = buildCompanyContext(crawledData, description, countries, orgType, devThemes);

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: `Classify this company's PRIMARY industry for UN/international development procurement matching.

${context}

Return a JSON object with exactly these fields:
- "detected_industry": PRIMARY industry — one of: it, education, healthcare, logistics, construction, consulting, food, security, language_services, engineering, environment, agriculture, water_sanitation, energy
- "sectors": array of relevant UN procurement sectors (e.g. "Information Technology", "Healthcare", "Construction", "Logistics & Supply Chain"). Include ONLY sectors the company directly operates in — do NOT add "Consulting Services", "Technical Assistance", "Advisory", or "Project Management" as a generic add-on. Those belong only to companies whose core trade is providing consulting/advisory itself.
- "services": array of specific services the company offers

CRITICAL classification rules:
- A warehousing / freight / supply-chain / transport / storage company is "logistics", NOT "consulting". Even if their website mentions "solutions" or "services" or "expertise".
- A translation / interpretation / editorial / subtitling / localization company is "language_services", NOT "consulting".
- A software / SaaS / platform / digital-product company is "it", NOT "consulting".
- Use "consulting" for development consulting, M&E, research, strategy, facilitation, technical assistance, capacity-building advisory, and broad multi-sector professional-service firms.
- For NGOs and humanitarian organizations, do not convert "protection" or "community safety" programme language into "security" unless the organization clearly sells guarding, surveillance, access-control, or protective services. Keep multiple programme areas in "sectors" so matching can remain broad.
- If unsure, pick the concrete trade (logistics, it, education, etc.) over "consulting". DO NOT default to "consulting" when website content is thin or ambiguous — pick the closest concrete industry from any available signal (company description, countries, services listed).

Return ONLY valid JSON, no explanation.`,
      },
    ],
  });

  const text =
    msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  // NB: parse-failure fallback is intentionally NOT "consulting" — that was
  // poisoning the Consultancy filter for every company whose classification
  // JSON happened to fail parsing. Use empty string so userIsConsulting stays
  // false and the Consultancy/individual-role guards keep firing.
  const parsed = safeParseJSON<IndustryClassification>(text, {
    detected_industry: "",
    sectors: [],
    services: [],
  });

  return applyBroadProfileGuards(
    applyConcreteIndustryGuards(parsed, context),
    context,
    orgType,
    devThemes,
  );
}

/**
 * Stage 2: Full readiness analysis with gap identification and scoring.
 */
export async function fullAnalysis(
  crawledData: CrawledData | null,
  description: string,
  countries: string[],
  classification: IndustryClassification,
  orgType?: string,
  devThemes?: string[]
): Promise<AIAnalysis> {
  const client = getClient();
  const context = buildCompanyContext(
    crawledData,
    description,
    countries,
    orgType,
    devThemes
  );

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    temperature: 0.3,
    messages: [
      {
        role: "user",
        content: `You are a UN procurement readiness analyst with deep expertise in UNGM vendor registration, UNDP procurement processes, and international development contracting.

Analyze this company for UN vendor eligibility and tender readiness.

${context}

Already classified as: ${JSON.stringify(classification)}

Return a JSON object with exactly these fields:
- "capabilities": array of key capabilities relevant to UN procurement
- "certifications_detected": array of certifications, registrations, or compliance standards found (ISO, UNGM, etc.)
- "company_size_signal": one of "micro", "small", "medium", "large" — inferred from website/description
- "strengths": array of strengths for UN procurement participation
- "gaps": array of objects, each with:
  - "gap": description of the gap
  - "severity": "high", "medium", or "low"
  - "fix": one-line recommendation
  - "action_steps": array of 2-4 concrete action steps
  - "upsell_tier": one of "tender-intelligence", "submission-package", "strategic-partnership"
- "readiness_dimensions": object with scores 0-100 for each:
  - "technical_capability": ability to deliver the work
  - "compliance_readiness": registration, certifications, policies
  - "financial_stability": evidence of financial capacity
  - "geographic_reach": presence in target countries/regions
  - "experience_relevance": track record with similar projects
- "overall_score": weighted average (technical 25%, compliance 25%, financial 20%, geographic 15%, experience 15%)
- "summary": 2-3 sentence executive assessment

Be rigorous. Most first-time applicants score 30-50. Only score above 70 if there is strong evidence of UN experience, relevant certifications, and established operations in target countries. Identify at least 3 gaps for any company scoring below 60.

Return ONLY valid JSON, no explanation.`,
      },
    ],
  });

  const text =
    msg.content[0]?.type === "text" ? msg.content[0].text : "{}";

  const defaultAnalysis: AIAnalysis = {
    detected_industry: classification.detected_industry,
    sectors: classification.sectors,
    services: classification.services,
    capabilities: [],
    certifications_detected: [],
    company_size_signal: "small",
    strengths: [],
    gaps: [],
    readiness_dimensions: {
      technical_capability: 30,
      compliance_readiness: 20,
      financial_stability: 25,
      geographic_reach: 20,
      experience_relevance: 20,
    },
    overall_score: 24,
    summary: "Unable to complete full analysis.",
  };

  const parsed = safeParseJSON<Partial<AIAnalysis>>(text, {});

  const guardedClassification = applyBroadProfileGuards(
    applyConcreteIndustryGuards(classification, context),
    context,
    orgType,
    devThemes,
  );

  // Merge analysis fields, but keep Stage 1 company identity authoritative.
  // The full-readiness prompt evaluates readiness; it must not reclassify a
  // logistics/warehouse/security company back into generic consulting.
  return {
    ...defaultAnalysis,
    ...parsed,
    detected_industry: guardedClassification.detected_industry,
    sectors: guardedClassification.sectors,
    services: guardedClassification.services,
    // Validate gaps have correct upsell_tier
    gaps: (parsed.gaps ?? []).map((g: Partial<Gap>) => ({
      gap: g.gap ?? "Unknown gap",
      severity: (["high", "medium", "low"].includes(g.severity ?? "")
        ? g.severity
        : "medium") as Gap["severity"],
      fix: g.fix ?? "Consult with a specialist",
      action_steps: g.action_steps ?? [],
      upsell_tier: (
        [
          "tender-intelligence",
          "submission-package",
          "strategic-partnership",
        ].includes(g.upsell_tier ?? "")
          ? g.upsell_tier
          : "submission-package"
      ) as TierSlug,
    })),
  };
}

type CompanyProfileExtras = {
  orgType: string | null;
  operatingCountries: string[];
  submissionLanguage: string | null;
};

export async function inferProfileExtras(
  crawledData: CrawledData | null,
  description: string,
): Promise<CompanyProfileExtras> {
  const client = getClient();
  const context = buildCompanyContext(crawledData, description, []);
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    temperature: 0.1,
    messages: [{
      role: "user",
      content: `Extract company profile details from the following information.

${context}

Return a JSON object with exactly these fields:
- "orgType": one of "company", "ngo", "sole-trader", "government", or null if unclear
- "operatingCountries": array of up to 8 standard English country names where the company operates or targets
- "submissionLanguage": the most likely proposal/bid submission language — one of "English", "French", "Arabic", "Spanish", "Russian", "Portuguese", or null if unclear

Return ONLY valid JSON, no explanation.`,
    }],
  });
  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  return safeParseJSON<CompanyProfileExtras>(text, {
    orgType: null,
    operatingCountries: [],
    submissionLanguage: null,
  });
}

/**
 * Determine the recommended subscription tier based on gaps and score.
 * >=2 high-severity gaps → strategic-partnership
 * Score <50 → submission-package
 * Otherwise → tender-intelligence
 */
export function determineRecommendedTier(
  gaps: Gap[],
  overallScore: number,
  intent?: string
): TierSlug {
  if (intent === "track-tenders" || intent === "evaluate-tender") return "tender-intelligence";
  if (intent === "prepare-proposal") return "submission-package";
  if (intent === "register-roster") return "strategic-partnership";

  const highGaps = gaps.filter((g) => g.severity === "high").length;
  if (overallScore >= 60) return "tender-intelligence";
  if (overallScore >= 40) return "submission-package";
  if (highGaps <= 1) return "submission-package";
  return "strategic-partnership";
}
