/* Invite-request confirmation — sent to someone who asks for an invite from the
 * invite-only landing page. A warm "we've got your details, we'll be in touch"
 * with no promised timeline (we onboard in small batches). Same idiom as the
 * other senders: Resend, suppression check, defaultEmailMeta for Reply-To +
 * List-Unsubscribe. Throws on a rejected send so the caller's best-effort
 * Promise.allSettled records it; it never breaks the signup. */

import { Resend } from "resend";
import { defaultEmailMeta } from "@/lib/email/defaults";
import { isEmailSuppressed } from "@/lib/email/suppression";

const INK = "#0f1620";
const INK2 = "#2b3543";
const ACCENT = "#9c6b1f";
const PAPER = "#f6f3ec";
const RULE = "#d8d1bf";
const FAINT = "#8c8676";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export async function sendInviteConfirmationEmail(email: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[tp:invite_confirm:skipped]", { reason: "RESEND_API_KEY missing" });
    return;
  }

  try {
    if (await isEmailSuppressed(email)) {
      console.log("[tp:invite_confirm:skipped_unsubscribed]", { email });
      return;
    }
  } catch {
    // Suppression lookup is best-effort — proceed to send a user-requested
    // confirmation rather than withholding it on a metering hiccup.
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || "TenderPath <no-reply@tenderpath.me>";
  const resend = new Resend(apiKey);
  const subject = "You're on the TenderPath invite list";

  const text = [
    "Thanks for requesting an invite to TenderPath — we've got your details.",
    "",
    "We're onboarding teams in small batches right now, and we'll email you the",
    "moment your invite is ready.",
    "",
    "In the meantime, if you have any questions, just reply to this email — it",
    "reaches a real person.",
    "",
    "— The TenderPath team",
    "UN & donor procurement intelligence",
  ].join("\n");

  const html = `<div style="background:${PAPER};padding:32px 16px;font-family:${SANS};">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};">
    <div style="padding:28px 32px 0;">
      <div style="font-family:${SERIF};font-size:22px;font-weight:600;color:${INK};letter-spacing:-0.01em;">TenderPath<span style="color:${ACCENT};">&middot;</span></div>
    </div>
    <div style="padding:18px 32px 8px;">
      <h1 style="font-family:${SERIF};font-size:25px;font-weight:400;color:${INK};margin:0 0 14px;letter-spacing:-0.02em;">You're on the list.</h1>
      <p style="font-size:15px;line-height:1.6;color:${INK2};margin:0 0 14px;">Thanks for requesting an invite to TenderPath &mdash; we&rsquo;ve got your details.</p>
      <p style="font-size:15px;line-height:1.6;color:${INK2};margin:0 0 14px;">We&rsquo;re onboarding teams in small batches right now, and we&rsquo;ll email you the moment your invite is ready.</p>
      <p style="font-size:15px;line-height:1.6;color:${INK2};margin:0;">In the meantime, if you have any questions, just reply to this email &mdash; it reaches a real person.</p>
    </div>
    <div style="padding:18px 32px 26px;border-top:1px solid #e4ddcb;margin-top:16px;">
      <p style="font-size:12px;line-height:1.5;color:${FAINT};margin:0;">TenderPath &middot; UN &amp; donor procurement intelligence<br/>If this wasn&rsquo;t you, you can safely ignore this email.</p>
    </div>
  </div>
</div>`;

  const { error } = await resend.emails.send({
    from,
    to: email,
    subject,
    text,
    html,
    ...defaultEmailMeta(email),
  });
  // The Resend SDK returns errors in the response body, not as thrown
  // exceptions — surface it so the caller's allSettled records the failure.
  if (error) {
    throw new Error(`Resend send rejected: ${error.message ?? JSON.stringify(error)}`);
  }
}
