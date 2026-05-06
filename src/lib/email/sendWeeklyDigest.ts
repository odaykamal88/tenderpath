import { Resend } from "resend";
import type { MatchedGrant, MatchedTender } from "@/lib/types";

interface SendWeeklyDigestArgs {
  email: string;
  companyName: string;
  tenders: MatchedTender[];
  grants: MatchedGrant[];
  dashboardUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]!));
}

function deadlineLabel(deadline: string | null | undefined): string {
  if (!deadline) return "No deadline listed";
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return "No deadline listed";
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function tenderReason(tender: MatchedTender): string {
  return tender.opportunity_bucket_reason
    ?? tender.structured_reasons?.summary?.[0]
    ?? tender.match_reasons?.[0]
    ?? "Matched to your latest Tenderpath assessment profile.";
}

function renderText(args: SendWeeklyDigestArgs): string {
  const tenderLines = args.tenders.length
    ? args.tenders.flatMap((tender, index) => [
        `${index + 1}. ${tender.title}`,
        `   ${tender.agency} · ${tender.country || "Country not listed"} · ${deadlineLabel(tender.deadline)} · ${tender.score}% fit`,
        `   Why: ${tenderReason(tender)}`,
        tender.source_url ? `   Source: ${tender.source_url}` : "",
        "",
      ])
    : ["No strong tender matches this week.", ""];

  const grantLines = args.grants.length
    ? args.grants.flatMap((grant, index) => [
        `${index + 1}. ${grant.title}`,
        `   ${grant.agency} · ${grant.country ?? grant.region ?? "Geography not listed"} · ${deadlineLabel(grant.deadline)} · ${grant.score}% fit`,
        grant.source_url ? `   Source: ${grant.source_url}` : "",
        "",
      ])
    : ["No strong grant matches this week.", ""];

  return [
    `Hi ${args.companyName},`,
    "",
    "Here is your weekly Tenderpath matched opportunity digest.",
    "",
    "Top tenders",
    ...tenderLines,
    "Top grants",
    ...grantLines,
    `Review your pipeline: ${args.dashboardUrl}`,
    "",
    "Tenderpath",
  ].filter(Boolean).join("\n");
}

function renderHtml(args: SendWeeklyDigestArgs): string {
  const tenderCards = args.tenders.length
    ? args.tenders.map((tender) => `
      <div style="border-bottom:1px solid #d8d0bd;padding:14px 0;">
        <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:3px;">${escapeHtml(tender.title)}</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#8a8377;margin-bottom:6px;">${escapeHtml(tender.agency)} · ${escapeHtml(tender.country || "Country not listed")} · ${escapeHtml(deadlineLabel(tender.deadline))} · <span style="color:#b08530;">${tender.score}% fit</span></div>
        <p style="font-size:12px;color:#4a4a4a;line-height:1.55;margin:0 0 6px;">${escapeHtml(tenderReason(tender))}</p>
        ${tender.source_url ? `<a href="${tender.source_url}" style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#b08530;text-decoration:none;">View source →</a>` : ""}
      </div>
    `).join("")
    : `<p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:12px;color:#8a8377;padding:10px 0;">No strong tender matches this week.</p>`;

  const grantCards = args.grants.length
    ? args.grants.map((grant) => `
      <div style="border-bottom:1px solid #d8d0bd;padding:14px 0;">
        <div style="font-size:14px;font-weight:600;color:#1a1a1a;margin-bottom:3px;">${escapeHtml(grant.title)}</div>
        <div style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#8a8377;margin-bottom:6px;">${escapeHtml(grant.agency)} · ${escapeHtml(grant.country ?? grant.region ?? "Geography not listed")} · ${escapeHtml(deadlineLabel(grant.deadline))} · <span style="color:#2d8a4e;">${grant.score}% fit</span></div>
        ${grant.source_url ? `<a href="${grant.source_url}" style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#b08530;text-decoration:none;">View source →</a>` : ""}
      </div>
    `).join("")
    : `<p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:12px;color:#8a8377;padding:10px 0;">No strong grant matches this week.</p>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f1e8;font-family:Georgia,serif;color:#1a1a1a;">
  <div style="max-width:600px;margin:0 auto;padding:36px 24px;">
    <div style="border-bottom:1px solid #1a1a1a;padding-bottom:18px;margin-bottom:24px;">
      <p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.16em;color:#b08530;margin:0 0 6px;">Weekly matched digest</p>
      <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:400;margin:0 0 4px;line-height:1.1;">${escapeHtml(args.companyName)}</h1>
      <p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:12px;color:#8a8377;margin:0;">Opportunities scored against your Tenderpath assessment profile.</p>
    </div>

    <h2 style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8a8377;margin:0 0 2px;font-weight:600;">Top tenders</h2>
    ${tenderCards}

    <h2 style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#8a8377;margin:24px 0 2px;font-weight:600;">Top grants</h2>
    ${grantCards}

    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #d8d0bd;">
      <a href="${args.dashboardUrl}" style="display:inline-block;background:#1a1a1a;color:#f5f1e8;text-decoration:none;padding:12px 24px;font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;font-weight:600;">Review dashboard →</a>
    </div>

    <p style="font-family:-apple-system,BlinkMacSystemFont,monospace;font-size:11px;color:#8a8377;margin:24px 0 0;border-top:1px solid #d8d0bd;padding-top:16px;">
      Tenderpath · You're receiving this as a subscribed member.
    </p>
  </div>
</body></html>`;
}

export async function sendWeeklyDigestEmail(args: SendWeeklyDigestArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");

  const resend = new Resend(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  let sendError: string | null = null;
  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to: args.email,
      subject: `Your weekly Tenderpath matches: ${args.tenders.length} tenders, ${args.grants.length} grants`,
      html: renderHtml(args),
      text: renderText(args),
    });
    if (error) sendError = error.message;
  } catch (err) {
    sendError = err instanceof Error ? err.message : "Unknown send error";
  }

  if (sendError) throw new Error(sendError);
}
