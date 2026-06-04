import { sql } from "@/lib/db";
import { ensureBotRuntimeSchema } from "./schema";
import type { BotChannel } from "./types";

/**
 * Channel-agnostic conversation state. Generalized from the old
 * telegram-only session store; keyed by (channel, chat_id) so Telegram and
 * WhatsApp conversations never collide.
 */

export type SessionIntent = "assessment" | "matches" | "escalate";
export type SessionState = "idle" | "awaiting_email" | "awaiting_message";

export interface Session {
  state: SessionState;
  intent?: SessionIntent;
  email?: string;
}

const SESSION_TTL_MINUTES = 30;

export async function getSession(channel: BotChannel, chatId: string): Promise<Session> {
  await ensureBotRuntimeSchema();
  const rows = await sql`
    SELECT state, data, updated_at FROM bot_sessions
    WHERE channel = ${channel} AND chat_id = ${chatId}
  `;
  if (!rows[0]) return { state: "idle" };
  const row = rows[0] as { state: SessionState; data: Omit<Session, "state">; updated_at: string };

  const ageMinutes = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
  if (ageMinutes > SESSION_TTL_MINUTES) {
    await clearSession(channel, chatId);
    return { state: "idle" };
  }

  return { state: row.state, ...row.data };
}

export async function setSession(channel: BotChannel, chatId: string, session: Session): Promise<void> {
  await ensureBotRuntimeSchema();
  const { state, ...data } = session;
  await sql`
    INSERT INTO bot_sessions (channel, chat_id, state, data, updated_at)
    VALUES (${channel}, ${chatId}, ${state}, ${JSON.stringify(data)}, NOW())
    ON CONFLICT (channel, chat_id) DO UPDATE SET
      state = EXCLUDED.state,
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
}

export async function clearSession(channel: BotChannel, chatId: string): Promise<void> {
  await ensureBotRuntimeSchema();
  await sql`DELETE FROM bot_sessions WHERE channel = ${channel} AND chat_id = ${chatId}`;
}
