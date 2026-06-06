import { NextResponse } from "next/server";
import { createToken } from "@/lib/auth";
import { sql } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import {
  DEMO_EMAIL,
  resolveOrMintForSignin,
  setDemoSessionCookie,
  wipeDemoWorkOrders,
  wipeOtherDemoAssessments,
} from "@/lib/assessment/demo-session";

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

    const ipLimit = enforceRateLimit(request, {
      namespace: "auth:password:ip",
      limit: 30,
      windowMs: 10 * 60 * 1000,
    });
    if (ipLimit) return ipLimit;
    const emailLimit = enforceRateLimit(request, {
      namespace: "auth:password:email",
      limit: 12,
      windowMs: 10 * 60 * 1000,
      keyParts: [email],
    });
    if (emailLimit) return emailLimit;

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

    // Sprint 24 (audit 2026-05-20 demo isolation): session-aware wipe.
    // Carries the visitor's tp_demo_session cookie forward when present so
    // the just-completed anonymous assessment stays visible after sign-in.
    // Visitors with no cookie (or a stale cookie that doesn't match any row)
    // get a clean slate — wipes ALL prior demo assessments so two sequential
    // people sharing a browser don't see each other's data.
    //
    // email_queue's pre-hotfix NO-ACTION FK is now ON DELETE SET NULL after
    // the 2026-05-20 schema upgrade, so the explicit queue-row deletion lives
    // inside wipeOtherDemoAssessments for tidiness rather than correctness.
    // The demo_sessions log row is independent of the wipe and is best-effort.
    let demoSessionForResponse: string | null = null;
    if (email === DEMO_EMAIL) {
      try {
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          null;
        const country = request.headers.get("cf-ipcountry") ?? null;
        const ua = request.headers.get("user-agent") ?? null;

        const { sessionId, carriedFromCookie } = resolveOrMintForSignin(request);
        demoSessionForResponse = sessionId;
        const { wiped } = await wipeOtherDemoAssessments(sessionId);
        // PR-J (2026-05-23): also wipe the demo user's work_orders and
        // proposal_packages on every sign-in. The user reported seeing
        // accumulated bid-no-bid / proposal orders from prior demo
        // sessions on the Work Orders page — those should clear like
        // assessments do. Other emails are unaffected (wipe is scoped to
        // the demo email).
        const wipedOrders = await wipeDemoWorkOrders();
        console.log("[auth:password:demo_reset]", {
          sessionId,
          carriedFromCookie,
          assessments_wiped: wiped,
          work_orders_wiped: wipedOrders.orders,
          proposal_packages_wiped: wipedOrders.packages,
        });

        await sql`
          INSERT INTO demo_sessions (email, ip_address, country, user_agent)
          VALUES (${DEMO_EMAIL}, ${ip}, ${country}, ${ua})
        `.catch(() => null);
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

    // Refresh / set the demo-session cookie so the same value sticks around
    // for the dashboard (further assessment runs land in the same session).
    if (demoSessionForResponse) {
      setDemoSessionCookie(response, demoSessionForResponse);
    }

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
