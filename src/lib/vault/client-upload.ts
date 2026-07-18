"use client";

import { upload } from "@vercel/blob/client";
import { inferTenderDocumentRole } from "@/lib/tender-workspace/documents";
import type { TenderDocumentRole, TenderPackDocument } from "@/lib/tender-workspace/types";

export interface TenderPackUploadContext {
  tenderId?: number | null;
  tenderTitle?: string | null;
  role?: TenderDocumentRole;
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
  const blob = await upload(blobPath, file, {
    access: "private",
    handleUploadUrl: "/api/dashboard/vault/upload-token",
    clientPayload: token ? JSON.stringify({ token }) : undefined,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage),
  });

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

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    url?: string;
    vaultDocumentId?: number;
    extraction?: {
      status?: TenderPackDocument["extractionStatus"];
      charCount?: number;
    };
  };
  if (!response.ok || !data.url || !data.vaultDocumentId) {
    throw new Error(data.error ?? "The file uploaded, but TenderPath could not process it.");
  }

  return {
    vaultDocumentId: data.vaultDocumentId,
    name: file.name,
    role,
    source: "user_upload",
    extractionStatus: data.extraction?.status ?? "unsupported",
    charCount: data.extraction?.charCount ?? 0,
    downloadUrl: data.url,
  };
}
