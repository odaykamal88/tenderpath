import ExcelJS from "exceljs";
import JSZip from "jszip";
import { sql } from "@/lib/db";

// pdf-parse@2.x ships a NAPI-backed native binding (@napi-rs/canvas) that
// fails to load in the Vercel serverless runtime — the symptom is a
//   Warning: Cannot load "@napi-..."
// in the function log and a generic Next.js 500 HTML response, served
// *before* any route handler can run. That blew up /api/dashboard/services/
// fetch-criteria and /api/dashboard/vault/extract at module-init time and
// the user saw "Could not fetch criteria (500)." (the client fallback).
//
// We lazy-import pdf-parse inside extractPdf() so the native module is only
// loaded when the request actually involves a PDF. HTML / DOCX / XLSX paths
// never touch it. If the dynamic import itself throws, extractDocumentText's
// outer try/catch turns it into a clean "failed" extraction result instead
// of a route crash.

export type ExtractionStatus = "extracted" | "empty" | "unsupported" | "failed";

export interface DocumentExtractionResult {
  status: ExtractionStatus;
  text: string;
  charCount: number;
  error: string | null;
}

const MAX_TEXT_CHARS = 24_000;

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function xmlText(xml: string): string {
  return cleanText(
    decodeXmlEntities(
      xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<\/w:tr>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const parts = [
    "word/document.xml",
    "word/header1.xml",
    "word/footer1.xml",
  ];
  const texts = await Promise.all(
    parts.map(async (part) => {
      const file = zip.file(part);
      return file ? xmlText(await file.async("text")) : "";
    }),
  );
  return cleanText(texts.filter(Boolean).join("\n\n"));
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (Array.isArray(record.richText)) {
    return record.richText
      .map((item) => (item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  if (record.result != null) return cellText(record.result);
  if (record.formula != null) return String(record.formula);
  return "";
}

async function extractXlsx(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const chunks: string[] = [];

  workbook.eachSheet((sheet) => {
    chunks.push(`Sheet: ${sheet.name}`);
    sheet.eachRow((row) => {
      const values = row.values;
      const cells = Array.isArray(values)
        ? values.slice(1).map(cellText).filter(Boolean)
        : [];
      if (cells.length) chunks.push(cells.join(" | "));
    });
  });

  return cleanText(chunks.join("\n"));
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // Dynamic import — see top-of-file note. If the NAPI binding fails to
  // load on this runtime, the rejection propagates to extractDocumentText's
  // outer catch and the caller gets a "failed" status with a readable
  // error string instead of a function-level crash.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({
      first: 40,
      pageJoiner: "\n\n--- page page_number of total_number ---\n\n",
    });
    return cleanText(result.text);
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function isPdf(mimeType: string, fileName: string): boolean {
  return mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
}

function isDocx(mimeType: string, fileName: string): boolean {
  return mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || /\.docx$/i.test(fileName);
}

function isXlsx(mimeType: string, fileName: string): boolean {
  return mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || /\.xlsx$/i.test(fileName)
    || /\.xls$/i.test(fileName);
}

export async function extractDocumentText(args: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<DocumentExtractionResult> {
  try {
    let text = "";
    const pdf = isPdf(args.mimeType, args.fileName);
    if (pdf) {
      text = await extractPdf(args.buffer);
    } else if (isDocx(args.mimeType, args.fileName)) {
      text = await extractDocx(args.buffer);
    } else if (isXlsx(args.mimeType, args.fileName)) {
      text = await extractXlsx(args.buffer);
    } else {
      return {
        status: "unsupported",
        text: "",
        charCount: 0,
        error: "Extraction currently supports DOCX and XLSX uploads. PDF/image parsing is not enabled yet.",
      };
    }

    if (!text) {
      return {
        status: "empty",
        text: "",
        charCount: 0,
        error: pdf ? "No extractable text found. This may be a scanned/image-only PDF." : "No extractable text found.",
      };
    }
    return { status: "extracted", text, charCount: text.length, error: null };
  } catch (err) {
    return {
      status: "failed",
      text: "",
      charCount: 0,
      error: err instanceof Error ? err.message : "Document extraction failed.",
    };
  }
}

export async function ensureDocumentExtractionTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS document_extractions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      vault_document_id INTEGER REFERENCES vault_documents(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      file_url TEXT NOT NULL,
      mime_type TEXT,
      status TEXT NOT NULL,
      text_content TEXT,
      char_count INTEGER DEFAULT 0,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, file_url)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS document_extractions_user_idx ON document_extractions (user_id, created_at DESC)`;
}

export async function persistDocumentExtraction(args: {
  userId: number;
  vaultDocumentId?: number | null;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  result: DocumentExtractionResult;
}): Promise<{ id: number; status: ExtractionStatus; charCount: number; error: string | null }> {
  await ensureDocumentExtractionTable();
  const rows = await sql`
    INSERT INTO document_extractions (
      user_id, vault_document_id, file_name, file_url, mime_type, status,
      text_content, char_count, error
    ) VALUES (
      ${args.userId}, ${args.vaultDocumentId ?? null}, ${args.fileName}, ${args.fileUrl},
      ${args.mimeType}, ${args.result.status}, ${args.result.text || null},
      ${args.result.charCount}, ${args.result.error}
    )
    ON CONFLICT (user_id, file_url) DO UPDATE SET
      vault_document_id = COALESCE(EXCLUDED.vault_document_id, document_extractions.vault_document_id),
      file_name = EXCLUDED.file_name,
      mime_type = EXCLUDED.mime_type,
      status = EXCLUDED.status,
      text_content = EXCLUDED.text_content,
      char_count = EXCLUDED.char_count,
      error = EXCLUDED.error,
      updated_at = NOW()
    RETURNING id, status, char_count, error
  `;
  const row = rows[0];
  // Sprint 10: re-run auto-tagging now that we have the full extracted
  // text. Filename-only tags were applied at upload time; this pass adds
  // tags that only the body content reveals (e.g. ISO 27001 in a clause).
  if (args.vaultDocumentId != null && row.status === "extracted") {
    const { applyAutoTagsForVaultDocument } = await import("@/lib/applicant-evidence/ingest");
    await applyAutoTagsForVaultDocument({
      userId: args.userId,
      vaultDocumentId: args.vaultDocumentId,
    }).catch((err) => {
      console.warn("[tp:extract:autotag_after_extraction_failed]", {
        userId: args.userId,
        vaultDocumentId: args.vaultDocumentId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  return {
    id: row.id as number,
    status: row.status as ExtractionStatus,
    charCount: row.char_count as number,
    error: row.error as string | null,
  };
}

export async function linkExtractionToVaultDocument(args: {
  userId: number;
  vaultDocumentId: number;
  fileUrl: string;
}): Promise<void> {
  await ensureDocumentExtractionTable();
  await sql`
    UPDATE document_extractions
    SET vault_document_id = ${args.vaultDocumentId},
        updated_at = NOW()
    WHERE user_id = ${args.userId}
      AND file_url = ${args.fileUrl}
  `;
  // Sprint 10: the link gave us extracted text we did not have at upload
  // time, so re-run the auto-tagger with the fuller payload.
  const { applyAutoTagsForVaultDocument } = await import("@/lib/applicant-evidence/ingest");
  await applyAutoTagsForVaultDocument({
    userId: args.userId,
    vaultDocumentId: args.vaultDocumentId,
  }).catch((err) => {
    console.warn("[tp:extract:autotag_after_link_failed]", {
      userId: args.userId,
      vaultDocumentId: args.vaultDocumentId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
