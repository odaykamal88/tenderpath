import { NextRequest, NextResponse } from "next/server";
import type { HandleUploadBody } from "@vercel/blob/client";
import { handleUpload } from "@vercel/blob/client";
import { verifyToken } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

// Direct-to-Blob upload coordinator. Two responsibilities:
//
//   1. blob.generate-client-token — the browser SDK calls here to mint a
//      signed token. The SDK can't carry an Authorization header on this
//      call, so we accept the tp_session JWT through `clientPayload`
//      instead. Token is rejected if the JWT is missing or invalid.
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
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    console.warn("[vault:upload-token:bad_json]");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let token: string | null = null;
        if (clientPayload) {
          try {
            const parsed = JSON.parse(clientPayload) as { token?: string };
            token = parsed.token ?? null;
          } catch {
            // fall through — token stays null and request fails
          }
        }
        if (!token) {
          console.warn("[vault:upload-token:no_token]", { pathname });
          throw new Error("Authentication required for upload");
        }
        const claims = await verifyToken(token);
        if (!claims) {
          console.warn("[vault:upload-token:invalid_token]", { pathname });
          throw new Error("Invalid or expired token");
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
          tokenPayload: JSON.stringify({ userId: claims.userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Webhook from Vercel Blob (production only). Extraction is done via
        // the explicit /api/dashboard/vault/extract endpoint that the client
        // calls after upload returns — keeping this a no-op so a webhook
        // failure can never roll the upload back.
        console.info("[vault:upload-token:webhook_completed]", {
          url: blob.url,
          tokenPayload,
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
