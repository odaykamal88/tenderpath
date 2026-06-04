import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureBotRuntimeSchema } from "@/lib/bot/schema";
import { telegramAdapter } from "@/lib/bot/channels/telegram";
import { whatsappAdapter } from "@/lib/bot/channels/whatsapp";
import { buildUserNudge, renderNudgeText, nudgeButtons, whatsappNudgeTemplate } from "@/lib/bot/proactive";
import { botDisplayName } from "@/lib/bot/identity";
import type { BotChannel, ChannelAdapter } from "@/lib/bot/types";

export const maxDuration = 60;

// At most one proactive push per linked identity per this window.
const NUDGE_INTERVAL_HOURS = 72;
// Window for detecting "new" matches when the identity has never been nudged.
const FIRST_LOOKBACK_DAYS = 7;

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[bot:nudges] CRON_SECRET not configured — refusing request");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

const ADAPTERS: Record<BotChannel, ChannelAdapter> = {
  telegram: telegramAdapter,
  whatsapp: whatsappAdapter,
};

interface IdentityRow {
  id: number;
  channel: BotChannel;
  channel_user_id: string;
  user_id: number;
  last_nudge_at: string | null;
  name: string | null;
  business_name: string | null;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureBotRuntimeSchema();

  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const nudgeCutoffIso = new Date(Date.now() - NUDGE_INTERVAL_HOURS * 3_600_000).toISOString();

  const identities = (await sql`
    SELECT mi.id, mi.channel, mi.channel_user_id, mi.user_id, mi.last_nudge_at,
           u.name, u.business_name
    FROM messaging_identities mi
    JOIN users u ON u.id = mi.user_id
    WHERE mi.nudge_opt_out = FALSE
      AND (mi.last_nudge_at IS NULL OR mi.last_nudge_at < ${nudgeCutoffIso})
    ORDER BY mi.last_nudge_at ASC NULLS FIRST
  `) as IdentityRow[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const identity of identities) {
    try {
      const sinceIso = identity.last_nudge_at
        ?? new Date(Date.now() - FIRST_LOOKBACK_DAYS * 86_400_000).toISOString();

      const nudge = await buildUserNudge(identity.user_id, sinceIso);
      if (!nudge) {
        skipped++;
        continue;
      }

      const displayName = botDisplayName({
        id: identity.user_id,
        email: "",
        name: identity.name,
        businessName: identity.business_name,
      });

      if (dryRun) {
        sent++;
        continue;
      }

      const adapter = ADAPTERS[identity.channel];
      if (!adapter) {
        console.warn("[bot:nudges:unknown_channel]", JSON.stringify({ channel: identity.channel }));
        skipped++;
        continue;
      }

      if (identity.channel === "whatsapp") {
        // Outside the 24h window WhatsApp requires an approved template.
        await adapter.send(identity.channel_user_id, {
          text: renderNudgeText(displayName, nudge),
          whatsappTemplate: whatsappNudgeTemplate(displayName, nudge),
        });
      } else {
        await adapter.send(identity.channel_user_id, {
          text: renderNudgeText(displayName, nudge),
          buttons: nudgeButtons(),
        });
      }

      await sql`UPDATE messaging_identities SET last_nudge_at = NOW() WHERE id = ${identity.id}`;
      sent++;
    } catch (err) {
      failed++;
      console.error("[bot:nudges:error]", JSON.stringify({ identityId: identity.id, channel: identity.channel }), err);
    }
  }

  console.log("[bot:nudges:summary]", JSON.stringify({ candidates: identities.length, sent, skipped, failed, dryRun }));
  return NextResponse.json({ ok: true, candidates: identities.length, sent, skipped, failed, dryRun });
}
