/**
 * Server-side URL → text fetch + extract + cache, for bid-no-bid grounding.
 *
 * When a user pastes a tender URL or supporting-doc URL on the intake form,
 * we don't fetch it at intake time (keeps the submit→/pay redirect fast).
 * Instead, at bid-no-bid analysis run-time, generate.ts calls
 * `ensureUrlExtractions()` which:
 *
 *   1. Looks up document_extractions by (user_id, file_url) — if a cached
 *      extraction exists for this URL and user, returns immediately.
 *   2. Otherwise HTTPS-GETs the URL with a 20 s timeout. PDF → goes through
 *      extractDocumentText. HTML → stripped to text inline.
 *   3. Persists to document_extractions for future runs.
 *   4. Returns the extracted text so the caller can feed it into the LLM
 *      prompt alongside uploaded-file extractions.
 *
 * Failures are absorbed: a broken URL produces a "failed" extraction row
 * with the error, the caller continues without that document. Mirrors the
 * graceful-degradation pattern from the rest of the extract pipeline.
 *
 * Classification is skipped for fetched URLs — we don't have a vault row
 * to tag, and the bid-no-bid prompt receives raw text + a "fetched URL"
 * label. Future PR can extend this to create vault rows for pasted URLs
 * and run classification too, if user feedback indicates classification
 * matters for URL-only intake.
 */
import { sql } from "@/lib/db";
import {
  extractDocumentText,
  persistDocumentExtraction,
  type DocumentExtractionResult,
  type ExtractionStatus,
} from "./extract";
import { assertSafeHttpUrl, UnsafeUrlError } from "@/lib/security/safe-url";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS = 24_000;
const MAX_FETCH_BYTES = 15 * 1024 * 1024;
const CACHE_FRESH_DAYS = 30;

interface CachedRow {
  status: string | null;
  text_content: string | null;
  char_count: number | null;
  error: string | null;
  updated_at: string | null;
}

export interface FetchedDocument {
  url: string;
  status: ExtractionStatus | "fetch_failed";
  text: string;
  charCount: number;
  error: string | null;
  fromCache: boolean;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

async function loadCached(userId: number, url: string): Promise<CachedRow | null> {
  try {
    const rows = (await sql`
      SELECT status, text_content, char_count, error, updated_at::text AS updated_at
      FROM document_extractions
      WHERE user_id = ${userId} AND file_url = ${url}
      ORDER BY updated_at DESC
      LIMIT 1
    `) as unknown as CachedRow[];
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[doc:fetch-url:cache_lookup_failed]", {
      userId,
      url: url.slice(0, 120),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function isCacheFresh(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return false;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return ageDays < CACHE_FRESH_DAYS;
}

async function fetchSafeUrl(url: URL): Promise<{ response: Response; finalUrl: URL }> {
  let current = url.toString();
  for (let hop = 0; hop <= 5; hop += 1) {
    const safeUrl = await assertSafeHttpUrl(current);
    const response = await fetch(safeUrl, {
      headers: {
        "user-agent": "TenderPathBot/1.0 (+https://www.tenderpath.me)",
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect missing Location header");
      current = new URL(location, safeUrl).toString();
      continue;
    }
    return { response, finalUrl: safeUrl };
  }
  throw new Error("Redirect limit exceeded");
}

/**
 * Fetch a single URL (or return cached extraction). Never throws.
 */
export async function fetchAndPersistUrl(args: {
  userId: number;
  url: string;
}): Promise<FetchedDocument> {
  const { userId, url } = args;

  // Cache check: skip the HTTPS GET if we have a fresh successful extraction.
  const cached = await loadCached(userId, url);
  if (cached && cached.status === "extracted" && cached.text_content && isCacheFresh(cached.updated_at)) {
    return {
      url,
      status: "extracted",
      text: cached.text_content,
      charCount: cached.char_count ?? cached.text_content.length,
      error: null,
      fromCache: true,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
    await assertSafeHttpUrl(parsed.toString());
  } catch (err) {
    console.warn("[doc:fetch-url:invalid_url]", {
      userId,
      inputLength: url.length,
      error: err instanceof UnsafeUrlError ? err.code : err instanceof Error ? err.message : String(err),
    });
    return {
      url,
      status: "fetch_failed",
      text: "",
      charCount: 0,
      error: "Invalid URL",
      fromCache: false,
    };
  }

  // Network fetch — 20 s cap. Anything slower is unlikely to add value
  // to the analysis and would risk the function's maxDuration.
  let text = "";
  let extractionResult: DocumentExtractionResult | null = null;
  let fetchErr: string | null = null;
  try {
    const { response: res, finalUrl } = await fetchSafeUrl(parsed);
    parsed = finalUrl;
    if (!res.ok) {
      fetchErr = `HTTP ${res.status}`;
      console.warn("[doc:fetch-url:non_2xx]", {
        userId,
        host: parsed.host,
        status: res.status,
      });
    } else {
      const contentLength = Number(res.headers.get("content-length") ?? "0");
      if (contentLength > MAX_FETCH_BYTES) {
        throw new Error("Fetched document is too large");
      }
      const contentType = (res.headers.get("content-type") || "").toLowerCase();
      const isPdf =
        contentType.includes("application/pdf") ||
        parsed.pathname.toLowerCase().endsWith(".pdf");
      if (isPdf) {
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.byteLength > MAX_FETCH_BYTES) {
          throw new Error("Fetched document is too large");
        }
        extractionResult = await extractDocumentText({
          buffer,
          mimeType: "application/pdf",
          fileName: parsed.pathname.split("/").pop() || "fetched.pdf",
        });
        text = extractionResult.text.slice(0, MAX_TEXT_CHARS);
      } else {
        const html = await res.text();
        if (Buffer.byteLength(html, "utf8") > MAX_FETCH_BYTES) {
          throw new Error("Fetched document is too large");
        }
        text = stripHtml(html);
      }
    }
  } catch (err) {
    fetchErr = err instanceof Error ? err.message : String(err);
    console.warn("[doc:fetch-url:fetch_failed]", {
      userId,
      host: parsed.host,
      error: fetchErr,
    });
  }

  // Persist a row either way so future runs see this URL has been tried
  // (and don't keep re-fetching a broken link).
  const status: ExtractionStatus =
    fetchErr ? "failed" :
    text.trim().length > 0 ? "extracted" :
    "empty";

  const fileName = parsed.pathname.split("/").pop() || parsed.host;
  const mimeType = extractionResult ? "application/pdf" : "text/html";
  try {
    await persistDocumentExtraction({
      userId,
      fileName,
      fileUrl: url,
      mimeType,
      result: {
        status,
        text,
        charCount: text.length,
        error: fetchErr,
      },
    });
  } catch (err) {
    console.warn("[doc:fetch-url:persist_failed]", {
      userId,
      host: parsed.host,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  console.info("[doc:fetch-url:done]", {
    userId,
    host: parsed.host,
    status,
    charCount: text.length,
    fetchErr: fetchErr ?? undefined,
  });

  return {
    url,
    status: fetchErr ? "fetch_failed" : status,
    text,
    charCount: text.length,
    error: fetchErr,
    fromCache: false,
  };
}

/**
 * Eagerly fetch and persist every URL in `urls` for `userId`. Runs them in
 * parallel (bounded at 4) so a 10-URL intake doesn't sequentially walk
 * through 10 × 20 s of fetch budget.
 */
export async function ensureUrlExtractions(args: {
  userId: number;
  urls: string[];
}): Promise<FetchedDocument[]> {
  const { userId, urls } = args;
  const unique = Array.from(new Set(urls.filter((u) => typeof u === "string" && u.trim().length > 0)));
  if (unique.length === 0) return [];

  const CONCURRENCY = 4;
  const results: FetchedDocument[] = [];
  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    const chunk = unique.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      chunk.map((url) => fetchAndPersistUrl({ userId, url })),
    );
    results.push(...settled);
  }
  return results;
}
