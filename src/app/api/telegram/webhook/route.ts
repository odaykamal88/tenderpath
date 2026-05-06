import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { sendMessage, answerCallbackQuery } from "@/lib/telegram/api";
import { getSession, setSession, clearSession } from "@/lib/telegram/sessions";
import { MAIN_MENU, LOGIN_MENU, FAQ_MENU, FAQ_BACK, ESCALATE_BACK, WELCOME, FAQ_ANSWERS } from "@/lib/telegram/content";

const ADMIN_CHAT_ID = Number(process.env.TELEGRAM_ADMIN_CHAT_ID ?? "5825303923");
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";

interface TgUser { id: number; first_name?: string; username?: string }
interface TgMessage { chat: { id: number }; from?: TgUser; text?: string }
interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string }
interface TgUpdate { message?: TgMessage; callback_query?: TgCallbackQuery }

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

async function sendMainMenu(chatId: number): Promise<void> {
  await sendMessage(chatId, WELCOME, MAIN_MENU);
}

async function handleCallback(cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat.id ?? cq.from.id;
  const data = cq.data ?? "";
  await answerCallbackQuery(cq.id);

  if (data === "back_menu") {
    await clearSession(chatId);
    return sendMainMenu(chatId);
  }

  if (data === "menu_faq") {
    return sendMessage(chatId, "What do you want to know?", FAQ_MENU);
  }

  if (data.startsWith("faq_")) {
    const answer = FAQ_ANSWERS[data];
    if (answer) await sendMessage(chatId, answer, FAQ_BACK);
    return;
  }

  if (data === "menu_login") {
    return sendMessage(chatId, "How do you normally sign in?", LOGIN_MENU);
  }

  if (data === "login_google") {
    return sendMessage(
      chatId,
      `Here's how to get back in with Google:\n\n` +
      `1. Head to <a href="${APP_URL}/login">${APP_URL}/login</a>\n` +
      `2. Hit <b>Continue with Google</b>\n` +
      `3. Pick the Google account you signed up with\n\n` +
      `Seeing "Account not found"? Your account might be under a different email — tap "Talk to Team" and I'll pass it to the team to check.`,
      [[{ text: "💬 Talk to Team", callback_data: "menu_escalate" }, { text: "← Back", callback_data: "menu_login" }]]
    );
  }

  if (data === "login_magic") {
    return sendMessage(
      chatId,
      `Magic link not working? Here's the drill:\n\n` +
      `1. Go to <a href="${APP_URL}/login">${APP_URL}/login</a>\n` +
      `2. Enter your email and hit <b>Send magic link</b>\n` +
      `3. Check your inbox — and spam, just in case\n` +
      `4. Click the link (it's single-use, so don't open it twice)\n\n` +
      `Still nothing? Tap "Talk to Team" and we'll dig into it.`,
      [[{ text: "💬 Talk to Team", callback_data: "menu_escalate" }, { text: "← Back", callback_data: "menu_login" }]]
    );
  }

  if (data === "menu_assessment") {
    await setSession(chatId, { state: "awaiting_email", intent: "assessment" });
    return sendMessage(chatId, "Which email did you use for your assessment?");
  }

  if (data === "menu_matches") {
    await setSession(chatId, { state: "awaiting_email", intent: "matches" });
    return sendMessage(chatId, "Which email is your account under?");
  }

  if (data === "menu_escalate") {
    await setSession(chatId, { state: "awaiting_email", intent: "escalate" });
    return sendMessage(chatId, "What's your email so I can pass it along?");
  }
}

async function handleAssessmentResult(chatId: number, email: string): Promise<void> {
  const row = await fetchAssessment(email);
  if (!row) {
    await sendMessage(
      chatId,
      `Hmm, nothing came up for <code>${email}</code>.\n\n` +
      `Worth double-checking the address — if it's right and you haven't run one yet, you can do it free here: <a href="${APP_URL}">${APP_URL}</a>`,
      ESCALATE_BACK
    );
    return;
  }
  const tenderCount = Array.isArray(row.matched_tenders) ? row.matched_tenders.length : 0;
  const grantCount = Array.isArray(row.matched_grants) ? row.matched_grants.length : 0;
  await sendMessage(
    chatId,
    `<b>Your latest assessment</b>\n\n` +
    `🏢 <b>${row.company_name}</b>\n` +
    `🏷 Sector: ${row.sector}\n` +
    `📊 Readiness: ${row.readiness_score}/100\n` +
    `🎯 Tenders matched: ${tenderCount}\n` +
    `💡 Grants matched: ${grantCount}\n` +
    `📋 Recommended path: ${row.recommended_tier}\n` +
    `🗓 Assessed: ${formatDate(row.created_at)}\n\n` +
    `<a href="${APP_URL}/dashboard">View your full dashboard →</a>`,
    [[{ text: "⌂ Main menu", callback_data: "back_menu" }]]
  );
}

async function handleMatchesResult(chatId: number, email: string): Promise<void> {
  const row = await fetchAssessment(email);
  if (!row || !Array.isArray(row.matched_tenders) || row.matched_tenders.length === 0) {
    await sendMessage(
      chatId,
      `No matches on file for <code>${email}</code> yet.\n\n` +
      `If your assessment just finished, give it a minute and check your dashboard: <a href="${APP_URL}/dashboard">${APP_URL}/dashboard</a>`,
      ESCALATE_BACK
    );
    return;
  }
  const top = row.matched_tenders.slice(0, 3);
  const lines = top.map((t, i) => {
    const reasons = t.match_reasons?.slice(0, 2).join(", ") ?? "sector + capability match";
    const deadline = t.deadline ? `📅 ${t.deadline}` : "";
    return `${i + 1}. <b>${t.title}</b> — ${t.agency}\n   ${deadline}  💡 ${reasons}`;
  });
  await sendMessage(
    chatId,
    `<b>Your top matches</b>\n\n${lines.join("\n\n")}\n\n` +
    `<a href="${APP_URL}/dashboard">See all matches →</a>`,
    [[{ text: "⌂ Main menu", callback_data: "back_menu" }]]
  );
}

async function handleEscalation(chatId: number, email: string, from?: TgUser): Promise<void> {
  await setSession(chatId, { state: "awaiting_message", intent: "escalate", email });
  const name = from?.first_name ?? "there";
  await sendMessage(chatId, `Got it, ${name}. What's going on? Give me a quick summary:`);
}

async function finalizeEscalation(chatId: number, email: string, message: string, from?: TgUser): Promise<void> {
  const username = from?.username ? `@${from.username}` : `chat ${chatId}`;
  const name = from?.first_name ?? "Unknown";
  await sendMessage(
    chatId,
    `All good — we'll be in touch shortly, typically within one business day.\n\nIf it's urgent, drop a line at <a href="mailto:info@tenderpath.me">info@tenderpath.me</a>.`,
    [[{ text: "⌂ Main menu", callback_data: "back_menu" }]]
  );
  await sendMessage(
    ADMIN_CHAT_ID,
    `🚨 <b>Support escalation</b>\n\n` +
    `👤 ${name} (${username})\n` +
    `📧 ${email}\n` +
    `💬 ${message}\n\n` +
    `🕐 ${new Date().toUTCString()}`
  );
}

async function handleMessage(msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = msg.text?.trim() ?? "";

  if (text === "/start" || text === "/help") {
    await clearSession(chatId);
    return sendMainMenu(chatId);
  }

  const session = await getSession(chatId);

  if (session.state === "awaiting_email") {
    const email = text.toLowerCase();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return sendMessage(chatId, "That doesn't look quite right — want to try again?");
    }
    await clearSession(chatId);
    if (session.intent === "assessment") return handleAssessmentResult(chatId, email);
    if (session.intent === "matches") return handleMatchesResult(chatId, email);
    if (session.intent === "escalate") return handleEscalation(chatId, email, msg.from);
  }

  if (session.state === "awaiting_message" && session.intent === "escalate" && session.email) {
    await clearSession(chatId);
    return finalizeEscalation(chatId, session.email, text, msg.from);
  }

  // Unrecognised input — acknowledge and show menu
  await sendMessage(chatId, "Not sure I caught that one. Here's what I can help with:", MAIN_MENU);
}

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: true });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message?.text) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("[tg:webhook:error]", err);
  }

  return NextResponse.json({ ok: true });
}
