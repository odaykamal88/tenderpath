import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sql } from "@/lib/db";
import { defaultEmailMeta } from "@/lib/email/defaults";
import { TRIAL_DAYS, TRIAL_WARNING_DAY } from "@/lib/access";

// PR-M (2026-05-23): daily cron that fires the day-27 trial-ending email
// to platform-trial users (no Stripe subscription on file yet). Stripe-
// managed trials send their own `customer.subscription.trial_will_end`
// reminder 3 days before the trial ends — that path is handled by
// /api/webhooks/stripe and shouldn't double-mail through here, so we
// exclude subscription_status IN ('active', 'trialing') from the query.
//
// Scheduled in vercel.json at 14:00 UTC daily. Idempotent: the
// trial_warning_sent_at column is stamped on send, so re-runs on the
// same day skip already-mailed users.
//
// Auth: requires Bearer ${CRON_SECRET} — Vercel injects this header for
// scheduled invocations. Same pattern as /api/cron/daily-digest.

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[api/cron/trial-reminders] CRON_SECRET not configured — refusing request");
    return false;
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

interface CandidateRow {
  id: number;
  email: string;
  created_at: string;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Day 27 of the trial = exactly TRIAL_WARNING_DAY full days after
  // created_at AND less than (TRIAL_WARNING_DAY + 1) days. The window
  // is 24 hours wide so a daily cron at 14:00 UTC catches each user
  // exactly once between their signup time and the same time 24h later.
  //
  // We exclude:
  //   - users with subscription_status active/trialing (Stripe handles them)
  //   - users with trial_warning_sent_at already set (idempotency)
  //   - super_admin users (no trial concept)
  const candidates = (await sql`
    SELECT id, email, created_at
    FROM users
    WHERE
      created_at <= NOW() - (${TRIAL_WARNING_DAY} || ' days')::interval
      AND created_at > NOW() - ((${TRIAL_WARNING_DAY} + 1) || ' days')::interval
      AND trial_warning_sent_at IS NULL
      AND (subscription_status IS NULL OR subscription_status NOT IN ('active', 'trialing'))
      AND COALESCE(is_super_admin, FALSE) = FALSE
      AND email IS NOT NULL
      AND email <> ''
    ORDER BY created_at ASC
    LIMIT 100
  `) as unknown as CandidateRow[];

  if (!candidates.length) {
    console.info("[cron:trial-reminders:no_candidates]", {
      trial_warning_day: TRIAL_WARNING_DAY,
    });
    return NextResponse.json({ sent: 0, skipped: 0 });
  }

  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    console.error("[cron:trial-reminders:no_resend_key]");
    return NextResponse.json({ error: "Email service not configured" }, { status: 503 });
  }
  const resend = new Resend(resendKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() || "TenderPath <no-reply@tenderpath.me>";
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://www.tenderpath.me").replace(/\/$/, "");

  let sent = 0;
  let failed = 0;
  for (const user of candidates) {
    const daysLeft = Math.max(1, TRIAL_DAYS - TRIAL_WARNING_DAY);
    const { html, text } = renderTrialWarningEmail({
      recipient: user.email,
      daysLeft,
      appUrl,
    });
    try {
      const { error } = await resend.emails.send({
        from: fromEmail,
        to: user.email,
        subject: `Your TenderPath trial ends in ${daysLeft} days`,
        html,
        text,
        ...defaultEmailMeta(user.email),
      });
      if (error) {
        failed += 1;
        console.error("[cron:trial-reminders:send_failed]", {
          userId: user.id,
          email: user.email,
          error: error.message ?? String(error),
        });
        continue;
      }
      // Stamp on success so we never re-mail.
      await sql`
        UPDATE users
        SET trial_warning_sent_at = NOW()
        WHERE id = ${user.id}
      `;
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error("[cron:trial-reminders:send_threw]", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.info("[cron:trial-reminders:summary]", {
    candidates: candidates.length,
    sent,
    failed,
  });
  return NextResponse.json({ candidates: candidates.length, sent, failed });
}

/**
 * Brand-aligned 30-day trial-ending email. Mirrors the magic-link email
 * shape from /api/auth/signup — Fraunces serif, IBM Plex Mono labels,
 * orange wordmark dot, stone neutrals.
 */
function renderTrialWarningEmail({
  recipient,
  daysLeft,
  appUrl,
}: {
  recipient: string;
  daysLeft: number;
  appUrl: string;
}): { html: string; text: string } {
  const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
  const MONO = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace";
  const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const ACCENT = "#ea580c"; // orange-600
  const INK = "#1c1917"; // stone-900
  const INK2 = "#44403c"; // stone-700
  const MUTE = "#a8a29e"; // stone-400
  const RULE = "#e7e5e4"; // stone-200
  const PAPER = "#fafaf7";
  const PAPER2 = "#ffffff";

  const subscribeLink = `${appUrl}/pay?plan=annual-access`;
  const dashboardLink = `${appUrl}/dashboard`;
  const safeEmail = escapeHtml(recipient);
  const safeSubLink = escapeHtml(subscribeLink);
  const safeDashLink = escapeHtml(dashboardLink);

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};color:${INK};">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <!-- Header -->
    <div style="border-bottom:1px solid ${RULE};padding-bottom:20px;margin-bottom:28px;">
      <div style="font-family:${SERIF};font-size:24px;font-weight:500;color:${INK};letter-spacing:-0.01em;">
        Tender<span style="color:${ACCENT};">·</span>Path
      </div>
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;margin-top:8px;">
        Trial reminder · ${daysLeft} days left
      </div>
    </div>

    <!-- Title -->
    <h1 style="font-family:${SERIF};font-size:30px;font-weight:500;color:${INK};letter-spacing:-0.02em;line-height:1.15;margin:0 0 12px;">
      Your free trial ends in ${daysLeft} days
    </h1>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${INK2};margin:0 0 12px;">
      You have ${daysLeft} day${daysLeft === 1 ? "" : "s"} left of free access to your TenderPath dashboard — full readiness scoring, matched tenders + grants, the bid/no-bid analyst, proposal drafts, and the document vault.
    </p>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${INK2};margin:0 0 8px;">
      To keep access after day ${TRIAL_DAYS}, subscribe at $99/year (cancel anytime). If you've already subscribed, your card will be charged shortly — nothing else to do.
    </p>
    <p style="font-family:${MONO};font-size:11px;color:${MUTE};margin:0 0 28px;letter-spacing:0.04em;">
      Account · ${safeEmail}
    </p>

    <!-- CTA -->
    <div style="margin:0 0 14px;">
      <a href="${safeSubLink}" style="display:inline-block;background:${INK};color:${PAPER2};text-decoration:none;padding:13px 24px;border-radius:2px;font-family:${MONO};font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:0.14em;">
        Subscribe · $99/year →
      </a>
    </div>
    <div style="margin:0 0 28px;">
      <a href="${safeDashLink}" style="font-family:${MONO};font-size:10.5px;color:${INK2};text-decoration:none;border-bottom:1px solid ${MUTE};padding-bottom:1px;text-transform:uppercase;letter-spacing:0.14em;">
        Open dashboard →
      </a>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid ${RULE};padding-top:18px;">
      <p style="font-family:${SANS};font-size:12.5px;line-height:1.55;color:${INK2};margin:0 0 14px;">
        Don't need TenderPath after the trial? Reply to this email and we'll archive your account — no charge, no questions.
      </p>
      <p style="font-family:${MONO};font-size:10px;color:${MUTE};text-align:center;margin:0;text-transform:uppercase;letter-spacing:0.12em;line-height:1.7;">
        TenderPath · Cairo, Egypt<br>
        Reply to this email if you need anything.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `Your TenderPath trial ends in ${daysLeft} days`,
    ``,
    `You have ${daysLeft} day${daysLeft === 1 ? "" : "s"} of free access left on your TenderPath dashboard.`,
    ``,
    `To keep access after day ${TRIAL_DAYS}, subscribe at $99/year (cancel anytime):`,
    subscribeLink,
    ``,
    `Open your dashboard:`,
    dashboardLink,
    ``,
    `Account: ${recipient}`,
    ``,
    `Don't need TenderPath? Reply to this email and we'll archive your account.`,
    ``,
    `— TenderPath`,
  ].join("\n");

  return { html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}
