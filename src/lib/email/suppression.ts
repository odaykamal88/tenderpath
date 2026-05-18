/**
 * Sprint 22. Email opt-out registry + signed one-click unsubscribe tokens.
 *
 * Every user-facing send (`sendAssessmentEmail`, `sendWeeklyDigestEmail`, the
 * proposal / bid-no-bid / roster / work-order user notifications) calls
 * `isEmailSuppressed()` before dispatching to Resend. Ops digests
 * (`sendDailyDigest`, `notifyAdmin`) skip the gate by design — they go to
 * info@/ops, not to subscribers.
 *
 * The token embedded in the List-Unsubscribe HTTPS URL is `base64url(email)`
 * dot `base64url(HMAC-SHA256(email))`. No expiry — emails archived in inboxes
 * need to keep working indefinitely. Rotating UNSUBSCRIBE_SECRET invalidates
 * all outstanding tokens (acceptable: users can still email
 * unsubscribe@tenderpath.me or hit support).
 *
 * The HMAC key falls back to RESEND_API_KEY when UNSUBSCRIBE_SECRET is unset
 * so deployments don't need a new env var on day one. If RESEND_API_KEY is
 * rotated, outstanding tokens break — set UNSUBSCRIBE_SECRET explicitly when
 * you need stability.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";

function getSecret(): string {
  const dedicated = process.env.UNSUBSCRIBE_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback = process.env.RESEND_API_KEY?.trim();
  if (fallback) return fallback;
  throw new Error(
    "Cannot sign unsubscribe token: set UNSUBSCRIBE_SECRET (or RESEND_API_KEY as fallback)"
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hmacEmail(email: string): Buffer {
  return createHmac("sha256", getSecret()).update(email).digest();
}

export function signUnsubscribeToken(email: string): string {
  const normalized = normalizeEmail(email);
  const emailPart = Buffer.from(normalized, "utf8").toString("base64url");
  const sigPart = hmacEmail(normalized).toString("base64url");
  return `${emailPart}.${sigPart}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [emailPart, sigPart] = token.split(".");
  if (!emailPart || !sigPart) return null;

  let email: string;
  let sig: Buffer;
  try {
    email = Buffer.from(emailPart, "base64url").toString("utf8");
    sig = Buffer.from(sigPart, "base64url");
  } catch {
    return null;
  }

  if (!email.includes("@") || email.length > 320) return null;

  const expected = hmacEmail(email);
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(sig, expected)) return null;
  return email;
}

export function unsubscribeUrl(email: string, baseUrl?: string): string {
  const app = (baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me").replace(/\/$/, "");
  return `${app}/api/email/unsubscribe?t=${signUnsubscribeToken(email)}`;
}

export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalized = normalizeEmail(email);
  try {
    const rows = (await sql`
      SELECT 1 AS hit FROM email_suppressions WHERE email = ${normalized} LIMIT 1
    `) as Array<{ hit: number }>;
    return rows.length > 0;
  } catch (err) {
    // Fail-open on transient DB errors. The alternative — blocking every send
    // because the lookup failed — is strictly worse than occasionally sending
    // to a user who unsubscribed during the outage window.
    console.error("[tp:suppression:lookup_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface SuppressMeta {
  userAgent?: string;
  notes?: string;
}

export async function suppressEmail(
  email: string,
  source: string,
  meta: SuppressMeta = {}
): Promise<void> {
  const normalized = normalizeEmail(email);
  await sql`
    INSERT INTO email_suppressions (email, source, user_agent, notes)
    VALUES (${normalized}, ${source}, ${meta.userAgent ?? null}, ${meta.notes ?? null})
    ON CONFLICT (email) DO UPDATE SET
      source = EXCLUDED.source,
      user_agent = COALESCE(EXCLUDED.user_agent, email_suppressions.user_agent),
      notes = COALESCE(EXCLUDED.notes, email_suppressions.notes),
      unsubscribed_at = NOW()
  `;
}
