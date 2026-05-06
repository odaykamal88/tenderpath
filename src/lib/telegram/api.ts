export type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };

function base(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `https://api.telegram.org/bot${token}`;
}

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: InlineButton[][]
): Promise<void> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

  const res = await fetch(`${base()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("[tg:sendMessage:error]", chatId, await res.text());
  }
}

export async function answerCallbackQuery(id: string): Promise<void> {
  await fetch(`${base()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id }),
  });
}
