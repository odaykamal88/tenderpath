import { Resend } from "resend";
import { sql } from "@/lib/db";
import type { TierSlug } from "@/lib/types";

interface SendArgs {
  assessmentId: number;
  email: string;
  companyName: string;
  readinessScore: number;
  recommendedTier: TierSlug;
  summary: string;
  topGap: string | null;
  tenderCount: number;
  grantCount: number;
}

const TIER_COPY: Record<TierSlug, { name: string; price: string; pitch: string }> = {
  "tender-intelligence": {
    name: "Tender Intelligence",
    price: "$49/mo",
    pitch: "Real-time alerts for tenders matched to your exact capabilities and target regions.",
  },
  "submission-package": {
    name: "Submission Package",
    price: "$299",
    pitch: "We turn one matched opportunity into a panel-ready technical and financial proposal.",
  },
  "strategic-partnership": {
    name: "Strategic Partnership",
    price: "$999/mo",
    pitch: "End-to-end procurement support: roster registration, capability statements, and live proposal coaching.",
  },
};

export async function sendAssessmentEmail(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.io>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://tenderpath.io";

  if (!apiKey) {
    console.warn("RESEND_API_KEY missing — skipping email send");
    return;
  }

  const tier = TIER_COPY[args.recommendedTier];
  const resultsUrl = `${appUrl}/api/assessment/${args.assessmentId}`;
  const ctaUrl = `${appUrl}/#services`;

  const html = renderHtml({ ...args, tier, resultsUrl, ctaUrl });
  const text = renderText({ ...args, tier, resultsUrl, ctaUrl });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: args.email,
    subject: `Your TenderPath Readiness Score: ${args.readinessScore}/100`,
    html,
    text,
  });

  if (error) {
    await sql`
      UPDATE email_queue SET status = 'failed'
      WHERE assessment_id = ${args.assessmentId} AND status = 'pending'
    `;
    throw new Error(error.message);
  }

  await sql`
    UPDATE email_queue SET status = 'sent', sent_at = NOW()
    WHERE assessment_id = ${args.assessmentId} AND status = 'pending'
  `;
}

function renderText(d: SendArgs & { tier: { name: string; price: string; pitch: string }; resultsUrl: string; ctaUrl: string }): string {
  return [
    `Hi ${d.companyName},`,
    ``,
    `Your TenderPath Vendor Readiness Assessment is ready.`,
    ``,
    `Readiness Score: ${d.readinessScore}/100`,
    `Matched Tenders: ${d.tenderCount}    Matched Grants: ${d.grantCount}`,
    ``,
    `Summary: ${d.summary}`,
    ``,
    d.topGap ? `Top gap to close: ${d.topGap}` : ``,
    ``,
    `Recommended next step — ${d.tier.name} (${d.tier.price})`,
    d.tier.pitch,
    ``,
    `View your full report: ${d.resultsUrl}`,
    `Explore ${d.tier.name}: ${d.ctaUrl}`,
    ``,
    `— The TenderPath Team`,
  ].filter(Boolean).join("\n");
}

function renderHtml(d: SendArgs & { tier: { name: string; price: string; pitch: string }; resultsUrl: string; ctaUrl: string }): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e2e8f0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;margin:0 0 8px;color:#fff;">Your TenderPath Readiness Report</h1>
    <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;">${escapeHtml(d.companyName)}</p>

    <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="font-size:42px;font-weight:700;color:#fff;line-height:1;">${d.readinessScore}<span style="font-size:18px;color:#64748b;">/100</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">Readiness Score</div>
      <div style="margin-top:16px;display:flex;gap:16px;font-size:13px;color:#cbd5e1;">
        <span><strong style="color:#fbbf24;">${d.tenderCount}</strong> matched tenders</span>
        <span><strong style="color:#2dd4bf;">${d.grantCount}</strong> matched grants</span>
      </div>
    </div>

    <p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0 0 20px;">${escapeHtml(d.summary)}</p>

    ${d.topGap ? `<div style="background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#fca5a5;">
      <strong style="display:block;margin-bottom:4px;color:#fff;">Top gap to close</strong>${escapeHtml(d.topGap)}
    </div>` : ``}

    <div style="background:#1e293b;border:2px solid #fbbf24;border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="font-size:11px;color:#fbbf24;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:8px;">Recommended for ${escapeHtml(d.companyName)}</div>
      <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px;">${d.tier.name} <span style="color:#fbbf24;">${d.tier.price}</span></div>
      <p style="font-size:13px;color:#cbd5e1;line-height:1.5;margin:0 0 20px;">${d.tier.pitch}</p>
      <a href="${d.ctaUrl}" style="display:inline-block;background:#fbbf24;color:#0f172a;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">Get ${d.tier.name} →</a>
    </div>

    <div style="text-align:center;margin:32px 0;">
      <a href="${d.resultsUrl}" style="color:#94a3b8;font-size:13px;text-decoration:underline;">View your full report online</a>
    </div>

    <p style="font-size:11px;color:#64748b;text-align:center;margin:32px 0 0;border-top:1px solid rgba(255,255,255,0.05);padding-top:16px;">
      You received this because you ran a free assessment at TenderPath.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
