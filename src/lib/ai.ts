import OpenAI from "openai";
import type { CrawledData, AIAnalysis, Gap } from "./types";

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  });
}

function safeParseJSON<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function buildCompanyContext(
  crawledData: CrawledData | null,
  description: string,
  countries: string[]
): string {
  let context = `Company Description: ${description}\n`;
  context += `Target Countries: ${countries.join(", ")}\n`;

  if (crawledData) {
    if (crawledData.title) context += `Website Title: ${crawledData.title}\n`;
    if (crawledData.metaDescription)
      context += `Website Description: ${crawledData.metaDescription}\n`;
    if (crawledData.content)
      context += `Website Content:\n${crawledData.content}\n`;
    if (crawledData.isThinContent)
      context += `Note: Website has thin content (SPA or minimal).\n`;
  }

  return context;
}

export async function classifyIndustry(
  crawledData: CrawledData | null,
  description: string,
  countries: string[]
): Promise<{ detected_industry: string; sectors: string[]; services: string[] }> {
  const openai = getClient();
  const context = buildCompanyContext(crawledData, description, countries);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `Analyze the following company information and classify their industry for UN procurement matching.

${context}

Return JSON with:
- detected_industry: primary industry (one of: it, education, healthcare, logistics, construction, consulting, food, security, language_services)
- sectors: array of relevant UN procurement sectors
- services: array of specific services offered

Return only valid JSON.`,
      },
    ],
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  return safeParseJSON(text, {
    detected_industry: "consulting",
    sectors: [],
    services: [],
  });
}

export async function fullAnalysis(
  crawledData: CrawledData | null,
  description: string,
  countries: string[],
  classification: { detected_industry: string; sectors: string[]; services: string[] }
): Promise<AIAnalysis> {
  const openai = getClient();
  const context = buildCompanyContext(crawledData, description, countries);

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: `You are a UN procurement readiness analyst. Analyze this company for UN vendor eligibility.

${context}

Already classified as: ${JSON.stringify(classification)}

Return JSON with:
- capabilities: array of key capabilities
- certifications_detected: array of certifications found
- company_size_signal: "micro", "small", "medium", or "large"
- strengths: array of strengths for UN procurement
- gaps: array of objects { gap, severity (high/medium/low), fix, action_steps[], upsell_tier }
  - upsell_tier must be one of: "tender-intelligence", "submission-package", "strategic-partnership"
- readiness_dimensions: { technical_capability: 0-100, compliance_readiness: 0-100, geographic_reach: 0-100, experience_relevance: 0-100 }
- overall_score: 0-100 weighted average
- summary: 2-3 sentence assessment summary

Return only valid JSON.`,
      },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const text = response.choices[0]?.message?.content ?? "{}";
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
      compliance_readiness: 30,
      geographic_reach: 30,
      experience_relevance: 30,
    },
    overall_score: 30,
    summary: "Unable to complete full analysis.",
  };

  return safeParseJSON(text, defaultAnalysis);
}

export function determineRecommendedTier(
  gaps: Gap[],
  overallScore: number
): string {
  const highSeverityGaps = gaps.filter((g) => g.severity === "high").length;
  if (highSeverityGaps >= 2) return "strategic-partnership";
  if (overallScore < 50) return "submission-package";
  return "tender-intelligence";
}

export function computeGrantReadinessScore(
  orgType: string | null,
  analysis: AIAnalysis,
  devThemes: string[]
): number {
  const dims = analysis.readiness_dimensions;
  const impactMethodology = Math.min(
    100,
    dims.experience_relevance * 0.6 + dims.technical_capability * 0.4
  );
  const mAndE = Math.min(100, dims.compliance_readiness * 0.7 + dims.technical_capability * 0.3);
  const grantMgmt = dims.compliance_readiness;
  const orgCapacity = dims.technical_capability;

  let score =
    impactMethodology * 0.35 +
    mAndE * 0.25 +
    grantMgmt * 0.2 +
    orgCapacity * 0.2;

  if (orgType === "NGO") score = Math.min(100, score + 5);
  if (devThemes.length > 2) score = Math.min(100, score + 3);

  return Math.round(score);
}
