import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const OAUTH_STATE_COOKIE = "tp_google_oauth_state";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, {
    namespace: "auth:google:start:ip",
    limit: 40,
    windowMs: 10 * 60 * 1000,
  });
  if (limited) return limited;

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(url);
  }

  const reqUrl = new URL(request.url);
  const next = safeNextPath(reqUrl.searchParams.get("next"));

  const nonce = crypto.randomUUID();
  const stateCookie = Buffer.from(JSON.stringify({ nonce, next })).toString("base64url");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "https://www.tenderpath.me";
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: nonce,
    access_type: "offline",
    prompt: "select_account",
  });

  const response = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.cookies.set(OAUTH_STATE_COOKIE, stateCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60,
    path: "/api/auth/google",
  });
  return response;
}
