import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { verifyToken } from "@/lib/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAssessmentUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type ResolvedAssessmentRef = {
  intId: number;
  publicId: string;
  email: string;
};

// Maps an external id (UUID or legacy int string) to the canonical row pointer.
// Returns null when the row doesn't exist. Does NOT enforce ownership.
export async function resolveAssessmentRef(
  idOrUuid: string,
): Promise<ResolvedAssessmentRef | null> {
  if (!idOrUuid) return null;
  if (isAssessmentUuid(idOrUuid)) {
    const rows = await sql`
      SELECT id, public_id, email FROM assessments
      WHERE public_id = ${idOrUuid}::uuid
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return {
      intId: rows[0].id as number,
      publicId: rows[0].public_id as string,
      email: rows[0].email as string,
    };
  }
  const asInt = Number(idOrUuid);
  if (!Number.isInteger(asInt) || asInt <= 0) return null;
  const rows = await sql`
    SELECT id, public_id, email FROM assessments
    WHERE id = ${asInt}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return {
    intId: rows[0].id as number,
    publicId: rows[0].public_id as string,
    email: rows[0].email as string,
  };
}

export type ViewerContext = {
  email: string | null;
  isAdmin: boolean;
};

// Reads the tp_session cookie and returns viewer email + admin flag. Empty when
// not signed in. Used by both page and API routes (cookies() works in both).
export async function getViewerContext(): Promise<ViewerContext> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("tp_session")?.value;
    if (!token) return { email: null, isAdmin: false };
    const claims = await verifyToken(token);
    if (!claims) return { email: null, isAdmin: false };
    return { email: claims.email, isAdmin: claims.isAdmin === true };
  } catch {
    return { email: null, isAdmin: false };
  }
}

export type AuthorizedAssessment = ResolvedAssessmentRef & {
  pathway: "uuid_capability" | "session_owner" | "session_admin";
};

// IDOR-safe assessment read. Returns the resolved row only when the requester
// is authorized; returns null and logs `[assessment:authz:owner_mismatch]` on
// every denial.
//
// Authorization model:
//   - UUID path: holding the UUID is the capability. Allowed for anyone — the
//     emailed report link, the dashboard redirect, and the tab nav all use
//     UUID and rely on this.
//   - Int path (legacy): must be the row owner (session email matches) or
//     a signed-in admin. Anonymous int requests are denied — this is the
//     hole `/assessment/0001` was walking through.
//
// `[assessment:authz:legacy_int_path]` is emitted whenever an authorized
// caller still hits an int URL, so we can watch traffic and drop the legacy
// path once it goes silent.
export async function authorizeAssessmentRead(
  idOrUuid: string,
): Promise<AuthorizedAssessment | null> {
  const ref = await resolveAssessmentRef(idOrUuid);
  if (!ref) return null;

  if (isAssessmentUuid(idOrUuid)) {
    return { ...ref, pathway: "uuid_capability" };
  }

  const viewer = await getViewerContext();
  const isOwner =
    viewer.email != null &&
    viewer.email.toLowerCase() === ref.email.toLowerCase();

  if (isOwner) {
    console.warn("[assessment:authz:legacy_int_path]", {
      assessmentId: ref.intId,
      publicId: ref.publicId,
    });
    return { ...ref, pathway: "session_owner" };
  }
  if (viewer.isAdmin) {
    console.warn("[assessment:authz:legacy_int_path]", {
      assessmentId: ref.intId,
      publicId: ref.publicId,
      admin: true,
    });
    return { ...ref, pathway: "session_admin" };
  }

  console.warn("[assessment:authz:owner_mismatch]", {
    assessmentId: ref.intId,
    viewerEmail: viewer.email,
    requestedBy: "int_id",
  });
  return null;
}
