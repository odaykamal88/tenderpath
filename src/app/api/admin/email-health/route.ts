import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/subscription-guard";
import { sql } from "@/lib/db";
import { ensureEmailDeliveryLogSchema } from "@/lib/email/delivery-log";

export const dynamic = "force-dynamic";

function configured(key: string): boolean {
  const value = process.env[key]?.trim();
  return Boolean(value && value !== '""' && value !== "''");
}

function maskEmail(value: unknown): string | null {
  if (typeof value !== "string" || !value.includes("@")) return null;
  const [local, domain] = value.split("@");
  return `${local.slice(0, 2)}${local.length > 2 ? "***" : ""}@${domain}`;
}

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.authorized) return guard.response!;

  try {
    await ensureEmailDeliveryLogSchema();
    const [summaryRows, recentRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS attempts_24h,
          COUNT(*) FILTER (WHERE status = 'sent' AND created_at > NOW() - INTERVAL '24 hours')::int AS sent_24h,
          COUNT(*) FILTER (WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'skipped' AND created_at > NOW() - INTERVAL '24 hours')::int AS skipped_24h,
          MAX(sent_at) AS last_sent_at
        FROM email_queue
        WHERE message_key IS NOT NULL
      `,
      sql`
        SELECT email, status, attempts, provider, sent_at, error, message_key,
               metadata->>'kind' AS kind, created_at
        FROM email_queue
        WHERE message_key IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 20
      `,
    ]);
    const summary = summaryRows[0] ?? {};
    const config = {
      resendApiKey: configured("RESEND_API_KEY"),
      fromAddress: configured("RESEND_FROM_EMAIL"),
      replyTo: configured("RESEND_REPLY_TO"),
    };
    const failed24h = Number(summary.failed_24h ?? 0);
    return NextResponse.json({
      status: !config.resendApiKey || !config.fromAddress ? "not_configured" : failed24h > 0 ? "degraded" : "ok",
      checkedAt: new Date().toISOString(),
      config,
      summary,
      recent: recentRows.map((row) => ({ ...row, email: maskEmail(row.email) })),
    });
  } catch (error) {
    console.error("[tp:email:health_failed]", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ status: "error", error: "Could not read email delivery health." }, { status: 500 });
  }
}
