/**
 * Post-generation cover-letter sweep — Sprint 13b.
 *
 * The generator prompt forbids bracketed placeholders in cover_letter_draft,
 * but Sonnet still emits 3-5 per real run (the grader caught this on every
 * EU CIM sample). Rather than re-prompt indefinitely, we run a deterministic
 * sweep after generation:
 *
 *   - find every [...] occurrence in the cover letter,
 *   - drop unresolved placeholder values into missing_information so the
 *     user sees them on the dashboard remediation surface,
 *   - replace the placeholder text with a neutral marker the cover letter
 *     can still read cleanly ([…] for visual continuity),
 *   - allow-list a small set of legitimate placeholders ([DATE], the
 *     standard date marker) so they survive untouched.
 *
 * This is intentionally conservative: we do not invent values, we surface
 * them as gaps. The applicant's evidence library (Sprint 10) is the way
 * to resolve them — uploading a vault doc that auto-tags `contact-email`
 * etc. would let a regeneration pick up the real value.
 */
import type { ProposalOutput } from "./types";

const KEEP_PLACEHOLDERS = new Set(["DATE", "DD MONTH YYYY"]);
const PLACEHOLDER_RE = /\[([^\[\]\n]{1,80})\]/g;

export interface SweepResult {
  /** Number of unique placeholder kinds detected. */
  count: number;
  /** Distinct placeholder strings found (lowercased, deduped). */
  placeholders: string[];
  /** Whether the cover letter text was modified. */
  modified: boolean;
}

/**
 * Sweep cover_letter_draft, return the modified output plus a summary.
 * Mutation-free: caller decides whether to commit the change.
 */
export function sweepCoverLetterPlaceholders(output: ProposalOutput): {
  output: ProposalOutput;
  sweep: SweepResult;
} {
  const original = output.cover_letter_draft ?? "";
  if (!original) {
    return { output, sweep: { count: 0, placeholders: [], modified: false } };
  }

  const seen = new Map<string, string>();
  let modified = false;
  const replaced = original.replace(PLACEHOLDER_RE, (match, raw: string) => {
    const trimmed = raw.trim();
    const keepKey = trimmed.toUpperCase();
    if (KEEP_PLACEHOLDERS.has(keepKey)) return match;
    // Skip placeholders that contain the literal character `[` or look
    // like an array-index reference (defensive — shouldn't appear in
    // real letters but keeps the sweep predictable).
    if (!trimmed || /^\d+$/.test(trimmed)) return match;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
    modified = true;
    return "[…]";
  });

  if (seen.size === 0) {
    return { output, sweep: { count: 0, placeholders: [], modified: false } };
  }

  const placeholders = Array.from(seen.values());
  // Append a single composite line to missing_information so the dashboard
  // remediation panel surfaces the gap without flooding the list with N
  // separate items.
  const summaryLine = `Cover letter has ${placeholders.length} unresolved placeholder${placeholders.length === 1 ? "" : "s"} to fill before submission: ${placeholders.map((p) => `[${p}]`).join(", ")}.`;
  const nextMissing = [...(output.missing_information ?? []), summaryLine];

  return {
    output: {
      ...output,
      cover_letter_draft: replaced,
      missing_information: nextMissing,
    },
    sweep: { count: placeholders.length, placeholders, modified },
  };
}
