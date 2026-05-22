import { NextRequest, NextResponse } from "next/server";
import { requireDashboardAccess } from "@/lib/access";
import { extractDocumentText, persistDocumentExtraction } from "@/lib/documents/extract";
import { classifyDocument, classToTag, tenderTitleTag } from "@/lib/documents/classify";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 45;

// Post-upload extraction.
//
// The browser uploads to Blob storage directly via the @vercel/blob/client
// SDK (bypassing the 4.5 MB function body limit). Once that completes, the
// client POSTs here with the Blob URL so we can:
//   1. download the file
//   2. extract text
//   3. create/upsert a vault_documents row tied to the user — this is the
//      missing piece that previously broke the "documents in bid-no-bid
//      analysis" wiring. Without a vault row, the service-context packet
//      had nothing to gather and the LLM analysed in the blind.
//   4. tag the vault row with:
//        - "bid-no-bid-supporting" (or "bid-no-bid-tender" when purpose is
//          the main tender doc) — for purpose-based vault search
//        - "tender:<title-slug>" — so future runs against the same tender
//          can pre-load every doc tagged for that opportunity
//        - "class:<doc_class>" — Haiku-classified label (tor / capability_
//          statement / cv / compliance / financial / reference_letter /
//          eligibility_criteria / evaluation_criteria / other)
//   5. persist the extraction with the vault row id so the existing
//      applicant-evidence body-tagger fires for free
//
// Auth: Bearer via requireDashboardAccess.
export async function POST(req: NextRequest) {
  // Outer try/catch — defensive belt-and-braces so any unhandled
  // exception (auth guard, DB hiccup, missing env, future module-init
  // side effect) still surfaces as JSON instead of a generic Next.js
  // 500 HTML body. PR-D was specifically about the pdf-parse@2.x NAPI
  // crash — PR-H swapped to pdfjs-dist which doesn't have that issue,
  // but the wrap stays as defense-in-depth.
  try {
    const guard = await requireDashboardAccess(req);
    if (!guard.authorized) return guard.response!;

    let url: string;
    let name: string;
    let mimeType: string;
    let tenderTitle: string | null;
    let purpose: "tender_main" | "supporting" | "other";
    try {
      const body = await req.json();
      url = String(body.url ?? "");
      name = String(body.name ?? "");
      mimeType = String(body.mimeType ?? "");
      tenderTitle =
        typeof body.tenderTitle === "string" && body.tenderTitle.trim().length > 0
          ? body.tenderTitle.trim()
          : null;
      const rawPurpose = String(body.purpose ?? "supporting");
      purpose =
        rawPurpose === "tender_main" || rawPurpose === "supporting"
          ? rawPurpose
          : "other";
      if (!url || !name) throw new Error("missing url/name");
    } catch {
      console.warn("[vault:extract:bad_request]", { userId: guard.user!.id });
      return NextResponse.json({ error: "url and name required" }, { status: 400 });
    }

    // Only accept URLs from our own Vercel Blob storage. Prevents someone from
    // pointing this endpoint at an arbitrary external resource and forcing the
    // function to download large blobs / SSRF target.
    if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(url)) {
      console.warn("[vault:extract:unsafe_url]", {
        userId: guard.user!.id,
        urlPrefix: url.slice(0, 60),
      });
      return NextResponse.json({ error: "URL must be a Vercel Blob URL" }, { status: 400 });
    }

    let stage = "fetch_blob";
    try {
      stage = "fetch_blob";
      const blobRes = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!blobRes.ok) {
        console.warn("[vault:extract:fetch_blob_failed]", {
          userId: guard.user!.id,
          status: blobRes.status,
        });
        return NextResponse.json(
          { error: `Could not fetch the uploaded file (${blobRes.status})` },
          { status: 502 },
        );
      }
      const buffer = Buffer.from(await blobRes.arrayBuffer());
      const effectiveMime =
        mimeType || blobRes.headers.get("content-type") || "application/octet-stream";

      stage = "extract_text";
      const extraction = await extractDocumentText({
        buffer,
        mimeType: effectiveMime,
        fileName: name,
      });

      // Vault row: create or upsert on (user_id, file_url). The schema
      // doesn't currently have a unique index on file_url, so we look up
      // first to keep this idempotent (re-running extract on the same URL
      // shouldn't duplicate rows).
      stage = "vault_row";
      const purposeTag =
        purpose === "tender_main" ? "bid-no-bid-tender" : "bid-no-bid-supporting";
      const titleTag = tenderTitleTag(tenderTitle);
      const initialTags = [purposeTag, titleTag].filter(Boolean) as string[];

      const existing = (await sql`
        SELECT id FROM vault_documents
        WHERE user_id = ${guard.user!.id} AND file_url = ${url}
        LIMIT 1
      `) as unknown as Array<{ id: number }>;

      let vaultDocumentId: number;
      if (existing.length) {
        vaultDocumentId = existing[0].id;
        // Merge new tags into the existing set; preserves any
        // user-curated tags. The PostgreSQL `array_cat` + DISTINCT pattern
        // would be cleanest but the existing applicant-evidence merger
        // uses application-level dedup, so do the same here.
        const cur = (await sql`
          SELECT tags FROM vault_documents WHERE id = ${vaultDocumentId}
        `) as unknown as Array<{ tags: string[] | null }>;
        const merged = Array.from(
          new Set([...(cur[0]?.tags ?? []), ...initialTags]),
        );
        await sql`
          UPDATE vault_documents
          SET tags = ${merged}::text[]
          WHERE id = ${vaultDocumentId}
        `;
      } else {
        const inserted = (await sql`
          INSERT INTO vault_documents (user_id, name, type, file_url, tags)
          VALUES (${guard.user!.id}, ${name}, 'other', ${url}, ${initialTags}::text[])
          RETURNING id
        `) as unknown as Array<{ id: number }>;
        vaultDocumentId = inserted[0].id;
      }

      stage = "persist_extraction";
      // Passing vaultDocumentId is what unlocks the existing
      // applicant-evidence body-tagger inside persistDocumentExtraction
      // — it runs the auto-tag pass once the full text is available and
      // adds things like "iso-27001", "gdpr", "audited-2023", etc.
      const persisted = await persistDocumentExtraction({
        userId: guard.user!.id,
        vaultDocumentId,
        fileName: name,
        fileUrl: url,
        mimeType: effectiveMime,
        result: extraction,
      });

      // Haiku classification — fire-and-forget shape: we do await it so
      // the response carries the class, but classify never throws (it
      // returns "other" on failure) so this stage can't break the upload.
      stage = "classify";
      let docClass: ReturnType<typeof classifyDocument> extends Promise<infer R> ? R : never;
      docClass = "other";
      if (extraction.status === "extracted" && extraction.text) {
        docClass = await classifyDocument({
          fileName: name,
          textExcerpt: extraction.text,
        });
        // Add the class tag to the vault row.
        const classTag = classToTag(docClass);
        await sql`
          UPDATE vault_documents
          SET tags = (
            SELECT ARRAY(
              SELECT DISTINCT unnest(array_append(COALESCE(tags, '{}'), ${classTag}))
            )
          )
          WHERE id = ${vaultDocumentId}
        `;
      }

      return NextResponse.json({
        url,
        name,
        vaultDocumentId,
        purpose: purposeTag,
        tenderTitleTag: titleTag || null,
        docClass,
        extraction: persisted,
      });
    } catch (err) {
      console.error("[vault:extract:failed]", {
        userId: guard.user?.id,
        stage,
        errorName: err instanceof Error ? err.name : "unknown",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        {
          error: `Extraction failed at ${stage}. ${err instanceof Error ? err.message : "Unknown error"}`,
          stage,
        },
        { status: 500 },
      );
    }
  } catch (err) {
    // See top-of-handler comment — anything that escapes the inner pipeline
    // (auth guard, module-init, etc.) still produces JSON so the client
    // can show a useful message.
    console.error("[vault:extract:handler_error]", {
      errorName: err instanceof Error ? err.name : "unknown",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: `Server error processing extraction: ${err instanceof Error ? err.message : "unknown"}`,
        stage: "handler",
      },
      { status: 500 },
    );
  }
}
