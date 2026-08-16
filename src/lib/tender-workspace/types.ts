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

export const TENDER_REQUIREMENT_CATEGORIES = [
  "administrative",
  "technical",
  "financial",
  "submission",
] as const;

export type TenderRequirementCategory = (typeof TENDER_REQUIREMENT_CATEGORIES)[number];

export const TENDER_REQUIREMENT_SEVERITIES = ["BLOCK", "HIGH", "MED", "LOW"] as const;
export type TenderRequirementSeverity = (typeof TENDER_REQUIREMENT_SEVERITIES)[number];

export const TENDER_REQUIREMENT_STATUSES = [
  "open",
  "ready",
  "needs_review",
  "not_applicable",
] as const;
export type TenderRequirementStatus = (typeof TENDER_REQUIREMENT_STATUSES)[number];

export const TENDER_REQUIREMENT_CONFIDENCE = ["high", "medium", "low"] as const;
export type TenderRequirementConfidence = (typeof TENDER_REQUIREMENT_CONFIDENCE)[number];

export interface TenderRequirementItem {
  id: string;
  category: TenderRequirementCategory;
  severity: TenderRequirementSeverity;
  title: string;
  action: string;
  /** Short excerpt from the source document, never an invented rationale. */
  evidence: string;
  sourceDocumentId: number;
  sourceDocumentName: string;
  sourceSection?: string | null;
  confidence: TenderRequirementConfidence;
  status: TenderRequirementStatus;
  ownerNote?: string | null;
}

export type TenderRequirementGenerationStatus =
  | "not_started"
  | "ready"
  | "partial"
  | "failed";

/**
 * Evidence-backed compliance map derived from the owner-scoped tender pack.
 * `packFingerprint` lets the UI mark the map stale as soon as documents or
 * document roles change; stale results are preserved for auditability but are
 * never presented as current.
 */
export interface TenderRequirementsState {
  generationStatus: TenderRequirementGenerationStatus;
  packFingerprint: string | null;
  generatedAt?: string | null;
  updatedAt?: string | null;
  items: TenderRequirementItem[];
  note?: string | null;
}

export const EMPTY_TENDER_REQUIREMENTS: TenderRequirementsState = {
  generationStatus: "not_started",
  packFingerprint: null,
  generatedAt: null,
  updatedAt: null,
  items: [],
  note: null,
};

/* ── Response outline ───────────────────────────────────────────────────────
 * The solicitation's OWN list of what a response must contain.
 *
 * Distinct from TenderRequirementsState, which is a compliance map (what you
 * must satisfy to be eligible). This is the response's table of contents: an
 * RFI that says "keep your response to 10 pages and address the following:"
 * followed by ten bullets defines ten sections, in that order.
 *
 * It exists because the submission formats (EOI/RFQ/ITB/RFP) fix a document
 * shape before anyone reads the notice. When a solicitation dictates its own
 * structure, that fixed shape is simply the wrong document — no amount of
 * better prose inside preset sections can answer questions the sections do not
 * have. */

export interface ResponseSection {
  /** Stable slug used as the generation slot id. */
  id: string;
  order: number;
  /** Heading for this section of the response. */
  title: string;
  /** What the solicitation asks for here, in its own terms. */
  ask: string;
  /** Verbatim excerpt from the source document — never a paraphrase. */
  evidence: string;
  sourceDocumentName: string;
  /** False for sections the notice offers as optional. */
  required: boolean;
}

export type ResponseOutlineStatus = "not_started" | "ready" | "partial" | "failed";

export interface ResponseOutline {
  generationStatus: ResponseOutlineStatus;
  packFingerprint: string | null;
  generatedAt?: string | null;
  /** e.g. "no more than 10 pages" — quoted from the notice when stated. */
  pageLimit?: string | null;
  /** Channel, format and deadline instructions the response must respect. */
  submission?: string | null;
  /** Document title the response should carry, from the notice. */
  documentTitle?: string | null;
  sections: ResponseSection[];
  note?: string | null;
}

export const EMPTY_RESPONSE_OUTLINE: ResponseOutline = {
  generationStatus: "not_started",
  packFingerprint: null,
  generatedAt: null,
  pageLimit: null,
  submission: null,
  documentTitle: null,
  sections: [],
  note: null,
};
