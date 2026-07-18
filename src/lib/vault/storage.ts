import { del, get, put } from "@vercel/blob";

export type StoredBlobAccess = "private" | "legacy_public" | "inline" | "synthetic" | "invalid";

const PRIVATE_BLOB_RE = /^https:\/\/[a-z0-9-]+\.private\.blob\.vercel-storage\.com\//i;
const PUBLIC_BLOB_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export class PrivateBlobConfigurationError extends Error {
  constructor() {
    super("BLOB_READ_WRITE_TOKEN is not configured for a private Vercel Blob store");
    this.name = "PrivateBlobConfigurationError";
  }
}

export function storedBlobAccess(value: string): StoredBlobAccess {
  if (PRIVATE_BLOB_RE.test(value)) return "private";
  if (PUBLIC_BLOB_RE.test(value)) return "legacy_public";
  if (value.startsWith("data:")) return "inline";
  if (value.startsWith("tenderpath://")) return "synthetic";
  return "invalid";
}

export function privateBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new PrivateBlobConfigurationError();
  return token;
}

export function privateBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function putPrivateBlob(
  pathname: string,
  body: Buffer | Blob,
  options: { contentType?: string; addRandomSuffix?: boolean; allowOverwrite?: boolean } = {},
) {
  return put(pathname, body, {
    access: "private",
    token: privateBlobToken(),
    contentType: options.contentType,
    addRandomSuffix: options.addRandomSuffix ?? true,
    allowOverwrite: options.allowOverwrite ?? false,
  });
}

export async function getPrivateBlob(urlOrPathname: string) {
  return get(urlOrPathname, {
    access: "private",
    token: privateBlobToken(),
  });
}

export async function deleteStoredBlob(url: string, access: StoredBlobAccess): Promise<void> {
  if (access === "private") {
    await del(url, { token: privateBlobToken() });
    return;
  }
  if (access === "legacy_public") {
    const token = process.env.LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) {
      throw new Error("LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN is required to delete a legacy public object");
    }
    await del(url, { token });
    return;
  }
  if (access === "inline" || access === "synthetic") return;
  throw new Error("Refusing to delete metadata for an unrecognized stored object URL");
}

export function authenticatedArtifactUrl(workOrderId: number): string {
  return `/api/dashboard/work-orders/${workOrderId}/artifact`;
}
