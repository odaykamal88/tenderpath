import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const sql = neon(process.env.DATABASE_URL);

const tables = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  tier TEXT,
  subscription_status TEXT,
  subscription_expires_at TIMESTAMPTZ,
  is_super_admin BOOLEAN DEFAULT FALSE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  magic_token TEXT,
  magic_token_expires_at TIMESTAMPTZ,
  trial_start_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_focus JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_description TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_source TEXT DEFAULT 'unset';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mined_profile_facts JSONB DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_submission_used_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_submission_used_work_order_id INTEGER;

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  tier TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
  id SERIAL PRIMARY KEY,
  company_name TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT,
  description TEXT NOT NULL,
  sector TEXT,
  countries JSONB DEFAULT '[]',
  crawled_data JSONB,
  ai_analysis JSONB,
  readiness_score INTEGER DEFAULT 0,
  matched_tenders JSONB DEFAULT '[]',
  gaps JSONB DEFAULT '[]',
  recommended_tier TEXT,
  org_type TEXT,
  dev_themes JSONB DEFAULT '[]',
  matched_grants JSONB DEFAULT '[]',
  grant_readiness_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS include_consultancies BOOLEAN DEFAULT false;

-- T1 / launch-audit 2026-05-19: unguessable public identifier for assessment URLs.
-- DEFAULT gen_random_uuid() backfills every existing row with a fresh UUID at
-- column-add time; the UNIQUE constraint holds because the default is volatile.
-- Existing /assessment/{int} URLs continue to work via the legacy-int fallback
-- in src/lib/assessment/authz.ts, but only for the assessment owner.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS public_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid();

-- Sprint 24 (audit 2026-05-20 demo isolation): tag demo-email assessments
-- with the browser-session cookie value so the anonymous → demo-sign-in
-- handoff preserves the just-completed run AND so the next demo visitor
-- doesn't inherit a previous visitor's data. NULL for every non-demo row.
-- Wipe query in src/app/api/auth/password/route.ts uses this column.
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS demo_session_id TEXT;
CREATE INDEX IF NOT EXISTS assessments_demo_session_idx ON assessments (demo_session_id) WHERE demo_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tenders (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  agency TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  country TEXT,
  sector TEXT,
  reference_id TEXT,
  requirements JSONB,
  experience_level TEXT,
  opportunity_type TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grants (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  agency TEXT NOT NULL,
  deadline TIMESTAMPTZ,
  sector TEXT,
  themes JSONB,
  eligible_org_types JSONB,
  source_url TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE grants ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS countries JSONB;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE grants ADD COLUMN IF NOT EXISTS value_range TEXT;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE grants ADD COLUMN IF NOT EXISTS region TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS grants_reference_id_unique ON grants (reference_id);

CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER REFERENCES assessments(id),
  email TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS message_key TEXT;
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One row per assessment so resend-email's ON CONFLICT (assessment_id) upsert
-- works without falling back to a plain INSERT. Dedupes any prior duplicates
-- by keeping the most recent row.
DELETE FROM email_queue
WHERE id NOT IN (
  SELECT DISTINCT ON (assessment_id) id
  FROM email_queue
  WHERE assessment_id IS NOT NULL
  ORDER BY assessment_id, COALESCE(sent_at, created_at) DESC NULLS LAST, id DESC
)
AND assessment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_queue_assessment_id_unique ON email_queue (assessment_id) WHERE assessment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS email_queue_message_key_unique ON email_queue (message_key) WHERE message_key IS NOT NULL;

-- Hotfix 2026-05-20: the original email_queue.assessment_id FK had no
-- ON DELETE clause, defaulting to NO ACTION. That blocks ANY delete on
-- the assessments table the moment a queue row references it (23503).
-- Discovered during demo-account state reset on the first incognito
-- walkthrough. Match the SET NULL pattern used by pipeline_items,
-- service_orders, work_orders, etc. — keeps the queue row alive for
-- delivery-history auditing but unblocks the parent delete.
-- Idempotent: DROP IF EXISTS + re-ADD always lands on the right rule.
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_assessment_id_fkey;
ALTER TABLE email_queue
  ADD CONSTRAINT email_queue_assessment_id_fkey
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS crawl_logs (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  tenders_added INTEGER DEFAULT 0,
  tenders_updated INTEGER DEFAULT 0,
  tenders_expired INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_documents (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(64) NOT NULL,
  expiry_date DATE,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS storage_access TEXT NOT NULL DEFAULT 'legacy_public';
ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS blob_pathname TEXT;
CREATE INDEX IF NOT EXISTS vault_documents_tags_gin ON vault_documents USING GIN (tags);
CREATE INDEX IF NOT EXISTS vault_documents_user_type ON vault_documents (user_id, type);

CREATE TABLE IF NOT EXISTS document_extractions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vault_document_id INTEGER REFERENCES vault_documents(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  status TEXT NOT NULL,
  text_content TEXT,
  char_count INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_url)
);
CREATE INDEX IF NOT EXISTS document_extractions_user_idx ON document_extractions (user_id, created_at DESC);
ALTER TABLE document_extractions ADD COLUMN IF NOT EXISTS structured_extraction JSONB;
CREATE INDEX IF NOT EXISTS document_extractions_structured_idx ON document_extractions ((structured_extraction->>'type')) WHERE structured_extraction IS NOT NULL;

CREATE TABLE IF NOT EXISTS proposal_rerun_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS proposal_rerun_log_user_time ON proposal_rerun_log (user_id, ran_at DESC);

CREATE TABLE IF NOT EXISTS purchase_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  plan TEXT NOT NULL,
  stripe_session_id TEXT,
  stripe_customer_id TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'usd',
  referrer TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE purchase_logs ADD COLUMN IF NOT EXISTS plan TEXT;
ALTER TABLE purchase_logs ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE purchase_logs ADD COLUMN IF NOT EXISTS amount_cents INTEGER;
ALTER TABLE purchase_logs ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE purchase_logs ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE purchase_logs ALTER COLUMN tier DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS purchase_logs_stripe_session_id_unique
  ON purchase_logs (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> '';

ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS broken_links INTEGER DEFAULT 0;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS last_link_check TIMESTAMPTZ;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS has_broken_link BOOLEAN DEFAULT false;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS submission_language TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS estimated_value TEXT;

-- Canonical "same opportunity" key maintained by dedupKey() in
-- src/lib/crawlers/types.ts. It includes canonical agency aliases and explicit
-- lot/amendment variants, so it is populated/backfilled in application code
-- rather than a generated SQL expression.
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS dedup_key TEXT;
CREATE INDEX IF NOT EXISTS tenders_dedup_key_open_idx ON tenders (dedup_key) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS pipeline_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  tender_title TEXT NOT NULL,
  tender_agency TEXT,
  tender_deadline TIMESTAMPTZ,
  tender_value TEXT,
  fit_score INTEGER DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'matched',
  position INTEGER DEFAULT 0,
  notes TEXT,
  match_reasons JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pipeline_items_user_id ON pipeline_items (user_id);
CREATE INDEX IF NOT EXISTS pipeline_items_stage ON pipeline_items (user_id, stage);
CREATE INDEX IF NOT EXISTS pipeline_items_user_tender_idx ON pipeline_items (user_id, tender_id) WHERE tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pipeline_items_user_assessment_title_idx ON pipeline_items (user_id, assessment_id, tender_title) WHERE tender_id IS NULL AND assessment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_tender_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  tender_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, tender_id)
);
CREATE INDEX IF NOT EXISTS user_tender_feedback_user_id ON user_tender_feedback (user_id);
CREATE INDEX IF NOT EXISTS user_tender_feedback_status ON user_tender_feedback (user_id, status);

ALTER TABLE pipeline_items ADD COLUMN IF NOT EXISTS assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL;
ALTER TABLE pipeline_items ADD COLUMN IF NOT EXISTS match_reasons JSONB;
ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS user_grant_feedback (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  grant_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, grant_id)
);
CREATE INDEX IF NOT EXISTS user_grant_feedback_user_status_idx ON user_grant_feedback (user_id, status);

CREATE TABLE IF NOT EXISTS work_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  payment_status TEXT DEFAULT 'pending',
  stripe_session_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'usd',
  email TEXT,
  service_slug TEXT,
  pipeline_item_id INTEGER REFERENCES pipeline_items(id) ON DELETE SET NULL,
  tender_title TEXT,
  agency TEXT,
  tender_url TEXT,
  intake JSONB DEFAULT '{}'::jsonb,
  fulfillment_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_orders_status ON work_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_user_id ON work_orders (user_id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS service_slug TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tender_url TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS intake JSONB DEFAULT '{}'::jsonb;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS usdt_txid TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;
ALTER TABLE work_orders ALTER COLUMN payment_status SET DEFAULT 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_usdt_txid_unique
  ON work_orders (usdt_txid)
  WHERE usdt_txid IS NOT NULL AND usdt_txid <> '';

CREATE TABLE IF NOT EXISTS proposal_packages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  pipeline_item_id INTEGER REFERENCES pipeline_items(id) ON DELETE SET NULL,
  plan VARCHAR(50) NOT NULL,
  tender_title TEXT,
  agency TEXT,
  tender_url TEXT,
  intake JSONB DEFAULT '{}'::jsonb,
  stripe_session_id VARCHAR(200),
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_url TEXT,
  pdf_pathname TEXT,
  generation_status TEXT DEFAULT 'pending',
  generation_attempts INTEGER DEFAULT 1,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS pdf_pathname TEXT;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS generation_status TEXT DEFAULT 'pending';
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS generation_attempts INTEGER DEFAULT 1;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS parsed_requirements JSONB;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS gate_state JSONB;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS artifact_access TEXT NOT NULL DEFAULT 'legacy_public';
ALTER TABLE proposal_packages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS proposal_packages_work_order_plan ON proposal_packages (work_order_id, plan, created_at DESC);
CREATE INDEX IF NOT EXISTS proposal_packages_pending_idx ON proposal_packages (generation_status, updated_at)
  WHERE generation_status IN ('pending','generating');

CREATE TABLE IF NOT EXISTS bid_analyses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pipeline_item_id INTEGER REFERENCES pipeline_items(id) ON DELETE SET NULL,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  tender_url TEXT,
  stripe_session_id TEXT,
  win_probability INTEGER NOT NULL,
  recommendation TEXT NOT NULL,
  strength_areas JSONB DEFAULT '[]',
  gap_areas JSONB DEFAULT '[]',
  required_documents JSONB DEFAULT '[]',
  effort_estimate TEXT NOT NULL,
  key_risks JSONB DEFAULT '[]',
  next_steps JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS bid_analyses_stripe_session_id_unique
  ON bid_analyses (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> '';

CREATE TABLE IF NOT EXISTS bid_no_bid_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bid_no_bid_usage_user_month
  ON bid_no_bid_usage (user_id, created_at);

-- Bundled-EOI monthly quota (P1.2): one append-only row per subscriber EOI claimed. Self-heals via ensureEoiBundledUsageSchema. Same shape/pattern as bid_no_bid_usage.
CREATE TABLE IF NOT EXISTS eoi_bundled_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eoi_bundled_usage_user_month
  ON eoi_bundled_usage (user_id, created_at);

CREATE TABLE IF NOT EXISTS weekly_digest_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tender_count INTEGER DEFAULT 0,
  grant_count INTEGER DEFAULT 0,
  pipeline_added INTEGER DEFAULT 0,
  pipeline_updated INTEGER DEFAULT 0,
  provider TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS weekly_digest_logs_user_id ON weekly_digest_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS weekly_digest_logs_status ON weekly_digest_logs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  user_agent TEXT,
  logged_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS demo_sessions_email_idx ON demo_sessions (email, logged_at DESC);
CREATE INDEX IF NOT EXISTS demo_sessions_logged_at_idx ON demo_sessions (logged_at DESC);

-- Sprint 22. Email opt-out registry. Populated by the one-click HTTPS
-- unsubscribe endpoint (List-Unsubscribe-Post, RFC 8058) and by manual ops
-- review of replies to unsubscribe@tenderpath.me. Every user-facing email
-- sender consults this table before dispatching to Resend.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  unsubscribed_at TIMESTAMPTZ DEFAULT NOW(),
  user_agent TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS email_suppressions_unsubscribed_at ON email_suppressions (unsubscribed_at DESC);

-- Sprint 24 (audit 2026-05-20 UX): per-assessment to-do completion log for the
-- Next Steps tab. step_key is opaque to the DB but currently shaped as
-- "g{gapIdx}-s{stepIdx}" against the assessment's gaps[i].action_steps[j].
-- ON DELETE CASCADE keeps the table tidy when an assessment row is reset
-- (demo reset, GDPR purge). Score impact stays projected-only — we never
-- recompute readiness_score from completion state, just surface progress.
CREATE TABLE IF NOT EXISTS assessment_step_completions (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  done_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, step_key)
);
CREATE INDEX IF NOT EXISTS assessment_step_completions_assessment_idx ON assessment_step_completions (assessment_id);

CREATE TABLE IF NOT EXISTS vendor_profiles (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessments(id) ON DELETE CASCADE,
  tier TEXT,
  ungm_status TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  relationship_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT vendor_profiles_tier_chk CHECK (tier IS NULL OR tier IN ('T1','T2','REF')),
  CONSTRAINT vendor_profiles_ungm_chk CHECK (ungm_status IS NULL OR ungm_status IN ('registered','pending','unregistered','unknown'))
);
CREATE INDEX IF NOT EXISTS vendor_profiles_tier_idx ON vendor_profiles (tier) WHERE tier IS NOT NULL;

CREATE TABLE IF NOT EXISTS tender_vendor_matches (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  routed_service TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'suggested',
  fit_reasoning TEXT NOT NULL,
  outcome TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT tender_vendor_matches_service_chk CHECK (routed_service IN ('bid-no-bid','proposal-draft','roster-fast-track','matching')),
  CONSTRAINT tender_vendor_matches_status_chk CHECK (status IN ('suggested','contacted','applied','shortlisted','won','lost')),
  CONSTRAINT tender_vendor_matches_unique UNIQUE (tender_id, assessment_id)
);
CREATE INDEX IF NOT EXISTS tender_vendor_matches_tender_idx ON tender_vendor_matches (tender_id);
CREATE INDEX IF NOT EXISTS tender_vendor_matches_assessment_idx ON tender_vendor_matches (assessment_id);
CREATE INDEX IF NOT EXISTS tender_vendor_matches_status_idx ON tender_vendor_matches (status, updated_at DESC);

-- Phase 1 feedback store: unified flywheel records (outcomes, loss reasons,
-- extraction corrections, consented exemplars). The state column IS the
-- curation gate: only state=promoted records may affect scoring calibration,
-- extraction, or retrieval. Anchored to proposal_packages (snapshots are not a
-- queryable table). The frozen model reads the promoted store; a human curates.
CREATE TABLE IF NOT EXISTS feedback_records (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'captured',
  captured_from TEXT NOT NULL DEFAULT 'user_prompt',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  proposal_package_id INTEGER REFERENCES proposal_packages(id) ON DELETE SET NULL,
  tender_title TEXT,
  agency TEXT,
  outcome TEXT,
  predicted_score NUMERIC,
  predicted_max NUMERIC,
  predicted_band TEXT,
  rubric_version INTEGER,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT feedback_records_kind_chk CHECK (kind IN ('outcome','loss_reason','extraction_correction','exemplar')),
  CONSTRAINT feedback_records_state_chk CHECK (state IN ('captured','promoted','rejected')),
  CONSTRAINT feedback_records_outcome_chk CHECK (outcome IS NULL OR outcome IN ('won','lost','shortlisted','disqualified','withdrawn','pending'))
);
CREATE INDEX IF NOT EXISTS feedback_records_state_kind_idx ON feedback_records (state, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_records_package_idx ON feedback_records (proposal_package_id) WHERE proposal_package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_records_promoted_outcome_idx ON feedback_records (kind, state) WHERE kind = 'outcome' AND state = 'promoted';

CREATE TABLE IF NOT EXISTS network_companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  services_text TEXT,
  countries JSONB DEFAULT '[]'::jsonb,
  sectors JSONB DEFAULT '[]'::jsonb,
  org_type TEXT,
  ai_analysis JSONB,
  crawled_data JSONB,
  profile_status TEXT NOT NULL DEFAULT 'pending',
  profile_error TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_matched_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT network_companies_profile_status_chk CHECK (profile_status IN ('pending','ready','failed'))
);
CREATE INDEX IF NOT EXISTS network_companies_active_idx ON network_companies (is_active) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS network_company_matches (
  id SERIAL PRIMARY KEY,
  network_company_id INTEGER NOT NULL REFERENCES network_companies(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  structured_reasons JSONB,
  match_reasons JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'new',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_scored_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT network_company_matches_unique UNIQUE (network_company_id, tender_id),
  CONSTRAINT network_company_matches_status_chk CHECK (status IN ('new','seen','contacted','replied','booked','paid','not_relevant','dismissed','won','lost'))
);
CREATE INDEX IF NOT EXISTS network_company_matches_company_idx ON network_company_matches (network_company_id);
CREATE INDEX IF NOT EXISTS network_company_matches_status_idx ON network_company_matches (status, score DESC);
CREATE INDEX IF NOT EXISTS network_company_matches_tender_idx ON network_company_matches (tender_id);
ALTER TABLE network_company_matches ADD COLUMN IF NOT EXISTS dismiss_reason TEXT;
ALTER TABLE network_company_matches DROP CONSTRAINT IF EXISTS network_company_matches_status_chk;
ALTER TABLE network_company_matches
  ADD CONSTRAINT network_company_matches_status_chk
  CHECK (status IN ('new','seen','contacted','replied','booked','paid','not_relevant','dismissed','won','lost'));
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS contact_linkedin TEXT;
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS ungm_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS share_token TEXT DEFAULT md5(random()::text || clock_timestamp()::text);
UPDATE network_companies SET share_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE share_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS network_companies_share_token_idx ON network_companies (share_token);
-- CRM contact + pipeline fields: the person behind the company and their outreach stage.
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS contact_title TEXT;
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS contact_email_status TEXT;
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS un_buyer TEXT;
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'lead';
ALTER TABLE network_companies DROP CONSTRAINT IF EXISTS network_companies_pipeline_stage_chk;
ALTER TABLE network_companies ADD CONSTRAINT network_companies_pipeline_stage_chk CHECK (pipeline_stage IN ('lead','contacted','replied','meeting','proposal','won','lost'));
-- Per-company activity log: the CRM interaction trail (notes/calls/emails/meetings/stage changes/imports).
CREATE TABLE IF NOT EXISTS network_company_activity (
  id SERIAL PRIMARY KEY,
  network_company_id INTEGER NOT NULL REFERENCES network_companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',
  body TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT network_company_activity_kind_chk CHECK (kind IN ('note','call','email','meeting','linkedin','stage_change','import','other'))
);
CREATE INDEX IF NOT EXISTS network_company_activity_company_idx ON network_company_activity (network_company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS network_external_prospects (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  network_company_id INTEGER REFERENCES network_companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  website TEXT,
  country TEXT,
  countries JSONB DEFAULT '[]'::jsonb,
  sectors JSONB DEFAULT '[]'::jsonb,
  org_type TEXT,
  services_text TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  confidence TEXT NOT NULL DEFAULT 'medium',
  fit_reasons JSONB DEFAULT '[]'::jsonb,
  evidence_urls JSONB DEFAULT '[]'::jsonb,
  search_queries JSONB DEFAULT '[]'::jsonb,
  provider TEXT NOT NULL DEFAULT 'openai_web_search',
  status TEXT NOT NULL DEFAULT 'suggested',
  dedup_key TEXT NOT NULL,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_discovered_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT network_external_prospects_unique UNIQUE (tender_id, dedup_key),
  CONSTRAINT network_external_prospects_confidence_chk CHECK (confidence IN ('high','medium','low')),
  CONSTRAINT network_external_prospects_status_chk CHECK (status IN ('suggested','reviewed','added_to_network','dismissed'))
);
CREATE INDEX IF NOT EXISTS network_external_prospects_tender_idx ON network_external_prospects (tender_id, status, score DESC);
CREATE INDEX IF NOT EXISTS network_external_prospects_network_company_idx ON network_external_prospects (network_company_id) WHERE network_company_id IS NOT NULL;

-- Calibration corpus (P0.2): append-only labeled row per match/artifact/submission, owner-scoped to a customer OR a network prospect. Distinct from feedback_records (curated scoring inputs); this logs everything and never feeds the scoring engine. Self-heals at runtime via ensureCalibrationLogSchema.
CREATE TABLE IF NOT EXISTS calibration_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  network_company_id INTEGER REFERENCES network_companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  network_match_id INTEGER,
  work_order_id INTEGER,
  submission_order_id INTEGER,
  agency TEXT,
  tender_type TEXT,
  value_band TEXT,
  country TEXT,
  system_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  vendor_action TEXT,
  review_disqualifier_caught BOOLEAN,
  founder_fit_reasoning TEXT,
  outcome_state TEXT,
  outcome_decided_at TIMESTAMPTZ,
  outcome_notes TEXT,
  dedup_key TEXT NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT calibration_log_owner_chk CHECK (user_id IS NOT NULL OR network_company_id IS NOT NULL),
  CONSTRAINT calibration_log_dedup_unique UNIQUE (dedup_key)
);
CREATE INDEX IF NOT EXISTS calibration_log_user_idx ON calibration_log (user_id, captured_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calibration_log_company_idx ON calibration_log (network_company_id, captured_at DESC) WHERE network_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calibration_log_tender_idx ON calibration_log (tender_id) WHERE tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calibration_log_outcome_idx ON calibration_log (outcome_state) WHERE outcome_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS calibration_log_source_idx ON calibration_log (source, event_type, captured_at DESC);

-- Bot (Telegram/WhatsApp) channel-agnostic session store. Replaces telegram_sessions.
CREATE TABLE IF NOT EXISTS bot_sessions (
  channel TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel, chat_id)
);

-- Binds a messaging identity (Telegram chat / WhatsApp number) to a user account.
CREATE TABLE IF NOT EXISTS messaging_identities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  channel_user_id TEXT NOT NULL,
  last_nudge_at TIMESTAMPTZ,
  nudge_opt_out BOOLEAN DEFAULT FALSE,
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel, channel_user_id)
);
CREATE INDEX IF NOT EXISTS messaging_identities_user_idx ON messaging_identities (user_id);

-- One-time deep-link token for bot account linking (separate from login magic_token).
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_link_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_link_token_expires_at TIMESTAMPTZ;

-- Submissions workflow (EOI/RFQ/ITB/RFP paid orders). One shared order object
-- drives the vendor dashboard and the ops queue; events[] is the truth log.
-- Mirrored by ensureSubmissionsSchema() in src/lib/submissions/store.ts.
CREATE TABLE IF NOT EXISTS submission_orders (
  id SERIAL PRIMARY KEY,
  ref TEXT UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id INTEGER,
  type TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  tender TEXT NOT NULL,
  agency TEXT,
  source TEXT,
  portal TEXT,
  tender_id INTEGER,
  pipeline_item_id INTEGER,
  due DATE,
  value TEXT,
  fit INTEGER,
  stage TEXT NOT NULL DEFAULT 'intake',
  pct INTEGER NOT NULL DEFAULT 0,
  round INTEGER NOT NULL DEFAULT 0,
  stage_note TEXT,
  sla_mins INTEGER NOT NULL DEFAULT 60,
  completeness INTEGER NOT NULL DEFAULT 0,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  intake JSONB NOT NULL DEFAULT '[]'::jsonb,
  intake_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision_notes TEXT,
  amendments JSONB NOT NULL DEFAULT '[]'::jsonb,
  qna JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome JSONB NOT NULL DEFAULT '{"state":"pending"}'::jsonb,
  shepherd JSONB NOT NULL DEFAULT '{"checked":[]}'::jsonb,
  generation_status TEXT NOT NULL DEFAULT 'not_started',
  generated_prose JSONB,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE submission_orders ADD COLUMN IF NOT EXISTS artifact_versions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE submission_orders ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE submission_orders ADD COLUMN IF NOT EXISTS generated_prose JSONB;
CREATE INDEX IF NOT EXISTS submission_orders_user_idx ON submission_orders (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS submission_orders_stage_idx ON submission_orders (stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS submission_orders_wo_idx ON submission_orders (work_order_id);

-- Sprint 0 confidentiality boundary. Client-upload receipts bind a private
-- blob to its authenticated owner before extraction. Human access is scoped
-- to one paid work order, expires automatically, and leaves an append-only
-- event trail.
CREATE TABLE IF NOT EXISTS vault_upload_receipts (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_url TEXT NOT NULL UNIQUE,
  blob_pathname TEXT NOT NULL,
  content_type TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS vault_upload_receipts_owner_idx
  ON vault_upload_receipts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_access_grants (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_access_grants_active_idx
  ON customer_access_grants (owner_user_id, work_order_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS customer_access_events (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  purpose TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customer_access_events_owner_idx
  ON customer_access_events (owner_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS customer_access_events_work_order_idx
  ON customer_access_events (work_order_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS private_blob_migrations (
  id BIGSERIAL PRIMARY KEY,
  object_kind TEXT NOT NULL,
  source_row_id INTEGER NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  destination_pathname TEXT NOT NULL,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_deleted_at TIMESTAMPTZ
);

-- Server-side wizard autosave: one draft per user x format.
CREATE TABLE IF NOT EXISTS submission_drafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS waitlist_signups (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function migrate() {
  console.log("Running migration...");
  // neon() doesn't support multi-statement queries. Remove full-line comments
  // before splitting so a semicolon in prose cannot swallow the following
  // CREATE/ALTER statement, then execute only the additive schema operations.
  const uncommentedTables = tables
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
  const statements = uncommentedTables
    .split(/;/)
    .map((statement) => statement.trim())
    .filter((s) => /^(CREATE|ALTER)\b/.test(s));

  for (const stmt of statements) {
    const label =
      stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1] ??
      stmt.match(/CREATE UNIQUE INDEX IF NOT EXISTS (\w+)/)?.[1] ??
      stmt.match(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/)?.slice(1).join(".") ??
      stmt.slice(0, 40);
    await sql.query(stmt);
    console.log(`  ✓ ${label}`);
  }
  console.log("Migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
