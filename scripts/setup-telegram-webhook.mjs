/**
 * Register the Telegram webhook and print getWebhookInfo.
 *
 * Use when:
 *  - A user reports "/start does nothing" (the webhook may have drifted or
 *    been silently de-registered)
 *  - The webhook URL changes (new domain, secret rotation)
 *  - Diagnosing per-user delivery failures — getWebhookInfo's
 *    last_error_date / last_error_message / pending_update_count reveal
 *    whether Telegram is queueing deliveries
 *
 * Usage:
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *   NEXT_PUBLIC_APP_URL=https://www.tenderpath.me \
 *   node scripts/setup-telegram-webhook.mjs
 *
 * Optional flags:
 *   --dry      Skip setWebhook, only print getWebhookInfo
 *   --reset    Call deleteWebhook first (clears pending queue + last_error)
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set.");
  process.exit(1);
}

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me").replace(/\/+$/, "");
const webhookUrl = `${appUrl}/api/telegram/webhook`;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const args = new Set(process.argv.slice(2));

const api = `https://api.telegram.org/bot${token}`;

async function call(method, body) {
  const res = await fetch(`${api}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  return res.json();
}

console.log(`Target webhook: ${webhookUrl}`);
console.log(`Secret token set: ${secret ? "yes" : "no"}`);

if (args.has("--reset")) {
  console.log("\n→ deleteWebhook (drop_pending_updates=true)…");
  const del = await call("deleteWebhook", { drop_pending_updates: true });
  console.log(JSON.stringify(del, null, 2));
}

if (!args.has("--dry")) {
  console.log("\n→ setWebhook…");
  const set = await call("setWebhook", {
    url: webhookUrl,
    secret_token: secret || undefined,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  console.log(JSON.stringify(set, null, 2));
  if (!set.ok) {
    console.error("\nsetWebhook FAILED. Fix the error above and re-run.");
    process.exit(1);
  }
}

console.log("\n→ getWebhookInfo…");
const info = await call("getWebhookInfo");
console.log(JSON.stringify(info, null, 2));

console.log("\n→ getMe…");
const me = await call("getMe");
console.log(JSON.stringify(me, null, 2));

const r = info.result ?? {};
const issues = [];
if (r.url !== webhookUrl) issues.push(`url mismatch: have "${r.url}", want "${webhookUrl}"`);
if (secret && r.has_custom_certificate === undefined) {
  // Telegram doesn't echo secret_token; presence isn't directly verifiable from here.
}
if (r.pending_update_count > 0) issues.push(`pending_update_count=${r.pending_update_count} (Telegram has queued undelivered updates)`);
if (r.last_error_date) {
  const when = new Date(r.last_error_date * 1000).toISOString();
  issues.push(`last_error at ${when}: ${r.last_error_message ?? "(no message)"}`);
}

console.log("\n— Diagnosis —");
if (issues.length === 0) {
  console.log("Webhook looks healthy. If users still get no response, check Vercel logs for [tg:webhook:update] entries with the user's chat_id.");
} else {
  for (const i of issues) console.log("  · " + i);
  console.log("\nNext step: re-run with --reset if pending_update_count is high or last_error keeps recurring.");
}
