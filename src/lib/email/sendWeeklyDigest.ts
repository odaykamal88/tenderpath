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
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(tender.title)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(tender.agency)} · ${escapeHtml(tender.country || "Country not listed")} · ${escapeHtml(deadlineLabel(tender.deadline))} · ${tender.score}% fit</div>
        <p style="font-size:12px;color:#4b5563;line-height:1.5;margin:8px 0 0;">${escapeHtml(tenderReason(tender))}</p>
        ${tender.source_url ? `<a href="${tender.source_url}" style="display:inline-block;margin-top:8px;font-size:12px;color:#4f46e5;">Open source</a>` : ""}
      </div>
    `).join("")
    : `<p style="font-size:13px;color:#6b7280;">No strong tender matches this week.</p>`;

  const grantCards = args.grants.length
    ? args.grants.map((grant) => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(grant.title)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(grant.agency)} · ${escapeHtml(grant.country ?? grant.region ?? "Geography not listed")} · ${escapeHtml(deadlineLabel(grant.deadline))} · ${grant.score}% fit</div>
        ${grant.source_url ? `<a href="${grant.source_url}" style="display:inline-block;margin-top:8px;font-size:12px;color:#4f46e5;">Open source</a>` : ""}
      </div>
    `).join("")
    : `<p style="font-size:13px;color:#6b7280;">No strong grant matches this week.</p>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111827;">
  <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;">Weekly matched digest</div>
      <h1 style="font-size:22px;line-height:1.2;margin:8px 0 6px;color:#111827;">${escapeHtml(args.companyName)}</h1>
      <p style="font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 20px;">These opportunities were scored against your latest Tenderpath assessment profile.</p>
      <h2 style="font-size:15px;margin:0 0 10px;color:#111827;">Top tenders</h2>
      ${tenderCards}
      <h2 style="font-size:15px;margin:22px 0 10px;color:#111827;">Top grants</h2>
      ${grantCards}
      <div style="margin-top:24px;">
        <a href="${args.dashboardUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700;font-size:13px;">Review dashboard</a>
      </div>
    </div>
  </div>
</body></html>`;
}

export async function sendWeeklyDigestEmail(args: SendWeeklyDigestArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY missing");

  const resend = new Resend(apiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
  const { error } = await resend.emails.send({
    from: fromEmail,
    to: args.email,
    subject: `Your weekly Tenderpath matches: ${args.tenders.length} tenders, ${args.grants.length} grants`,
    html: renderHtml(args),
    text: renderText(args),
  });

  if (error) throw new Error(error.message);
}
