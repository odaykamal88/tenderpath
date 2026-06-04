import { sql } from "@/lib/db";

let ensured = false;

/**
 * Idempotent runtime self-heal for bot tables/columns. Mirrors
 * `ensureAssessmentRuntimeColumns()` in src/lib/assessment/run.ts so the schema
 * exists on the first hit after a deploy — `npm run migrate` does NOT run
 * automatically on Vercel. The same statements are the canonical source in
 * scripts/migrate.mjs. Called at the top of both webhooks and the nudge cron.
 */
export async function ensureBotRuntimeSchema(): Promise<void> {
  if (ensured) return;

  // Channel-keyed session store. Replaces the old telegram_sessions table;
  // sessions are ephemeral (30-min TTL) so no data migration is needed — old
  // rows simply expire and are never read again.
  await sql`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      channel TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'idle',
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (channel, chat_id)
    )
  `;

  // Binds a messaging identity (Telegram chat / WhatsApp number) to a user
  // account. Multi-channel; carries proactive-nudge preferences.
  await sql`
    CREATE TABLE IF NOT EXISTS messaging_identities (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      last_nudge_at TIMESTAMPTZ,
      nudge_opt_out BOOLEAN DEFAULT FALSE,
      linked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (channel, channel_user_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS messaging_identities_user_idx ON messaging_identities (user_id)`;

  // One-time deep-link token for account linking. Kept separate from the login
  // `magic_token` columns so a bot link can't be confused with a login link.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_link_token TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_link_token_expires_at TIMESTAMPTZ`;

  ensured = true;
}
