/**
 * Channel-agnostic bot contracts.
 *
 * The bot engine (`engine.ts`) only ever sees these normalized types. Each
 * messaging channel (Telegram, WhatsApp) provides a `ChannelAdapter` that
 * translates provider payloads → `InboundEvent` and `OutboundMessage` →
 * provider API calls. This keeps all behavior in one place and lets a second
 * channel be added without touching engine logic.
 */

export type BotChannel = "telegram" | "whatsapp";

/**
 * A button. `action` buttons trigger a bot callback (the action string is
 * echoed back as `InboundEvent.payload` when tapped); `url` buttons open a
 * link. Adapters render these per channel (Telegram inline keyboard; WhatsApp
 * interactive reply/list — URL buttons degrade to inline links).
 */
export type BotButton =
  | { label: string; action: string }
  | { label: string; url: string };

/** WhatsApp template descriptor — required to send outside the 24h window. */
export interface WhatsAppTemplate {
  name: string;
  languageCode: string;
  /** Body `{{1}}`, `{{2}}`… substitutions, in order. */
  variables: string[];
}

/**
 * A channel-agnostic outbound message. `text` is authored in the lightweight
 * HTML subset Telegram already uses (`<b>`, `<i>`, `<code>`, `<a href>`); the
 * WhatsApp adapter converts it to WhatsApp markup. Keep that subset only.
 */
export interface OutboundMessage {
  text: string;
  buttons?: BotButton[][];
  /**
   * Proactive (cron) sends outside WhatsApp's 24h customer-care window must
   * ride an approved template. Telegram ignores this and sends `text`.
   */
  whatsappTemplate?: WhatsAppTemplate;
}

/** A normalized inbound event produced by a channel adapter. */
export interface InboundEvent {
  channel: BotChannel;
  /** Stable per-conversation id — the reply target + session/identity key. */
  chatId: string;
  /** Free text the user typed (trimmed), if any. */
  text?: string;
  /** Button payload (the `action` of a tapped BotButton), if any. */
  payload?: string;
  /** Provider-side user id (may differ from chatId on some channels). */
  userId?: string;
  /** Display name, for greetings + escalation context. */
  name?: string;
  /** Provider handle (@username on Telegram), for escalation context. */
  username?: string;
  /** BCP-47-ish language hint from the provider, when available. */
  lang?: string;
  /** True when the user sent a non-text payload (photo/voice/etc.) we can't read. */
  nonText?: boolean;
  /** Opaque id the adapter needs to acknowledge a tapped button (Telegram). */
  callbackId?: string;
}

/** Channel adapter contract. */
export interface ChannelAdapter {
  readonly channel: BotChannel;
  /** Send a normalized message to a chat. */
  send(chatId: string, message: OutboundMessage): Promise<void>;
  /** Acknowledge a tapped button (no-op where the channel doesn't need it). */
  ackCallback?(callbackId: string): Promise<void>;
}
