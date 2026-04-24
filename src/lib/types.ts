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
  renderMethod?: "static" | "browser" | "failed";
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

export interface MatchedTender {
  id: number;
  title: string;
  agency: string;
  deadline: string;
  country: string;
  sector: string;
  score: number;
  reference_id?: string;
  source_url?: string | null;
  estimated_value?: string | number | null;
  jv_allowed?: boolean;
  match_reason?: string | null;
  match_reasons?: string[];
  discovered_date?: string | null;
  confidence?: string | null;
  bucket?: "country" | "regional" | "global" | "remote";
  is_adjacent?: boolean;
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
}

export type TierSlug =
  | "tender-intelligence"
  | "submission-package"
  | "strategic-partnership";

export interface User {
  id: number;
  email: string;
  name: string | null;
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
  orgType?: string;
  devThemes?: string[];
  /** Include individual-consultant / consultancy-style tenders. Default OFF for org/company flows. */
  includeConsultancies?: boolean;
}
