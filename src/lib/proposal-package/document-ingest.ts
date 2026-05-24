/**
 * document-ingest.ts — file-based document extraction for tender fixtures.
 *
 * Thin wrapper around `src/lib/documents/extract.ts` (the battle-tested PR-H
 * pdfjs/jszip/exceljs pipeline) that adds:
 *   - file-system reading (the vault flow operates on Buffer + mimeType)
 *   - content-hash computation (DocManifestEntry.contentHash, for the
 *     amendment-versioning hash-compare case)
 *   - higher per-document text cap (rubric extraction needs full text,
 *     not vault-preview 24k chars)
 *
 * Consumed by manifest-loader.ts to materialize IngestedDoc[] from disk.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { extractDocumentText, type DocumentExtractionResult } from "@/lib/documents/extract";

export type DocumentFormat = "pdf" | "docx" | "xlsx" | "doc" | "unknown";

export interface ExtractedDocument {
  filepath: string;
  filename: string;
  format: DocumentFormat;
  byteSize: number;
  contentHash: string;
  extraction: DocumentExtractionResult;
}

/**
 * Per-document text cap for rubric extraction. Larger than the 24k vault default
 * because UN solicitations regularly span 30-50 pages of dense scoring criteria
 * and technical specs.
 */
const RUBRIC_TEXT_CAP_CHARS = 200_000;

function detectFormat(filename: string): { format: DocumentFormat; mimeType: string } {
  const ext = extname(filename).toLowerCase();
  if (ext === ".pdf") return { format: "pdf", mimeType: "application/pdf" };
  if (ext === ".docx") {
    return {
      format: "docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  if (ext === ".xlsx") {
    return {
      format: "xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  if (ext === ".doc") return { format: "doc", mimeType: "application/msword" };
  return { format: "unknown", mimeType: "application/octet-stream" };
}

export async function ingestDocument(filepath: string): Promise<ExtractedDocument> {
  const filename = basename(filepath);
  const buffer = await readFile(filepath);
  const { format, mimeType } = detectFormat(filename);
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const extraction = await extractDocumentText({
    buffer,
    mimeType,
    fileName: filename,
    maxChars: RUBRIC_TEXT_CAP_CHARS,
  });
  return {
    filepath,
    filename,
    format,
    byteSize: buffer.byteLength,
    contentHash,
    extraction,
  };
}
