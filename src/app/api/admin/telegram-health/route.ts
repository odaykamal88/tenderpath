/**
 * Telegram webhook diagnostics & ops, admin-gated.
 *
 *   GET  /api/admin/telegram-health                → getWebhookInfo + getMe + env check + diagnosis
 *   POST /api/admin/telegram-health?action=setup   → setWebhook (re-register) then getWebhookInfo
 *   POST /api/admin/telegram-health?action=reset   → deleteWebhook(drop_pending_updates) then setWebhook
 *
 * Runs server-side on Vercel so it picks up TELEGRAM_BOT_TOKEN /
 * TELEGRAM_WEBHOOK_SECRET / NEXT_PUBLIC_APP_URL from the deployment env
 * without anyone having to copy secrets locally.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";

const ALLOWED_UPDATES = ["message", "callback_query"];

function envValue(key: string): string | null {
  const v = process.env[key]?.trim();
  return v ? v : null;
}

function api(token: string): string {
  return `https://api.telegram.org/bot${token}`;
}

async function tg(token: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${api(token)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  return res.json();
}

function diagnose(info: Record<string, unknown> | undefined, expectedUrl: string): string[] {
  const issues: string[] = [];
  if (!info) {
    issues.push("getWebhookInfo did not return a result (token invalid?)");
    return issues;
  }
  if (info.url !== expectedUrl) {
    issues.push(`url mismatch — Telegram has "${info.url || "(empty)"}", expected "${expectedUrl}". Re-register via POST ?action=setup.`);
  }
  const pending = typeof info.pending_update_count === "number" ? info.pending_update_count : 0;
  if (pending > 0) {
    issues.push(`pending_update_count=${pending} — Telegram has queued undelivered updates. POST ?action=reset to flush.`);
  }
  if (info.last_error_date) {
    const when = new Date((info.last_error_date as number) * 1000).toISOString();
    issues.push(`last_error at ${when}: ${info.last_error_message ?? "(no message)"}`);
  }
  const allowed = info.allowed_updates as string[] | undefined;
  if (allowed && !allowed.includes("message")) {
    issues.push(`allowed_updates does not include "message" — text messages won't trigger the webhook`);
  }
  return issues;
}

function envSnapshot(expectedUrl: string) {
  return {
    TELEGRAM_BOT_TOKEN: Boolean(envValue("TELEGRAM_BOT_TOKEN")),
    TELEGRAM_WEBHOOK_SECRET: Boolean(envValue("TELEGRAM_WEBHOOK_SECRET")),
    NEXT_PUBLIC_APP_URL: envValue("NEXT_PUBLIC_APP_URL") ?? "(unset — defaulting to https://www.tenderpath.me)",
    expectedWebhookUrl: expectedUrl,
  };
}

function expectedWebhookUrl(): string {
  const appUrl = (envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me").replace(/\/+$/, "");
  return `${appUrl}/api/telegram/webhook`;
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const token = envValue("TELEGRAM_BOT_TOKEN");
  const expected = expectedWebhookUrl();
  if (!token) {
    return NextResponse.json({
      ok: false,
      error: "TELEGRAM_BOT_TOKEN is not set on this deployment.",
      env: envSnapshot(expected),
    }, { status: 500 });
  }

  const [info, me] = await Promise.all([
    tg(token, "getWebhookInfo"),
    tg(token, "getMe"),
  ]);

  const infoResult = (info as { result?: Record<string, unknown> }).result;
  const meResult = (me as { result?: Record<string, unknown> }).result;

  return NextResponse.json({
    ok: true,
    env: envSnapshot(expected),
    bot: meResult ? { id: meResult.id, username: meResult.username, first_name: meResult.first_name } : null,
    webhook: infoResult ?? info,
    diagnosis: diagnose(infoResult, expected),
  });
}

export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "setup";
  if (action !== "setup" && action !== "reset") {
    return NextResponse.json({ ok: false, error: "action must be 'setup' or 'reset'" }, { status: 400 });
  }

  const token = envValue("TELEGRAM_BOT_TOKEN");
  const secret = envValue("TELEGRAM_WEBHOOK_SECRET");
  const expected = expectedWebhookUrl();
  if (!token) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set" }, { status: 500 });
  }

  const steps: Array<{ step: string; response: unknown }> = [];

  if (action === "reset") {
    const del = await tg(token, "deleteWebhook", { drop_pending_updates: true });
    steps.push({ step: "deleteWebhook(drop_pending_updates=true)", response: del });
  }

  const set = await tg(token, "setWebhook", {
    url: expected,
    secret_token: secret || undefined,
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: action === "reset",
  });
  steps.push({ step: "setWebhook", response: set });

  const info = await tg(token, "getWebhookInfo");
  steps.push({ step: "getWebhookInfo", response: info });

  const infoResult = (info as { result?: Record<string, unknown> }).result;

  return NextResponse.json({
    ok: true,
    action,
    env: envSnapshot(expected),
    steps,
    diagnosis: diagnose(infoResult, expected),
  });
}
