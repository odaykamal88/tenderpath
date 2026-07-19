import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createHash } from "node:crypto";
import { recordEmailDelivery } from "@/lib/email/delivery-log";
import { defaultEmailMeta } from "@/lib/email/defaults";

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { email } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const ipLimit = enforceRateLimit(request, {
    namespace: "auth:login:ip",
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (ipLimit) return ipLimit;
  const emailLimit = enforceRateLimit(request, {
    namespace: "auth:login:email",
    limit: 4,
    windowMs: 60 * 60 * 1000,
    keyParts: [normalizedEmail],
  });
  if (emailLimit) return emailLimit;

  const users = await sql`
    SELECT id FROM users WHERE email = ${normalizedEmail}
  `;

  if (users.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "If that account exists, a magic link has been sent.",
    });
  }

  const magicToken = generateMagicToken();
  const expires = new Date(Date.now() + 30 * 60 * 1000);

  await sql`
    UPDATE users SET
      magic_token = ${magicToken},
      magic_token_expires_at = ${expires.toISOString()}
    WHERE email = ${normalizedEmail}
  `;

  const isDev = process.env.NODE_ENV === "development";
  const resendKey = envValue("RESEND_API_KEY");
  const appUrl = envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
  const fromEmail = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const magicLink = `${appUrl}/login?token=${magicToken}`;
  const messageKey = `tp-auth-login-${createHash("sha256").update(magicToken).digest("hex").slice(0, 24)}`;

  if (resendKey) {
    const resend = new Resend(resendKey);
    const { data, error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: normalizedEmail,
      subject: "Your TenderPath sign-in link",
      html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e2e8f0;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 8px;">Sign in to TenderPath</h1>
    <p style="font-size:14px;color:#94a3b8;margin:0 0 28px;">Click the button below to sign in. This link expires in 30 minutes.</p>
    <a href="${magicLink}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Sign in to TenderPath</a>
    <p style="font-size:12px;color:#475569;margin:28px 0 0;">If you didn't request this, you can safely ignore this email.<br>Or copy this link: ${magicLink}</p>
  </div>
</body></html>`,
      text: `Sign in to TenderPath\n\nClick here to sign in (link expires in 30 minutes):\n${magicLink}\n\nIf you didn't request this, you can safely ignore this email.`,
      tags: [{ name: "kind", value: "auth-login" }],
      ...defaultEmailMeta(normalizedEmail),
    }, { idempotencyKey: messageKey });

    if (emailError) {
      await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_login", status: "failed", error: emailError.message });
      console.error("[tp:auth:login_magic_link_failed]", { error: emailError.message });
      if (!isDev) {
        return NextResponse.json(
          { error: "Could not send magic link email. Please contact support." },
          { status: 502 }
        );
      }
    } else {
      await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_login", status: "sent", providerMessageId: data?.id ?? null });
      console.info("[tp:auth:login_magic_link_sent]", { userId: users[0].id, messageId: data?.id ?? null });
    }
  } else if (!isDev) {
    await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_login", status: "skipped", error: "RESEND_API_KEY missing" });
    console.warn("[tp:auth:login_magic_link_skipped]", { reason: "RESEND_API_KEY missing" });
    return NextResponse.json(
      { error: "Magic link email is not configured. Please contact support." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "If that account exists, a magic link has been sent.",
    ...(isDev && { _devToken: magicToken }),
  });
}
