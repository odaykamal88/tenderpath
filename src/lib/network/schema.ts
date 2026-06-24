import { sql } from "@/lib/db";

// Network/bizdev matching tables ship in scripts/migrate.mjs, but that
// migration is manual and does not auto-run on deploy. Self-heal at runtime
// (same pattern as ensureAssessmentRuntimeColumns in src/lib/assessment/run.ts)
// so the first request after deploy doesn't 500 with "relation does not exist"
// if migrate.mjs hasn't been re-run yet. All statements are idempotent.
let ensured = false;
let ensuring: Promise<void> | null = null;

export async function ensureNetworkMatchingColumns(): Promise<void> {
  if (ensured) return;
  if (!ensuring) {
    ensuring = ensureNetworkMatchingColumnsOnce()
      .then(() => { ensured = true; })
      .finally(() => { ensuring = null; });
  }
  await ensuring;
}

async function ensureNetworkMatchingColumnsOnce(): Promise<void> {
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
      CONSTRAINT network_company_matches_status_chk CHECK (status IN ('new','seen','contacted','replied','booked','paid','not_relevant','dismissed','won','lost'))
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_company_idx ON network_company_matches (network_company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_status_idx ON network_company_matches (status, score DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS network_company_matches_tender_idx ON network_company_matches (tender_id)`;
  // Operator's free-text reason for a dismissal — fuels the AI feedback pass.
  await sql`ALTER TABLE network_company_matches ADD COLUMN IF NOT EXISTS dismiss_reason TEXT`;
  await sql`
    DO $$
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext('tenderpath_network_matching_schema'));

      IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'network_company_matches'::regclass
          AND conname = 'network_company_matches_status_chk'
          AND pg_get_constraintdef(oid) NOT LIKE '%not_relevant%'
      ) THEN
        ALTER TABLE network_company_matches DROP CONSTRAINT network_company_matches_status_chk;
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'network_company_matches'::regclass
          AND conname = 'network_company_matches_status_chk'
      ) THEN
        ALTER TABLE network_company_matches
          ADD CONSTRAINT network_company_matches_status_chk
          CHECK (status IN ('new','seen','contacted','replied','booked','paid','not_relevant','dismissed','won','lost'));
      END IF;
    END $$;
  `;
  // LinkedIn URL of the prospect's contact — powers the LinkedIn outreach motion
  // for prospects with no email on file (the majority of bizdev imports).
  await sql`ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS contact_linkedin TEXT`;
  // Operator-recorded UNGM vendor-registration status of the prospect. We can't
  // honestly auto-detect it, so the operator records what they know; when known
  // it sharpens the outreach ("you're already set up to bid"), when 'unknown' the
  // copy stays conditional. One of: unknown | not_registered | basic | level-1 | level-2.
  await sql`ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS ungm_status TEXT NOT NULL DEFAULT 'unknown'`;
  // Unguessable token for the public, read-only prospect briefing page (/n/<token>).
  // The volatile default backfills existing rows with distinct tokens on ADD; the
  // explicit UPDATE + unique index are belt-and-suspenders for a column that may
  // already exist without a default. Not a security boundary (it only reveals a
  // prospect's own company analysis + public tenders) — just hard to guess.
  await sql`ALTER TABLE network_companies ADD COLUMN IF NOT EXISTS share_token TEXT DEFAULT md5(random()::text || clock_timestamp()::text)`;
  await sql`UPDATE network_companies SET share_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE share_token IS NULL`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS network_companies_share_token_idx ON network_companies (share_token)`;
}
