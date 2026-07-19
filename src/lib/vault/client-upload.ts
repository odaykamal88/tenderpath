"use client";

import { upload } from "@vercel/blob/client";
import { inferTenderDocumentRole } from "@/lib/tender-workspace/documents";
import type { TenderDocumentRole, TenderPackDocument } from "@/lib/tender-workspace/types";

export interface TenderPackUploadContext {
  tenderId?: number | null;
  tenderTitle?: string | null;
  role?: TenderDocumentRole;
}

const SERVER_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024;
const UPLOAD_STALL_TIMEOUT_MS = 60_000;

interface UploadResponse {
  error?: string;
  url?: string;
  vaultDocumentId?: number;
  extraction?: {
    status?: TenderPackDocument["extractionStatus"];
    charCount?: number;
  };
}

function toTenderPackDocument(
  data: UploadResponse,
  fileName: string,
  role: TenderDocumentRole,
): TenderPackDocument {
  if (!data.url || !data.vaultDocumentId) {
    throw new Error(data.error ?? "The file uploaded, but TenderPath could not process it.");
  }
  return {
    vaultDocumentId: data.vaultDocumentId,
    name: fileName,
    role,
    source: "user_upload",
    extractionStatus: data.extraction?.status ?? "unsupported",
    charCount: data.extraction?.charCount ?? 0,
    downloadUrl: data.url,
  };
}

async function uploadSmallFileViaServer(
  file: File,
  context: TenderPackUploadContext,
  role: TenderDocumentRole,
  token: string | null,
  onProgress?: (percentage: number) => void,
): Promise<TenderPackDocument> {
  const form = new FormData();
  form.append("file", file);
  if (context.tenderId) form.append("tenderId", String(context.tenderId));
  if (context.tenderTitle) form.append("tenderTitle", context.tenderTitle);
  form.append("tenderRole", role);
  onProgress?.(5);
  const response = await fetch("/api/dashboard/vault/upload", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    body: form,
    signal: AbortSignal.timeout(UPLOAD_STALL_TIMEOUT_MS),
  });
  const data = (await response.json().catch(() => ({}))) as UploadResponse;
  if (!response.ok) throw new Error(data.error ?? "TenderPath could not upload this file.");
  onProgress?.(100);
  return toTenderPackDocument(data, file.name, role);
}

function uploadLargeFileDirectly(
  blobPath: string,
  file: File,
  token: string | null,
  onProgress?: (percentage: number) => void,
) {
  return new Promise<Awaited<ReturnType<typeof upload>>>((resolve, reject) => {
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout>;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("The private upload stopped making progress. Check your connection and try again."));
      }, UPLOAD_STALL_TIMEOUT_MS);
    };
    armStallTimer();
    void upload(blobPath, file, {
      access: "private",
      handleUploadUrl: "/api/dashboard/vault/upload-token",
      clientPayload: token ? JSON.stringify({ token }) : undefined,
      onUploadProgress: ({ percentage }) => {
        armStallTimer();
        onProgress?.(percentage);
      },
    }).then((blob) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      resolve(blob);
    }).catch((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      reject(error);
    });
  });
}

export async function uploadTenderPackFile(
  file: File,
  context: TenderPackUploadContext,
  onProgress?: (percentage: number) => void,
): Promise<TenderPackDocument> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. The private upload limit is 50 MB.`);
  }

  const token = localStorage.getItem("tp_token");
  const ext = file.name.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase() ?? "";
  const blobPath = `vault-upload/${crypto.randomUUID()}${ext}`;
  const role = context.role ?? inferTenderDocumentRole(file.name);
  if (file.size <= SERVER_UPLOAD_LIMIT_BYTES) {
    return uploadSmallFileViaServer(file, context, role, token, onProgress);
  }

  const blob = await uploadLargeFileDirectly(blobPath, file, token, onProgress);

  const body = JSON.stringify({
    url: blob.url,
    name: file.name,
    mimeType: file.type,
    tenderTitle: context.tenderTitle ?? null,
    tenderId: context.tenderId ?? null,
    tenderRole: role,
    purpose: role === "solicitation" || role === "tor" || role === "guidelines"
      ? "tender_main"
      : "supporting",
  });

  let response: Response | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    response = await fetch("/api/dashboard/vault/extract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 409 || attempt === 5) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  if (!response) throw new Error("Document processing did not start.");

  const data = (await response.json().catch(() => ({}))) as UploadResponse;
  if (!response.ok || !data.url || !data.vaultDocumentId) {
    throw new Error(data.error ?? "The file uploaded, but TenderPath could not process it.");
  }
  return toTenderPackDocument(data, file.name, role);
}
