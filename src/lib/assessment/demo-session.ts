import type { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Single source of truth — keep this aligned with scripts/create-demo-user.mjs
// and the credentials hint on /login. Tests + ops scripts read it from here.
export const DEMO_EMAIL = "demo@tenderpath.me";

// Cookie that carries a per-visitor session id across the anonymous
// /api/assessment/public submission → demo /api/auth/password sign-in handoff.
// 30-minute TTL is generous: the longest legit gap between "completed
// assessment" and "signed in" is a user reading the landing page and clicking
// the Sign-in link — well under a minute in practice. Beyond 30 min we treat
// it as a stale handoff and wipe everything to keep visitors isolated.
export const DEMO_SESSION_COOKIE = "tp_demo_session";
export const DEMO_SESSION_TTL_SECONDS = 30 * 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDemoEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === DEMO_EMAIL;
}

// Server-side cookie reader. Strict UUID validation prevents arbitrary text
// from being stamped into the DB via a forged cookie.
export function readDemoSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    if (rawName?.trim() !== DEMO_SESSION_COOKIE) continue;
    const value = rest.join("=").trim();
    if (UUID_RE.test(value)) return value;
    return null;
  }
  return null;
}

// Uses Web Crypto (available in both node and edge runtimes since Node 19).
export function mintDemoSessionId(): string {
  return crypto.randomUUID();
}

export function setDemoSessionCookie(
  response: NextResponse,
  value: string,
): void {
  response.cookies.set(DEMO_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEMO_SESSION_TTL_SECONDS,
    path: "/",
  });
}

export function clearDemoSessionCookie(response: NextResponse): void {
  response.cookies.set(DEMO_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}

// Anonymous demo submissions always mint a fresh session id so two different
// visitors using the same shared browser don't accidentally inherit each
// other's prior cookie. Sign-in flows reuse the incoming cookie to preserve
// the just-completed anonymous handoff.
export function resolveOrMintForAnonymousSubmission(): string {
  return mintDemoSessionId();
}

export function resolveOrMintForSignin(request: Request): {
  sessionId: string;
  carriedFromCookie: boolean;
} {
  const existing = readDemoSessionCookie(request);
  if (existing) return { sessionId: existing, carriedFromCookie: true };
  return { sessionId: mintDemoSessionId(), carriedFromCookie: false };
}

// Wipe every demo-email assessment whose demo_session_id does NOT match the
// currently active session. Called from /api/auth/password on demo sign-in.
// Uses IS DISTINCT FROM so a NULL session_id (legacy rows from before this
// column existed) also gets wiped — those have no signed-in owner.
//
// Two-step DELETE: email_queue first to satisfy any environment still on the
// pre-hotfix NO-ACTION FK. After the 2026-05-20 FK upgrade this is redundant
// but harmless and keeps the queue table tidy.
export async function wipeOtherDemoAssessments(
  currentSessionId: string,
): Promise<{ wiped: number }> {
  try {
    await sql`
      DELETE FROM email_queue
      WHERE assessment_id IN (
        SELECT id FROM assessments
        WHERE lower(email) = ${DEMO_EMAIL}
          AND demo_session_id IS DISTINCT FROM ${currentSessionId}
      )
    `;
  } catch (err) {
    console.warn("[demo:wipe:queue_delete_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const rows = await sql`
      DELETE FROM assessments
      WHERE lower(email) = ${DEMO_EMAIL}
        AND demo_session_id IS DISTINCT FROM ${currentSessionId}
      RETURNING id
    `;
    return { wiped: rows.length };
  } catch (err) {
    console.error("[demo:wipe:assessment_delete_failed]", {
      currentSessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { wiped: 0 };
  }
}
