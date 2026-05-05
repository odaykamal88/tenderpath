import { NextResponse } from "next/server";
import { createToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

const DEMO_EMAIL = "demo@tenderpath.me";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  const users = await sql`
    SELECT id, email, name, tier, subscription_status, is_super_admin, trial_start_date, password_hash
    FROM users
    WHERE lower(email) = ${email}
    LIMIT 1
  `;

  const user = users[0];
  const valid = user ? await verifyPassword(password, user.password_hash as string | null) : false;

  if (!user || !valid) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    );
  }

  // Demo account: reset state and log session
  if (email === DEMO_EMAIL) {
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;
    const country = request.headers.get("cf-ipcountry") ?? null;
    const ua = request.headers.get("user-agent") ?? null;

    await Promise.all([
      sql`DELETE FROM assessments WHERE lower(email) = ${DEMO_EMAIL}`,
      sql`
        INSERT INTO demo_sessions (email, ip_address, country, user_agent)
        VALUES (${DEMO_EMAIL}, ${ip}, ${country}, ${ua})
      `.catch(() => null),
    ]);
  }

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
