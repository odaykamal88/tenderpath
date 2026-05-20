import { NextResponse } from "next/server";
import { createToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

const DEMO_EMAIL = "demo@tenderpath.me";
// Must match scripts/create-demo-user.mjs and the hint shown on /login.
// Credentials are publicly displayed, so it is safe to self-heal on every login.
const DEMO_PASSWORD = "TenderDemo2026!";

export async function POST(request: Request) {
  // Outer wrap so unexpected throws (DB schema drift, JWT secret missing,
  // partially-migrated tables) surface in prod logs with a stable tag
  // instead of as a bare Next.js 500 with no diagnostic info. Discovered
  // when the first incognito demo-login walkthrough hit a 5xx and the
  // logs had nothing to grep for. Launch-discipline rule 4.
  try {
    const body = await request.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    // Self-heal: keep the demo account password in sync with the displayed hint.
    // Prevents UI/DB drift from locking visitors out of the public demo.
    // Wrapped: if scrypt or the upsert throws (DB down, missing column), we want
    // the failure visible in logs — silently 500ing here would surface to the UI
    // as "Invalid email or password", indistinguishable from real bad creds.
    // Audit 2026-05-19 P0 #3, launch-discipline rule 4.
    if (email === DEMO_EMAIL) {
      try {
        const hash = await hashPassword(DEMO_PASSWORD);
        const now = new Date().toISOString();
        await sql`
          INSERT INTO users (email, password_hash, subscription_status, tier, trial_start_date, created_at)
          VALUES (${DEMO_EMAIL}, ${hash}, 'active', 'pro', ${now}, ${now})
          ON CONFLICT (email) DO UPDATE SET
            password_hash       = EXCLUDED.password_hash,
            subscription_status = 'active',
            tier                = 'pro'
        `;
      } catch (err) {
        console.error("[auth:password:demo_self_heal_failed]", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Fall through — the SELECT below may still succeed against a row that
        // was seeded earlier via scripts/create-demo-user.mjs.
      }
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
      // Distinguish a magic-link-only account from a real bad-creds attempt.
      // A user who signed up via magic link never sets a password_hash, so
      // they hit the password tab and get "Invalid email or password" with
      // no way out. Returning a distinct code lets the client offer a
      // one-click switch back to magic link. Audit 2026-05-19 P1 #9.
      if (user && !user.password_hash) {
        return NextResponse.json(
          {
            error: "This account uses magic-link sign-in. Send a sign-in link to your inbox?",
            code: "magic_link_only",
          },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    // Demo account: reset state and log session. Wrapped — if the assessments
    // table is in a partially-migrated state (e.g. PR-1 public_id NOT NULL
    // column added but pgcrypto missing for the default on insert paths the
    // delete cascades into), a thrown DELETE here used to 500 the entire
    // sign-in. The session refresh is best-effort; sign-in itself should
    // succeed regardless. Discovered on the first incognito walkthrough.
    if (email === DEMO_EMAIL) {
      try {
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
      } catch (err) {
        console.error("[auth:password:demo_reset_failed]", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Fall through — sign-in itself proceeds.
      }
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
  } catch (err) {
    console.error("[auth:password:route_error]", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
