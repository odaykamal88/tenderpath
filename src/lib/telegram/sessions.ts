import { sql } from "@/lib/db";

export type SessionIntent = "assessment" | "matches" | "escalate";
export type SessionState = "idle" | "awaiting_email" | "awaiting_message";

export interface Session {
  state: SessionState;
  intent?: SessionIntent;
  email?: string;
}

const SESSION_TTL_MINUTES = 30;

let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS telegram_sessions (
      chat_id BIGINT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'idle',
      data JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  tableReady = true;
}

export async function getSession(chatId: number): Promise<Session> {
  await ensureTable();
  const rows = await sql`
    SELECT state, data, updated_at FROM telegram_sessions WHERE chat_id = ${chatId}
  `;
  if (!rows[0]) return { state: "idle" };
  const row = rows[0] as { state: SessionState; data: Omit<Session, "state">; updated_at: string };

  const ageMinutes = (Date.now() - new Date(row.updated_at).getTime()) / 60000;
  if (ageMinutes > SESSION_TTL_MINUTES) {
    await clearSession(chatId);
    return { state: "idle" };
  }

  return { state: row.state, ...row.data };
}

export async function setSession(chatId: number, session: Session): Promise<void> {
  await ensureTable();
  const { state, ...data } = session;
  await sql`
    INSERT INTO telegram_sessions (chat_id, state, data, updated_at)
    VALUES (${chatId}, ${state}, ${JSON.stringify(data)}, NOW())
    ON CONFLICT (chat_id) DO UPDATE SET
      state = EXCLUDED.state,
      data = EXCLUDED.data,
      updated_at = NOW()
  `;
}

export async function clearSession(chatId: number): Promise<void> {
  await ensureTable();
  await sql`DELETE FROM telegram_sessions WHERE chat_id = ${chatId}`;
}
