/* POST /api/waitlist — invite-request capture for the invite-only landing.
 *
 * Public (allowlisted in src/proxy.ts): an anonymous visitor submits their email
 * to request an invite. Stores one row per email (idempotent ON CONFLICT) in
 * waitlist_signups. Self-heals its schema like the other ensure-helpers so the
 * first request after deploy doesn't 500 against an un-migrated DB; the table is
 * also declared in scripts/migrate.mjs. No PII beyond the email + an optional
 * source tag. Never silently swallows a failure — logs a stable [tp:waitlist:*]. */

import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { notifyAdmin } from "@/lib/email/notifyAdmin";
import { sendInviteConfirmationEmail } from "@/lib/email/sendInviteConfirmation";

export const dynamic = "force-dynamic";

let schemaEnsured = false;
async function ensureWaitlistSchema(): Promise<void> {
  if (schemaEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist_signups (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  schemaEnsured = true;
}

// Permissive shape check — we validate intent, not deliverability.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { email?: unknown; source?: unknown };
  try {
    body = (await request.json()) as { email?: unknown; source?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source.slice(0, 60) : null;

  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    await ensureWaitlistSchema();
    const inserted = await sql`
      INSERT INTO waitlist_signups (email, source)
      VALUES (${email}, ${source})
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;
    // Only on a genuinely new request — a repeat email hits ON CONFLICT and
    // returns no row, so we neither re-alert ops nor re-confirm to the signup.
    // Both sends are best-effort and run under allSettled: the row is already
    // saved, so a mail failure (or a missing RESEND_API_KEY) can never block or
    // fail the signup.
    if (inserted.length > 0) {
      await Promise.allSettled([
        // Ops alert → info@tenderpath.me.
        notifyAdmin(
          "New invite request",
          [
            "A new invite request just came in from the landing page.",
            "",
            `Email:  ${email}`,
            `Source: ${source ?? "—"}`,
            "",
            "See all requests: https://www.tenderpath.me/admin/waitlist",
          ].join("\n"),
        ),
        // Confirmation → the person who signed up ("we've got your details").
        sendInviteConfirmationEmail(email),
      ]);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tp:waitlist:insert_failed]", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Couldn't save your request. Please try again." },
      { status: 500 },
    );
  }
}
