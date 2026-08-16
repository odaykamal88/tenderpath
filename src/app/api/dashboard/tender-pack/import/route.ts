import { createHash, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { browserAvailable, fetchViaBrowser } from "@/lib/crawlers/_browser";
import { sql } from "@/lib/db";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";
import { ensureCustomerPrivacySchema } from "@/lib/privacy/schema";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { assertSafeHttpUrl } from "@/lib/security/safe-url";
import {
  discoverTenderAttachments,
  inferTenderDocumentRole,
  tenderPackStatus,
  type TenderAttachmentLink,
} from "@/lib/tender-workspace/documents";
import type { TenderPackDocument } from "@/lib/tender-workspace/types";
import { deleteStoredBlob, privateBlobConfigured, putPrivateBlob } from "@/lib/vault/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SOURCE_HTML_BYTES = 3 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_DOCUMENTS = 8;
const USER_AGENT = "TenderPathBot/1.0 (+https://www.tenderpath.me)";

interface TenderRow {
  id: number;
  title: string;
  agency: string;
  source_url: string | null;
}

interface VaultPackRow {
  id: number;
  name: string;
  tags: string[] | null;
  status: TenderPackDocument["extractionStatus"] | null;
  char_count: number | null;
}

function contentTypeFor(ext: string): string {
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rtf: "application/rtf",
  };
  return types[ext.toLowerCase()] ?? "application/octet-stream";
}

function cleanFileName(value: string, ext: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 170);
  const fallback = `tender-document.${ext}`;
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith(`.${ext}`) ? cleaned : `${cleaned}.${ext}`;
}

function sourceTag(url: string): string {
  return `tender-source:${createHash("sha256").update(url).digest("hex").slice(0, 24)}`;
}

function roleFromTags(tags: string[] | null): TenderPackDocument["role"] {
  const value = tags?.find((tag) => tag.startsWith("tender-role:"))?.slice("tender-role:".length);
  return inferTenderDocumentRole(value ?? "");
}

function mapPackRow(row: VaultPackRow): TenderPackDocument {
  return {
    vaultDocumentId: row.id,
    name: row.name,
    role: roleFromTags(row.tags),
    source: row.tags?.includes("tender-pack:user-upload") ? "user_upload" : "source_import",
    extractionStatus: row.status ?? "unsupported",
    charCount: row.char_count ?? 0,
    downloadUrl: `/api/dashboard/vault/${row.id}/download`,
  };
}

async function listPackDocuments(userId: number, tenderId: number): Promise<TenderPackDocument[]> {
  const tag = `tender-pack:${tenderId}`;
  const rows = (await sql`
    SELECT vd.id, vd.name, vd.tags, de.status, de.char_count
    FROM vault_documents vd
    LEFT JOIN document_extractions de
      ON de.vault_document_id = vd.id AND de.user_id = vd.user_id
    WHERE vd.user_id = ${userId}
      AND ${tag} = ANY(COALESCE(vd.tags, '{}'))
    ORDER BY vd.created_at ASC, vd.id ASC
  `) as unknown as VaultPackRow[];
  return rows.map(mapPackRow);
}

async function readBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  const announced = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(announced) && announced > maxBytes) {
    throw new Error(`Document exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`);
  }
  if (!response.body) throw new Error("Upstream response had no body.");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Document exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB import limit.`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

/** Validate every redirect hop so a public URL cannot redirect into a private network. */
async function safeFetch(rawUrl: string, accept: string, redirects = 0): Promise<Response> {
  const url = await assertSafeHttpUrl(rawUrl);
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (response.status >= 300 && response.status < 400) {
    if (redirects >= 5) throw new Error("Too many redirects while importing the tender pack.");
    const location = response.headers.get("location");
    if (!location) return response;
    return safeFetch(new URL(location, url).toString(), accept, redirects + 1);
  }
  return response;
}

async function sourceCandidates(sourceUrl: string): Promise<{
  candidates: TenderAttachmentLink[];
  note: string | null;
}> {
  const parsed = await assertSafeHttpUrl(sourceUrl);
  const sourceExt = parsed.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "";
  if (["pdf", "doc", "docx", "xls", "xlsx", "rtf"].includes(sourceExt)) {
    return {
      candidates: [{ href: parsed.toString(), label: parsed.pathname.split("/").pop() || "Tender document", ext: sourceExt }],
      note: null,
    };
  }

  let html = "";
  let directStatus: number | null = null;
  try {
    const response = await safeFetch(parsed.toString(), "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
    directStatus = response.status;
    if (response.ok) html = (await readBuffer(response, MAX_SOURCE_HTML_BYTES)).toString("utf8");
  } catch (error) {
    console.warn("[tp:tender-pack:source_direct_failed]", {
      host: parsed.host,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let candidates = html ? discoverTenderAttachments(html, parsed, MAX_IMPORT_DOCUMENTS) : [];
  const looksThin = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length < 250;
  if ((candidates.length === 0 || looksThin || (directStatus != null && directStatus >= 400)) && browserAvailable()) {
    try {
      const rendered = await fetchViaBrowser(parsed.toString(), {
        mode: "navigate",
        waitAfterNav: 1_500,
        timeoutMs: 45_000,
      });
      if (rendered.finalUrl) await assertSafeHttpUrl(rendered.finalUrl);
      if (rendered.ok && rendered.body) {
        const renderedBase = new URL(rendered.finalUrl ?? parsed.toString());
        candidates = discoverTenderAttachments(rendered.body.slice(0, MAX_SOURCE_HTML_BYTES), renderedBase, MAX_IMPORT_DOCUMENTS);
      }
    } catch (error) {
      console.warn("[tp:tender-pack:source_browser_failed]", {
        host: parsed.host,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    candidates,
    note: candidates.length
      ? null
      : "The official notice did not expose public document links. Keep the supplier portal open beside TenderPath and upload the downloaded pack here.",
  };
}

async function persistImportedDocument(args: {
  userId: number;
  tender: TenderRow;
  candidate: TenderAttachmentLink;
  maxBytes: number;
}): Promise<{ document: TenderPackDocument; bytes: number }> {
  const hashTag = sourceTag(args.candidate.href);
  const existing = (await sql`
    SELECT vd.id, vd.name, vd.tags, de.status, de.char_count
    FROM vault_documents vd
    LEFT JOIN document_extractions de
      ON de.vault_document_id = vd.id AND de.user_id = vd.user_id
    WHERE vd.user_id = ${args.userId}
      AND ${hashTag} = ANY(COALESCE(vd.tags, '{}'))
    LIMIT 1
  `) as unknown as VaultPackRow[];
  if (existing[0]) {
    const packTag = `tender-pack:${args.tender.id}`;
    const mergedTags = Array.from(new Set([...(existing[0].tags ?? []), packTag]));
    if (!(existing[0].tags ?? []).includes(packTag)) {
      await sql`UPDATE vault_documents SET tags = ${mergedTags}::text[] WHERE id = ${existing[0].id} AND user_id = ${args.userId}`;
      existing[0].tags = mergedTags;
    }
    return { document: mapPackRow(existing[0]), bytes: 0 };
  }

  const response = await safeFetch(args.candidate.href, "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*;q=0.3");
  if (!response.ok) throw new Error(`Official document returned HTTP ${response.status}.`);
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || contentTypeFor(args.candidate.ext);
  if (mimeType.includes("text/html")) {
    throw new Error("The document link returned a portal page instead of a file.");
  }
  const buffer = await readBuffer(response, Math.min(MAX_DOCUMENT_BYTES, args.maxBytes));
  const role = inferTenderDocumentRole(`${args.candidate.label} ${args.candidate.href}`);
  const fileName = cleanFileName(args.candidate.label, args.candidate.ext);
  const packTag = `tender-pack:${args.tender.id}`;
  const tags = [
    packTag,
    "tender-pack:source-import",
    `tender-role:${role}`,
    hashTag,
  ];

  const ext = fileName.match(/\.[A-Za-z0-9]{1,12}$/)?.[0]?.toLowerCase() ?? "";
  const blob = await putPrivateBlob(`vault/${args.userId}/${randomUUID()}${ext}`, buffer, {
    contentType: mimeType,
    addRandomSuffix: true,
  });

  try {
    const inserted = (await sql`
      INSERT INTO vault_documents (
        user_id, name, type, file_url, tags, storage_access, blob_pathname
      ) VALUES (
        ${args.userId}, ${fileName}, 'other', ${blob.url}, ${tags}::text[],
        'private', ${blob.pathname}
      )
      RETURNING id
    `) as unknown as Array<{ id: number }>;
    const vaultDocumentId = inserted[0].id;
    const extraction = await extractDocumentText({ buffer, mimeType, fileName });
    const persisted = await persistDocumentExtraction({
      userId: args.userId,
      vaultDocumentId,
      fileName,
      fileUrl: blob.url,
      mimeType,
      result: extraction,
    });
    return {
      document: {
        vaultDocumentId,
        name: fileName,
        role,
        source: "source_import",
        extractionStatus: persisted.status,
        charCount: persisted.charCount,
        downloadUrl: `/api/dashboard/vault/${vaultDocumentId}/download`,
      },
      bytes: buffer.byteLength,
    };
  } catch (error) {
    await deleteStoredBlob(blob.url, "private").catch((cleanupError) => {
      console.error("[tp:tender-pack:orphan_cleanup_failed]", {
        pathname: blob.pathname,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    throw error;
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireDashboardAccess(req);
    if (!guard.authorized) return guard.response!;
    await ensureCustomerPrivacySchema();

    const limited = enforceRateLimit(req, {
      namespace: "tender-pack-import",
      limit: 10,
      windowMs: 60 * 60 * 1000,
      keyParts: [guard.user!.id],
    });
    if (limited) return limited;

    let tenderId: number;
    // Optional user-supplied document/page URL. Many notices (UNGM and most
    // login-walled portals) expose no public attachments, so `source_url`
    // discovery returns nothing; the bidder usually does have a direct link to
    // the pack. Treated exactly like the source URL — same SSRF guard, same
    // discovery, same extraction — never as a trusted input.
    let pastedUrl: string | null = null;
    try {
      const body = (await req.json()) as { tenderId?: number; url?: unknown };
      tenderId = Number(body.tenderId);
      if (!Number.isInteger(tenderId) || tenderId <= 0) throw new Error("invalid tender id");
      if (typeof body.url === "string" && body.url.trim()) {
        pastedUrl = body.url.trim().slice(0, 2000);
      }
    } catch {
      return NextResponse.json({ error: "A valid tender is required." }, { status: 400 });
    }

    const tenders = (await sql`
      SELECT id, title, agency, source_url
      FROM tenders
      WHERE id = ${tenderId}
      LIMIT 1
    `) as unknown as TenderRow[];
    const tender = tenders[0];
    if (!tender) return NextResponse.json({ error: "Tender not found." }, { status: 404 });

    const current = await listPackDocuments(guard.user!.id, tender.id);
    // A pasted link wins over the stored notice URL — the user is telling us
    // where the pack actually is, which is the whole point of pasting it.
    const importUrl = pastedUrl ?? tender.source_url;
    if (!importUrl) {
      return NextResponse.json({
        status: tenderPackStatus(current, true),
        documents: current,
        checkedAt: new Date().toISOString(),
        note: "This tender has no official source URL on record. Paste a direct link to the solicitation documents, or upload the pack you downloaded from the supplier portal.",
      });
    }
    if (!privateBlobConfigured()) {
      console.error("[tp:tender-pack:private_blob_unconfigured]", { userId: guard.user!.id });
      return NextResponse.json({ error: "Private document storage is unavailable." }, { status: 503 });
    }

    let candidates: TenderAttachmentLink[];
    let note: string | null;
    try {
      ({ candidates, note } = await sourceCandidates(importUrl));
    } catch (error) {
      // A bad or unreachable pasted link is user error, not a server fault —
      // say so plainly instead of returning a silent empty pack.
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("[tp:tender-pack:import_url_rejected]", {
        userId: guard.user!.id,
        tenderId: tender.id,
        pasted: Boolean(pastedUrl),
        reason,
      });
      return NextResponse.json(
        {
          error: pastedUrl
            ? `That link could not be read: ${reason}`
            : `The notice URL could not be read: ${reason}`,
        },
        { status: 400 },
      );
    }
    const imported: TenderPackDocument[] = [];
    const failures: string[] = [];
    let totalBytes = 0;
    for (const candidate of candidates.slice(0, MAX_IMPORT_DOCUMENTS)) {
      if (totalBytes >= MAX_TOTAL_DOCUMENT_BYTES) break;
      try {
        const result = await persistImportedDocument({
          userId: guard.user!.id,
          tender,
          candidate,
          maxBytes: MAX_TOTAL_DOCUMENT_BYTES - totalBytes,
        });
        totalBytes += result.bytes;
        imported.push(result.document);
      } catch (error) {
        failures.push(candidate.label);
        console.warn("[tp:tender-pack:document_import_failed]", {
          userId: guard.user!.id,
          tenderId: tender.id,
          host: new URL(candidate.href).host,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const documents = await listPackDocuments(guard.user!.id, tender.id);
    console.info("[tp:tender-pack:import_complete]", {
      userId: guard.user!.id,
      tenderId: tender.id,
      // Which URL was actually scraped — `discovered: 0` is uninterpretable
      // without knowing whether it was the stored notice or a pasted link.
      urlSource: pastedUrl ? "pasted" : "tender_source_url",
      host: (() => { try { return new URL(importUrl).host; } catch { return "(unparseable)"; } })(),
      discovered: candidates.length,
      imported: imported.length,
      failed: failures.length,
      bytes: totalBytes,
    });
    return NextResponse.json({
      status: tenderPackStatus(documents, true),
      documents,
      checkedAt: new Date().toISOString(),
      note: note ?? (failures.length ? `${failures.length} public document(s) could not be imported. Upload them from the supplier portal if required.` : null),
      sourceUrl: tender.source_url,
    });
  } catch (error) {
    console.error("[tp:tender-pack:handler_failed]", {
      errorName: error instanceof Error ? error.name : "unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not import the tender pack. You can still upload it manually." }, { status: 500 });
  }
}
