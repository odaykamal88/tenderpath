import { Resend } from "resend";

export interface BidReadyEmailArgs {
  email: string;
  workOrderId: number;
  tenderTitle: string | null;
  agency: string | null;
  recommendation: "bid" | "no-bid" | "conditional";
  winProbabilityBand: string;
  /**
   * Public download URL on Vercel Blob. Provide when the upload succeeded so
   * the user can re-download from the email + dashboard. Null when Blob is
   * misconfigured — in that case `pdfBuffer` is the fallback delivery vector.
   */
  pdfUrl: string | null;
  /** Render output. Attached to the email when `pdfUrl` is null. */
  pdfBuffer?: Buffer | null;
}

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function recommendationLine(rec: BidReadyEmailArgs["recommendation"], band: string): string {
  if (rec === "bid") return `Recommendation: BID  ·  Win probability: ${band}`;
  if (rec === "no-bid") return `Recommendation: NO-BID  ·  Win probability: ${band}`;
  return `Recommendation: CONDITIONAL  ·  Win probability: ${band} (action required)`;
}

export async function sendBidNoBidReadyEmail(args: BidReadyEmailArgs): Promise<void> {
  const apiKey = envValue("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[tp:bid_email:skipped]", {
      workOrderId: args.workOrderId,
      reason: "RESEND_API_KEY missing",
    });
    return;
  }

  const from = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const appUrl = envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
  const resend = new Resend(apiKey);

  const subject = `Your Bid/No-Bid analysis is ready · ${
    args.tenderTitle ?? `Work order #${args.workOrderId}`
  }`;

  const dashboardUrl = `${appUrl}/dashboard/work-orders/${args.workOrderId}`;
  const hasAttachment = !args.pdfUrl && !!args.pdfBuffer;

  const body = [
    `Your Bid/No-Bid analysis is ready.`,
    ``,
    args.tenderTitle ? `Tender: ${args.tenderTitle}` : null,
    args.agency ? `Agency: ${args.agency}` : null,
    ``,
    recommendationLine(args.recommendation, args.winProbabilityBand),
    ``,
    args.pdfUrl
      ? `Download the PDF: ${args.pdfUrl}`
      : hasAttachment
        ? `Your PDF is attached to this email.`
        : null,
    `Review in your dashboard: ${dashboardUrl}`,
    ``,
    `This analysis is generated automatically and surfaces the company-vs-tender fit, gaps, required documents, and the next concrete steps. If anything looks off, you can regenerate the analysis once from your dashboard, or reply to this email and we'll take a look.`,
    ``,
    `— TenderPath`,
  ].filter(Boolean).join("\n");

  await resend.emails.send({
    from,
    to: args.email,
    subject,
    text: body,
    ...(hasAttachment && args.pdfBuffer
      ? {
          attachments: [
            {
              filename: `bid-no-bid-${args.workOrderId}.pdf`,
              content: args.pdfBuffer,
            },
          ],
        }
      : {}),
  });
}
