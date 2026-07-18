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
  if (/corrigendum|amendment|addendum|revision|revised/.test(lower)) return "amendment";
  if (/\bq\s*(?:&|and)\s*a\b|questions?[-_ ]answers?|clarification/.test(lower)) return "qa";
  if (/terms? of reference|\btor\b|scope of work|statement of work|\bsow\b/.test(lower)) return "tor";
  if (/guideline|instruction(?:s)? to (?:bidder|offeror|supplier)/.test(lower)) return "guidelines";
  if (/info(?:rmation)? session|pre[- ]?bid|briefing|minutes/.test(lower)) return "info_session";
  if (/annex|appendix|schedule|form|template|bill of quantities|\bboq\b|price/.test(lower)) return "annex";
  if (/rfp|rfq|itb|eoi|solicitation|invitation to bid|request for/.test(lower)) return "solicitation";
  return "supporting";
}

export function tenderPackStatus(documents: TenderPackDocument[], attempted: boolean): TenderPackStatus {
  if (!documents.length) return attempted ? "needs_upload" : "not_started";
  return documents.some((doc) => doc.extractionStatus === "extracted") ? "ready" : "partial";
}
