import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { email, name } = body;

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
    INSERT INTO users (email, name, magic_token, magic_token_expires_at, trial_start_date)
    VALUES (${normalizedEmail}, ${name ?? null}, ${magicToken}, ${expires.toISOString()}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      magic_token = ${magicToken},
      magic_token_expires_at = ${expires.toISOString()},
      name = COALESCE(${name ?? null}, users.name),
      trial_start_date = COALESCE(users.trial_start_date, NOW())
  `;

  // In production, send magic link via email (Resend)
  // For now, return the token in development
  const isDev = process.env.NODE_ENV === "development";

  return NextResponse.json({
    ok: true,
    message: "Magic link sent to your email",
    ...(isDev && { _devToken: magicToken }),
  });
}
