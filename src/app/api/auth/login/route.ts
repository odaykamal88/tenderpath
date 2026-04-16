import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { email } = body;

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const users = await sql`
    SELECT id FROM users WHERE email = ${normalizedEmail}
  `;

  if (users.length === 0) {
    return NextResponse.json(
      { error: "No account found with this email" },
      { status: 404 }
    );
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

  return NextResponse.json({
    ok: true,
    message: "Magic link sent to your email",
    ...(isDev && { _devToken: magicToken }),
  });
}
