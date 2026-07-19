/* Nudge scheduler (SPEC §5 contract 6) — the external mirror of the in-page
 * strip. Three triggers:
 *   · draft ready for review — IMMEDIATE email when ops releases qa → review
 *     (fired from the admin action route);
 *   · final pack unsubmitted at T-72h / T-24h / deadline day — escalating,
 *     sent by the daily bot-nudges cron (exact-day buckets, so a daily run
 *     never double-sends);
 *   · debrief window closing — one shot, 7 days after a lost decision with no
 *     debrief requested.
 * Channel: Telegram when the account is linked (the bot is live), email
 * otherwise. WhatsApp is skipped here until its Meta setup lands — its 24h
 * template rules need the approved-template path, not free-form nudges. */

import { Resend } from "resend";
import { sql } from "@/lib/db";
import { defaultEmailMeta } from "@/lib/email/defaults";
import { recordEmailDelivery } from "@/lib/email/delivery-log";
import { isEmailSuppressed } from "@/lib/email/suppression";
import { telegramAdapter } from "@/lib/bot/channels/telegram";
import type { SubmissionOrder } from "./types";
import { ensureSubmissionsSchema, rowToOrder } from "./store";

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function appUrl(): string {
  return envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
}

function daysUntil(due: string | null): number | null {
  if (!due) return null;
  const t = new Date(due).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ── 1 · Draft ready for review — immediate, on qa → review release ─────── */

export async function sendSubmissionReviewReadyEmail(
  order: SubmissionOrder,
  userEmail: string | null,
): Promise<{ status: "sent" | "failed" | "skipped"; messageId?: string; reason?: string }> {
  const revision = order.artifactVersions.at(-1)?.revision ?? order.round + 1;
  const messageKey = `tp-sub-review-${order.id}-r${revision}`;
  const resendKey = envValue("RESEND_API_KEY");
  if (!resendKey || !userEmail) {
    const reason = !resendKey ? "RESEND_API_KEY missing" : "no user email";
    console.warn("[tp:submissions:review_email_skipped]", {
      orderId: order.id,
      reason,
    });
    if (userEmail) {
      await recordEmailDelivery({ messageKey, email: userEmail, kind: "submission_review_ready", status: "skipped", error: reason, metadata: { orderId: order.id, revision } });
    }
    return { status: "skipped", reason };
  }
  if (await isEmailSuppressed(userEmail)) {
    console.log("[tp:submissions:review_email_skipped_unsubscribed]", { orderId: order.id });
    await recordEmailDelivery({ messageKey, email: userEmail, kind: "submission_review_ready", status: "skipped", error: "recipient suppressed", metadata: { orderId: order.id, revision } });
    return { status: "skipped", reason: "recipient suppressed" };
  }
  const from = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const resend = new Resend(resendKey);
  const due = order.due
    ? new Date(order.due).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  const { data, error } = await resend.emails.send({
    from,
    to: userEmail,
    subject: `Your ${order.type} draft is ready for review — ${order.ref}`,
    text: [
      `The draft pack for "${order.tender}" passed our QA gate and is waiting for your review.`,
      "",
      `Read every document in the reader — especially names, figures and the financial section.`,
      `Approve, or request changes within the review rounds agreed at intake.`,
      due ? `Deadline: ${due}, in the agency's local time zone.` : null,
      "",
      `Open it: ${appUrl()}/dashboard/proposals?order=${order.id}`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    tags: [
      { name: "kind", value: "submission-review" },
      { name: "order", value: String(order.id) },
    ],
    ...defaultEmailMeta(userEmail),
  }, { idempotencyKey: messageKey });
  if (error) {
    await recordEmailDelivery({ messageKey, email: userEmail, kind: "submission_review_ready", status: "failed", error: error.message, metadata: { orderId: order.id, revision } });
    console.error("[tp:submissions:review_email_failed]", { orderId: order.id, ref: order.ref, error: error.message });
    return { status: "failed", reason: error.message };
  }
  await recordEmailDelivery({ messageKey, email: userEmail, kind: "submission_review_ready", status: "sent", providerMessageId: data?.id ?? null, metadata: { orderId: order.id, revision } });
  console.info("[tp:submissions:review_email_sent]", { orderId: order.id, ref: order.ref, messageId: data?.id ?? null });
  return { status: "sent", ...(data?.id ? { messageId: data.id } : {}) };
}

/* ── 2 + 3 · Daily deadline pass (called from /api/cron/bot-nudges) ─────── */

interface NudgeCandidate {
  order: SubmissionOrder;
  email: string | null;
  kind: "review" | "final" | "debrief";
  daysLeft: number | null;
}

function nudgeText(c: NudgeCandidate): { subject: string; body: string } {
  const o = c.order;
  const due = o.due ? new Date(o.due).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "the deadline";
  const urgent = c.daysLeft != null && c.daysLeft <= 1;
  if (c.kind === "final") {
    return {
      subject: urgent
        ? `URGENT — ${o.type} ${o.ref} is unsubmitted with ${c.daysLeft === 0 ? "the deadline today" : "1 day left"}`
        : `${o.type} ${o.ref} — final pack ready; submit 24h early`,
      body: [
        `Your final pack for "${o.tender}" is ready but hasn't been marked as submitted.`,
        `Deadline: ${due}, in the agency's local time zone — portals reject at the second; aim to be done 24h early.`,
        urgent ? "This is the last nudge before the deadline." : null,
        "",
        `Run the submission checklist: ${appUrl()}/dashboard/proposals?order=${o.id}`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }
  if (c.kind === "review") {
    return {
      subject: urgent
        ? `URGENT — your ${o.type} draft is still unreviewed (${o.ref})`
        : `Reminder — your ${o.type} draft is waiting for review (${o.ref})`,
      body: [
        `The draft pack for "${o.tender}" is still waiting for your review.`,
        `Deadline: ${due} — revisions need runway, so the sooner you read it the better.`,
        "",
        `Review it: ${appUrl()}/dashboard/proposals?order=${o.id}`,
      ].join("\n"),
    };
  }
  return {
    subject: `Debrief window closing — ${o.type} ${o.ref}`,
    body: [
      `"${o.tender}" wasn't selected, and the agency's debrief window is closing.`,
      `You're entitled to know why — most vendors never ask. One click and we draft the request in procurement language.`,
      "",
      `Request it: ${appUrl()}/dashboard/proposals?order=${o.id}`,
    ].join("\n"),
  };
}

/** Runs once per daily cron tick. Exact-day buckets (T-3 / T-1 / T-0 for
 *  final, T-3 / T-1 for review, day 7 post-decision for debrief) make a daily
 *  run idempotent without extra state. Returns counts for the cron summary. */
export async function sendSubmissionDeadlineNudges(opts?: { dryRun?: boolean }): Promise<{
  candidates: number;
  bot: number;
  email: number;
  skipped: number;
  failed: number;
}> {
  await ensureSubmissionsSchema();
  const rows = await sql`
    SELECT so.*, u.email AS user_email
    FROM submission_orders so
    JOIN users u ON u.id = so.user_id
    WHERE so.paid_at IS NOT NULL
      AND (
        so.stage IN ('review', 'final')
        OR (so.stage = 'submitted' AND so.outcome->>'state' = 'lost' AND so.outcome->'debrief' IS NULL)
      )
  `;

  const candidates: NudgeCandidate[] = [];
  for (const row of rows) {
    const order = rowToOrder(row);
    const email = (row.user_email as string | null) ?? null;
    if (order.stage === "review" || order.stage === "final") {
      const daysLeft = daysUntil(order.due);
      if (daysLeft == null) continue;
      const buckets = order.stage === "final" ? [3, 1, 0] : [3, 1];
      if (buckets.includes(daysLeft)) {
        candidates.push({ order, email, kind: order.stage === "final" ? "final" : "review", daysLeft });
      }
    } else {
      const decidedAt = order.outcome.decidedAt ? new Date(order.outcome.decidedAt).getTime() : null;
      if (!decidedAt) continue;
      const daysSince = Math.floor((Date.now() - decidedAt) / 86_400_000);
      if (daysSince === 7) candidates.push({ order, email, kind: "debrief", daysLeft: null });
    }
  }

  let bot = 0;
  let emailSent = 0;
  let skipped = 0;
  let failed = 0;
  const resendKey = envValue("RESEND_API_KEY");
  const from = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const resend = resendKey ? new Resend(resendKey) : null;

  for (const c of candidates) {
    try {
      if (opts?.dryRun) {
        skipped++;
        continue;
      }
      const { subject, body } = nudgeText(c);

      // Telegram first when linked (free-form pushes are fine there).
      const identities = await sql`
        SELECT channel_user_id FROM messaging_identities
        WHERE user_id = ${c.order.userId} AND channel = 'telegram' AND nudge_opt_out = FALSE
        LIMIT 1
      `;
      const tg = identities[0]?.channel_user_id as string | undefined;
      if (tg) {
        await telegramAdapter.send(tg, {
          text: `<b>${escapeHtml(subject)}</b>\n\n${escapeHtml(c.order.tender)}\n${escapeHtml(body.split("\n")[1] ?? "")}\n\n${appUrl()}/dashboard/proposals?order=${c.order.id}`,
        });
        bot++;
        continue;
      }

      if (!resend || !c.email) {
        skipped++;
        continue;
      }
      if (await isEmailSuppressed(c.email)) {
        skipped++;
        continue;
      }
      const dateBucket = new Date().toISOString().slice(0, 10);
      const messageKey = `tp-sub-nudge-${c.order.id}-${c.kind}-${dateBucket}`;
      const { data, error } = await resend.emails.send({
        from,
        to: c.email,
        subject,
        text: body,
        tags: [
          { name: "kind", value: "submission-nudge" },
          { name: "order", value: String(c.order.id) },
        ],
        ...defaultEmailMeta(c.email),
      }, { idempotencyKey: messageKey });
      if (error) {
        await recordEmailDelivery({ messageKey, email: c.email, kind: `submission_${c.kind}_nudge`, status: "failed", error: error.message, metadata: { orderId: c.order.id, daysLeft: c.daysLeft } });
        throw new Error(error.message);
      }
      await recordEmailDelivery({ messageKey, email: c.email, kind: `submission_${c.kind}_nudge`, status: "sent", providerMessageId: data?.id ?? null, metadata: { orderId: c.order.id, daysLeft: c.daysLeft } });
      emailSent++;
    } catch (err) {
      failed++;
      console.error("[tp:submissions:nudge_failed]", {
        orderId: c.order.id,
        kind: c.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("[tp:submissions:nudge_summary]", JSON.stringify({ candidates: candidates.length, bot, email: emailSent, skipped, failed }));
  return { candidates: candidates.length, bot, email: emailSent, skipped, failed };
}
