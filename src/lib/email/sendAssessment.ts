import { Resend } from "resend";
import { sql } from "@/lib/db";
import type { TierSlug } from "@/lib/types";

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://tenderpath.me";

  if (!apiKey) {
    console.warn("RESEND_API_KEY missing — skipping email send");
    return;
  }

  const tier = TIER_COPY[args.recommendedTier];
  const resultsUrl = `${appUrl}/dashboard`;
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
    console.error("[tp:email:failed]", { assessmentId: args.assessmentId, email: args.email, error: error.message });
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
    const border = isRec ? "2px solid #fbbf24" : "1px solid rgba(255,255,255,0.08)";
    const badge = isRec
      ? `<div style="font-size:10px;color:#fbbf24;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:6px;">★ Best Fit for ${escapeHtml(d.companyName)}</div>`
      : "";
    const btnBg = isRec ? "#fbbf24" : "transparent";
    const btnColor = isRec ? "#0f172a" : "#fbbf24";
    const btnBorder = isRec ? "none" : "1px solid #fbbf24";
    return `<div style="background:#1e293b;border:${border};border-radius:12px;padding:20px;margin-bottom:12px;">
      ${badge}
      <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:4px;">${escapeHtml(name)} <span style="color:#fbbf24;">${escapeHtml(price)}</span></div>
      <p style="font-size:13px;color:#cbd5e1;line-height:1.5;margin:0 0 16px;">${escapeHtml(pitch)}</p>
      <a href="${d.ctaUrl}" style="display:inline-block;background:${btnBg};color:${btnColor};border:${btnBorder};text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;font-size:13px;">Get ${escapeHtml(name)} →</a>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e2e8f0;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <h1 style="font-size:22px;margin:0 0 8px;color:#fff;">Your TenderPath Readiness Report</h1>
    <p style="margin:0 0 24px;color:#94a3b8;font-size:14px;">${escapeHtml(d.companyName)}</p>

    <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:24px;margin-bottom:24px;">
      <div style="font-size:42px;font-weight:700;color:#fff;line-height:1;">${d.readinessScore}<span style="font-size:18px;color:#64748b;">/100</span></div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:0.05em;">Readiness Score</div>
      <div style="margin-top:16px;font-size:13px;color:#cbd5e1;">
        <span><strong style="color:#fbbf24;">${d.tenderCount}</strong> matched tenders &nbsp;·&nbsp; <strong style="color:#2dd4bf;">${d.grantCount}</strong> matched grants</span>
      </div>
    </div>

    <p style="font-size:14px;line-height:1.6;color:#cbd5e1;margin:0 0 20px;">${escapeHtml(d.summary)}</p>

    ${d.topGap ? `<div style="background:rgba(239,68,68,0.1);border-left:3px solid #ef4444;padding:12px 16px;margin-bottom:24px;font-size:13px;color:#fca5a5;">
      <strong style="display:block;margin-bottom:4px;color:#fff;">Top gap to close</strong>${escapeHtml(d.topGap)}
    </div>` : ``}

    ${d.topTenders?.length ? `
    <div style="margin-bottom:24px;">
      <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:12px;">Top Matched Tenders</div>
      ${d.topTenders.map((t) => `
      <div style="background:#1e293b;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:14px 16px;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:4px;">${escapeHtml(t.title)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:${t.match_reasons?.length ? "8px" : "0"};">${escapeHtml(t.agency)} · ${escapeHtml(t.country)}</div>
        ${t.match_reasons?.length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;">${t.match_reasons.slice(0, 3).map((r) => `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:2px 8px;font-size:11px;color:#94a3b8;">${escapeHtml(r)}</span>`).join("")}</div>` : ""}
      </div>`).join("")}
    </div>` : ""}
    <div style="font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;margin-bottom:12px;">Your Recommended Services</div>
    ${tierCards}

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
