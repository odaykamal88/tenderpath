import { sql } from "@/lib/db";
import type { ChannelAdapter, InboundEvent } from "./types";
import { getSession, setSession, clearSession } from "./sessions";
import {
  MAIN_MENU, LOGIN_MENU, FAQ_MENU, FAQ_BACK, ESCALATE_BACK, MENU_BACK, WELCOME, FAQ_ANSWERS,
} from "./content";
import { notifyAdminTelegram } from "./channels/telegram";
import { resolveUser, linkIdentity, extractLinkToken, botDisplayName, setNudgeOptOut, type LinkedUser } from "./identity";
import { answerQuestion } from "./nl";
import { loadLinkedMatches } from "./matches";
import { matchActionButtons, parseMatchAction, applyMatchAction } from "./actions";

/**
 * Channel-agnostic bot engine. Receives a normalized InboundEvent + the
 * adapter for the originating channel, runs the conversation state machine,
 * and replies via `adapter.send`. No provider-specific code lives here.
 *
 * When the chat is linked to a user account, the bot greets by name and scopes
 * lookups to that account. Unlinked chats can ask general questions or request
 * support, but never receive assessment or match data from an email-only lookup.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";

interface AssessmentRow {
  company_name: string;
  sector: string;
  readiness_score: number;
  matched_tenders: Array<{ title: string; agency: string; deadline?: string; match_reasons?: string[] }>;
  matched_grants: unknown[];
  recommended_tier: string;
  created_at: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

async function fetchAssessment(email: string): Promise<AssessmentRow | undefined> {
  const rows = await sql`
    SELECT company_name, sector, readiness_score, matched_tenders,
           matched_grants, recommended_tier, created_at
    FROM assessments
    WHERE LOWER(email) = LOWER(${email})
    ORDER BY created_at DESC LIMIT 1
  `;
  return rows[0] as AssessmentRow | undefined;
}

function welcomeText(user: LinkedUser | null): string {
  if (!user) return WELCOME;
  return (
    `Hey ${botDisplayName(user)} 👋\n\n` +
    `I can pull up your matches, help with your account, or get you to the team. ` +
    `I'll also ping you when new tenders match or a deadline's coming up.\n\n` +
    `What do you need?`
  );
}

async function sendMainMenu(adapter: ChannelAdapter, chatId: string, user: LinkedUser | null): Promise<void> {
  await adapter.send(chatId, { text: welcomeText(user), buttons: MAIN_MENU });
}

async function sendLinkedAccountRequired(
  adapter: ChannelAdapter,
  event: InboundEvent,
  intent: "assessment" | "matches",
): Promise<void> {
  console.warn("[bot:account_link_required]", {
    channel: event.channel,
    chatId: event.chatId,
    intent,
  });
  const label = intent === "assessment" ? "assessment" : "matches";
  await clearSession(event.channel, event.chatId);
  return adapter.send(event.chatId, {
    text:
      `For security, I can't show your ${label} from an email address in chat.\n\n` +
      `Sign in and connect the assistant from <b>Dashboard → Settings</b>, or open your dashboard directly: <a href="${APP_URL}/dashboard">${APP_URL}/dashboard</a>`,
    buttons: [[{ label: "Open dashboard", url: `${APP_URL}/dashboard` }, { label: "💬 Talk to Team", action: "menu_escalate" }], [{ label: "⌂ Menu", action: "back_menu" }]],
  });
}

async function handleCallbackPayload(event: InboundEvent, adapter: ChannelAdapter, user: LinkedUser | null): Promise<void> {
  const chatId = event.chatId;
  const data = event.payload ?? "";

  // Inline match actions (Save / Not relevant) — only meaningful for a linked
  // user, since they write to that account's feedback.
  const matchAction = parseMatchAction(data);
  if (matchAction) {
    if (!user) {
      return adapter.send(chatId, {
        text: "Connect your account first so I can save this for you — open <b>Settings → Connect assistant</b> on your dashboard.",
        buttons: MENU_BACK,
      });
    }
    await applyMatchAction(user.id, matchAction);
    const msg = matchAction.kind === "save"
      ? "✅ Saved — it's in your dashboard pipeline."
      : "👍 Got it — I'll keep that out of your matches.";
    return adapter.send(chatId, {
      text: msg,
      buttons: [[{ label: "🎯 More matches", action: "menu_matches" }, { label: "⌂ Menu", action: "back_menu" }]],
    });
  }

  if (data === "back_menu") {
    await clearSession(event.channel, chatId);
    return sendMainMenu(adapter, chatId, user);
  }

  if (data === "nudge_off") {
    if (user) await setNudgeOptOut(event.channel, chatId, true);
    return adapter.send(chatId, {
      text: "🔕 Alerts paused — I won't send proactive nudges. You can turn them back on anytime.",
      buttons: [[{ label: "🔔 Resume alerts", action: "nudge_on" }, { label: "⌂ Menu", action: "back_menu" }]],
    });
  }

  if (data === "nudge_on") {
    if (user) await setNudgeOptOut(event.channel, chatId, false);
    return adapter.send(chatId, {
      text: "🔔 Alerts on — I'll ping you about new matches and approaching deadlines.",
      buttons: MENU_BACK,
    });
  }

  if (data === "menu_faq") {
    return adapter.send(chatId, { text: "What do you want to know?", buttons: FAQ_MENU });
  }

  if (data.startsWith("faq_")) {
    const answer = FAQ_ANSWERS[data];
    if (answer) await adapter.send(chatId, { text: answer, buttons: FAQ_BACK });
    return;
  }

  if (data === "menu_login") {
    return adapter.send(chatId, { text: "How do you normally sign in?", buttons: LOGIN_MENU });
  }

  if (data === "login_google") {
    return adapter.send(chatId, {
      text:
        `Here's how to get back in with Google:\n\n` +
        `1. Head to <a href="${APP_URL}/login">${APP_URL}/login</a>\n` +
        `2. Hit <b>Continue with Google</b>\n` +
        `3. Pick the Google account you signed up with\n\n` +
        `Seeing "Account not found"? Your account might be under a different email — tap "Talk to Team" and I'll pass it to the team to check.`,
      buttons: [[{ label: "💬 Talk to Team", action: "menu_escalate" }, { label: "← Back", action: "menu_login" }]],
    });
  }

  if (data === "login_magic") {
    return adapter.send(chatId, {
      text:
        `Magic link not working? Here's the drill:\n\n` +
        `1. Go to <a href="${APP_URL}/login">${APP_URL}/login</a>\n` +
        `2. Enter your email and hit <b>Send magic link</b>\n` +
        `3. Check your inbox — and spam, just in case\n` +
        `4. Click the link (it's single-use, so don't open it twice)\n\n` +
        `Still nothing? Tap "Talk to Team" and we'll dig into it.`,
      buttons: [[{ label: "💬 Talk to Team", action: "menu_escalate" }, { label: "← Back", action: "menu_login" }]],
    });
  }

  // Linked users skip the email prompt — their lookups are scoped to the
  // account that owns this chat.
  if (data === "menu_assessment") {
    if (user) return handleAssessmentResult(adapter, chatId, user.email);
    return sendLinkedAccountRequired(adapter, event, "assessment");
  }

  if (data === "menu_matches") {
    if (user) return handleLinkedMatches(adapter, chatId, user);
    return sendLinkedAccountRequired(adapter, event, "matches");
  }

  if (data === "menu_escalate") {
    if (user) return handleEscalation(adapter, event, user.email);
    await setSession(event.channel, chatId, { state: "awaiting_email", intent: "escalate" });
    return adapter.send(chatId, { text: "What's your email so I can pass it along?" });
  }
}

async function handleAssessmentResult(adapter: ChannelAdapter, chatId: string, email: string): Promise<void> {
  const row = await fetchAssessment(email);
  if (!row) {
    await adapter.send(chatId, {
      text:
        `Hmm, nothing came up for <code>${email}</code>.\n\n` +
        `Worth double-checking the address — if it's right and you haven't run one yet, you can do it free here: <a href="${APP_URL}">${APP_URL}</a>`,
      buttons: ESCALATE_BACK,
    });
    return;
  }
  const tenderCount = Array.isArray(row.matched_tenders) ? row.matched_tenders.length : 0;
  const grantCount = Array.isArray(row.matched_grants) ? row.matched_grants.length : 0;
  await adapter.send(chatId, {
    text:
      `<b>Your latest assessment</b>\n\n` +
      `🏢 <b>${row.company_name}</b>\n` +
      `🏷 Sector: ${row.sector}\n` +
      `📊 Readiness: ${row.readiness_score}/100\n` +
      `🎯 Tenders matched: ${tenderCount}\n` +
      `💡 Grants matched: ${grantCount}\n` +
      `📋 Recommended path: ${row.recommended_tier}\n` +
      `🗓 Assessed: ${formatDate(row.created_at)}\n\n` +
      `<a href="${APP_URL}/dashboard">View your full dashboard →</a>`,
    buttons: MENU_BACK,
  });
}

async function handleMatchesResult(adapter: ChannelAdapter, chatId: string, email: string): Promise<void> {
  const row = await fetchAssessment(email);
  if (!row || !Array.isArray(row.matched_tenders) || row.matched_tenders.length === 0) {
    await adapter.send(chatId, {
      text:
        `No matches on file for <code>${email}</code> yet.\n\n` +
        `If your assessment just finished, give it a minute and check your dashboard: <a href="${APP_URL}/dashboard">${APP_URL}/dashboard</a>`,
      buttons: ESCALATE_BACK,
    });
    return;
  }
  const top = row.matched_tenders.slice(0, 3);
  const lines = top.map((t, i) => {
    const reasons = t.match_reasons?.slice(0, 2).join(", ") ?? "sector + capability match";
    const deadline = t.deadline ? `📅 ${t.deadline}` : "";
    return `${i + 1}. <b>${t.title}</b> — ${t.agency}\n   ${deadline}  💡 ${reasons}`;
  });
  await adapter.send(chatId, {
    text: `<b>Your top matches</b>\n\n${lines.join("\n\n")}\n\n` + `<a href="${APP_URL}/dashboard">See all matches →</a>`,
    buttons: MENU_BACK,
  });
}

/**
 * Linked-user matches with inline actions. Sources actionable matches (with a
 * real tender_id) from the dashboard pipeline; falls back to the email-keyed
 * assessment summary when there are no actionable rows yet.
 */
async function handleLinkedMatches(adapter: ChannelAdapter, chatId: string, user: LinkedUser): Promise<void> {
  const matches = await loadLinkedMatches(user.id, 3);
  if (matches.length === 0) {
    return handleMatchesResult(adapter, chatId, user.email);
  }
  await adapter.send(chatId, {
    text:
      `<b>Your top ${matches.length === 1 ? "match" : `${matches.length} matches`}</b>\n\n` +
      `Save the ones worth pursuing, hide the rest, or run a bid analysis. 👇`,
  });
  for (const m of matches) {
    const fit = m.fitScore ? `\n📊 Fit: ${m.fitScore}/100` : "";
    const deadline = m.deadline ? `\n📅 Deadline: ${formatDate(m.deadline)}` : "";
    await adapter.send(chatId, {
      text: `<b>${m.title}</b>\n🏛 ${m.agency ?? "Agency"}${fit}${deadline}`,
      buttons: matchActionButtons(m),
    });
  }
  await adapter.send(chatId, {
    text: `<a href="${APP_URL}/dashboard">See all your matches →</a>`,
    buttons: MENU_BACK,
  });
}

async function handleEscalation(adapter: ChannelAdapter, event: InboundEvent, email: string): Promise<void> {
  await setSession(event.channel, event.chatId, { state: "awaiting_message", intent: "escalate", email });
  const name = event.name ?? "there";
  await adapter.send(event.chatId, { text: `Got it, ${name}. What's going on? Give me a quick summary:` });
}

async function finalizeEscalation(adapter: ChannelAdapter, event: InboundEvent, email: string, message: string): Promise<void> {
  const username = event.username ? `@${event.username}` : `chat ${event.chatId}`;
  const name = event.name ?? "Unknown";
  await adapter.send(event.chatId, {
    text:
      `All good — we'll be in touch shortly, typically within one business day.\n\nIf it's urgent, drop a line at <a href="mailto:info@tenderpath.me">info@tenderpath.me</a>.`,
    buttons: MENU_BACK,
  });
  await notifyAdminTelegram(
    `🚨 <b>Support escalation</b>\n\n` +
    `📡 Channel: ${event.channel}\n` +
    `👤 ${name} (${username})\n` +
    `📧 ${email}\n` +
    `💬 ${message}\n\n` +
    `🕐 ${new Date().toUTCString()}`
  );
}

async function handleLinkToken(event: InboundEvent, adapter: ChannelAdapter, token: string): Promise<void> {
  const linked = await linkIdentity(token, event.channel, event.chatId);
  await clearSession(event.channel, event.chatId);
  if (!linked) {
    await adapter.send(event.chatId, {
      text:
        `That connection link didn't work — it may have expired (they last 30 minutes).\n\n` +
        `Grab a fresh one from your dashboard under <b>Settings → Connect assistant</b>.`,
      buttons: MAIN_MENU,
    });
    return;
  }
  await adapter.send(event.chatId, {
    text:
      `✅ Connected to <b>${botDisplayName(linked)}</b>.\n\n` +
      `From now on I know it's you — no need to type your email. I'll also ping you when new tenders match or a deadline's approaching.\n\n` +
      `What do you need?`,
    buttons: MAIN_MENU,
  });
}

async function handleTextMessage(event: InboundEvent, adapter: ChannelAdapter, user: LinkedUser | null): Promise<void> {
  const chatId = event.chatId;
  const text = event.text ?? "";

  // Always respond to non-text payloads instead of silently dropping. A user
  // who voice-notes or stickers the bot and gets nothing back assumes it's
  // broken — they don't know it only handles text.
  if (!text && event.nonText) {
    return adapter.send(chatId, {
      text: "I can only read text messages right now. Tap a button or type /start to see what I can help with:",
      buttons: MAIN_MENU,
    });
  }

  if (!text) {
    return adapter.send(chatId, { text: "Didn't catch that — try /start:", buttons: MAIN_MENU });
  }

  // Account-linking deep link: `/start <token>` (Telegram) or `LINK <token>` (WhatsApp).
  const token = extractLinkToken(text);
  if (token) {
    return handleLinkToken(event, adapter, token);
  }

  if (text === "/start" || text === "/help") {
    await clearSession(event.channel, chatId);
    return sendMainMenu(adapter, chatId, user);
  }

  const session = await getSession(event.channel, chatId);

  if (session.state === "awaiting_email") {
    const email = text.toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return adapter.send(chatId, { text: "That doesn't look quite right — want to try again?" });
    }
    await clearSession(event.channel, chatId);
    if (session.intent === "assessment") return sendLinkedAccountRequired(adapter, event, "assessment");
    if (session.intent === "matches") return sendLinkedAccountRequired(adapter, event, "matches");
    if (session.intent === "escalate") return handleEscalation(adapter, event, email);
  }

  if (session.state === "awaiting_message" && session.intent === "escalate" && session.email) {
    await clearSession(event.channel, chatId);
    return finalizeEscalation(adapter, event, session.email, text);
  }

  // Free text outside any flow → try a grounded LLM answer (product knowledge
  // for anyone; the user's own assessment + matches when the chat is linked).
  // Falls back to the menu if the model is unavailable or returns nothing.
  const answer = await answerQuestion({ user, channel: event.channel, question: text });
  if (answer) {
    return adapter.send(chatId, {
      text: answer.text,
      buttons: [[{ label: "💬 Talk to Team", action: "menu_escalate" }, { label: "⌂ Menu", action: "back_menu" }]],
    });
  }

  // Unrecognised input and no model answer — acknowledge and show menu.
  await adapter.send(chatId, { text: "Not sure I caught that one. Here's what I can help with:", buttons: MAIN_MENU });
}

/** Single entry point. The webhook routes call this with a normalized event. */
export async function handleEvent(event: InboundEvent, adapter: ChannelAdapter): Promise<void> {
  if (event.callbackId && adapter.ackCallback) {
    await adapter.ackCallback(event.callbackId);
  }
  const user = await resolveUser(event.channel, event.chatId);
  if (event.payload) {
    return handleCallbackPayload(event, adapter, user);
  }
  return handleTextMessage(event, adapter, user);
}
