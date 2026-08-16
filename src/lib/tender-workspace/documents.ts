import type { TenderDocumentRole, TenderPackDocument, TenderPackStatus } from "./types";

export const TENDER_DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "rtf",
] as const;

export interface TenderAttachmentLink {
  href: string;
  label: string;
  ext: string;
}

/** True when a URL points straight at a solicitation document rather than a
 *  notice page. The import route already short-circuits on these, so the UI can
 *  safely fetch one without a page-scrape round trip. */
export function isDirectDocumentUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const ext = new URL(value).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? "";
    return (TENDER_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
  } catch {
    return false;
  }
}

/**
 * The vault tag that binds a document to one tender's solicitation pack.
 *
 * Crawled tenders key on `tenders.id`, which is what every pack created before
 * 2026-08-16 uses — that form is preserved exactly so existing packs keep
 * resolving. Hand-entered notices have no `tenders` row (the wizard's manual
 * path sets title/agency but never an id), which previously meant they could
 * carry no pack at all: the import route rejected them and an upload silently
 * dropped the pack tags, leaving drafting with nothing to read. They now key on
 * a slug of the notice title instead.
 *
 * Deliberately NOT a hash: a readable slug is debuggable in the tags column,
 * and two entries of the same title SHOULD share a pack. Collision risk across
 * different tenders is bounded because every pack query is already scoped by
 * `user_id` — this tag never widens access on its own.
 *
 * Kept dependency-free (no node:crypto) because this module is imported by the
 * client upload path as well as the server routes.
 */
export function tenderPackTag(input: {
  tenderId?: number | null;
  title?: string | null;
}): string | null {
  if (typeof input.tenderId === "number" && Number.isInteger(input.tenderId) && input.tenderId > 0) {
    return `tender-pack:${input.tenderId}`;
  }
  const slug = (input.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug ? `tender-pack:h:${slug}` : null;
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Discover direct tender-document links without executing page scripts. */
export function discoverTenderAttachments(
  html: string,
  pageUrl: URL,
  limit = 12,
): TenderAttachmentLink[] {
  const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out: TenderAttachmentLink[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(html)) !== null) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith("#") || /^javascript:/i.test(rawHref)) continue;

    let resolved: URL;
    try {
      resolved = new URL(rawHref, pageUrl);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) continue;

    const pathLower = resolved.pathname.toLowerCase();
    const ext = TENDER_DOCUMENT_EXTENSIONS.find((candidate) =>
      pathLower.endsWith(`.${candidate}`),
    );
    if (!ext || seen.has(resolved.toString())) continue;

    seen.add(resolved.toString());
    const visibleText = decodeBasicEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    const fileName = safeDecodePathSegment(resolved.pathname.split("/").pop() ?? "");
    const label =
      visibleText.length >= 3 && visibleText.length <= 180
        ? visibleText
        : fileName || `${ext.toUpperCase()} attachment`;

    out.push({ href: resolved.toString(), label, ext });
    if (out.length >= limit) break;
  }

  return out;
}

/** Conservative filename/label role inference aligned to the scoring engine. */
export function inferTenderDocumentRole(value: string): TenderDocumentRole {
  const lower = value.toLowerCase();
  // Explicit amendment language wins, but "revised" by itself must not turn a
  // revised TOR into an amendment. The document's primary type remains the
  // most useful role unless the filename actually says amendment/corrigendum.
  if (/corrigendum|amendment|addendum/.test(lower)) return "amendment";
  if (/\bq\s*(?:&|and)\s*a\b|questions?[-_ ]answers?|clarification/.test(lower)) return "qa";
  if (/terms? of reference|\btor\b|scope of work|statement of work|\bsow\b/.test(lower)) return "tor";
  if (/\brevision\b|\brevised\b/.test(lower)) return "amendment";
  if (/guideline|instruction(?:s)? to (?:bidder|offeror|supplier)/.test(lower)) return "guidelines";
  if (/info(?:rmation)? session|pre[- ]?bid|briefing|minutes/.test(lower)) return "info_session";
  if (/annex|appendix|schedule|form|template|bill of quantities|\bboq\b|price/.test(lower)) return "annex";
  if (/rfp|rfq|itb|eoi|solicitation|invitation to bid|request for/.test(lower)) return "solicitation";
  return "supporting";
}

export function tenderPackStatus(documents: TenderPackDocument[], attempted: boolean): TenderPackStatus {
  if (!documents.length) return attempted ? "needs_upload" : "not_started";
  return documents.every((doc) => doc.extractionStatus === "extracted") ? "ready" : "partial";
}
