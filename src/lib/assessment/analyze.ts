import Anthropic from "@anthropic-ai/sdk";
import type { CrawledData, AIAnalysis, Gap, ReadinessDimensions, TierSlug } from "@/lib/types";
import { isComingSoonTier } from "@/lib/pricing";

// While a tier is held back ("coming soon", e.g. Roster/LTA → strategic-
// partnership), never recommend it as the next step — fall back to the best
// available paid tier so the funnel stays actionable.
function availableTier(tier: TierSlug): TierSlug {
  return isComingSoonTier(tier) ? "submission-package" : tier;
}

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
function countStringMatches(text: string, signals: string[]): number {
  let n = 0;
  for (const s of signals) if (text.includes(s)) n += 1;
  return n;
}

function countPatternMatches(text: string, patterns: RegExp[]): number {
  let n = 0;
  for (const re of patterns) if (re.test(text)) n += 1;
  return n;
}

function applyConcreteIndustryGuards(
  classification: IndustryClassification,
  context: string,
): IndustryClassification {
  const text = [
    context,
    ...classification.services,
  ].join(" ").toLowerCase();

  // Concrete physical-trade signals — each entry is a distinct piece of
  // evidence. Counted, not flagged. Order doesn't matter.
  const logisticsSignals = [
    "warehouse", "warehousing", "supply chain", "logistics",
    "freight", "freight forwarding", "transport services", "transportation services",
    "distribution services", "last-mile", "last mile",
    "cargo", "fleet", "food packaging", "food distribution",
    "shipping", "courier", "haulage", "trucking", "drayage",
    "customs clearance", "customs broker", "multimodal", "intermodal",
    "container", "container handling", "sea freight", "air freight",
    "land freight", "ocean freight", "stevedoring",
  ];
  // IT signals — tightened. Dropped the ambiguous catch-alls "platform",
  // "managed services", "telecom", "cloud" which appear on many non-IT
  // company sites (freight forwarders mention "tracking platform", logistics
  // companies say "managed services", anybody can host on "cloud"). Kept
  // unambiguous software-trade terms and explicit IT-reseller patterns.
  const itSignals = [
    /\b(information technology services|ict services?|it services? (provider|firm|company)|software development|software engineering|saas|systems integration|network solutions?|cybersecurity|data systems? services?|digital transformation|erp implementation|cloud (services?|infrastructure|migration))\b/i,
    /\b(software (company|firm|house|vendor|developer)|tech (company|firm|startup)|technology (company|firm)|it firm)\b/i,
    /\b(apple (premium )?reseller|microsoft (gold )?partner|cisco partner|samsung reseller|hardware reseller|ict retailer|it (hardware|equipment) (reseller|supplier|distributor))\b/i,
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

  const counts = {
    logistics: countStringMatches(text, logisticsSignals),
    it: countPatternMatches(text, itSignals),
    consulting: countPatternMatches(text, researchConsultingSignals),
    engineering: countPatternMatches(text, engineeringSignals),
    security: countStringMatches(text, securitySignals),
    facility: countStringMatches(text, facilitySignals),
  };

  const total = counts.logistics + counts.it + counts.consulting + counts.engineering + counts.security + counts.facility;
  if (total === 0) return classification;

  // Sectors get added when a category fires at all. This stays lenient — the
  // tightening happens at the industry-pick step below.
  const sectors = addUnique(classification.sectors, [
    ...(counts.it > 0 ? ["Information Technology"] : []),
    ...(counts.consulting > 0 ? ["Consulting Services", "Research & Evaluation", "Technical Assistance"] : []),
    ...(counts.engineering > 0 ? ["Engineering Services"] : []),
    ...(counts.logistics > 0 ? ["Logistics & Supply Chain", "Warehousing & Distribution"] : []),
    ...(counts.security > 0 ? ["Security Services"] : []),
    ...(counts.facility > 0 ? ["Facility Management"] : []),
  ]);

  // Pick the category with the most distinct evidence — not the first one in
  // a hardcoded priority order. The Sprint 6 audit found a freight forwarder
  // (Transporters SAL) misclassified as "it" because the old priority order
  // hardcoded IT first: any single IT mention (e.g. "platform" or "managed
  // services") would override 8+ logistics signals. Now: most signals wins,
  // ties broken in favour of concrete physical trades (logistics/engineering/
  // security/facility) over service-economy categories (it/consulting).
  const categoryToIndustry: Record<keyof typeof counts, string> = {
    logistics: "logistics",
    it: "it",
    consulting: "consulting",
    engineering: "engineering",
    security: "security",
    facility: "facilities",
  };
  const concretePhysicalTrades = new Set<keyof typeof counts>(["logistics", "engineering", "security", "facility"]);

  const ranked = (Object.entries(counts) as Array<[keyof typeof counts, number]>)
    .filter(([, c]) => c > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const aPhys = concretePhysicalTrades.has(a[0]);
      const bPhys = concretePhysicalTrades.has(b[0]);
      if (aPhys && !bPhys) return -1;
      if (!aPhys && bPhys) return 1;
      return 0;
    });

  let detected_industry = classification.detected_industry;
  const top = ranked[0];
  if (top) {
    const [topCategory, topCount] = top;
    const topIndustry = categoryToIndustry[topCategory];
    // Keep the LLM's industry when it already matches our top category.
    // Override only when our top has ≥2 distinct signals — a single match
    // is too thin to flip a primary industry on its own.
    if (topIndustry === classification.detected_industry || topCount >= 2) {
      detected_industry = topIndustry;
    }
  }

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
    // IT-retail / hardware-reseller signals so Apple/Microsoft/Cisco partners
    // and similar device-distribution businesses aren't broadened into
    // generic "Consulting Services" when their site mentions training or
    // capacity building (Apple Professional Learning is a classic trigger).
    "apple reseller", "apple premium reseller", "microsoft partner",
    "cisco partner", "hardware reseller", "device reseller",
    "it equipment", "ict retailer", "device sales", "hardware sales",
    "macbook", "iphone", "ipad",
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

  // Short-circuit: when we have NO evidence at all (crawl failed AND user
  // gave no usable description), do not call the LLM. Empty/ambiguous prompts
  // were drifting toward "consulting" despite the prompt instructions, which
  // mis-classifies real concrete-trade companies whose websites were down.
  // Return an empty classification — downstream guards and dashboard cues
  // already handle this case as low-confidence and fall back to user input.
  const crawlContent = crawledData?.content?.trim() ?? "";
  const crawlIsUsable =
    crawlContent.length >= 50 && crawledData?.isThinContent !== true;
  const descriptionIsUsable = description.trim().length >= 30;
  if (!crawlIsUsable && !descriptionIsUsable) {
    return applyBroadProfileGuards(
      applyConcreteIndustryGuards(
        { detected_industry: "", sectors: [], services: [] },
        context,
      ),
      context,
      orgType,
      devThemes,
    );
  }

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

EVIDENCE RULES — read carefully before scoring:
You may only score based on evidence that is actually present in the context above. That means:
  ✓ Public website content
  ✓ User-supplied business description
  ✓ Structured user input (org type, countries, themes)
  ✓ Any uploaded documents reflected in the context
You MAY NOT penalize a company for the absence of items that are typically non-public:
  ✗ Audited financial statements (financial evidence is collected at the deliverable stage, not scored here)
  ✗ Bank references or balance sheets
  ✗ Internal compliance policies, ISO certificates, or insurance documents not mentioned
  ✗ Past performance contracts not described
When evidence for a dimension is missing, do NOT score it low — score it as "unknown but plausible" near 50 and flag it as a gap so the user can supply evidence. Reserve low scores (<35) for dimensions where there is concrete negative signal (e.g. website explicitly contradicts capability, single-person consultancy with no infrastructure, etc.).

Return a JSON object with exactly these fields:
- "capabilities": array of key capabilities relevant to UN procurement
- "certifications_detected": array of certifications, registrations, or compliance standards found (ISO, UNGM, etc.)
- "company_size_signal": one of "micro", "small", "medium", "large" — inferred from website/description
- "strengths": array of strengths for UN procurement participation
- "gaps": array of objects, each with:
  - "gap": description of the gap (frame as "evidence needed" rather than "deficiency" when the gap is about missing non-public information)
  - "severity": "high", "medium", or "low"
  - "fix": one-line recommendation
  - "action_steps": array of 2-4 concrete action steps
  - "upsell_tier": one of "tender-intelligence", "submission-package", "strategic-partnership"
- "readiness_dimensions": object with scores 0-100 for each:
  - "technical_capability": ability to deliver the work — score from public evidence + user description
  - "compliance_readiness": registration, certifications, policies — score 50 (neutral) when no signal either way
  - "geographic_reach": presence in target countries/regions — usually scoreable from public content
  - "experience_relevance": track record with similar projects — score from case studies, client lists, references that ARE described
- "overall_score": top-level number — weighted average across exactly the four dimensions above: technical 30%, compliance 30%, geographic 20%, experience 20%. Do NOT include overall_score inside readiness_dimensions.
- "summary": 2-3 sentence executive assessment that distinguishes confirmed strengths from evidence gaps

Be rigorous but fair. Anchor scores in observed evidence, not in absences. A company with a clear capability story and missing financial info should land in the 55-70 range, not 30-40 — financial evidence is collected separately when the user buys a deliverable. Identify at least 3 gaps for any company scoring below 60, and prefer "supply evidence of X" gaps over "company lacks X" gaps when X is typically non-public.

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
      technical_capability: 50,
      compliance_readiness: 50,
      geographic_reach: 50,
      experience_relevance: 45,
    },
    overall_score: 49,
    summary: "Analysis incomplete — neutral baseline applied. Add a business description or upload documents to refine the score.",
  };

  const parsed = safeParseJSON<Partial<AIAnalysis>>(text, {});

  const guardedClassification = applyBroadProfileGuards(
    applyConcreteIndustryGuards(classification, context),
    context,
    orgType,
    devThemes,
  );

  // The LLM sometimes nests overall_score inside readiness_dimensions instead
  // of at the top level. If we got dimensions but no top-level score, recompute
  // from the four-dimension formula so the user never falls back to 46 just
  // because the model placed the field one level deep.
  const mergedDims: ReadinessDimensions = {
    ...defaultAnalysis.readiness_dimensions,
    ...(parsed.readiness_dimensions ?? {}),
  };
  let overallScore = parsed.overall_score;
  const dimsAsLoose = parsed.readiness_dimensions as unknown as Record<string, unknown> | undefined;
  const nestedOverallScore =
    dimsAsLoose && typeof dimsAsLoose.overall_score === "number"
      ? (dimsAsLoose.overall_score as number)
      : null;
  if (typeof overallScore !== "number" || overallScore <= 0) {
    overallScore = nestedOverallScore ?? Math.round(
      mergedDims.technical_capability * 0.3
        + mergedDims.compliance_readiness * 0.3
        + mergedDims.geographic_reach * 0.2
        + mergedDims.experience_relevance * 0.2
    );
  }

  // Merge analysis fields, but keep Stage 1 company identity authoritative.
  // The full-readiness prompt evaluates readiness; it must not reclassify a
  // logistics/warehouse/security company back into generic consulting.
  return {
    ...defaultAnalysis,
    ...parsed,
    readiness_dimensions: mergedDims,
    overall_score: overallScore,
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
  if (intent === "register-roster") return availableTier("strategic-partnership");

  const highGaps = gaps.filter((g) => g.severity === "high").length;
  if (overallScore >= 60) return "tender-intelligence";
  if (overallScore >= 40) return "submission-package";
  if (highGaps <= 1) return "submission-package";
  return availableTier("strategic-partnership");
}
