import { NextResponse } from "next/server";
import crypto from "crypto";
import { parseWhatsAppWebhook, whatsappAdapter } from "@/lib/bot/channels/whatsapp";
import { handleEvent } from "@/lib/bot/engine";

/**
 * WhatsApp Business Cloud API webhook. Dormant until the Meta app is configured
 * to point here (see docs/agents/whatsapp-setup.md). Mirrors the Telegram
 * webhook discipline: log every inbound, never silently drop, verify the
 * payload signature.
 *
 *   GET  → Meta verification handshake (echo hub.challenge)
 *   POST → inbound messages (X-Hub-Signature-256 verified when app secret set)
 */

// Meta subscription-verification handshake.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();

  if (mode === "subscribe" && expected && token === expected) {
    return new Response(challenge ?? "", { status: 200 });
  }
  console.warn("[bot:whatsapp:verify_failed]", JSON.stringify({ mode, hasToken: Boolean(token), hasExpected: Boolean(expected) }));
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  // Read the raw body so the HMAC is computed over the exact bytes Meta signed.
  const raw = await request.text();

  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (appSecret) {
    const sig = request.headers.get("x-hub-signature-256") ?? "";
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
    const ok =
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) {
      console.warn("[bot:whatsapp:bad_signature]");
      return NextResponse.json({ ok: true });
    }
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.warn("[bot:whatsapp:bad_json]");
    return NextResponse.json({ ok: true });
  }

  const event = parseWhatsAppWebhook(body);
  console.log("[bot:whatsapp:update]", JSON.stringify({
    chat_id: event?.chatId ?? null,
    kind: event?.payload ? "interactive" : event?.text ? "message" : event?.nonText ? "non_text" : "status",
    has_non_text: event?.nonText ?? false,
  }));

  if (!event) return NextResponse.json({ ok: true });

  try {
    await handleEvent(event, whatsappAdapter);
  } catch (err) {
    console.error("[bot:whatsapp:error]", err);
  }

  return NextResponse.json({ ok: true });
}
