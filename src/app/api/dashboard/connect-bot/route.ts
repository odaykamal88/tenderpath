import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { mintLinkToken } from "@/lib/bot/identity";

/**
 * Mint a one-time deep-link token so a signed-in user can connect their
 * Telegram / WhatsApp chat to their account. Auth-gated by the proxy + the
 * getUserFromRequest check. Returns ready-to-open deep links.
 */

const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME ?? "Tenderpathbot").replace(/^@/, "");

export async function POST(request: Request): Promise<Response> {
  let contextForLog = "connect-bot:start";
  try {
    const user = await getUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: "Authentication required", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    contextForLog = `connect-bot:user:${user.id}`;

    const token = await mintLinkToken(user.id);

    const telegramUrl = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;

    // WhatsApp deep link only when a business number is configured — never
    // invent a number. `LINK <token>` is what the engine parses on first message.
    const waNumber = process.env.WHATSAPP_BUSINESS_NUMBER?.trim().replace(/[^\d]/g, "");
    const whatsappUrl = waNumber
      ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`LINK ${token}`)}`
      : null;

    return NextResponse.json({ ok: true, telegramUrl, whatsappUrl });
  } catch (err) {
    console.error("[bot:connect:error]", JSON.stringify({ context: contextForLog }), err);
    return NextResponse.json({ error: "Failed to create connection link" }, { status: 500 });
  }
}
