import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = new Set([
  "/api/auth/signup",
  "/api/auth/login",
  "/api/auth/password",
  "/api/auth/verify",
  "/api/auth/google",
  "/api/auth/google/callback",
  "/api/health",
  "/api/webhooks/stripe",
  "/api/cron/crawl",
  "/api/cron/grants",
  "/api/cron/weekly-digest",
  "/api/cron/daily-digest",
  "/api/cron/bot-nudges",
  "/api/assessment/public",
  "/api/assessment/preview",
  // Live "opportunity signal" counts shown in the public assessment wizard
  // before the user has any session. Read-only aggregate counts, no PII.
  "/api/assessment/opportunity-signal",
  // PDF report — opened via `<a href="/api/report?id={uuid}">` so the browser
  // can't supply a Bearer header (anchor nav drops Authorization). The route
  // itself authorizes via UUID capability through authorizeAssessmentRead,
  // same model as /api/assessment/{uuid}.
  "/api/report",
  "/api/pay/checkout",
  "/api/pay/readiness",
  "/api/telegram/webhook",
  // WhatsApp Business Cloud API webhook — Meta posts inbound messages here and
  // hits GET for the verification handshake; neither can carry a Bearer header.
  // The route verifies the X-Hub-Signature-256 HMAC itself.
  "/api/whatsapp/webhook",
  // Vault upload token endpoint — called by @vercel/blob/client's `upload()`.
  // The route authorizes same-origin tp_session cookies itself and accepts a
  // legacy clientPayload JWT only as fallback, so the proxy gate is bypassed.
  // Also receives the post-upload webhook from Vercel Blob (signature
  // verified by handleUpload()).
  "/api/dashboard/vault/upload-token",
]);

// Matches /api/assessment/{numeric-id-or-uuid} only — not subpaths like /pdf.
// UUID is the canonical post-IDOR-fix form; the numeric-id branch is kept for
// in-flight polling sessions that fetched their poll_url before deploy.
// Authorization on the row itself happens in authorizeAssessmentRead, not here.
const PUBLIC_ASSESSMENT_POLL_RE =
  /^\/api\/assessment\/(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Sibling pattern for the HTML+print PDF fallback. Anchor navigation from the
// dashboard PDF button (target="_blank") can't carry a Bearer header, so the
// proxy default-deny would 401 every click. The route itself authorizes via
// authorizeAssessmentRead — UUID is capability, int requires session ownership
// — so the proxy gate is redundant. Mirrors how /api/report is already public.
const PUBLIC_ASSESSMENT_PDF_RE =
  /^\/api\/assessment\/(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/pdf$/i;

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (PUBLIC_ASSESSMENT_POLL_RE.test(pathname)) return true;
  if (PUBLIC_ASSESSMENT_PDF_RE.test(pathname)) return true;
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

  // API routes: authenticate via Authorization header or the httpOnly session
  // cookie. Prefer trying every available token so stale localStorage does not
  // break a valid cookie-backed session.
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const cookieToken = request.cookies.get("tp_session")?.value?.trim() ?? "";
  const tokens = [bearerToken, cookieToken].filter(Boolean);
  if (tokens.length === 0) {
    return NextResponse.json(
      { error: "Authentication required", code: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  for (const token of tokens) {
    try {
      await jwtVerify(token, new TextEncoder().encode(secret));
      return NextResponse.next();
    } catch {
      // Try the next token candidate.
    }
  }

  return NextResponse.json(
    { error: "Invalid or expired token", code: "AUTH_INVALID" },
    { status: 401 }
  );
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*", "/dashboard"],
};
