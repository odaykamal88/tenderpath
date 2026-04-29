import { Resend } from "resend";

export async function notifyAdmin(subject: string, body: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_ALERT_EMAIL;
  if (!apiKey || !adminEmail) return;
  try {
    const resend = new Resend(apiKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "TenderPath <no-reply@tenderpath.me>";
    await resend.emails.send({
      from: fromEmail,
      to: adminEmail,
      subject: `[TenderPath Alert] ${subject}`,
      text: body,
    });
  } catch {
    // Never let alert failures surface — they must not break the main flow
  }
}
