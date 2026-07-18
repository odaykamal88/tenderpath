import "server-only";

import { sql } from "@/lib/db";
import { inferTenderDocumentRole, tenderPackStatus } from "./documents";
import { TENDER_DOCUMENT_ROLES, type TenderDocumentRole, type TenderPackDocument, type TenderPackState } from "./types";

export class TenderPackOwnershipError extends Error {
  constructor() {
    super("One or more tender-pack documents are not available to this account.");
    this.name = "TenderPackOwnershipError";
  }
}

interface OwnedDocumentRow {
  id: number;
  name: string;
  tags: string[] | null;
  status: TenderPackDocument["extractionStatus"] | null;
  char_count: number | null;
}

function roleInTags(tags: string[] | null): TenderDocumentRole {
  const raw = tags?.find((tag) => tag.startsWith("tender-role:"))?.slice("tender-role:".length) ?? "";
  return inferTenderDocumentRole(raw);
}

/**
 * Rebuild the customer-supplied manifest from owner-scoped database rows.
 * This prevents forged vault ids, raw URLs, names, and extraction status from
 * crossing into a paid work order.
 */
export async function sanitizeTenderPackForUser(
  userId: number,
  pack: TenderPackState | null | undefined,
): Promise<TenderPackState> {
  const incoming = Array.isArray(pack?.documents) ? pack.documents.slice(0, 24) : [];
  const ids = Array.from(new Set(incoming.map((doc) => Number(doc.vaultDocumentId)).filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) {
    return {
      status: pack?.status === "needs_upload" ? "needs_upload" : "not_started",
      documents: [],
      checkedAt: pack?.checkedAt ?? null,
      note: pack?.note?.slice(0, 500) ?? null,
    };
  }

  const rows = (await sql`
    SELECT vd.id, vd.name, vd.tags, de.status, de.char_count
    FROM vault_documents vd
    LEFT JOIN document_extractions de
      ON de.vault_document_id = vd.id AND de.user_id = vd.user_id
    WHERE vd.user_id = ${userId}
      AND vd.id = ANY(${ids}::int[])
  `) as unknown as OwnedDocumentRow[];
  if (rows.length !== ids.length) throw new TenderPackOwnershipError();

  const requestedRole = new Map<number, TenderDocumentRole>();
  for (const doc of incoming) {
    if (TENDER_DOCUMENT_ROLES.includes(doc.role)) requestedRole.set(doc.vaultDocumentId, doc.role);
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const documents = ids.map((id): TenderPackDocument => {
    const row = rowById.get(id)!;
    return {
      vaultDocumentId: id,
      name: row.name,
      role: requestedRole.get(id) ?? roleInTags(row.tags),
      source: row.tags?.includes("tender-pack:source-import") ? "source_import" : "user_upload",
      extractionStatus: row.status ?? "unsupported",
      charCount: row.char_count ?? 0,
      downloadUrl: `/api/dashboard/vault/${id}/download`,
    };
  });

  return {
    status: tenderPackStatus(documents, true),
    documents,
    checkedAt: pack?.checkedAt ?? new Date().toISOString(),
    note: pack?.note?.slice(0, 500) ?? null,
  };
}
