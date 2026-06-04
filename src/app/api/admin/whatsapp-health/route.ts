/**
 * WhatsApp Business Cloud API diagnostics & ops, admin-gated. Mirrors
 * src/app/api/admin/telegram-health/route.ts so prod wiring can be inspected
 * without redeploying.
 *
 *   GET  /api/admin/whatsapp-health             → env check + phone-number lookup + diagnosis
 *   POST /api/admin/whatsapp-health?action=test&to=<e164> → send a plain test message
 *
 * Note: a free-form test message only delivers if the recipient has messaged
 * the business within the last 24h; otherwise Meta requires an approved
 * template. The Graph response is returned verbatim so that's visible.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";

const GRAPH_VERSION = "v21.0";

function envValue(key: string): string | null {
  const v = process.env[key]?.trim();
  return v ? v : null;
}

function expectedWebhookUrl(): string {
  const appUrl = (envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me").replace(/\/+$/, "");
  return `${appUrl}/api/whatsapp/webhook`;
}

function envSnapshot() {
  return {
    WHATSAPP_TOKEN: Boolean(envValue("WHATSAPP_TOKEN")),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(envValue("WHATSAPP_PHONE_NUMBER_ID")),
    WHATSAPP_VERIFY_TOKEN: Boolean(envValue("WHATSAPP_VERIFY_TOKEN")),
    WHATSAPP_APP_SECRET: Boolean(envValue("WHATSAPP_APP_SECRET")),
    WHATSAPP_BUSINESS_NUMBER: envValue("WHATSAPP_BUSINESS_NUMBER") ?? "(unset — wa.me deep links disabled)",
    expectedWebhookUrl: expectedWebhookUrl(),
  };
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const token = envValue("WHATSAPP_TOKEN");
  const phoneId = envValue("WHATSAPP_PHONE_NUMBER_ID");
  const issues: string[] = [];

  if (!token) issues.push("WHATSAPP_TOKEN not set");
  if (!phoneId) issues.push("WHATSAPP_PHONE_NUMBER_ID not set");
  if (!envValue("WHATSAPP_VERIFY_TOKEN")) issues.push("WHATSAPP_VERIFY_TOKEN not set — the webhook GET handshake will fail");
  if (!envValue("WHATSAPP_APP_SECRET")) issues.push("WHATSAPP_APP_SECRET not set — inbound signature won't be verified (recommended)");

  let phone: unknown = null;
  if (token && phoneId) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,platform_type`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    phone = await res.json().catch(() => null);
    if (!res.ok) issues.push(`Graph phone lookup failed (HTTP ${res.status}) — check WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID`);
  }

  return NextResponse.json({
    ok: issues.length === 0,
    configured: Boolean(token && phoneId),
    env: envSnapshot(),
    phone,
    diagnosis: issues,
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "test";
  if (action !== "test") {
    return NextResponse.json({ ok: false, error: "action must be 'test'" }, { status: 400 });
  }

  const token = envValue("WHATSAPP_TOKEN");
  const phoneId = envValue("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) {
    return NextResponse.json({ ok: false, error: "WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set" }, { status: 500 });
  }

  const to = url.searchParams.get("to")?.replace(/[^\d]/g, "");
  if (!to) {
    return NextResponse.json({ ok: false, error: "pass ?to=<recipient phone in digits, E.164 without +>" }, { status: 400 });
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: "✅ TenderPath WhatsApp is wired up. (test message)" },
    }),
  });
  const response = await res.json().catch(() => null);

  return NextResponse.json({ ok: res.ok, status: res.status, response });
}
