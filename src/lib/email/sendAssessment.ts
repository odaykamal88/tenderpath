import { Resend } from "resend";
import { sql } from "@/lib/db";
import { defaultEmailMeta } from "@/lib/email/defaults";
import type { TierSlug, Gap, MatchedTender, MatchedGrant, ReadinessDimensions } from "@/lib/types";
import { notifyAdmin } from "@/lib/email/notifyAdmin";
import { generateAssessmentPdf } from "@/lib/email/assessmentPdf";
import { decodeHtmlEntities } from "@/lib/text/entities";

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
  // Extended fields for PDF generation
  sectors?: string[];
  grantReadinessScore?: number;
  readinessDimensions?: ReadinessDimensions;
  gaps?: Gap[];
  strengths?: string[];
  matchedTenders?: MatchedTender[];
  matchedGrants?: MatchedGrant[];
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

  const cleanArgs = { ...args, companyName: decodeHtmlEntities(args.companyName) || args.companyName };
  const html = renderHtml({ ...cleanArgs, tier, resultsUrl, ctaUrl });
  const text = renderText({ ...cleanArgs, tier, resultsUrl, ctaUrl });

  // Generate PDF attachment when full assessment data is available
  let pdfAttachment: { filename: string; content: Buffer } | null = null;
  if (args.gaps && args.matchedTenders && args.matchedGrants && args.readinessDimensions) {
    try {
      const pdfBuffer = await generateAssessmentPdf({
        id: args.assessmentId,
        companyName: cleanArgs.companyName,
        email: args.email,
        sectors: args.sectors ?? [],
        readinessScore: args.readinessScore,
        grantReadinessScore: args.grantReadinessScore ?? 0,
        summary: args.summary,
        recommendedTier: args.recommendedTier,
        readinessDimensions: args.readinessDimensions,
        gaps: args.gaps,
        strengths: args.strengths ?? [],
        matchedTenders: args.matchedTenders,
        matchedGrants: args.matchedGrants,
      });
      pdfAttachment = { filename: "tenderpath-readiness-report.pdf", content: pdfBuffer };
    } catch (pdfErr) {
      console.warn("[tp:email:pdf-failed]", { assessmentId: args.assessmentId, error: pdfErr instanceof Error ? pdfErr.message : String(pdfErr) });
    }
  }

  const resend = new Resend(apiKey);
  let sendError: string | null = null;
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: args.email,
      subject: `Your TenderPath Readiness Score: ${args.readinessScore}/100`,
      html,
      text,
      ...defaultEmailMeta(),
      ...(pdfAttachment ? { attachments: [pdfAttachment] } : {}),
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

  const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
  const MONO = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace";
  const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const ACCENT = "#ea580c"; // orange
  const INK = "#1c1917"; // stone-900
  const INK2 = "#44403c"; // stone-700
  const INK3 = "#78716c"; // stone-500
  const MUTE = "#a8a29e"; // stone-400
  const RULE = "#e7e5e4"; // stone-200
  const PAPER = "#fafaf7";
  const PAPER2 = "#ffffff";

  const tierCards = allTiers.map(({ slug, name, price, pitch }) => {
    const isRec = slug === d.recommendedTier;
    const border = isRec ? `2px solid ${ACCENT}` : `1px solid ${RULE}`;
    const badge = isRec
      ? `<div style="font-family:${MONO};font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:0.16em;font-weight:600;margin-bottom:10px;">★ Best fit for ${escapeHtml(d.companyName)}</div>`
      : "";
    const btnBg = isRec ? INK : "transparent";
    const btnColor = isRec ? PAPER2 : INK;
    const btnBorder = isRec ? `1px solid ${INK}` : `1px solid ${INK}`;
    return `<div style="background:${PAPER2};border:${border};border-radius:4px;padding:20px;margin-bottom:10px;">
      ${badge}
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px;">
        <div style="font-family:${SERIF};font-size:20px;font-weight:500;color:${INK};line-height:1.2;letter-spacing:-0.01em;">${escapeHtml(name)}</div>
        <div style="font-family:${SERIF};font-size:22px;font-weight:500;color:${INK};white-space:nowrap;">${escapeHtml(price)}</div>
      </div>
      <p style="font-family:${SANS};font-size:13px;color:${INK2};line-height:1.55;margin:0 0 14px;">${escapeHtml(pitch)}</p>
      <a href="${d.ctaUrl}" style="display:inline-block;background:${btnBg};color:${btnColor};border:${btnBorder};text-decoration:none;padding:9px 16px;border-radius:2px;font-family:${MONO};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;">Get ${escapeHtml(name)} →</a>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};color:${INK};">
  <div style="max-width:580px;margin:0 auto;padding:32px 24px;">
    <!-- Header -->
    <div style="border-bottom:1px solid ${RULE};padding-bottom:20px;margin-bottom:24px;">
      <div style="font-family:${SERIF};font-size:24px;font-weight:500;color:${INK};letter-spacing:-0.01em;">
        Tender<span style="color:${ACCENT};">·</span>Path
      </div>
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;margin-top:8px;">
        Readiness report · ${escapeHtml(d.companyName)}
      </div>
    </div>

    <!-- Score card -->
    <div style="background:${PAPER2};border:1px solid ${RULE};border-radius:4px;padding:24px;margin-bottom:20px;">
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;margin-bottom:8px;">
        Readiness score
      </div>
      <div style="font-family:${SERIF};font-size:52px;font-weight:500;color:${INK};line-height:1;letter-spacing:-0.02em;">
        ${d.readinessScore}<span style="font-size:22px;color:${INK3};">/100</span>
      </div>
      <div style="border-top:1px solid ${RULE};margin-top:18px;padding-top:14px;font-family:${MONO};font-size:12px;color:${INK2};">
        <strong style="color:${INK};font-weight:600;">${d.tenderCount}</strong> matched tenders
        <span style="color:${MUTE};margin:0 8px;">·</span>
        <strong style="color:${INK};font-weight:600;">${d.grantCount}</strong> matched grants
      </div>
    </div>

    <!-- Summary -->
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${INK2};margin:0 0 20px;">
      ${escapeHtml(d.summary)}
    </p>

    ${d.topGap ? `<div style="border-left:2px solid ${ACCENT};background:#fff7ed;padding:14px 18px;margin-bottom:24px;border-radius:0 2px 2px 0;">
      <div style="font-family:${MONO};font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:0.16em;font-weight:600;margin-bottom:6px;">Top gap to close</div>
      <div style="font-family:${SANS};font-size:13.5px;color:${INK};line-height:1.55;">${escapeHtml(d.topGap)}</div>
    </div>` : ``}

    ${d.topTenders?.length ? `
    <div style="margin-bottom:28px;">
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;font-weight:600;margin-bottom:12px;">Top matched tenders</div>
      ${d.topTenders.map((t) => `
      <div style="background:${PAPER2};border:1px solid ${RULE};border-radius:4px;padding:14px 16px;margin-bottom:8px;">
        <div style="font-family:${SERIF};font-size:15px;font-weight:500;color:${INK};margin-bottom:4px;line-height:1.3;">${escapeHtml(t.title)}</div>
        <div style="font-family:${MONO};font-size:11px;color:${INK3};margin-bottom:${t.match_reasons?.length ? "10px" : "0"};text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(t.agency)} · ${escapeHtml(t.country)}</div>
        ${t.match_reasons?.length ? `<div>${t.match_reasons.slice(0, 3).map((r) => `<span style="display:inline-block;border:1px solid ${RULE};border-radius:2px;padding:3px 8px;font-family:${MONO};font-size:10.5px;color:${INK2};margin-right:4px;margin-bottom:4px;">${escapeHtml(r)}</span>`).join("")}</div>` : ""}
      </div>`).join("")}
    </div>` : ""}

    <!-- Recommended services -->
    <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;font-weight:600;margin-bottom:12px;">Recommended next steps</div>
    ${tierCards}

    <!-- CTA -->
    <div style="text-align:center;margin:32px 0 20px;">
      <a href="${d.resultsUrl}" style="display:inline-block;background:${INK};color:${PAPER2};text-decoration:none;padding:12px 22px;border-radius:2px;font-family:${MONO};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;">View full report →</a>
    </div>

    <!-- Footer -->
    <div style="border-top:1px solid ${RULE};margin-top:28px;padding-top:18px;">
      <p style="font-family:${MONO};font-size:10px;color:${MUTE};text-align:center;margin:0;text-transform:uppercase;letter-spacing:0.12em;line-height:1.6;">
        TenderPath · Amman · Beirut<br>
        You received this because you ran a free assessment at TenderPath.
      </p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
