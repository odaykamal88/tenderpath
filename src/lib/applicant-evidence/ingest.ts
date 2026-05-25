/**
 * Apply auto-tagging to a vault document — Sprint 10.
 *
 * Called from three places (idempotent):
 *   1. `/api/dashboard/vault` POST — at insert time (filename + declared type only).
 *   2. `persistDocumentExtraction` — after extraction succeeds, with full text.
 *   3. `linkExtractionToVaultDocument` — when a vault doc gets linked to a
 *       previously-extracted file (extraction text is already there).
 *
 * The helper preserves any tags a user has manually curated by merging the
 * existing tag set with newly-detected ones — so a re-run after extraction
 * never strips a tag the user added.
 *
 * The declared type is also preserved unless the user picked "other" and
 * the auto-tagger has a stronger guess.
 */
import { sql } from "@/lib/db";
import { autoTag } from "./auto-tag";

export async function applyAutoTagsForVaultDocument(args: {
  userId: number;
  vaultDocumentId: number;
}): Promise<void> {
  // Pull the vault row + the most recent extraction (if any) in one trip.
  const rows = await sql`
    SELECT
      vd.id, vd.name, vd.type, vd.tags,
      de.text_content
    FROM vault_documents vd
    LEFT JOIN document_extractions de
      ON de.user_id = vd.user_id
     AND (de.vault_document_id = vd.id OR de.file_url = vd.file_url)
    WHERE vd.id = ${args.vaultDocumentId}
      AND vd.user_id = ${args.userId}
    ORDER BY de.updated_at DESC NULLS LAST
    LIMIT 1
  ` as unknown as Array<{
    id: number;
    name: string;
    type: string;
    tags: string[] | null;
    text_content: string | null;
  }>;
  const row = rows[0];
  if (!row) return;

  const existingTags = Array.isArray(row.tags) ? row.tags : [];
  const result = autoTag({
    fileName: row.name,
    textExcerpt: row.text_content,
    declaredType: row.type,
  });

  // Merge: preserve every manually-curated tag, add new auto-detected ones.
  const merged = Array.from(new Set([...existingTags, ...result.tags]));
  // Type policy: upgrade only when the user-declared type is "other" and
  // the auto-tagger produced something more specific. Otherwise leave alone.
  let nextType = row.type === "other" && result.type !== "other" ? result.type : row.type;

  // Sprint 8d: LLM type-recovery fallback. When the keyword auto-tagger
  // left the row as "other" but we have enough extracted text, ask Haiku
  // to classify the document. Only fires when (1) current type IS still
  // "other" after keyword rules, (2) text_content is present and long
  // enough, and (3) the LLM returns a high-confidence specific type —
  // the helper itself returns null for low-confidence / "other" / any
  // failure, so the row stays "other" by default (safe).
  if (nextType === "other" && row.text_content && row.text_content.length >= MIN_TEXT_CHARS_FOR_CLASSIFIER) {
    const { classifyEvidenceType } = await import("./type-classifier");
    const llmType = await classifyEvidenceType({
      fileName: row.name,
      textContent: row.text_content,
    });
    if (llmType) {
      console.log("[applicant-evidence:type_classifier:recovered]", {
        vaultDocumentId: args.vaultDocumentId,
        from: "other",
        to: llmType,
      });
      nextType = llmType;
    }
  }

  // Skip write if nothing changed (idempotent / cheap repeated call).
  const tagsUnchanged = existingTags.length === merged.length
    && existingTags.every((t) => merged.includes(t));
  if (tagsUnchanged && nextType === row.type) return;

  await sql`
    UPDATE vault_documents
    SET tags = ${merged}::text[],
        type = ${nextType}
    WHERE id = ${args.vaultDocumentId}
      AND user_id = ${args.userId}
  `;
}

// Sprint 8d. Imported lazily inside applyAutoTagsForVaultDocument so the
// module load cost of @anthropic-ai/sdk only happens on the codepath that
// actually needs LLM classification. The constant mirrors the classifier's
// own MIN_TEXT_CHARS — duplicating it as a literal avoids pulling the
// classifier module just to read a number.
const MIN_TEXT_CHARS_FOR_CLASSIFIER = 300;
