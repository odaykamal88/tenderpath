/**
 * library-context.ts — Sprint 8c.
 *
 * The Sprint 7 free readiness page (AssessmentResults.tsx) runs against
 * data the wizard collects anonymously: company, sector, capabilities,
 * email. The Sprint 8/8b library enrichment lifts that score significantly
 * (3 → 36 on synthetic data) for users who already have evidence docs
 * uploaded — but it requires a user_id, and the wizard doesn't have one.
 *
 * Sprint 8c adds the bridge. After the wizard submits an assessment, the
 * client posts the email to GET /api/assessment/library-context. The
 * server looks up the user (if any) for that email, checks the viewer's
 * session, and returns one of three states:
 *
 *   1. No matching email             → no banner, no enrichment
 *   2. Email matches but unauthed    → banner only ("N docs on file —
 *                                       sign in to factor them in")
 *   3. Email matches AND authed AS    → full library payload + enrich
 *      that same user                  the readiness on the client
 *
 * This module is the pure shape-and-policy of (1)-(3). The route handler
 * does the DB lookups and calls into this. Keeping the policy pure lets
 * the acceptance script verify the branches without a DB.
 *
 * Privacy note: returning the doc_count to an unauthed visitor confirms
 * that an email IS registered (and has library docs). This is the same
 * info that the assessment-flow already leaks (the assessment is created
 * keyed on email and stored). The full library is only returned to the
 * authenticated owner.
 */

import type { EvidenceLibraryRow } from "@/lib/applicant-evidence/types";

export interface LibraryContextInputs {
  /** users.id of the row whose email matches the typed assessment email,
   *  or null when no user has that email. Server-side lookup result. */
  emailUserId: number | null;
  /** users.id of the viewer (from the session cookie), or null when
   *  anonymous. Used to gate full-library disclosure. */
  sessionUserId: number | null;
  /** Library rows for `emailUserId` (filtered to enrichable types only —
   *  cv / certificate / audit / past_performance / capability_statement /
   *  registration). Caller may pass [] when emailUserId is null. */
  libraryDocs: EvidenceLibraryRow[];
}

export interface LibraryContextResponse {
  /** Count of enrichable docs the typed-email user has on file. Zero when
   *  no email match. Used to render the banner copy. */
  doc_count: number;
  /** True when the viewer is authenticated AS the email-matched user.
   *  In that case the `library` field is populated so the client can
   *  enrich the ApplicantContext locally before scoring readiness. */
  signed_in_match: boolean;
  /** Library payload — present only when signed_in_match is true. The
   *  caller is expected to strip text_content before sending to the
   *  browser (enrichment doesn't need it, and stripping saves wire bytes). */
  library?: EvidenceLibraryRow[];
}

/**
 * Compose the response shape from already-resolved inputs.
 *
 * Pure function — no DB, no session reads. The route handler resolves
 * those upstream and passes the results in here. That keeps the privacy
 * policy (who sees what) in one place and unit-testable.
 */
export function buildLibraryContext(input: LibraryContextInputs): LibraryContextResponse {
  // No user matches the typed email → nothing to surface.
  if (input.emailUserId == null) {
    return { doc_count: 0, signed_in_match: false };
  }

  const isOwner =
    input.sessionUserId != null && input.sessionUserId === input.emailUserId;

  // Email matches AND viewer is signed in as that user — disclose full
  // library so client can enrich readiness.
  if (isOwner) {
    return {
      doc_count: input.libraryDocs.length,
      signed_in_match: true,
      library: input.libraryDocs,
    };
  }

  // Email matches but viewer is either anonymous OR signed in as a different
  // user. Return count only so the banner can render; do NOT disclose the
  // library payload.
  return {
    doc_count: input.libraryDocs.length,
    signed_in_match: false,
  };
}

/**
 * The six evidence types that library-enrichment.ts actually consumes.
 * Used by the route handler's WHERE clause so doc_count reflects what
 * would actually move the readiness score, not the total vault size.
 */
export const ENRICHABLE_EVIDENCE_TYPES = [
  "cv",
  "certificate",
  "audit",
  "past_performance",
  "capability_statement",
  "registration",
] as const;
