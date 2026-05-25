/**
 * GET /api/assessment/library-context — Sprint 8c.
 *
 * Returns a small payload that lets the anonymous /assessment readiness
 * page decide whether to:
 *
 *   - show a "you have N evidence documents on file — sign in to factor
 *     them into your readiness" banner (unauthed viewer, email matches
 *     an existing user with library docs),
 *   - silently enrich the readiness with the user's actual library
 *     (signed-in viewer's identity matches the typed email),
 *   - do nothing (no email match).
 *
 * Shape + privacy policy live in @/lib/proposal-package/library-context;
 * this route resolves the email→user lookup, the viewer's session, and
 * the user's library, then calls into the pure helper.
 *
 * Usage:
 *   GET /api/assessment/library-context?email=foo%40bar.com
 *
 * The endpoint is unauthenticated by design — anonymous wizard visitors
 * need to call it. The server reads the tp_session cookie internally to
 * decide if the viewer is the email-matched user.
 */

import { NextResponse } from "next/server";

import { sql } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import {
  buildLibraryContext,
  ENRICHABLE_EVIDENCE_TYPES,
  type LibraryContextResponse,
} from "@/lib/proposal-package/library-context";
import type { EvidenceLibraryRow, EvidenceStructuredExtraction } from "@/lib/applicant-evidence/types";

export const runtime = "nodejs";
export const maxDuration = 15;

function emptyResponse(): LibraryContextResponse {
  return { doc_count: 0, signed_in_match: false };
}

/**
 * Strip text_content from each row before sending to the browser. The
 * client's enrichment (library-enrichment.ts) reads tags / type /
 * file_name / structured_extraction only — text_content is wire bloat
 * (up to 6KB per row × N rows) that the consumer never uses.
 */
function stripTextContent(rows: EvidenceLibraryRow[]): EvidenceLibraryRow[] {
  return rows.map((r) => ({ ...r, text_content: null }));
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const rawEmail = url.searchParams.get("email")?.trim().toLowerCase() ?? "";

  // Lightweight input validation. Lying about the email is fine for the
  // doc_count branch (the server only confirms registered emails); the
  // privacy gate is that we never disclose the library without a session
  // owned by the matched user.
  if (!rawEmail || rawEmail.length > 254 || !rawEmail.includes("@")) {
    return NextResponse.json(emptyResponse());
  }

  // Resolve the email → user lookup.
  let emailUserId: number | null = null;
  try {
    const rows = await sql`
      SELECT id FROM users WHERE LOWER(email) = ${rawEmail} LIMIT 1
    ` as unknown as Array<{ id: number }>;
    emailUserId = rows[0]?.id ?? null;
  } catch (err) {
    console.warn("[tp:assessment:library_context:user_lookup_failed]", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(emptyResponse());
  }

  if (emailUserId == null) {
    return NextResponse.json(emptyResponse());
  }

  // Resolve the viewer's session (cookie or Authorization header).
  const sessionUser = await getUserFromRequest(request).catch(() => null);
  const sessionUserId = sessionUser?.id ?? null;

  // Load the library — filtered to the six enrichment-relevant types so
  // doc_count reflects what would actually lift the readiness score, not
  // the user's total vault size.
  let libraryRows: EvidenceLibraryRow[] = [];
  try {
    const rows = await sql`
      SELECT
        vd.id AS vault_document_id,
        vd.user_id,
        vd.name AS file_name,
        vd.type,
        vd.tags,
        vd.file_url,
        vd.created_at,
        de.text_content,
        de.char_count,
        de.status AS extraction_status,
        de.structured_extraction
      FROM vault_documents vd
      LEFT JOIN document_extractions de
        ON de.user_id = vd.user_id
       AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
      WHERE vd.user_id = ${emailUserId}
        AND vd.type = ANY(${ENRICHABLE_EVIDENCE_TYPES as readonly string[] as string[]})
      ORDER BY vd.created_at DESC
      LIMIT 30
    ` as unknown as Array<{
      vault_document_id: number;
      user_id: number;
      file_name: string;
      type: string;
      tags: string[] | null;
      file_url: string;
      created_at: string;
      text_content: string | null;
      char_count: number | null;
      extraction_status: string | null;
      structured_extraction: EvidenceStructuredExtraction | null;
    }>;
    libraryRows = rows.map((r) => ({
      vault_document_id: r.vault_document_id,
      user_id: r.user_id,
      file_name: r.file_name,
      type: r.type,
      tags: Array.isArray(r.tags) ? r.tags : [],
      file_url: r.file_url,
      text_content: r.text_content ? r.text_content.slice(0, 6000) : null,
      char_count: r.char_count ?? 0,
      extraction_status: r.extraction_status,
      created_at: r.created_at,
      structured_extraction: r.structured_extraction ?? null,
    }));
  } catch (err) {
    console.warn("[tp:assessment:library_context:library_load_failed]", {
      userId: emailUserId,
      error: err instanceof Error ? err.message : String(err),
    });
    // Degrade gracefully: we know the user exists, but couldn't load
    // their library. Return doc_count: 0 so the banner doesn't render
    // a misleading number; the readiness page just falls back to Sprint
    // 7 behaviour.
    return NextResponse.json(emptyResponse());
  }

  const result = buildLibraryContext({
    emailUserId,
    sessionUserId,
    libraryDocs: libraryRows,
  });

  // If we're disclosing the library (signed-in match), strip text_content
  // to keep the wire payload small. Enrichment doesn't read it.
  if (result.library) {
    result.library = stripTextContent(result.library);
  }

  return NextResponse.json(result);
}
