import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { createToken } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const body = await request.json();
  const { token } = body;

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const ipLimit = enforceRateLimit(request, {
    namespace: "auth:verify:ip",
    limit: 40,
    windowMs: 10 * 60 * 1000,
  });
  if (ipLimit) return ipLimit;
  const tokenLimit = enforceRateLimit(request, {
    namespace: "auth:verify:token",
    limit: 8,
    windowMs: 10 * 60 * 1000,
    keyParts: [token.slice(0, 18)],
  });
  if (tokenLimit) return tokenLimit;

  const users = await sql`
    SELECT id, email, name, tier, subscription_status, is_super_admin, trial_start_date
    FROM users
    WHERE magic_token = ${token}
      AND magic_token_expires_at > NOW()
  `;

  if (users.length === 0) {
    // Diagnose *why* the match failed so the cause is visible in prod logs
    // instead of a silent 401 (launch-discipline rule 4). Re-look the token up
    // ignoring expiry: a hit means the link aged out; a miss means it was
    // already consumed (the token is cleared on first use), rotated by a newer
    // request, or never existed. This second query only runs on the failure
    // path, so the happy path stays a single query.
    const stale = await sql`
      SELECT magic_token_expires_at FROM users WHERE magic_token = ${token}
    `;
    if (stale.length > 0) {
      console.warn("[auth:verify:expired]", {
        expiredAt: stale[0].magic_token_expires_at,
      });
      return NextResponse.json(
        {
          error: "This sign-in link has expired. Please request a new one.",
          code: "expired",
        },
        { status: 401 }
      );
    }
    console.warn("[auth:verify:consumed_or_unknown]");
    return NextResponse.json(
      {
        error:
          "This sign-in link is no longer valid — it may have already been used or replaced by a newer link. Please request a new one.",
        code: "consumed_or_unknown",
      },
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

  const jwt = await createToken(user.id as number, user.email as string, {
    isAdmin: user.is_super_admin as boolean,
    subscriptionStatus: user.subscription_status as string | null,
    trialStartDate: user.trial_start_date as string | null,
  });

  const response = NextResponse.json({
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

  response.cookies.set("tp_session", jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
