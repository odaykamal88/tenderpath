import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

/**
 * Subscription gating middleware.
 * Protects tier-gated API routes by verifying JWT presence.
 * Detailed tier checks happen in route-level guards (subscription-guard.ts).
 */

const PUBLIC_PATHS = new Set([
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/verify",
  "/api/health",
  "/api/webhooks/stripe",
  "/api/cron/sync-tenders",
  "/api/cron/crawl",
  "/api/assessment/public",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Allow all non-API routes (pages, static assets)
  if (!pathname.startsWith("/api/")) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for Authorization header
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

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
  matcher: ["/api/:path*"],
};
