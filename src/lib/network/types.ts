import type { AIAnalysis, CrawledData, MatchReason } from "@/lib/types";

export type NetworkProfileStatus = "pending" | "ready" | "failed";

export type NetworkMatchStatus =
  | "new"
  | "seen"
  | "contacted"
  | "dismissed"
  | "won"
  | "lost";

/**
 * An external company from the operator's network (a prospect for early
 * bizdev) — NOT a TenderPath customer. Kept entirely separate from the
 * `assessments` table: no email, no funnel telemetry, no user-facing dashboard.
 */
export interface NetworkCompany {
  id: number;
  name: string;
  website: string | null;
  /** Operator-typed description of what the company supplies/does. */
  services_text: string | null;
  countries: string[];
  sectors: string[];
  org_type: string | null;
  ai_analysis: AIAnalysis | null;
  crawled_data: CrawledData | null;
  profile_status: NetworkProfileStatus;
  profile_error: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  last_matched_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface NetworkCompanyMatch {
  id: number;
  network_company_id: number;
  tender_id: number;
  score: number;
  structured_reasons: MatchReason | null;
  match_reasons: string[];
  status: NetworkMatchStatus;
  dismiss_reason: string | null;
  first_seen_at: string;
  last_scored_at: string;
  created_at: string;
  updated_at: string | null;
}
