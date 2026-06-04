# WhatsApp go-live runbook

The bot engine, adapters, webhook, and proactive cron are already built and run
on the same core as Telegram. WhatsApp stays **dormant** until the steps below
are done — none of which can be automated, because they require a Meta Business
account and human verification. Once complete, WhatsApp behaves exactly like
Telegram (menus, account linking, LLM answers, inline actions) plus templated
proactive nudges.

## 1. Meta Business + WhatsApp Business Account

1. In [Meta Business Manager](https://business.facebook.com), create/confirm a Business and complete **business verification**.
2. Create a **WhatsApp Business Account (WABA)** and register the phone number you're dedicating to the bot.
   - ⚠️ The number is **consumed by the API** — it can no longer be used in the consumer WhatsApp or WhatsApp Business app. Use a number you don't use personally.
3. In the Meta App dashboard, add the **WhatsApp** product and note the **Phone number ID** and a **permanent system-user access token** (not the temporary 24h token).

## 2. Environment variables (set on Vercel)

| Variable | What it is |
|---|---|
| `WHATSAPP_TOKEN` | Permanent system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID from the WhatsApp product page |
| `WHATSAPP_VERIFY_TOKEN` | A random string **you choose**; pasted into the webhook config below |
| `WHATSAPP_APP_SECRET` | App secret (App → Settings → Basic) — verifies inbound payload signatures |
| `WHATSAPP_BUSINESS_NUMBER` | The dedicated number in digits, e.g. `201234567890` — powers the dashboard `wa.me` deep link |
| `TELEGRAM_BOT_USERNAME` | (optional) Telegram bot handle for deep links; defaults to `Tenderpathbot` |

## 3. Configure the webhook

In the Meta App → WhatsApp → Configuration → Webhook:

- **Callback URL:** `https://www.tenderpath.me/api/whatsapp/webhook`
- **Verify token:** the same value as `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save** (this triggers the GET handshake the route answers).
- **Subscribe** to the `messages` field.

## 4. Create the proactive-nudge template

Reactive replies (anything within 24h of the user's last message) need **no**
template. Proactive nudges sent by the `bot-nudges` cron are outside that window
and require an **approved utility template**.

Create a template in Meta → WhatsApp Manager → Message Templates:

- **Name:** `tenderpath_alert` (must match `WHATSAPP_NUDGE_TEMPLATE` in `src/lib/bot/proactive.ts`)
- **Category:** Utility
- **Language:** English
- **Body:**
  ```
  Hi {{1}}, you have {{2}} on TenderPath. Open your dashboard to review and act: https://www.tenderpath.me/dashboard
  ```
  - `{{1}}` = company/contact name · `{{2}}` = summary line (e.g. "2 new matches · 1 deadline approaching")

Submit for review. Until Meta approves it, proactive WhatsApp sends will be
rejected by the Graph API (visible in logs as `[bot:whatsapp:send_fail]`);
Telegram nudges are unaffected.

## 5. Verify

- `GET /api/admin/whatsapp-health` (signed in as an admin) → confirms env wiring and looks up the phone number via the Graph API.
- `POST /api/admin/whatsapp-health?action=test&to=<your number in digits>` → sends a plain test message (delivers only inside the 24h window).
- Message the business number from your phone → the bot should reply with the menu.
- Connect from the dashboard (**Settings → Connect assistant → Connect WhatsApp**) → the bot should greet you by name.

## Notes

- Inbound parsing, button mapping (reply buttons ≤3 / list ≤10 / URL→inline link), and HTML→WhatsApp-markup conversion all live in `src/lib/bot/channels/whatsapp.ts`.
- The webhook verifies `X-Hub-Signature-256` against `WHATSAPP_APP_SECRET` when set.
- Both channels share one engine; any future bot change applies to WhatsApp and Telegram at once.
