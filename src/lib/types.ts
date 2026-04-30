export interface AssessmentPreferences {
  include_consultancies: boolean;
}

export interface Assessment {
  id: number;
  company_name: string;
  email: string;
  website: string | null;
  description: string;
  sector: string | null;
  countries: string[];
  crawled_data: CrawledData | null;
  ai_analysis: AIAnalysis | null;
  readiness_score: number;
  matched_tenders: MatchedTender[];
  gaps: Gap[];
  recommended_tier: TierSlug;
  org_type: string | null;
  dev_themes: string[];
  matched_grants: MatchedGrant[];
  grant_readiness_score: number;
  /** User preferences captured at assessment time. Null on pre-Sprint-3 rows. */
  preferences: AssessmentPreferences | null;
  created_at: string;
}

export interface CrawledData {
  title: string | null;
  metaDescription: string | null;
  ogDescription: string | null;
  content: string;
  isThinContent: boolean;
  /** Final URL after redirect following (may differ from user-supplied URL). */
  finalUrl?: string | null;
  /** How the page was rendered. Absent on assessments saved before this field was added. */
  renderMethod?: "static" | "browser" | "failed" | "parked";
}

export interface AIAnalysis {
  detected_industry: string;
  sectors: string[];
  services: string[];
  capabilities: string[];
  certifications_detected: string[];
  company_size_signal: string;
  strengths: string[];
  gaps: Gap[];
  readiness_dimensions: ReadinessDimensions;
  overall_score: number;
  summary: string;
}

export interface ReadinessDimensions {
  technical_capability: number;
  compliance_readiness: number;
  financial_stability: number;
  geographic_reach: number;
  experience_relevance: number;
}

export interface Gap {
  gap: string;
  severity: "high" | "medium" | "low";
  fix: string;
  action_steps: string[];
  upsell_tier: TierSlug;
}

export type GeographyMode = "direct" | "regional" | "global-open" | "auto-expanded" | "unknown";
export type OpportunityBucket = "act_now" | "strong_fit" | "strategic" | "adjacent" | "watchlist";

export interface MatchReason {
  summary: string[];
  matchedSectors?: string[];
  matchedCapabilities?: string[];
  matchedKeywords?: string[];
  procurement?: {
    category?: string | null;
    opportunityType?: string | null;
    sourceName?: string | null;
    sourceUrl?: string | null;
    sourceProvenance?: "primary" | "aggregator" | "unknown";
    postedDate?: string | null;
    updatedDate?: string | null;
    sectorLabel?: string | null;
    estimatedValue?: string | number | null;
  };
  geographyAlignment?: {
    userCountries?: string[];
    tenderCountry?: string | null;
    mode: GeographyMode;
  };
  tenderTypeAlignment?: string[];
  scoreBreakdown?: {
    sector: number;
    capabilities: number;
    geography: number;
    agency: number;
    feedback?: number;
  };
  evidenceQuality?: "rich" | "thin";
  confidence?: "high" | "medium" | "low";
  caveats?: string[];
}

export interface MatchedTender {
  id: number;
  title: string;
  agency: string;
  deadline: string;
  country: string;
  sector: string;
  score: number;
  reference_id?: string;
  source_name?: string | null;
  source_url?: string | null;
  opportunity_type?: string | null;
  procurement_category?: string | null;
  source_provenance?: "primary" | "aggregator" | "unknown";
  posted_date?: string | null;
  updated_at?: string | null;
  estimated_value?: string | number | null;
  jv_allowed?: boolean;
  match_reason?: string | null;
  match_reasons?: string[];
  structured_reasons?: MatchReason | null;
  discovered_date?: string | null;
  confidence?: string | null;
  bucket?: "country" | "regional" | "global" | "remote";
  is_adjacent?: boolean;
  opportunity_bucket?: OpportunityBucket;
  opportunity_bucket_label?: string;
  opportunity_bucket_reason?: string;
  opportunity_bucket_priority?: number;
  enriched_summary?: string | null;
  decision_brief?: {
    headline: string;
    reasons_to_act: string[];
    verify_before_bidding: string[];
    recommended_action: string;
    source_confidence: "high" | "medium" | "low";
    source_confidence_reason: string;
  };
}

export interface MatchedGrant {
  id: number;
  title: string;
  agency: string;
  deadline: string;
  sector: string;
  score: number;
  source_url?: string | null;
  country?: string | null;
  region?: string | null;
  value_range?: string | null;
  description?: string | null;
  org_type_mismatch?: boolean;
  opportunity_bucket?: OpportunityBucket;
  opportunity_bucket_label?: string;
  opportunity_bucket_reason?: string;
  opportunity_bucket_priority?: number;
}

export type TierSlug =
  | "tender-intelligence"
  | "submission-package"
  | "strategic-partnership";

export interface User {
  id: number;
  email: string;
  name: string | null;
  business_name: string | null;
  website: string | null;
  sector: string | null;
  country_focus: string[];
  org_type: string | null;
  profile_description: string | null;
  profile_source: "assessment" | "manual" | "unset";
  tier: TierSlug | null;
  subscription_status: SubscriptionStatus | null;
  subscription_expires_at: string | null;
  is_super_admin: boolean;
  created_at: string;
}

export type SubscriptionStatus = "active" | "canceled" | "past_due" | "trialing";

export interface Subscription {
  id: number;
  user_id: number;
  tier: TierSlug;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: SubscriptionStatus;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssessmentInput {
  companyName: string;
  email: string;
  website?: string;
  description: string;
  countries: string[];
  /** Optional near-sector areas the user wants TenderPath to monitor. */
  adjacentSectors?: string[];
  /** Free-form capabilities not obvious from a thin website. */
  additionalCapabilities?: string;
  orgType?: string;
  devThemes?: string[];
  /** Include individual-consultant / consultancy-style tenders. Default OFF for org/company flows. */
  includeConsultancies?: boolean;
}
