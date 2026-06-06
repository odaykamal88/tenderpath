import { NextResponse } from "next/server";
import { parseTelegramUpdate, telegramAdapter, type TgUpdate } from "@/lib/bot/channels/telegram";
import { handleEvent } from "@/lib/bot/engine";

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) {
    console.error("[bot:telegram:secret_missing]");
    return NextResponse.json({ error: "Telegram webhook secret is not configured" }, { status: 503 });
  }
  if (secret !== expectedSecret) {
    // Surface secret-token mismatches so a misconfigured webhook is
    // diagnosable — previously this silently returned 200.
    console.warn("[bot:telegram:secret_mismatch]", JSON.stringify({ haveSecret: Boolean(secret) }));
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    console.warn("[bot:telegram:bad_json]");
    return NextResponse.json({ ok: true });
  }

  const event = parseTelegramUpdate(update);

  // Always log every update so prod logs reveal which users actually reach the
  // webhook — critical when a specific user reports "nothing happened" and we
  // need to determine whether their message arrived at all.
  console.log("[bot:telegram:update]", JSON.stringify({
    update_id: update.update_id,
    kind: event?.payload ? "callback_query" : event?.text || event?.nonText ? "message" : "other",
    chat_id: event?.chatId ?? null,
    user_id: event?.userId ?? null,
    username: event?.username ?? null,
    lang: event?.lang ?? null,
    text: event?.text ? event.text.slice(0, 80) : null,
    data: event?.payload ?? null,
    has_non_text: event?.nonText ?? false,
  }));

  if (!event) return NextResponse.json({ ok: true });

  try {
    await handleEvent(event, telegramAdapter);
  } catch (err) {
    console.error("[bot:telegram:error]", err);
  }

  return NextResponse.json({ ok: true });
}
