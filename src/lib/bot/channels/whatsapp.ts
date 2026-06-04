import type { BotButton, ChannelAdapter, InboundEvent, OutboundMessage } from "../types";

/**
 * WhatsApp Business Cloud API adapter.
 *
 * Dormant until WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_TOKEN are set — sends
 * no-op (with a logged reason) and the webhook is simply never configured at
 * Meta, so no inbound traffic arrives. Once activated it runs the SAME engine
 * as Telegram.
 *
 * Button mapping: ≤3 action buttons → interactive reply buttons; 4–10 → a list
 * message; URL buttons aren't supported in interactive messages, so they
 * degrade to inline links appended to the body. Message text is authored in
 * Telegram's HTML subset and converted to WhatsApp markup here.
 */

const GRAPH_VERSION = "v21.0";

function phoneNumberId(): string | null {
  return process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
}
function accessToken(): string | null {
  return process.env.WHATSAPP_TOKEN?.trim() || null;
}
export function whatsappConfigured(): boolean {
  return Boolean(phoneNumberId() && accessToken());
}

/** Convert the Telegram HTML subset to WhatsApp markup. */
export function htmlToWhatsApp(html: string): string {
  return html
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis, (_m, url: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== url ? `${text}: ${url}` : url;
    })
    .replace(/<\/?(?:b|strong)>/gi, "*")
    .replace(/<\/?(?:i|em)>/gi, "_")
    .replace(/<\/?code>/gi, "```")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Clamp to a code-point count (WhatsApp button/list titles have hard limits). */
function clamp(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join("") + "…";
}

async function postMessage(phoneId: string, token: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "<no body>");
    console.error("[bot:whatsapp:send_fail]", JSON.stringify({ to: payload.to, status: res.status, error: errText.slice(0, 500) }));
  }
}

async function sendWhatsAppMessage(chatId: string, message: OutboundMessage): Promise<void> {
  const phoneId = phoneNumberId();
  const token = accessToken();
  if (!phoneId || !token) {
    console.error("[bot:whatsapp:not_configured]", JSON.stringify({ hasPhoneId: Boolean(phoneId), hasToken: Boolean(token) }));
    return;
  }

  // Proactive sends outside the 24h window must ride an approved template.
  if (message.whatsappTemplate) {
    const tpl = message.whatsappTemplate;
    return postMessage(phoneId, token, {
      messaging_product: "whatsapp",
      to: chatId,
      type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.languageCode },
        components: tpl.variables.length
          ? [{ type: "body", parameters: tpl.variables.map((text) => ({ type: "text", text })) }]
          : [],
      },
    });
  }

  const flat: BotButton[] = (message.buttons ?? []).flat();
  const urlButtons = flat.filter((b): b is { label: string; url: string } => "url" in b);
  const actionButtons = flat.filter((b): b is { label: string; action: string } => "action" in b);

  let bodyText = htmlToWhatsApp(message.text);
  if (urlButtons.length) {
    bodyText += "\n\n" + urlButtons.map((b) => `${b.label}: ${b.url}`).join("\n");
  }

  if (actionButtons.length === 0) {
    return postMessage(phoneId, token, {
      messaging_product: "whatsapp",
      to: chatId,
      type: "text",
      text: { body: clamp(bodyText, 4096), preview_url: false },
    });
  }

  if (actionButtons.length <= 3) {
    return postMessage(phoneId, token, {
      messaging_product: "whatsapp",
      to: chatId,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: clamp(bodyText, 1024) },
        action: {
          buttons: actionButtons.map((b) => ({ type: "reply", reply: { id: b.action, title: clamp(b.label, 20) } })),
        },
      },
    });
  }

  // 4–10 action buttons → list message (Meta caps total rows at 10).
  const rows = actionButtons.slice(0, 10).map((b) => ({ id: b.action, title: clamp(b.label, 24) }));
  if (actionButtons.length > 10) {
    console.warn("[bot:whatsapp:list_truncated]", JSON.stringify({ to: chatId, dropped: actionButtons.length - 10 }));
  }
  return postMessage(phoneId, token, {
    messaging_product: "whatsapp",
    to: chatId,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: clamp(bodyText, 1024) },
      action: { button: "Options", sections: [{ rows }] },
    },
  });
}

// --- Inbound normalization -------------------------------------------------

interface WaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
}
interface WaValue {
  messages?: WaMessage[];
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
}
interface WaWebhookBody {
  entry?: Array<{ changes?: Array<{ value?: WaValue }> }>;
}

export function parseWhatsAppWebhook(body: unknown): InboundEvent | null {
  const value = (body as WaWebhookBody)?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg || !msg.from) return null; // delivery/read status callbacks carry no message

  const name = value?.contacts?.[0]?.profile?.name;

  if (msg.type === "text") {
    const text = msg.text?.body?.trim();
    return { channel: "whatsapp", chatId: msg.from, userId: msg.from, name, text: text || undefined };
  }
  if (msg.type === "interactive") {
    const payload = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
    return { channel: "whatsapp", chatId: msg.from, userId: msg.from, name, payload: payload || undefined };
  }
  // image / audio / document / location / sticker / etc.
  return { channel: "whatsapp", chatId: msg.from, userId: msg.from, name, nonText: true };
}

export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",
  send: sendWhatsAppMessage,
};
