import {
  EMPTY_TENDER_REQUIREMENTS,
  TENDER_REQUIREMENT_CATEGORIES,
  TENDER_REQUIREMENT_CONFIDENCE,
  TENDER_REQUIREMENT_SEVERITIES,
  TENDER_REQUIREMENT_STATUSES,
  type TenderPackState,
  type TenderRequirementCategory,
  type TenderRequirementConfidence,
  type TenderRequirementGenerationStatus,
  type TenderRequirementItem,
  type TenderRequirementSeverity,
  type TenderRequirementStatus,
  type TenderRequirementsState,
} from "./types";

const MAX_REQUIREMENTS = 36;

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && allowed.includes(value) ? (value as T[number]) : fallback;
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

/** Client-safe fingerprint over the sanitized manifest, never raw file text. */
export function tenderPackFingerprint(pack: TenderPackState | null | undefined): string | null {
  const documents = [...(pack?.documents ?? [])]
    .filter((document) => Number.isInteger(document.vaultDocumentId) && document.vaultDocumentId > 0)
    .sort((a, b) => a.vaultDocumentId - b.vaultDocumentId);
  if (!documents.length) return null;
  const basis = documents
    .map((document) => [
      document.vaultDocumentId,
      document.role,
      document.extractionStatus,
      Math.max(0, Math.round(document.charCount)),
    ].join(":"))
    .join("|");
  return `tp1-${documents.length}-${hashString(basis)}`;
}

function stableRequirementId(item: {
  category: TenderRequirementCategory;
  title: string;
  sourceDocumentId: number;
}): string {
  return `req-${hashString(`${item.category}|${item.sourceDocumentId}|${item.title.toLowerCase()}`)}`;
}

function normalizeItem(
  raw: unknown,
  documentNames: Map<number, string>,
): TenderRequirementItem | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<TenderRequirementItem>;
  const sourceDocumentId = Number(value.sourceDocumentId);
  const sourceDocumentName = documentNames.get(sourceDocumentId);
  if (!Number.isInteger(sourceDocumentId) || sourceDocumentId <= 0 || !sourceDocumentName) return null;

  const title = cleanText(value.title, 220);
  const action = cleanText(value.action, 360);
  const evidence = cleanText(value.evidence, 700);
  if (!title || !action || !evidence) return null;

  const category = oneOf(
    value.category,
    TENDER_REQUIREMENT_CATEGORIES,
    "administrative",
  ) as TenderRequirementCategory;
  const severity = oneOf(
    value.severity,
    TENDER_REQUIREMENT_SEVERITIES,
    "MED",
  ) as TenderRequirementSeverity;
  const confidence = oneOf(
    value.confidence,
    TENDER_REQUIREMENT_CONFIDENCE,
    "medium",
  ) as TenderRequirementConfidence;
  const status = oneOf(
    value.status,
    TENDER_REQUIREMENT_STATUSES,
    "open",
  ) as TenderRequirementStatus;

  return {
    id: stableRequirementId({ category, title, sourceDocumentId }),
    category,
    severity,
    title,
    action,
    evidence,
    sourceDocumentId,
    sourceDocumentName,
    sourceSection: cleanText(value.sourceSection, 180) || null,
    confidence,
    status,
    ownerNote: cleanText(value.ownerNote, 500) || null,
  };
}

/** Bound all client-controlled state and rebuild source names from the pack. */
export function normalizeTenderRequirements(
  raw: TenderRequirementsState | null | undefined,
  pack: TenderPackState | null | undefined,
): TenderRequirementsState {
  const documentNames = new Map(
    (pack?.documents ?? []).map((document) => [document.vaultDocumentId, cleanText(document.name, 240)]),
  );
  const items: TenderRequirementItem[] = [];
  const seen = new Set<string>();
  const incoming = Array.isArray(raw?.items) ? raw.items.slice(0, MAX_REQUIREMENTS) : [];
  for (const candidate of incoming) {
    const item = normalizeItem(candidate, documentNames);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }

  const allowedGenerationStatuses = ["not_started", "ready", "partial", "failed"] as const;
  const generationStatus = oneOf(
    raw?.generationStatus,
    allowedGenerationStatuses,
    items.length ? "partial" : "not_started",
  ) as TenderRequirementGenerationStatus;

  return {
    generationStatus,
    packFingerprint: cleanText(raw?.packFingerprint, 100) || null,
    generatedAt: safeIso(raw?.generatedAt),
    updatedAt: safeIso(raw?.updatedAt),
    items,
    note: cleanText(raw?.note, 500) || null,
  };
}

export interface TenderRequirementsView {
  isCurrent: boolean;
  isStale: boolean;
  complete: number;
  total: number;
  openBlocks: number;
  needsReview: number;
  nextAction: string;
}

export function buildTenderRequirementsView(
  pack: TenderPackState | null | undefined,
  raw: TenderRequirementsState | null | undefined,
): TenderRequirementsView {
  const state = normalizeTenderRequirements(raw, pack);
  const currentFingerprint = tenderPackFingerprint(pack);
  const isCurrent = Boolean(
    currentFingerprint
    && state.packFingerprint === currentFingerprint
    && ["ready", "partial"].includes(state.generationStatus),
  );
  const isStale = Boolean(state.items.length && !isCurrent);
  const unreadableAuthority = (pack?.documents ?? []).find((document) => (
    ["solicitation", "tor", "guidelines", "amendment", "qa"].includes(document.role)
    && document.extractionStatus !== "extracted"
  ));
  const unexplainedNotApplicable = state.items.find(
    (item) => item.status === "not_applicable" && !item.ownerNote?.trim(),
  );
  const complete = state.items.filter((item) => (
    item.status === "ready"
    || (item.status === "not_applicable" && Boolean(item.ownerNote?.trim()))
  )).length;
  const openBlocks = state.items.filter((item) => item.severity === "BLOCK" && item.status === "open").length;
  const needsReview = state.items.filter((item) => (
    item.status === "needs_review"
    || (item.status === "not_applicable" && !item.ownerNote?.trim())
  )).length;
  const next = state.items.find((item) => item.severity === "BLOCK" && item.status === "open")
    ?? unexplainedNotApplicable
    ?? state.items.find((item) => item.status === "needs_review")
    ?? state.items.find((item) => item.status === "open");

  let nextAction = "Build the tender-specific compliance map";
  if (unreadableAuthority) {
    nextAction = `Upload a readable copy of “${unreadableAuthority.name}” before relying on this map`;
  } else if (isStale) nextAction = "Refresh the map against the current tender pack";
  else if (unexplainedNotApplicable && next?.id === unexplainedNotApplicable.id) {
    nextAction = `Add a reason for marking “${unexplainedNotApplicable.title}” not applicable`;
  } else if (next) nextAction = next.action;
  else if (state.items.length) nextAction = "Compliance map accounted for — continue the response intake";

  return {
    isCurrent,
    isStale,
    complete,
    total: state.items.length,
    openBlocks,
    needsReview,
    nextAction,
  };
}

export function updateTenderRequirement(
  raw: TenderRequirementsState | null | undefined,
  pack: TenderPackState | null | undefined,
  id: string,
  patch: { status?: TenderRequirementStatus; ownerNote?: string | null },
  now = new Date().toISOString(),
): TenderRequirementsState {
  const state = normalizeTenderRequirements(raw ?? EMPTY_TENDER_REQUIREMENTS, pack);
  return normalizeTenderRequirements({
    ...state,
    updatedAt: now,
    items: state.items.map((item) => item.id === id ? {
      ...item,
      status: patch.status ?? item.status,
      ownerNote: patch.ownerNote === undefined ? item.ownerNote : patch.ownerNote,
    } : item),
  }, pack);
}

export function mergeTenderRequirementProgress(
  previous: TenderRequirementsState | null | undefined,
  generated: TenderRequirementsState,
  pack: TenderPackState,
): TenderRequirementsState {
  const before = normalizeTenderRequirements(previous, pack);
  const next = normalizeTenderRequirements(generated, pack);
  if (!before.packFingerprint || before.packFingerprint !== next.packFingerprint) return next;
  const previousById = new Map(before.items.map((item) => [item.id, item]));
  return normalizeTenderRequirements({
    ...next,
    items: next.items.map((item) => {
      const prior = previousById.get(item.id);
      return prior ? { ...item, status: prior.status, ownerNote: prior.ownerNote } : item;
    }),
  }, pack);
}
