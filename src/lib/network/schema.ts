import { sql } from "@/lib/db";

// Network/bizdev matching tables ship in scripts/migrate.mjs, but that
// migration is manual and does not auto-run on deploy. Self-heal at runtime
// (same pattern as ensureAssessmentRuntimeColumns in src/lib/assessment/run.ts)
// so the first request after deploy doesn't 500 with "relation does not exist"
// if migrate.mjs hasn't been re-run yet. All statements are idempotent.
let ensured = false;

export async function ensureNetworkMatchingColumns(): Promise<void> {
  if (ensured) return;

  await sql`
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
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS network_companies_active_idx ON network_companies (is_active) WHERE is_active = TRUE`;

  await sql`
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
      CONSTRAINT network_company_matches_status_chk CHECK (status IN ('new','seen','contacted','dismissed','won','lost'))
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_company_idx ON network_company_matches (network_company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_status_idx ON network_company_matches (status, score DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_tender_idx ON network_company_matches (tender_id)`;

  ensured = true;
}
