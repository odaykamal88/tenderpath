import type { BotButton, ChannelAdapter, InboundEvent, OutboundMessage } from "../types";

/**
 * Telegram channel adapter. Wraps the Bot API: renders BotButtons as inline
 * keyboards and sends HTML-parse-mode messages. Inbound updates are normalized
 * to InboundEvent. All failures log a stable `[bot:telegram:*]` tag.
 */

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

function apiBase(): string {
  return `https://api.telegram.org/bot${botToken()}`;
}

type TgInlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

function toTelegramKeyboard(buttons?: BotButton[][]): TgInlineButton[][] | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  return buttons.map((row) =>
    row.map((b) =>
      "url" in b ? { text: b.label, url: b.url } : { text: b.label, callback_data: b.action }
    )
  );
}

async function sendTelegramMessage(chatId: string, message: OutboundMessage): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: message.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  const keyboard = toTelegramKeyboard(message.buttons);
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

  const res = await fetch(`${apiBase()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Log status + body so blocked-bot (403) and rate-limit (429) failures are
    // searchable in Vercel logs, not just an opaque error.
    const errText = await res.text().catch(() => "<no body>");
    console.error("[bot:telegram:send_fail]", JSON.stringify({ chatId, status: res.status, error: errText }));
  }
}

async function ackCallback(callbackId: string): Promise<void> {
  await fetch(`${apiBase()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
  }).catch((err) => console.error("[bot:telegram:ack_fail]", err));
}

/**
 * Notify the human admin. Support escalations always land on Telegram
 * regardless of which channel the user is on — that's where the team watches.
 */
export async function notifyAdminTelegram(text: string): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID ?? "5825303923";
  await sendTelegramMessage(adminChatId, { text });
}

// --- Inbound normalization -------------------------------------------------

interface TgUser { id: number; first_name?: string; username?: string; language_code?: string }
interface TgMessage {
  chat: { id: number };
  from?: TgUser;
  text?: string;
  photo?: unknown; voice?: unknown; audio?: unknown; video?: unknown; video_note?: unknown;
  document?: unknown; sticker?: unknown; animation?: unknown; location?: unknown; contact?: unknown;
}
interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id?: number; message?: TgMessage; callback_query?: TgCallbackQuery }

function isNonTextPayload(msg: TgMessage): boolean {
  return Boolean(
    msg.photo || msg.voice || msg.audio || msg.video || msg.video_note ||
    msg.document || msg.sticker || msg.animation || msg.location || msg.contact
  );
}

export function parseTelegramUpdate(update: TgUpdate): InboundEvent | null {
  const cq = update.callback_query;
  if (cq) {
    return {
      channel: "telegram",
      chatId: String(cq.message?.chat.id ?? cq.from.id),
      payload: cq.data,
      callbackId: cq.id,
      userId: String(cq.from.id),
      name: cq.from.first_name,
      username: cq.from.username,
      lang: cq.from.language_code,
    };
  }
  const m = update.message;
  if (m) {
    const text = m.text?.trim();
    return {
      channel: "telegram",
      chatId: String(m.chat.id),
      text: text || undefined,
      userId: m.from ? String(m.from.id) : undefined,
      name: m.from?.first_name,
      username: m.from?.username,
      lang: m.from?.language_code,
      nonText: !text && isNonTextPayload(m),
    };
  }
  return null;
}

export const telegramAdapter: ChannelAdapter = {
  channel: "telegram",
  send: sendTelegramMessage,
  ackCallback,
};
