/**
 * The live, customer-owned tender pack carried through the submission wizard.
 *
 * The roles intentionally mirror the proposal engine's DocManifestEntry roles
 * so documents collected here can feed scoring without another translation
 * layer. Raw Blob URLs never enter this shape; `downloadUrl` is always the
 * owner-authorized TenderPath proxy route.
 */

export const TENDER_DOCUMENT_ROLES = [
  "guidelines",
  "tor",
  "solicitation",
  "amendment",
  "qa",
  "info_session",
  "annex",
  "supporting",
] as const;

export type TenderDocumentRole = (typeof TENDER_DOCUMENT_ROLES)[number];

export type TenderPackSource = "source_import" | "user_upload";

export interface TenderPackDocument {
  vaultDocumentId: number;
  name: string;
  role: TenderDocumentRole;
  source: TenderPackSource;
  extractionStatus: "extracted" | "empty" | "unsupported" | "failed";
  charCount: number;
  downloadUrl: string;
}

export type TenderPackStatus =
  | "not_started"
  | "ready"
  | "partial"
  | "needs_upload";

export interface TenderPackState {
  status: TenderPackStatus;
  documents: TenderPackDocument[];
  checkedAt?: string | null;
  note?: string | null;
}

export const PORTAL_CONFIRMATION_IDS = [
  "portal_access",
  "latest_documents",
  "deadline_channel",
] as const;

export type PortalConfirmationId = (typeof PORTAL_CONFIRMATION_IDS)[number];

/**
 * User-confirmed portal hand-off state. Derived checks (notice, route, pack,
 * and core-document coverage) are intentionally not persisted as booleans;
 * they are recomputed from the current tender and owner-scoped manifest.
 */
export interface PortalCompanionState {
  confirmed: PortalConfirmationId[];
  portalOpenedAt?: string | null;
  updatedAt?: string | null;
}

export const EMPTY_PORTAL_COMPANION: PortalCompanionState = {
  confirmed: [],
  portalOpenedAt: null,
  updatedAt: null,
};
