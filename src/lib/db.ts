import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _sql = neon(url);
  }
  return _sql;
}

/**
 * Lazy-initialized tagged-template SQL function.
 * Defers neon() connection until first query, avoiding build-time crashes.
 */
export const sql: NeonQueryFunction<false, false> = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => {
  return getSql()(strings, ...values);
}) as NeonQueryFunction<false, false>;

export async function initializeDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255),
      password_hash VARCHAR(255),
      is_super_admin BOOLEAN DEFAULT FALSE,
      tier VARCHAR(100),
      subscription_status VARCHAR(50),
      subscription_expires_at TIMESTAMPTZ,
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      magic_token VARCHAR(255),
      magic_token_expires_at TIMESTAMPTZ,
      trial_start_date TIMESTAMPTZ,
      trial_warning_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // PR-M (2026-05-23): trial_warning_sent_at — day-27 cron stamps this
  // so the warning email never fires twice for the same user. Safe
  // no-op on existing DBs.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_warning_sent_at TIMESTAMPTZ`;

  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      tier VARCHAR(100) NOT NULL,
      stripe_customer_id VARCHAR(255),
      stripe_subscription_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'active',
      current_period_end TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, tier)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      company_name VARCHAR(255),
      email VARCHAR(255),
      website VARCHAR(500),
      description TEXT,
      sector VARCHAR(100),
      countries JSONB DEFAULT '[]',
      crawled_data JSONB,
      ai_analysis JSONB,
      readiness_score INTEGER DEFAULT 0,
      matched_tenders JSONB DEFAULT '[]',
      gaps JSONB DEFAULT '[]',
      recommended_tier VARCHAR(100),
      org_type VARCHAR(100),
      dev_themes JSONB DEFAULT '[]',
      matched_grants JSONB DEFAULT '[]',
      grant_readiness_score INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS include_consultancies BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_status VARCHAR(32) DEFAULT 'completed'`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_error TEXT`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_duration_ms INTEGER`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_timings JSONB DEFAULT '{}'`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_started_at TIMESTAMPTZ`;
  await sql`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_completed_at TIMESTAMPTZ`;

  await sql`
    CREATE TABLE IF NOT EXISTS tenders (
      id SERIAL PRIMARY KEY,
      reference_id VARCHAR(100) UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      agency VARCHAR(100) NOT NULL,
      country VARCHAR(100) NOT NULL,
      country_code VARCHAR(10),
      region VARCHAR(100),
      sector VARCHAR(100),
      deadline DATE,
      estimated_value VARCHAR(100),
      source_url TEXT,
      status VARCHAR(50) DEFAULT 'open',
      requirements JSONB DEFAULT '[]',
      source_tier INTEGER DEFAULT 2,
      source_name VARCHAR(200),
      opportunity_type VARCHAR(50) DEFAULT 'RFP',
      eligibility_summary TEXT,
      required_registrations TEXT,
      verified_at TIMESTAMPTZ,
      deadline_timezone VARCHAR(50) DEFAULT 'UTC',
      jv_allowed BOOLEAN DEFAULT true,
      registration_complexity INTEGER DEFAULT 2,
      experience_level VARCHAR(50) DEFAULT 'any',
      submission_language VARCHAR(50) DEFAULT 'English',
      has_broken_link BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE tenders ADD COLUMN IF NOT EXISTS dedup_key TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS tenders_dedup_key_open_idx ON tenders (dedup_key) WHERE status = 'open'`;

  await sql`
    CREATE TABLE IF NOT EXISTS grants (
      id SERIAL PRIMARY KEY,
      reference_id TEXT,
      title TEXT NOT NULL,
      agency VARCHAR(100),
      deadline TIMESTAMPTZ,
      sector VARCHAR(100),
      themes JSONB DEFAULT '[]',
      eligible_org_types JSONB DEFAULT '[]',
      countries JSONB DEFAULT '[]',
      description TEXT,
      value_range TEXT,
      country TEXT,
      region TEXT,
      source_name TEXT,
      source_url TEXT,
      status VARCHAR(50) DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS reference_id TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS source_name TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS description TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS countries JSONB DEFAULT '[]'`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS value_range TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS country TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS region TEXT`;
  await sql`ALTER TABLE grants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

  await sql`
    CREATE TABLE IF NOT EXISTS email_queue (
      id SERIAL PRIMARY KEY,
      assessment_id INTEGER REFERENCES assessments(id),
      email VARCHAR(255) NOT NULL,
      status VARCHAR(50) DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      provider VARCHAR(50),
      sent_at TIMESTAMPTZ,
      error TEXT,
      message_key TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS provider VARCHAR(50)`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS error TEXT`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS message_key TEXT`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS email_queue_message_key_unique ON email_queue (message_key) WHERE message_key IS NOT NULL`;

  await sql`
    CREATE TABLE IF NOT EXISTS crawl_logs (
      id SERIAL PRIMARY KEY,
      platform VARCHAR(100),
      status VARCHAR(50),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      duration_ms INTEGER,
      tenders_added INTEGER DEFAULT 0,
      tenders_updated INTEGER DEFAULT 0,
      tenders_expired INTEGER DEFAULT 0,
      broken_links INTEGER DEFAULT 0,
      error TEXT
    )
  `;
  await sql`ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS errors JSONB DEFAULT '[]'`;
  await sql`ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`;

  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
      tender_title TEXT NOT NULL,
      tender_agency VARCHAR(200),
      tender_deadline DATE,
      tender_value VARCHAR(100),
      source_url TEXT,
      fit_score INTEGER DEFAULT 0,
      stage VARCHAR(32) NOT NULL DEFAULT 'matched',
      position INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE pipeline_items ADD COLUMN IF NOT EXISTS source_url TEXT`;
  await sql`
    CREATE INDEX IF NOT EXISTS pipeline_items_user_tender_idx
    ON pipeline_items (user_id, tender_id)
    WHERE tender_id IS NOT NULL
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS pipeline_items_user_assessment_title_idx
    ON pipeline_items (user_id, assessment_id, tender_title)
    WHERE tender_id IS NULL AND assessment_id IS NOT NULL
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS vault_documents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type VARCHAR(64) NOT NULL,
      expiry_date DATE,
      file_url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE vault_documents ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`;
  await sql`CREATE INDEX IF NOT EXISTS vault_documents_tags_gin ON vault_documents USING GIN (tags)`;
  await sql`CREATE INDEX IF NOT EXISTS vault_documents_user_type ON vault_documents (user_id, type)`;

  await sql`
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
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS document_extractions_user_idx
    ON document_extractions (user_id, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS purchase_logs (
      id SERIAL PRIMARY KEY,
      plan VARCHAR(64) NOT NULL,
      stripe_session_id VARCHAR(200),
      stripe_customer_id VARCHAR(255),
      user_id INTEGER REFERENCES users(id),
      amount_cents INTEGER,
      currency VARCHAR(10) DEFAULT 'usd',
      referrer VARCHAR(500),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS purchase_logs_stripe_session_id_unique
    ON purchase_logs (stripe_session_id)
    WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> ''
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_tender_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      assessment_id INTEGER REFERENCES assessments(id) ON DELETE CASCADE,
      tender_id INTEGER NOT NULL,
      status VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, tender_id)
    )
  `;
  await sql`ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS reason TEXT`;
  await sql`ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
  await sql`ALTER TABLE user_tender_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`;

  await sql`
    CREATE TABLE IF NOT EXISTS user_grant_feedback (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
      grant_id INTEGER NOT NULL,
      status VARCHAR(32) NOT NULL,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, grant_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS user_grant_feedback_user_status_idx
    ON user_grant_feedback (user_id, status)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS bid_analyses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pipeline_item_id INTEGER REFERENCES pipeline_items(id) ON DELETE SET NULL,
      tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
      tender_url TEXT,
      stripe_session_id VARCHAR(200),
      win_probability INTEGER NOT NULL,
      recommendation VARCHAR(20) NOT NULL,
      strength_areas JSONB DEFAULT '[]',
      gap_areas JSONB DEFAULT '[]',
      required_documents JSONB DEFAULT '[]',
      effort_estimate VARCHAR(20) NOT NULL,
      key_risks JSONB DEFAULT '[]',
      next_steps JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
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
    )
  `;

  await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS service_slug TEXT`;
  await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tender_url TEXT`;
  await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS intake JSONB DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS usdt_txid TEXT`;
  await sql`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT`;
  await sql`ALTER TABLE work_orders ALTER COLUMN payment_status SET DEFAULT 'pending'`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS work_orders_usdt_txid_unique
    ON work_orders (usdt_txid)
    WHERE usdt_txid IS NOT NULL AND usdt_txid <> ''
  `;

  await sql`
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
    )
  `;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS pdf_url TEXT`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS pdf_pathname TEXT`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS generation_status TEXT DEFAULT 'pending'`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS generation_attempts INTEGER DEFAULT 1`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS error_message TEXT`;
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS artifact_access TEXT NOT NULL DEFAULT 'legacy_public'`;
  // Sprint 9: persist the extracted TenderRequirements (with capability_match)
  // so subsequent runs and the dashboard can read what we parsed from the
  // uploaded TOR/RFP without re-running extraction.
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS parsed_requirements JSONB`;
  // Sprint 11: gate summary mirrored from output.gate_state for direct query
  // (so the dashboard list can filter "needs_remediation" without JSONB scan).
  await sql`ALTER TABLE proposal_packages ADD COLUMN IF NOT EXISTS gate_state JSONB`;
  // Sprint 17. Relax user_id NOT NULL so anonymous (email-only) paid
  // orders can persist. Without this, persist.ts threw at the INSERT
  // and the customer's $39–$749 charge produced no deliverable.
  await sql`ALTER TABLE proposal_packages ALTER COLUMN user_id DROP NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS proposal_packages_work_order_plan ON proposal_packages (work_order_id, plan, created_at DESC)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bid_analyses_stripe_session_id_unique
    ON bid_analyses (stripe_session_id)
    WHERE stripe_session_id IS NOT NULL AND stripe_session_id <> ''
  `;

  await sql`
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
    )
  `;

  // Internal Matching Workbench (Phase 1) — sidecar to an assessment row.
  await sql`
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
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS vendor_profiles_tier_idx
    ON vendor_profiles (tier)
    WHERE tier IS NOT NULL
  `;

  // Internal hand-match decisions — the training signal for the upcoming Matching product.
  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tender_vendor_matches_tender_idx ON tender_vendor_matches (tender_id)`;
  await sql`CREATE INDEX IF NOT EXISTS tender_vendor_matches_assessment_idx ON tender_vendor_matches (assessment_id)`;
  await sql`CREATE INDEX IF NOT EXISTS tender_vendor_matches_status_idx ON tender_vendor_matches (status, updated_at DESC)`;
}
