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
      if (crawledData.renderMethod === "failed") {
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
    classification.detected_industry,
    ...classification.sectors,
    ...classification.services,
  ].join(" ").toLowerCase();

  const logisticsSignals = [
    "warehouse", "warehousing", "storage", "supply chain", "logistics",
    "freight", "transport", "distribution", "last-mile", "last mile",
    "cargo", "fleet", "food packaging", "food distribution",
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

  const hasLogistics = hasAnySignal(text, logisticsSignals);
  const hasSecurity = hasAnySignal(text, securitySignals);
  const hasFacility = hasAnySignal(text, facilitySignals);

  if (!hasLogistics && !hasSecurity && !hasFacility) return classification;

  const sectors = addUnique(classification.sectors, [
    ...(hasLogistics ? ["Logistics & Supply Chain", "Warehousing & Distribution"] : []),
    ...(hasSecurity ? ["Security Services"] : []),
    ...(hasFacility ? ["Facility Management"] : []),
  ]);

  const detected_industry =
    hasLogistics ? "logistics"
    : hasSecurity ? "security"
    : classification.detected_industry === "consulting" ? "logistics"
    : classification.detected_industry;

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
  countries: string[]
): Promise<IndustryClassification> {
  const client = getClient();
  const context = buildCompanyContext(crawledData, description, countries);

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
- Only use "consulting" when the company's primary offering is advisory work itself (management consulting, M&E consulting, policy research, strategy firms, feasibility studies for hire). If unsure, pick the concrete trade (logistics, it, education, etc.) over "consulting". DO NOT default to "consulting" when website content is thin or ambiguous — pick the closest concrete industry from any available signal (company description, countries, services listed).

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

  return applyConcreteIndustryGuards(parsed, context);
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

  const guardedClassification = applyConcreteIndustryGuards(classification, context);

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

/**
 * Determine the recommended subscription tier based on gaps and score.
 * >=2 high-severity gaps → strategic-partnership
 * Score <50 → submission-package
 * Otherwise → tender-intelligence
 */
export function determineRecommendedTier(
  gaps: Gap[],
  overallScore: number
): TierSlug {
  const highGaps = gaps.filter((g) => g.severity === "high").length;
  if (overallScore >= 60) return "tender-intelligence";
  if (overallScore >= 40) return "submission-package";
  if (highGaps <= 1) return "submission-package";
  return "strategic-partnership";
}
