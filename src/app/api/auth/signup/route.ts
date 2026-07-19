import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";
import { defaultEmailMeta } from "@/lib/email/defaults";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createHash } from "node:crypto";
import { recordEmailDelivery } from "@/lib/email/delivery-log";

function envValue(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

export async function POST(request: Request) {
  // Outer wrap so DB/email throws surface in prod logs with a stable tag
  // instead of as a bare Next.js 500. Launch-discipline rule 4.
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email : null;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const ipLimit = enforceRateLimit(request, {
      namespace: "auth:signup:ip",
      limit: 12,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimit) return ipLimit;
    const emailLimit = enforceRateLimit(request, {
      namespace: "auth:signup:email",
      limit: 4,
      windowMs: 60 * 60 * 1000,
      keyParts: [normalizedEmail],
    });
    if (emailLimit) return emailLimit;

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
    const messageKey = `tp-auth-signup-${createHash("sha256").update(magicToken).digest("hex").slice(0, 24)}`;

    if (resendKey) {
      const resend = new Resend(resendKey);
      const subject = "Sign in to TenderPath";
      const { html, text } = renderMagicLinkEmail({
        magicLink,
        recipient: normalizedEmail,
      });
      try {
        const { data, error: emailError } = await resend.emails.send({
          from: fromEmail,
          to: normalizedEmail,
          subject,
          html,
          text,
          tags: [{ name: "kind", value: "auth-signup" }],
          ...defaultEmailMeta(normalizedEmail),
        }, { idempotencyKey: messageKey });
        if (emailError) {
          await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_signup", status: "failed", error: emailError.message });
          console.error("[auth:signup:magic_link_failed]", {
            email: normalizedEmail,
            error: emailError.message ?? String(emailError),
          });
          if (!isDev) {
            return NextResponse.json(
              { error: "Could not send magic link email. Please contact support." },
              { status: 502 },
            );
          }
        } else {
          await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_signup", status: "sent", providerMessageId: data?.id ?? null });
          console.info("[auth:signup:magic_link_sent]", { messageId: data?.id ?? null });
        }
      } catch (sendErr) {
        await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_signup", status: "failed", error: sendErr instanceof Error ? sendErr.message : String(sendErr) });
        console.error("[auth:signup:magic_link_send_threw]", {
          email: normalizedEmail,
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
        if (!isDev) {
          return NextResponse.json(
            { error: "Could not send magic link email. Please contact support." },
            { status: 502 },
          );
        }
      }
    } else if (!isDev) {
      await recordEmailDelivery({ messageKey, email: normalizedEmail, kind: "auth_signup", status: "skipped", error: "RESEND_API_KEY missing" });
      console.warn("[auth:signup:no_resend_key]");
      return NextResponse.json(
        { error: "Magic link email is not configured. Please contact support." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Magic link sent to your email",
      ...(isDev && { _devToken: magicToken }),
    });
  } catch (err) {
    console.error("[auth:signup:route_error]", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// Brand-aligned magic-link email (audit 2026-05-20 rebrand). Matches the
// typography and palette used by sendAssessment.ts: Fraunces serif headline,
// IBM Plex Mono uppercase labels, orange wordmark dot, stone neutrals, sharp
// 2px corners on the CTA. Plain text fallback covers clients that strip HTML.
function renderMagicLinkEmail({
  magicLink,
  recipient,
}: {
  magicLink: string;
  recipient: string;
}): { html: string; text: string } {
  const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
  const MONO = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace";
  const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
  const ACCENT = "#ea580c"; // orange-600
  const INK = "#1c1917"; // stone-900
  const INK2 = "#44403c"; // stone-700
  const MUTE = "#a8a29e"; // stone-400
  const RULE = "#e7e5e4"; // stone-200
  const PAPER = "#fafaf7";
  const PAPER2 = "#ffffff";

  const safeEmail = escapeHtml(recipient);
  // magicLink is built from env appUrl + alphanumeric magic token — no user
  // input — but escape defensively in case appUrl ever carries an ampersand.
  const safeLink = escapeHtml(magicLink);

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${PAPER};font-family:${SANS};color:${INK};">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <!-- Header -->
    <div style="border-bottom:1px solid ${RULE};padding-bottom:20px;margin-bottom:28px;">
      <div style="font-family:${SERIF};font-size:24px;font-weight:500;color:${INK};letter-spacing:-0.01em;">
        Tender<span style="color:${ACCENT};">·</span>Path
      </div>
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.16em;margin-top:8px;">
        Sign-in link · expires in 30 minutes
      </div>
    </div>

    <!-- Title -->
    <h1 style="font-family:${SERIF};font-size:30px;font-weight:500;color:${INK};letter-spacing:-0.02em;line-height:1.15;margin:0 0 12px;">
      Sign in to your workspace
    </h1>
    <p style="font-family:${SANS};font-size:14.5px;line-height:1.6;color:${INK2};margin:0 0 8px;">
      Use the button below to finish signing in. The link works once and expires
      30&nbsp;minutes after it was requested.
    </p>
    <p style="font-family:${MONO};font-size:11px;color:${MUTE};margin:0 0 28px;letter-spacing:0.04em;">
      Account · ${safeEmail}
    </p>

    <!-- CTA -->
    <div style="margin:0 0 28px;">
      <a href="${safeLink}" style="display:inline-block;background:${INK};color:${PAPER2};text-decoration:none;padding:13px 24px;border-radius:2px;font-family:${MONO};font-weight:600;font-size:11.5px;text-transform:uppercase;letter-spacing:0.14em;">
        Open TenderPath →
      </a>
    </div>

    <!-- Fallback link -->
    <div style="border-top:1px solid ${RULE};padding-top:18px;margin-bottom:24px;">
      <div style="font-family:${MONO};font-size:10px;color:${MUTE};text-transform:uppercase;letter-spacing:0.14em;margin-bottom:8px;">
        Button not working?
      </div>
      <div style="font-family:${MONO};font-size:11.5px;color:${INK2};word-break:break-all;line-height:1.55;">
        <a href="${safeLink}" style="color:${INK2};text-decoration:underline;">${safeLink}</a>
      </div>
    </div>

    <!-- Security note + footer -->
    <div style="border-top:1px solid ${RULE};padding-top:18px;">
      <p style="font-family:${SANS};font-size:12.5px;line-height:1.55;color:${INK2};margin:0 0 14px;">
        Didn&rsquo;t request this email? You can safely ignore it — the link
        won&rsquo;t do anything without your inbox.
      </p>
      <p style="font-family:${MONO};font-size:10px;color:${MUTE};text-align:center;margin:0;text-transform:uppercase;letter-spacing:0.12em;line-height:1.7;">
        TenderPath · Cairo, Egypt<br>
        Reply to this email if you need help signing in.
      </p>
    </div>
  </div>
</body></html>`;

  const text = [
    `Sign in to TenderPath`,
    ``,
    `Open this link to finish signing in (expires in 30 minutes, one-time use):`,
    magicLink,
    ``,
    `Account: ${recipient}`,
    ``,
    `Didn't request this? You can safely ignore the email.`,
    `Need help? Reply to this message and we'll pick it up.`,
    ``,
    `— TenderPath`,
  ].join("\n");

  return { html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}
