import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { generateMagicToken } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const OAUTH_STATE_COOKIE = "tp_google_oauth_state";

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawName, ...valueParts] = part.split("=");
    if (rawName?.trim() === name) return valueParts.join("=").trim() || null;
  }
  return null;
}

function clearStateCookie(response: NextResponse): NextResponse {
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/api/auth/google",
  });
  return response;
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    namespace: "auth:google:callback:ip",
    limit: 60,
    windowMs: 10 * 60 * 1000,
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "https://www.tenderpath.me";

  function errorRedirect(reason: string) {
    const dest = new URL("/login", appUrl);
    dest.searchParams.set("error", reason);
    return clearStateCookie(NextResponse.redirect(dest));
  }

  if (oauthError || !code) return errorRedirect("google_denied");

  let next = "/dashboard";
  try {
    const cookieState = readCookie(request, OAUTH_STATE_COOKIE);
    const state = JSON.parse(Buffer.from(cookieState ?? "", "base64url").toString()) as {
      nonce?: string;
      next?: string;
    };
    if (!stateParam || stateParam !== state.nonce) {
      return errorRedirect("google_state_invalid");
    }
    if (
      typeof state.next === "string"
      && state.next.startsWith("/")
      && !state.next.startsWith("//")
      && !state.next.startsWith("/\\")
    ) {
      next = state.next;
    }
  } catch {
    return errorRedirect("google_state_invalid");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return errorRedirect("google_not_configured");

  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) return errorRedirect("google_token_failed");

  const tokens = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokens.access_token) return errorRedirect("google_token_failed");

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });

  if (!profileRes.ok) return errorRedirect("google_profile_failed");

  const profile = (await profileRes.json()) as { email?: string; name?: string };
  if (!profile.email) return errorRedirect("google_no_email");

  const email = profile.email.toLowerCase();

  // Find or create user
  let users = await sql`
    SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1
  `;

  if (!users.length) {
    const now = new Date().toISOString();
    users = await sql`
      INSERT INTO users (email, name, created_at, trial_start_date)
      VALUES (${email}, ${profile.name ?? null}, ${now}, ${now})
      RETURNING id
    `;
  }

  if (!users.length) return errorRedirect("google_user_create_failed");

  // Issue a short-lived magic token and redirect to the existing verify flow
  const magicToken = generateMagicToken();
  const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await sql`
    UPDATE users SET
      magic_token = ${magicToken},
      magic_token_expires_at = ${expires.toISOString()}
    WHERE id = ${users[0].id}
  `;

  const dest = new URL("/login", appUrl);
  dest.searchParams.set("token", magicToken);
  dest.searchParams.set("next", next);
  return clearStateCookie(NextResponse.redirect(dest));
}
