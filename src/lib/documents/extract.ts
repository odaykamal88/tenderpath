import ExcelJS from "exceljs";
import JSZip from "jszip";
import { sql } from "@/lib/db";

// PDF extraction history:
//   1) pdf-parse@1.x — pure JS, worked but unmaintained and threw at
//      module-init on Vercel because it tried to open a test fixture.
//   2) pdf-parse@2.x (PR-B-era) — ships a NAPI binding (@napi-rs/canvas)
//      that fails to load in the Vercel serverless runtime. Symptom: a
//      "Warning: Cannot load @napi-..." in the function log and a
//      generic Next.js 500 HTML body, served BEFORE any handler ran.
//      Lazy-importing helped HTML/DOCX/XLSX paths but PDFs still
//      degraded silently.
//   3) pdfjs-dist (PR-H, current) — Mozilla's PDF.js engine. Pure WASM
//      + JS, no NAPI bindings, works reliably on Node serverless. Same
//      lazy-import pattern so the WASM blob is only fetched when an
//      actual PDF arrives.
//
// HTML / DOCX / XLSX paths never touch the PDF engine. If the dynamic
// import itself throws, extractDocumentText's outer try/catch turns it
// into a clean "failed" extraction result instead of a route crash.

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
  // Dynamic import — see top-of-file note. pdfjs-dist is pure JS/WASM
  // with no NAPI bindings, so this loads reliably on Vercel serverless.
  // The legacy build is used because the default "modern" entry point
  // expects browser globals (Worker, etc.) that don't exist in Node.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs") as typeof import("pdfjs-dist");
  // pdfjs requires a worker entry, even in Node — pointing the global at
  // the bundled worker .mjs lets pdfjs spin up a Node-side fake worker
  // internally. Smoke-tested locally on a 7-page tender PDF (2.4 KB of
  // text from page 1, all 7 pages parsed cleanly).
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { createRequire } = await import("node:module");
    const requireFromHere = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = requireFromHere.resolve(
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
    );
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Suppress non-fatal warnings (font glyph misses, etc.) — they're
    // noisy in the function log and don't affect text extraction.
    verbosity: 0,
    // Disable XFA / embedded font loading. Tender PDFs almost never use
    // those features and they trigger network requests we don't want.
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  try {
    const totalPages = doc.numPages;
    const maxPages = Math.min(totalPages, 40);
    const pageTexts: string[] = [];
    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            "str" in item && typeof item.str === "string" ? item.str : "",
          )
          .join(" ");
        pageTexts.push(text);
      } finally {
        page.cleanup();
      }
      if (pageNum < maxPages) {
        pageTexts.push(`\n\n--- page ${pageNum} of ${totalPages} ---\n\n`);
      }
    }
    return cleanText(pageTexts.join(""));
  } finally {
    await doc.destroy().catch(() => {});
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
