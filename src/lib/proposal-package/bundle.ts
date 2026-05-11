import JSZip from "jszip";
import { put } from "@vercel/blob";

export interface BundleFile {
  filename: string;
  content: Buffer;
}

export interface BundleUploadResult {
  url: string | null;
  pathname: string | null;
}

/**
 * Build a ZIP archive containing the provided deliverable files and upload it
 * to public Vercel Blob storage under the given pathname. Returns null URLs
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

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn("[proposal-package:blob_token_missing]", { pathname });
    return { url: null, pathname: null };
  }
  try {
    const result = await put(pathname, zipBuffer, {
      access: "public",
      contentType: "application/zip",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: result.url, pathname: result.pathname };
  } catch (err) {
    console.error("[proposal-package:blob_upload_failed]", {
      pathname,
      error: err instanceof Error ? err.message : String(err),
    });
    return { url: null, pathname: null };
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
