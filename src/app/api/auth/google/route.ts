import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "google_not_configured");
    return NextResponse.redirect(url);
  }

  const reqUrl = new URL(request.url);
  const next = reqUrl.searchParams.get("next") ?? "/dashboard";

  const state = Buffer.from(JSON.stringify({ next })).toString("base64url");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "https://www.tenderpath.me";
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
