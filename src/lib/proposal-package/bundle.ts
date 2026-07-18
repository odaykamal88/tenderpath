import JSZip from "jszip";
import { privateBlobConfigured, putPrivateBlob } from "@/lib/vault/storage";

export interface BundleFile {
  filename: string;
  content: Buffer;
}

export interface BundleUploadResult {
  url: string | null;
  pathname: string | null;
  /** Non-null when upload failed — propagated to proposal_packages.error_message
   *  so silent Blob failures are queryable from the DB. Vercel runtime logs
   *  are paywalled (ExceedsBillingLimitError) on the current plan and the
   *  console diagnostic below is not always reachable from there. */
  error: string | null;
}

/**
 * Build a ZIP archive containing the provided deliverable files and upload it
 * to private Vercel Blob storage under the given pathname. Returns null URLs
 * if Blob isn't configured — the caller decides whether to surface or fail.
 */
export async function bundleAndUpload(
  files: BundleFile[],
  pathname: string,
): Promise<BundleUploadResult> {
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.filename, f.content);
  }
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  if (!privateBlobConfigured()) {
    console.warn("[proposal-package:blob_token_missing]", { pathname });
    return { url: null, pathname: null, error: "private_blob_token_missing" };
  }
  try {
    const result = await putPrivateBlob(pathname, zipBuffer, {
      contentType: "application/zip",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: result.url, pathname: result.pathname, error: null };
  } catch (err) {
    // Match the diagnostic shape used in bid-no-bid/generate.ts:uploadPdf so
    // the two upload failure modes can be triaged from the same log query.
    const e = err as { name?: string; code?: string; status?: number; message?: string };
    const summary = `blob_upload_failed: ${e?.name ?? "Error"}${e?.status ? ` (${e.status})` : ""} — ${e?.message ?? String(err)}`;
    console.error("[proposal-package:blob_upload_failed]", {
      pathname,
      bufferBytes: zipBuffer.length,
      errorName: e?.name ?? null,
      errorCode: e?.code ?? null,
      errorStatus: e?.status ?? null,
      message: e?.message ?? String(err),
    });
    return { url: null, pathname: null, error: summary };
  }
}

/** Build a filesystem-safe filename slug from a free-form title. */
export function safeFilenameStem(title: string | null, fallback: string): string {
  const raw = (title ?? "").trim() || fallback;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}
