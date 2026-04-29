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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS provider VARCHAR(50)`;
  await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS error TEXT`;

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

  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
      tender_title TEXT NOT NULL,
      tender_agency VARCHAR(200),
      tender_deadline DATE,
      tender_value VARCHAR(100),
      fit_score INTEGER DEFAULT 0,
      stage VARCHAR(32) NOT NULL DEFAULT 'matched',
      position INTEGER DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
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
      payment_status TEXT DEFAULT 'paid',
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
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
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
}
