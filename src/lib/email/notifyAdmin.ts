import { Resend } from "resend";
import { defaultEmailMeta } from "@/lib/email/defaults";

const DEFAULT_OPS_INBOX = "info@tenderpath.me";

export async function notifyAdmin(subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const adminEmail = process.env.ADMIN_ALERT_EMAIL?.trim() || DEFAULT_OPS_INBOX;
  try {
    const resend = new Resend(apiKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
    await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `[TenderPath Alert] ${subject}`,
      text: body,
      ...defaultEmailMeta(),
    });
  } catch {
    // Never let alert failures surface — they must not break the main flow
  }
}
