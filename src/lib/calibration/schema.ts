import { sql } from "@/lib/db";

/**
 * Calibration corpus schema (P0.2, First-Revenue Sprint).
 *
 * `calibration_log` is the append-only labeled corpus that turns every match /
 * artifact / submission into training data from day one. It is DISTINCT from
 * `feedback_records` (the curated, promotion-gated store that feeds the scoring
 * engine's calibration math): this table logs EVERYTHING, is never promotion-
 * gated, and must NOT feed the scoring engine — raw corpus vs. curated inputs are
 * different access patterns and merging them would create two sources of truth.
 *
 * Owner-scoping (P0.1 discipline) is enforced at the schema level: every row is
 * owned by exactly a customer (`user_id`) OR a network prospect
 * (`network_company_id`) via a CHECK constraint. The 20 outreach prospects have
 * no user account yet, but they are exactly the corpus we want — so both owner
 * kinds are first-class.
 *
 * The migration also ships in scripts/migrate.mjs (dual-schema discipline), but
 * that runner is manual and does not auto-run on deploy, so we self-heal at
 * runtime the same way ensureNetworkMatchingColumns does. All statements are
 * idempotent.
 */
let ensured = false;
let ensuring: Promise<void> | null = null;

export async function ensureCalibrationLogSchema(): Promise<void> {
  if (ensured) return;
  if (!ensuring) {
    ensuring = ensureCalibrationLogSchemaOnce()
      .then(() => {
        ensured = true;
      })
      .finally(() => {
        ensuring = null;
      });
  }
  await ensuring;
}

async function ensureCalibrationLogSchemaOnce(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS calibration_log (
      id SERIAL PRIMARY KEY,

      -- Owner (exactly one of these is set — see the CHECK below). Cascades so a
      -- deleted customer / prospect takes its private corpus rows with it.
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      network_company_id INTEGER REFERENCES network_companies(id) ON DELETE CASCADE,

      -- Provenance.
      source TEXT NOT NULL,        -- network_artifact | bid_analysis | submission | ...
      event_type TEXT NOT NULL,    -- match | outcome

      -- Soft linkage (no FK on match/order ids: they churn on rematch and we want
      -- the corpus row to survive that; tender_id keeps a FK but nulls on delete).
      tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
      network_match_id INTEGER,
      work_order_id INTEGER,
      submission_order_id INTEGER,

      -- Tender snapshot, denormalized at capture so the corpus survives edits/deletes.
      agency TEXT,
      tender_type TEXT,            -- EOI | RFQ | ITB | RFP | unknown
      value_band TEXT,             -- <50k | 50k-250k | 250k-1m | >1m | unknown
      country TEXT,

      -- System output at capture time (flexible payload, not 20 columns):
      --   { merit:{score,tier}, contestability:{band,basis[],thinEvidence},
      --     verdict:{recommendation,confidence}, compliance:{portal,registrationRisk,ungmMinLevel},
      --     complianceFlags:[...] }
      system_output JSONB NOT NULL DEFAULT '{}'::jsonb,

      -- Vendor action + review + founder reasoning.
      vendor_action TEXT,                  -- bid | no_bid | pending
      review_disqualifier_caught BOOLEAN,
      founder_fit_reasoning TEXT,

      -- Outcome (resolved later; the label that makes a row training-grade).
      outcome_state TEXT,                  -- won | lost | shortlisted | disqualified | withdrawn | pending
      outcome_decided_at TIMESTAMPTZ,
      outcome_notes TEXT,

      -- Idempotency: re-generating an artifact UPDATES the corpus row for the same
      -- (owner, tender, source) rather than piling up duplicates.
      dedup_key TEXT NOT NULL,

      captured_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT calibration_log_owner_chk CHECK (user_id IS NOT NULL OR network_company_id IS NOT NULL),
      CONSTRAINT calibration_log_dedup_unique UNIQUE (dedup_key)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS calibration_log_user_idx ON calibration_log (user_id, captured_at DESC) WHERE user_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS calibration_log_company_idx ON calibration_log (network_company_id, captured_at DESC) WHERE network_company_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS calibration_log_tender_idx ON calibration_log (tender_id) WHERE tender_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS calibration_log_outcome_idx ON calibration_log (outcome_state) WHERE outcome_state IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS calibration_log_source_idx ON calibration_log (source, event_type, captured_at DESC)`;
}
