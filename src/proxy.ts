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
  // Vercel cron requests arrive as plain HTTP GETs with Bearer CRON_SECRET
  // (not a JWT), so they must be allowlisted here or the proxy 401s them
  // before the handler runs. The routes self-authorize via CRON_SECRET, same
  // as the crons above. Both are registered in vercel.json.
  "/api/cron/trial-reminders",
  "/api/cron/network-match",
  "/api/cron/refresh-matches",
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
  // Inbound agency mail for submission orders ({ref}@in.tenderpath.me) — the
  // mail provider's webhook can't carry a Bearer header. DORMANT until
  // INBOUND_MAIL_SECRET is set; the route enforces that shared secret itself.
  "/api/inbound/agency-mail",
  // Vault upload token endpoint — called by @vercel/blob/client's `upload()`
  // on the browser, which cannot attach a Bearer header. The route itself
  // verifies the tp_session JWT via clientPayload inside
  // onBeforeGenerateToken, so the proxy gate is intentionally bypassed.
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
  // Investor data room API. Investors have no JWT — these endpoints self-
  // authorize via the shared data-room password (login → httpOnly cookie) or a
  // super-admin Bearer. The proxy default-deny would 401 the cookie path, so
  // the prefix is allowlisted here, same model as the Stripe/cron webhooks.
  if (pathname.startsWith("/api/data-room/")) return true;
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
      // Freemium (2026-06): the dashboard is free for any authenticated user, so
      // we only verify the session cookie here. Premium features (Document Vault,
      // Readiness-gap Navigator, unlimited bid/no-bid) gate themselves server-side
      // via requireDashboardAccess + the bid/no-bid monthly cap. This block used
      // to redirect trial-expired users to /pay — removed when dashboard access
      // became free on signup.
      await jwtVerify(cookieToken, new TextEncoder().encode(secret));
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
