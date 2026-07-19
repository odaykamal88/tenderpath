import type { WizardDraftState } from "@/lib/submissions/types";
import {
  assessRegistrationTiming,
  resolveSubmissionPortal,
  type FirstTimeRisk,
} from "@/lib/tenders/submission-portals";
import {
  EMPTY_PORTAL_COMPANION,
  PORTAL_CONFIRMATION_IDS,
  type PortalCompanionState,
  type PortalConfirmationId,
  type TenderPackState,
} from "./types";

export type PortalChecklistItemId =
  | "official_notice"
  | "submission_route"
  | "portal_access"
  | "private_pack"
  | "core_document"
  | "latest_documents"
  | "deadline_channel";

export interface PortalChecklistItem {
  id: PortalChecklistItemId;
  label: string;
  detail: string;
  complete: boolean;
  confirmationId?: PortalConfirmationId;
}

export type PortalNextActionKind =
  | "notice"
  | "route"
  | "portal"
  | "pack"
  | "role"
  | "confirm_latest"
  | "confirm_deadline"
  | "ready";

export interface PortalNextAction {
  kind: PortalNextActionKind;
  title: string;
  detail: string;
  cta?: string;
}

export interface PortalCompanionView {
  items: PortalChecklistItem[];
  complete: number;
  total: number;
  pct: number;
  nextAction: PortalNextAction;
  firstTimeRisk: FirstTimeRisk;
  daysUntilDeadline: number | null;
}

const CORE_ROLES = new Set(["solicitation", "tor", "guidelines"]);

export function safeExternalHttpUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Bound the client-controlled confirmation state before saving it. */
export function normalizePortalCompanion(
  value: PortalCompanionState | null | undefined,
): PortalCompanionState {
  const incoming = Array.isArray(value?.confirmed) ? value.confirmed : [];
  const confirmed = Array.from(new Set(
    incoming.filter((id): id is PortalConfirmationId => PORTAL_CONFIRMATION_IDS.includes(id)),
  ));
  return {
    confirmed,
    portalOpenedAt: safeIso(value?.portalOpenedAt),
    updatedAt: safeIso(value?.updatedAt),
  };
}

function nextAction(items: PortalChecklistItem[], hasOnlinePortal: boolean): PortalNextAction {
  const missing = items.find((item) => !item.complete)?.id;
  switch (missing) {
    case "official_notice":
      return {
        kind: "notice",
        title: "Add the official notice link",
        detail: "The notice is the authority for the deadline, submission channel, amendments, and forms.",
      };
    case "submission_route":
      return {
        kind: "route",
        title: "Confirm where this bid is submitted",
        detail: "This buyer has no verified fixed route in TenderPath. Read the notice and enter the exact portal or channel it names.",
      };
    case "portal_access":
      return {
        kind: "portal",
        title: hasOnlinePortal ? "Open the supplier portal and confirm access" : "Confirm access to the named submission channel",
        detail: hasOnlinePortal
          ? "Sign in yourself, complete any MFA, then return here. TenderPath never receives the credentials."
          : "Use the channel named in the official notice, then confirm that it is usable before preparing the response.",
        cta: hasOnlinePortal ? "Open portal beside TenderPath" : undefined,
      };
    case "private_pack":
      return {
        kind: "pack",
        title: "Bring in the tender pack",
        detail: "Import public attachments or download the login-gated pack from the portal and upload it privately here.",
        cta: "Upload portal files",
      };
    case "core_document":
      return {
        kind: "role",
        title: "Identify the core solicitation",
        detail: "Label at least one file as Solicitation, Terms of reference, or Guidelines so the drafting workflow reads the right authority.",
      };
    case "latest_documents":
      return {
        kind: "confirm_latest",
        title: "Check for amendments and Q&A",
        detail: "Re-open the event, check its clarification or amendment area, and upload anything newer before confirming this check.",
      };
    case "deadline_channel":
      return {
        kind: "confirm_deadline",
        title: "Confirm the cutoff and response channel",
        detail: "Verify the agency-local time zone, technical/financial envelope rules, and where the acknowledgement will appear.",
      };
    default:
      return {
        kind: "ready",
        title: "Portal hand-off ready",
        detail: "The submission route and current tender pack are accounted for. Continue the intake so your expert judgment goes where it counts.",
      };
  }
}

export function buildPortalCompanionView(
  tender: WizardDraftState["tender"],
  pack: TenderPackState | null | undefined,
  rawCompanion: PortalCompanionState | null | undefined,
): PortalCompanionView {
  const companion = normalizePortalCompanion(rawCompanion);
  const confirmed = new Set(companion.confirmed);
  const portal = resolveSubmissionPortal(tender?.agency);
  const timing = assessRegistrationTiming(tender?.due, portal);
  const documents = pack?.documents ?? [];
  const hasOnlinePortal = Boolean(
    tender?.portalOverride
      ? safeExternalHttpUrl(tender.portalUrl)
      : safeExternalHttpUrl(tender?.portalUrl || portal.signInUrl || portal.registrationUrl),
  );
  const routeReady = Boolean(
    tender?.portalOverride
      ? tender.portal?.trim()
      : !portal.isFallback,
  );
  const hasCoreDocument = documents.some((document) => CORE_ROLES.has(document.role));

  const items: PortalChecklistItem[] = [
    {
      id: "official_notice",
      label: "Official notice linked",
      detail: "Verified source retained with this submission.",
      complete: Boolean(safeExternalHttpUrl(tender?.sourceUrl)),
    },
    {
      id: "submission_route",
      label: "Submission route identified",
      detail: portal.isFallback ? "Confirm the notice-specific channel." : portal.portalName,
      complete: routeReady,
    },
    {
      id: "portal_access",
      label: hasOnlinePortal ? "Supplier portal access confirmed" : "Submission channel access confirmed",
      detail: hasOnlinePortal ? "You signed in and completed any MFA yourself." : "You can access the notice-specific channel.",
      complete: confirmed.has("portal_access"),
      confirmationId: "portal_access",
    },
    {
      id: "private_pack",
      label: "Tender pack saved privately",
      detail: documents.length ? `${documents.length} owner-only file${documents.length === 1 ? "" : "s"}.` : "No tender files saved yet.",
      complete: documents.length > 0,
    },
    {
      id: "core_document",
      label: "Core solicitation identified",
      detail: "Solicitation, TOR, or bidder guidelines labeled.",
      complete: hasCoreDocument,
    },
    {
      id: "latest_documents",
      label: "Amendments and Q&A checked",
      detail: "You checked the live event for anything newer.",
      complete: confirmed.has("latest_documents"),
      confirmationId: "latest_documents",
    },
    {
      id: "deadline_channel",
      label: "Cutoff and envelopes confirmed",
      detail: "Time zone, upload channel, and acknowledgement checked.",
      complete: confirmed.has("deadline_channel"),
      confirmationId: "deadline_channel",
    },
  ];
  const complete = items.filter((item) => item.complete).length;
  return {
    items,
    complete,
    total: items.length,
    pct: Math.round((complete / items.length) * 100),
    nextAction: nextAction(items, hasOnlinePortal),
    firstTimeRisk: tender?.portalOverride ? "none" : timing.firstTimeRisk,
    daysUntilDeadline: timing.daysUntilDeadline,
  };
}

export function togglePortalConfirmation(
  value: PortalCompanionState | null | undefined,
  id: PortalConfirmationId,
  done: boolean,
  now = new Date().toISOString(),
): PortalCompanionState {
  const current = normalizePortalCompanion(value ?? EMPTY_PORTAL_COMPANION);
  const confirmed = new Set(current.confirmed);
  if (done) confirmed.add(id);
  else confirmed.delete(id);
  return normalizePortalCompanion({
    ...current,
    confirmed: [...confirmed],
    updatedAt: now,
  });
}
