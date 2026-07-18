import { NextRequest, NextResponse } from "next/server";
import type { HandleUploadBody } from "@vercel/blob/client";
import { handleUpload } from "@vercel/blob/client";
import { getUserFromRequest, verifyToken } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { sql } from "@/lib/db";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { privateBlobToken } from "@/lib/vault/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAllowedClientPath(pathname: string): boolean {
  return /^vault-upload\/[a-z0-9-]+(?:\.[a-z0-9]{1,12})?$/i.test(pathname);
}

// Direct-to-Blob upload coordinator. Two responsibilities:
//
//   1. blob.generate-client-token — the browser SDK calls here to mint a
//      signed token. Same-origin cookies authorize the request; the legacy
//      `clientPayload` JWT is accepted only as a fallback for older sessions.
//
//   2. blob.upload-completed — Vercel Blob webhook after the file lands in
//      storage. Signature is verified by handleUpload(). We don't run
//      extraction here (the webhook only fires in production and may race
//      the client's follow-up call) — extraction lives in
//      /api/dashboard/vault/extract which the client POSTs to immediately
//      after upload returns.
//
// Whitelisted in src/proxy.ts because the SDK's POST to this route can't
// supply a Bearer header. Authorization happens inside onBeforeGenerateToken.
export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, {
    namespace: "vault-upload-token",
    limit: 80,
    windowMs: 10 * 60 * 1000,
  });
  if (limited) return limited;

  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    console.warn("[vault:upload-token:bad_json]");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await ensureCustomerPrivacySchema();
    const requestUser = await getUserFromRequest(req);
    const result = await handleUpload({
      body,
      request: req,
      token: privateBlobToken(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!isAllowedClientPath(pathname)) {
          console.warn("[vault:upload-token:bad_path]", { pathname });
          throw new Error("Invalid upload path");
        }
        let tokenUserId: number | null = null;
        if (clientPayload) {
          try {
            const parsed = JSON.parse(clientPayload) as { token?: string };
            const token = parsed.token ?? null;
            if (token) {
              const claims = await verifyToken(token);
              tokenUserId = claims?.userId ?? null;
            }
          } catch {
            // fall through — cookie auth may still authorize the request
          }
        }
        if (requestUser && tokenUserId && requestUser.id !== tokenUserId) {
          console.warn("[vault:upload-token:user_mismatch]", { pathname });
          throw new Error("Upload authentication mismatch");
        }
        const userId = requestUser?.id ?? tokenUserId;
        if (!userId) {
          console.warn("[vault:upload-token:no_token]", { pathname });
          throw new Error("Authentication required for upload");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ],
          // 50 MB cap — comfortable for tender docs, sane upper bound. Browser
          // direct upload bypasses Vercel's 4.5 MB function body limit, which
          // is the bug we're fixing here.
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = JSON.parse(tokenPayload ?? "{}") as { userId?: number };
        const userId = Number(payload.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
          console.error("[vault:upload-token:webhook_owner_missing]", { pathname: blob.pathname });
          throw new Error("Upload owner missing from verified token payload");
        }
        await sql`
          INSERT INTO vault_upload_receipts (
            user_id, blob_url, blob_pathname, content_type
          ) VALUES (
            ${userId}, ${blob.url}, ${blob.pathname}, ${blob.contentType}
          )
          ON CONFLICT (blob_url) DO UPDATE SET
            blob_pathname = EXCLUDED.blob_pathname,
            content_type = EXCLUDED.content_type,
            expires_at = NOW() + INTERVAL '24 hours'
          WHERE vault_upload_receipts.user_id = EXCLUDED.user_id
        `;
        console.info("[vault:upload-token:webhook_completed]", {
          pathname: blob.pathname,
          userId,
        });
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[vault:upload-token:failed]", {
      bodyType: body.type,
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload token generation failed" },
      { status: 400 },
    );
  }
}
