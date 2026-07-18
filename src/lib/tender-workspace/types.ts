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
