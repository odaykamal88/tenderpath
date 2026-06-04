import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";
import { ensureBotRuntimeSchema } from "./schema";
import type { BotChannel } from "./types";

/**
 * Account linking: bind a messaging identity (Telegram chat id / WhatsApp
 * number) to a TenderPath user, so the bot knows who it's talking to and never
 * has to ask for an email again. Uses the same one-time-token shape as the
 * login magic link (generateMagicToken + expiry + consume-on-use).
 */

export interface LinkedUser {
  id: number;
  email: string;
  name: string | null;
  businessName: string | null;
}

const LINK_TOKEN_TTL_MINUTES = 30;

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  business_name: string | null;
}

function toLinkedUser(row: UserRow): LinkedUser {
  return { id: row.id, email: row.email, name: row.name, businessName: row.business_name };
}

/** The user bound to this chat, or null if the chat isn't linked. */
export async function resolveUser(channel: BotChannel, chatId: string): Promise<LinkedUser | null> {
  await ensureBotRuntimeSchema();
  const rows = await sql`
    SELECT u.id, u.email, u.name, u.business_name
    FROM messaging_identities mi
    JOIN users u ON u.id = mi.user_id
    WHERE mi.channel = ${channel} AND mi.channel_user_id = ${chatId}
    LIMIT 1
  `;
  const row = rows[0] as UserRow | undefined;
  return row ? toLinkedUser(row) : null;
}

/** Mint a fresh one-time link token for `userId` and return it (for deep links). */
export async function mintLinkToken(userId: number): Promise<string> {
  await ensureBotRuntimeSchema();
  const token = generateMagicToken();
  const expires = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60 * 1000);
  await sql`
    UPDATE users
    SET bot_link_token = ${token}, bot_link_token_expires_at = ${expires.toISOString()}
    WHERE id = ${userId}
  `;
  return token;
}

/**
 * Consume a link token and bind the chat to the user. Returns the linked user,
 * or null if the token is invalid/expired. Idempotent on re-link (a chat that
 * links again just re-points to the new user).
 */
export async function linkIdentity(token: string, channel: BotChannel, chatId: string): Promise<LinkedUser | null> {
  await ensureBotRuntimeSchema();
  const rows = await sql`
    SELECT id, email, name, business_name FROM users
    WHERE bot_link_token = ${token} AND bot_link_token_expires_at > NOW()
    LIMIT 1
  `;
  const row = rows[0] as UserRow | undefined;
  if (!row) return null;

  await sql`
    INSERT INTO messaging_identities (user_id, channel, channel_user_id, linked_at)
    VALUES (${row.id}, ${channel}, ${chatId}, NOW())
    ON CONFLICT (channel, channel_user_id)
    DO UPDATE SET user_id = EXCLUDED.user_id, linked_at = NOW(), nudge_opt_out = FALSE
  `;
  // One-time: burn the token so the deep link can't be replayed.
  await sql`UPDATE users SET bot_link_token = NULL, bot_link_token_expires_at = NULL WHERE id = ${row.id}`;

  return toLinkedUser(row);
}

/** Toggle proactive-nudge opt-out for a linked chat. */
export async function setNudgeOptOut(channel: BotChannel, chatId: string, optOut: boolean): Promise<void> {
  await ensureBotRuntimeSchema();
  await sql`
    UPDATE messaging_identities SET nudge_opt_out = ${optOut}
    WHERE channel = ${channel} AND channel_user_id = ${chatId}
  `;
}

export function botDisplayName(user: LinkedUser): string {
  return user.businessName || user.name || "there";
}

/** Parse a deep-link token from `/start <token>` (Telegram) or `LINK <token>` (WhatsApp). */
export function extractLinkToken(text: string): string | null {
  const trimmed = text.trim();
  const startMatch = /^\/start\s+(\S+)$/.exec(trimmed);
  if (startMatch) return startMatch[1];
  const linkMatch = /^link[\s-]+(\S+)$/i.exec(trimmed);
  if (linkMatch) return linkMatch[1];
  return null;
}
