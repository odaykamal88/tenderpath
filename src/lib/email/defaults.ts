/**
 * Sprint 18. Shared defaults for transactional + bulk email sends.
 *
 * Gmail and Yahoo bulk-sender enforcement (Feb 2024) requires a working
 * List-Unsubscribe header for any sender that hits >5k messages/day to the
 * same provider. Including it on every send — transactional or otherwise —
 * keeps us safely on the compliant side as we ramp during the blitz.
 *
 * A real `Reply-To` (vs. the no-reply from address) lets recipients reply
 * directly to ops, which both improves deliverability scoring and gives
 * users a clear path back to a human when something looks off.
 */

const DEFAULT_REPLY_TO = "info@tenderpath.me";
const DEFAULT_UNSUBSCRIBE_MAILTO = "unsubscribe@tenderpath.me";

export function defaultEmailMeta(): {
  replyTo: string;
  headers: Record<string, string>;
} {
  const replyTo = process.env.RESEND_REPLY_TO?.trim() || DEFAULT_REPLY_TO;
  const unsubscribeMailto = process.env.RESEND_UNSUBSCRIBE_MAILTO?.trim() || DEFAULT_UNSUBSCRIBE_MAILTO;
  return {
    replyTo,
    headers: {
      "List-Unsubscribe": `<mailto:${unsubscribeMailto}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
