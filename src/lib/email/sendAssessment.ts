import { Resend } from "resend";
import { sql } from "@/lib/db";
import type { TierSlug } from "@/lib/types";
import { notifyAdmin } from "@/lib/email/notifyAdmin";

interface TopTender {
  title: string;
  agency: string;
  country: string;
  match_reasons?: string[];
}

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
  topTenders?: TopTender[];
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
    name: "Roster Fast-Track",
    price: "$749/roster",
    pitch: "Complete vendor registration for WFP, UNICEF, UNDP — every document, submission, and follow-up handled.",
  },
};

export async function sendAssessmentEmail(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me";

  if (!apiKey) {
    const error = "RESEND_API_KEY missing";
    console.warn("[tp:email:failed]", { assessmentId: args.assessmentId, email: args.email, error });
    await sql`
      UPDATE email_queue SET
        status = 'failed',
        attempts = attempts + 1,
        provider = 'resend',
        error = ${error}
      WHERE assessment_id = ${args.assessmentId} AND status = 'pending'
    `;
    return;
  }

  const tier = TIER_COPY[args.recommendedTier];
  const resultsUrl = `${appUrl}/dashboard`;
  const ctaUrl = `${appUrl}/#services`;

  const html = renderHtml({ ...args, tier, resultsUrl, ctaUrl });
  const text = renderText({ ...args, tier, resultsUrl, ctaUrl });

  const resend = new Resend(apiKey);
  let sendError: string | null = null;
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: args.email,
      subject: `Your TenderPath Readiness Score: ${args.readinessScore}/100`,
      html,
      text,
    });
    if (error) sendError = error.message;
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Unknown send error";
  }

  if (sendError) {
    console.error("[tp:email:failed]", { assessmentId: args.assessmentId, email: args.email, error: sendError });
    notifyAdmin(
      `Assessment email failed — ${args.email}`,
      `Assessment ID: ${args.assessmentId}\nRecipient: ${args.email}\nError: ${sendError}\nThe email_queue row has been marked failed.`
    ).catch(() => {});
    await sql`
      UPDATE email_queue SET
        status = 'failed',
        attempts = attempts + 1,
        provider = 'resend',
        error = ${sendError}
      WHERE assessment_id = ${args.assessmentId} AND status = 'pending'
    `.catch(() => {});
    throw new Error(sendError);
  }

  await sql`
    UPDATE email_queue SET
      status = 'sent',
      attempts = attempts + 1,
      provider = 'resend',
      error = NULL,
      sent_at = NOW()
    WHERE assessment_id = ${args.assessmentId} AND status = 'pending'
  `.catch(() => {});
  console.log("[tp:email:sent]", { assessmentId: args.assessmentId, email: args.email });
}

function renderText(d: SendArgs & { tier: { name: string; price: string; pitch: string }; resultsUrl: string; ctaUrl: string }): string {
  const allTiers = (["tender-intelligence", "submission-package", "strategic-partnership"] as TierSlug[])
    .map((slug) => ({ slug, ...TIER_COPY[slug] }));

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
    ...(d.topTenders?.length ? [
      `── Top Matched Tenders ──`,
      ``,
      ...d.topTenders.flatMap((t) => [
        `• ${t.title} (${t.agency} · ${t.country})`,
        ...(t.match_reasons?.length ? [`  Why: ${t.match_reasons.slice(0, 3).join(" | ")}`] : []),
        ``,
      ]),
    ] : []),
    `── Your Recommended Services ──`,
    ``,
    ...allTiers.flatMap(({ name, price, pitch, slug }) => [
      `${slug === d.recommendedTier ? "★ BEST FIT — " : ""}${name} (${price})`,
      pitch,
      ``,
    ]),
    `View your full report: ${d.resultsUrl}`,
    `Explore all services: ${d.ctaUrl}`,
    ``,
    `— The TenderPath Team`,
  ].filter(Boolean).join("\n");
}

function renderHtml(d: SendArgs & { tier: { name: string; price: string; pitch: string }; resultsUrl: string; ctaUrl: string }): string {
  const allTiers = (["tender-intelligence", "submission-package", "strategic-partnership"] as TierSlug[])
    .map((slug) => ({ slug, ...TIER_COPY[slug] }));

  const tierCards = allTiers.map(({ slug, name, price, pitch }) => {
    const isRec = slug === d.recommendedTier;
    const border = isRec ? "2px solid #b08530" : "1px solid #d8d0bd";
    const badge = isRec
      ? `<div style="font-size:10px;color:#b08530;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;margin-bottom:6px;">★ Best fit for ${escapeHtml(d.companyName)}</div>`
      : "";
    const btnBg = isRec ? "#1a1a1a" : "transparent";
    const btnColor = isRec ? "#f5f1e8" : "#1a1a1a";
    const btnBorder = isRec ? "none" : "1px solid #1a1a1a";
    return `<div style="background:#faf7ee;border:${border};padding:18px 20px;margin-bottom:10px;">
      ${badge}
      <div style="font-size:16px;font-weight:600;color:#1a1a1a;margin-bottom:4px;">${escapeHtml(name)} <span style="color:#b08530;">${escapeHtml(price)}</span></div>
      <p style="font-size:13px;color:#4a4a4a;line-height:1.55;margin:0 0 14px;">${escapeHtml(pitch)}</p>
      <a href="${d.ctaUrl}" style="display:inline-block;background:${btnBg};color:${btnColor};border:${btnBorder};text-decoration:none;padding:9px 18px;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">Get started →</a>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f1e8;font-family:Georgia,serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:40px 28px;">

    <div style="border-bottom:1px solid #1a1a1a;padding-bottom:20px;margin-bottom:28px;">
      <p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.16em;color:#b08530;margin:0 0 6px;">Vendor readiness report · No. ${String(d.assessmentId).padStart(4, "0")}</p>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400;margin:0 0 4px;line-height:1.1;letter-spacing:-0.01em;">${escapeHtml(d.companyName)}</h1>
    </div>

    <div style="background:#ebe5d3;border:1px solid #d8d0bd;padding:24px;margin-bottom:24px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#8a8377;margin-bottom:8px;">Overall readiness</div>
      <div style="font-family:Georgia,serif;font-size:56px;font-weight:400;line-height:1;letter-spacing:-0.03em;color:#1a1a1a;">${d.readinessScore}<span style="font-size:22px;color:#8a8377;">/100</span></div>
      <div style="margin-top:14px;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:12px;color:#4a4a4a;border-top:1px solid #d8d0bd;padding-top:12px;">
        <strong style="color:#b08530;">${d.tenderCount}</strong> matched tenders &nbsp;·&nbsp; <strong style="color:#2d8a4e;">${d.grantCount}</strong> matched grants
      </div>
    </div>

    <p style="font-family:Georgia,serif;font-size:15px;line-height:1.65;color:#4a4a4a;margin:0 0 22px;font-style:italic;">&ldquo;${escapeHtml(d.summary)}&rdquo;</p>

    ${d.topGap ? `<div style="border-left:3px solid #b8463f;background:#faf7ee;padding:12px 16px;margin-bottom:24px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#b8463f;margin-bottom:4px;">Top gap to close</div>
      <p style="font-size:13px;color:#4a4a4a;margin:0;line-height:1.5;">${escapeHtml(d.topGap)}</p>
    </div>` : ``}

    ${d.topTenders?.length ? `
    <div style="margin-bottom:28px;">
      <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;font-weight:600;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #d8d0bd;">Top matched tenders</div>
      ${d.topTenders.map((t) => `
      <div style="border-bottom:1px solid #d8d0bd;padding:12px 0;">
        <div style="font-size:13px;font-weight:600;color:#1a1a1a;margin-bottom:3px;">${escapeHtml(t.title)}</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#8a8377;margin-bottom:${t.match_reasons?.length ? "6px" : "0"};">${escapeHtml(t.agency)} · ${escapeHtml(t.country)}</div>
        ${t.match_reasons?.length ? `<div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#b08530;">${t.match_reasons.slice(0, 2).join(" · ")}</div>` : ""}
      </div>`).join("")}
    </div>` : ""}

    <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#8a8377;font-weight:600;margin-bottom:14px;padding-bottom:8px;border-bottom:1px solid #d8d0bd;">Recommended services</div>
    ${tierCards}

    <div style="text-align:center;margin:32px 0 24px;">
      <a href="${d.resultsUrl}" style="display:inline-block;background:#1a1a1a;color:#f5f1e8;text-decoration:none;padding:12px 28px;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;">View full report →</a>
    </div>

    <p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#8a8377;text-align:center;margin:24px 0 0;border-top:1px solid #d8d0bd;padding-top:16px;">
      You received this because you ran a free assessment at TenderPath.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
