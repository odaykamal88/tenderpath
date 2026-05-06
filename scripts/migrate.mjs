import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

const sql = neon(process.env.DATABASE_URL);

const tables = `
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

CREATE TABLE IF NOT EXISTS crawl_logs (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL,
  tenders_added INTEGER DEFAULT 0,
  tenders_updated INTEGER DEFAULT 0,
  tenders_expired INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE crawl_logs ADD COLUMN IF NOT EXISTS broken_links INTEGER DEFAULT 0;

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS last_link_check TIMESTAMPTZ;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS has_broken_link BOOLEAN DEFAULT false;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS submission_language TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS estimated_value TEXT;

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
);
CREATE INDEX IF NOT EXISTS work_orders_status ON work_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS work_orders_user_id ON work_orders (user_id);
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS service_slug TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS tender_url TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS intake JSONB DEFAULT '{}'::jsonb;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS usdt_txid TEXT;
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;

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
`;

async function migrate() {
  console.log("Running migration...");
  // neon() doesn't support multi-statement, split by CREATE TABLE
  const statements = tables
    .split(/;/)
    .map((s) => s.trim())
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
