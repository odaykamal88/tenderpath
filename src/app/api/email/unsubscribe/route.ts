/**
 * Sprint 22. One-click unsubscribe endpoint (RFC 8058).
 *
 * - POST: the form Gmail/Yahoo/Apple Mail use when the user clicks the
 *   inbox "Unsubscribe" button. The token is in the URL query string; the
 *   body carries the `List-Unsubscribe=One-Click` marker (we don't need to
 *   read it — the URL token is sufficient). Responds 200 text/plain.
 *
 * - GET: when a user clicks the unsubscribe link inside the email body
 *   itself (or pastes the URL into a browser). Suppresses immediately and
 *   renders a confirmation page. Prefetcher-triggered unsubscribes are a
 *   theoretical risk but require the token, which is per-recipient — only
 *   the recipient's own mailbox can fire it.
 *
 * The HMAC-signed token (`base64url(email).base64url(hmac)`) prevents harvesting
 * arbitrary addresses. See `src/lib/email/suppression.ts` for the format.
 */
import { NextResponse } from "next/server";
import { suppressEmail, verifyUnsubscribeToken } from "@/lib/email/suppression";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readToken(request: Request): string | null {
  const url = new URL(request.url);
  return url.searchParams.get("t");
}

function htmlResponse(status: number, body: string): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function page(title: string, heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<style>
  body{margin:0;background:#fafaf7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;}
  .wrap{max-width:520px;margin:0 auto;padding:64px 24px;}
  .card{background:#fff;border:1px solid #e7e5e4;border-radius:6px;padding:32px 28px;}
  .brand{font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:500;letter-spacing:-0.01em;margin-bottom:24px;}
  .brand .dot{color:#ea580c;}
  h1{font-family:'Fraunces',Georgia,serif;font-size:22px;font-weight:500;margin:0 0 12px;letter-spacing:-0.01em;}
  p{font-size:14.5px;line-height:1.6;color:#44403c;margin:0 0 14px;}
  .email{font-family:'IBM Plex Mono','SF Mono',Menlo,monospace;font-size:13px;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:3px;padding:8px 10px;display:inline-block;color:#1c1917;}
  a.cta{display:inline-block;margin-top:20px;background:#1c1917;color:#fff;text-decoration:none;padding:10px 18px;border-radius:2px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;font-family:'IBM Plex Mono','SF Mono',Menlo,monospace;}
  .muted{color:#78716c;font-size:12px;margin-top:24px;}
</style>
</head>
<body><div class="wrap"><div class="card">
<div class="brand">Tender<span class="dot">·</span>Path</div>
<h1>${escapeHtml(heading)}</h1>
${body}
</div></div></body></html>`;
}

function successPage(email: string): string {
  return page(
    "Unsubscribed from TenderPath",
    "You're unsubscribed.",
    `<p>We won't send further matched-opportunity, proposal, or roster emails to:</p>
<p><span class="email">${escapeHtml(email)}</span></p>
<p>Account-critical messages (sign-in links, payment receipts) may still be delivered.</p>
<p class="muted">Changed your mind? Email <a href="mailto:info@tenderpath.me">info@tenderpath.me</a> and we'll re-enable you.</p>`
  );
}

function errorPage(reason: string): string {
  return page(
    "Unsubscribe link issue",
    "We couldn't process that link.",
    `<p>${escapeHtml(reason)}</p>
<p class="muted">Email <a href="mailto:unsubscribe@tenderpath.me?subject=unsubscribe">unsubscribe@tenderpath.me</a> and we'll take care of it manually.</p>`
  );
}

async function performUnsubscribe(email: string, source: string, request: Request): Promise<void> {
  await suppressEmail(email, source, {
    userAgent: request.headers.get("user-agent") ?? undefined,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = readToken(request);
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const email = verifyUnsubscribeToken(token);
  if (!email) return NextResponse.json({ error: "Invalid token" }, { status: 400 });

  try {
    await performUnsubscribe(email, "one-click-post", request);
    console.log("[tp:unsubscribe:post]", { email });
  } catch (err) {
    console.error("[tp:unsubscribe:post_failed]", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Could not record unsubscribe" }, { status: 500 });
  }

  return new NextResponse(`Unsubscribed ${email}`, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = readToken(request);
  if (!token) return htmlResponse(400, errorPage("This unsubscribe link is missing its token."));

  const email = verifyUnsubscribeToken(token);
  if (!email) return htmlResponse(400, errorPage("This unsubscribe link is invalid or has been tampered with."));

  try {
    await performUnsubscribe(email, "one-click-get", request);
    console.log("[tp:unsubscribe:get]", { email });
  } catch (err) {
    console.error("[tp:unsubscribe:get_failed]", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return htmlResponse(
      500,
      errorPage("Something went wrong recording your unsubscribe. Please try again in a minute or email unsubscribe@tenderpath.me.")
    );
  }

  return htmlResponse(200, successPage(email));
}
