/**
 * Sprint 18 + Sprint 22. Shared defaults for transactional + bulk email sends.
 *
 * Gmail and Yahoo bulk-sender enforcement (Feb 2024) requires a working
 * List-Unsubscribe header for any sender that hits >5k messages/day to the
 * same provider. RFC 8058 one-click compliance further requires the HTTPS
 * URL form alongside `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
 *
 * When a `recipient` is passed, we mint a per-recipient HMAC-signed URL and
 * emit both forms in the header — the HTTPS URL is what Gmail's "Unsubscribe"
 * button POSTs to; the mailto is the human fallback that lands in the Zoho
 * unsubscribe@ inbox.
 *
 * Ops/admin sends (daily digest, admin notify) pass no recipient and get the
 * mailto-only header — one-click compliance is irrelevant for those.
 *
 * A real `Reply-To` (vs. the no-reply from address) lets recipients reply
 * directly to ops, which both improves deliverability scoring and gives
 * users a clear path back to a human when something looks off.
 */
import { signUnsubscribeToken } from "@/lib/email/suppression";

const DEFAULT_REPLY_TO = "info@tenderpath.me";
const DEFAULT_UNSUBSCRIBE_MAILTO = "unsubscribe@tenderpath.me";
const DEFAULT_APP_URL = "https://www.tenderpath.me";

export function defaultEmailMeta(recipient?: string): {
  replyTo: string;
  headers: Record<string, string>;
} {
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
  const unsubscribeMailto = process.env.RESEND_UNSUBSCRIBE_MAILTO?.trim() || DEFAULT_UNSUBSCRIBE_MAILTO;

  if (!recipient) {
    return {
      replyTo,
      headers: {
        "List-Unsubscribe": `<mailto:${unsubscribeMailto}?subject=unsubscribe>`,
      },
    };
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL?.trim() || DEFAULT_APP_URL).replace(/\/$/, "");
  const httpsUrl = `${appUrl}/api/email/unsubscribe?t=${signUnsubscribeToken(recipient)}`;
  return {
    replyTo,
    headers: {
      "List-Unsubscribe": `<${httpsUrl}>, <mailto:${unsubscribeMailto}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
