import { sql } from "@/lib/db";

export type EmailDeliveryStatus = "sent" | "failed" | "skipped";

let ensurePromise: Promise<void> | null = null;

/** Runtime mirror for the delivery ledger additions in scripts/migrate.mjs. */
export async function ensureEmailDeliveryLogSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS email_queue (
          id SERIAL PRIMARY KEY,
          assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
          email TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          attempts INTEGER DEFAULT 0,
          provider TEXT,
          sent_at TIMESTAMPTZ,
          error TEXT,
          message_key TEXT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0`;
      await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS provider TEXT`;
      await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS error TEXT`;
      await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS message_key TEXT`;
      await sql`ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS email_queue_message_key_unique ON email_queue (message_key) WHERE message_key IS NOT NULL`;
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

export async function recordEmailDelivery(input: {
  messageKey: string;
  email: string;
  kind: string;
  status: EmailDeliveryStatus;
  provider?: string;
  providerMessageId?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await ensureEmailDeliveryLogSchema();
    const metadata = {
      kind: input.kind,
      providerMessageId: input.providerMessageId ?? null,
      ...(input.metadata ?? {}),
    };
    await sql`
      INSERT INTO email_queue (
        assessment_id, email, status, attempts, provider, sent_at, error,
        message_key, metadata
      ) VALUES (
        NULL, ${input.email}, ${input.status}, 1, ${input.provider ?? "resend"},
        ${input.status === "sent" ? new Date().toISOString() : null},
        ${input.error ?? null}, ${input.messageKey}, ${JSON.stringify(metadata)}::jsonb
      )
      ON CONFLICT (message_key) WHERE message_key IS NOT NULL DO UPDATE SET
        status = EXCLUDED.status,
        attempts = email_queue.attempts + 1,
        provider = EXCLUDED.provider,
        sent_at = COALESCE(EXCLUDED.sent_at, email_queue.sent_at),
        error = EXCLUDED.error,
        metadata = EXCLUDED.metadata
    `;
  } catch (error) {
    console.error("[tp:email:delivery_log_failed]", {
      messageKey: input.messageKey,
      kind: input.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
