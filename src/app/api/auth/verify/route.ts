import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createToken } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json();
  const { token } = body;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const users = await sql`
    SELECT id, email, name, tier, subscription_status, is_super_admin
    FROM users
    WHERE magic_token = ${token}
      AND magic_token_expires_at > NOW()
  `;

  if (users.length === 0) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 }
    );
  }

  const user = users[0];

  // Clear magic token after use
  await sql`
    UPDATE users SET
      magic_token = NULL,
      magic_token_expires_at = NULL
    WHERE id = ${user.id}
  `;

  const jwt = await createToken(user.id as number, user.email as string);

  return NextResponse.json({
    ok: true,
    token: jwt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tier: user.tier,
      subscription_status: user.subscription_status,
      is_super_admin: user.is_super_admin,
    },
  });
}
