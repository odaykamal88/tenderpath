import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";

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
  const magicToken = generateMagicToken();
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  // Ensure column exists for existing DBs (safe no-op if already present)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_start_date TIMESTAMPTZ`;

  // Upsert user with magic token; set trial_start_date only on first insert
  await sql`
    INSERT INTO users (email, magic_token, magic_token_expires_at, trial_start_date)
    VALUES (${normalizedEmail}, ${magicToken}, ${expires.toISOString()}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      magic_token = ${magicToken},
      magic_token_expires_at = ${expires.toISOString()},
      trial_start_date = COALESCE(users.trial_start_date, NOW())
  `;

  const isDev = process.env.NODE_ENV === "development";

  // Send magic link via Resend (skip in dev if no API key)
  const resendKey = envValue("RESEND_API_KEY");
  const appUrl = envValue("NEXT_PUBLIC_APP_URL") ?? "https://www.tenderpath.me";
  const fromEmail = envValue("RESEND_FROM_EMAIL") ?? "TenderPath <no-reply@tenderpath.me>";
  const magicLink = `${appUrl}/login?token=${magicToken}`;

  if (resendKey) {
    const resend = new Resend(resendKey);
    const { error: emailError } = await resend.emails.send({
      from: fromEmail,
      to: normalizedEmail,
      subject: "Your TenderPath sign-in link",
      html: `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#e2e8f0;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 8px;">Sign in to TenderPath</h1>
    <p style="font-size:14px;color:#94a3b8;margin:0 0 28px;">Click the button below to sign in. This link expires in 30 minutes.</p>
    <a href="${magicLink}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Sign in to TenderPath →</a>
    <p style="font-size:12px;color:#475569;margin:28px 0 0;">If you didn't request this, you can safely ignore this email.<br>Or copy this link: ${magicLink}</p>
  </div>
</body></html>`,
      text: `Sign in to TenderPath\n\nClick here to sign in (link expires in 30 minutes):\n${magicLink}\n\nIf you didn't request this, you can safely ignore this email.`,
    });

    if (emailError) {
      console.error("Magic link email failed:", emailError);
      if (!isDev) {
        return NextResponse.json(
          { error: "Could not send magic link email. Please contact support." },
          { status: 502 }
        );
      }
    }
  } else if (!isDev) {
    console.warn("RESEND_API_KEY not set — magic link email not sent");
    return NextResponse.json(
      { error: "Magic link email is not configured. Please contact support." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    ok: true,
    message: "Magic link sent to your email",
    ...(isDev && { _devToken: magicToken }),
  });
}
