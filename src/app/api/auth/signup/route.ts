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

  // Upsert user with magic token
  await sql`
    INSERT INTO users (email, name, magic_token, magic_token_expires_at)
    VALUES (${normalizedEmail}, ${name ?? null}, ${magicToken}, ${expires.toISOString()})
    ON CONFLICT (email) DO UPDATE SET
      magic_token = ${magicToken},
      magic_token_expires_at = ${expires.toISOString()},
      name = COALESCE(${name ?? null}, users.name)
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
