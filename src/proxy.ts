import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = new Set([
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/password",
  "/api/auth/verify",
  "/api/health",
  "/api/webhooks/stripe",
  "/api/cron/crawl",
  "/api/cron/grants",
  "/api/cron/weekly-digest",
  "/api/cron/daily-digest",
  "/api/assessment/public",
  "/api/assessment/preview",
  "/api/pay/checkout",
  "/api/telegram/webhook",
]);

// Matches /api/assessment/{numeric-id} only — not subpaths like /pdf
const PUBLIC_ASSESSMENT_POLL_RE = /^\/api\/assessment\/\d+$/;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_ASSESSMENT_POLL_RE.test(pathname)) return true;
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/dashboard")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isDashboardPage = pathname.startsWith("/dashboard");
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (isDashboardPage) {
      return NextResponse.redirect(new URL("/login?next=" + encodeURIComponent(pathname), request.url));
    }
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  // Dashboard page routes: authenticate via httpOnly cookie
  if (isDashboardPage) {
    const cookieToken = request.cookies.get("tp_session")?.value;
    if (!cookieToken) {
      return NextResponse.redirect(new URL("/login?next=" + encodeURIComponent(pathname), request.url));
    }
    try {
      const { payload } = await jwtVerify(cookieToken, new TextEncoder().encode(secret));
      const trialExpiresAt = payload.trialExpiresAt as string | null | undefined;
      const subscriptionStatus = payload.subscriptionStatus as string | null | undefined;
      const isAdmin = payload.isAdmin as boolean | undefined;

      // Admins and active subscribers bypass trial check
      if (!isAdmin && subscriptionStatus !== "active") {
        if (trialExpiresAt && new Date(trialExpiresAt) < new Date()) {
          return NextResponse.redirect(
            new URL("/pay?plan=grants-tenders-matching&trial_expired=1", request.url)
          );
        }
      }
      return NextResponse.next();
    } catch {
      return NextResponse.redirect(new URL("/login?next=" + encodeURIComponent(pathname), request.url));
    }
  }

  // API routes: authenticate via Authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);

  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return NextResponse.next();
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token", code: "AUTH_INVALID" },
      { status: 401 }
    );
  }
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*", "/dashboard"],
};
