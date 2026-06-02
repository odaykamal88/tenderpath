/**
 * Submission-portal registry.
 *
 * A matched tender's `agency` (the buyer, e.g. "UNHCR") is separate from its
 * `source_name` (the crawler that found it, e.g. "UNGM"). UNGM and other
 * aggregators only *advertise* the opportunity — the actual bid is almost
 * always submitted on the *buying agency's own* supplier portal, which usually
 * requires a one-time registration that takes real lead time to approve.
 *
 * This registry maps the buying agency → the portal a supplier must register
 * on before they can bid, so the UI can warn users *before* a deadline catches
 * them mid-registration (the classic UNHCR-ITB-closing-tomorrow trap).
 *
 * GOLDEN RULE: we only hardcode portals we have actually verified. Everything
 * else degrades to an honest generic fallback that tells the user to confirm
 * the channel on the notice — we never invent a portal URL.
 *
 * Lead times are TenderPath *estimates* to help users plan, not agency SLAs.
 */

export interface SubmissionPortal {
  /** Stable key. */
  key: string;
  /** Display name, e.g. "UNHCR Supplier Portal". */
  portalName: string;
  /** Buying organisation(s) this portal serves. */
  servedBy: string[];
  /** Where a NEW supplier self-registers. */
  registrationUrl: string;
  /** Where a returning supplier signs in (may equal registrationUrl). */
  signInUrl?: string;
  /** Optional official how-to guide / manual. */
  guideUrl?: string;
  /**
   * Estimated first-time registration + approval lead time, as a [low, high]
   * range of business days. Used to flag deadline risk. Display copy should
   * use {@link leadTimeLabel}, which hedges the precision.
   */
  leadTimeBusinessDays: [number, number];
  /** Human-facing lead-time phrasing (hedged — it's an estimate, not an SLA). */
  leadTimeLabel: string;
  /** Whether separate (free) UNGM vendor registration is also worth doing. */
  alsoRegisterUngm: boolean;
  /** 3–5 concrete, ordered steps. */
  steps: string[];
  /** Short caveat shown under the steps. */
  note: string;
  /** True for the generic fallback (no verified agency-specific portal). */
  isFallback?: boolean;
}

const UNGM_URL = "https://www.ungm.org";

const UNHCR: SubmissionPortal = {
  key: "unhcr",
  portalName: "UNHCR Supplier Portal",
  servedBy: ["UNHCR"],
  registrationUrl:
    "https://www.unhcr.org/get-involved/work-us/become-supplier/how-become-supplier",
  signInUrl: "https://supplier-portal.unhcr.org",
  guideUrl: "https://www.unhcr.org/sites/default/files/2023-09/supplier-portal-manual.pdf",
  leadTimeBusinessDays: [3, 10],
  leadTimeLabel: "typically several business days (registration + approval)",
  alsoRegisterUngm: true,
  steps: [
    "Register your company on the UNHCR Supplier Portal: company details → contact/user details → address → questionnaire, attaching company background and certifications.",
    "Wait for UNHCR to approve the registration and issue your sign-in credentials — this is not instant.",
    "Sign in, open the negotiation/event for this tender, and download the full bid documents.",
    "Read the ITB pack for eligibility, samples, bid security, and Incoterms before quoting.",
    "Submit your technical + financial response inside the portal before the deadline (it locks at cutoff).",
  ],
  note: "UNGM only advertises the tender — the bid is submitted inside the UNHCR portal. First-time registration takes time, so start it well before the deadline.",
};

const QUANTUM: SubmissionPortal = {
  key: "undp-quantum",
  portalName: "UNDP Quantum Supplier Portal",
  servedBy: [
    "UNDP",
    "UNFPA",
    "UN Women",
    "UNCDF",
    "UNV",
    "UN Capital Development Fund",
    "United Nations Volunteers",
  ],
  registrationUrl: "https://supplier.quantum.partneragencies.org/",
  signInUrl: "https://supplier.quantum.partneragencies.org/",
  guideUrl: "https://undp.service-now.com/kb_view.do?sysparm_article=KB0014109",
  leadTimeBusinessDays: [1, 5],
  leadTimeLabel: "usually 1–5 business days to register and activate",
  alsoRegisterUngm: true,
  steps: [
    "Register a supplier profile on the Quantum Supplier Portal (Oracle Cloud), then activate the account from the verification email.",
    "Sign in and open Negotiations — search for this tender's negotiation ID exactly as shown on the notice.",
    "Create a bid response, attach your technical and financial documents, and complete every required line.",
    "Submit the response in the portal before the deadline; confirm you receive the submission acknowledgement.",
  ],
  note: "Quantum is a shared Oracle Cloud portal across UNDP and its partner agencies (UNFPA, UN Women, UNCDF, UNV). Respond to the specific negotiation referenced on the notice.",
};

const FALLBACK: SubmissionPortal = {
  key: "generic",
  portalName: "UNGM + the buying agency's own portal",
  servedBy: [],
  registrationUrl: UNGM_URL,
  signInUrl: UNGM_URL,
  leadTimeBusinessDays: [1, 7],
  leadTimeLabel: "varies — confirm on the notice; allow several business days",
  alsoRegisterUngm: true,
  steps: [
    "Register (free) on UNGM to get a UN vendor number and tender notifications.",
    "Open the notice and check which portal it names for bid submission — many agencies (UNHCR, UNDP, UNICEF, WFP) collect bids on their OWN portal, not on UNGM.",
    "If a separate agency portal is required, register there early — first-time approval can take several business days.",
    "Download the documents, prepare your response, and submit through the named channel before the deadline.",
  ],
  note: "We don't have a verified portal mapping for this agency yet — confirm the exact submission channel on the notice itself before relying on these steps.",
  isFallback: true,
};

/** All verified, agency-specific portals (excludes the fallback). */
export const VERIFIED_PORTALS: SubmissionPortal[] = [UNHCR, QUANTUM];

/**
 * Resolve the supplier portal a bidder must register on, keyed off the buying
 * agency. Falls back to honest generic guidance when the agency is unknown.
 */
export function resolveSubmissionPortal(
  agency: string | null | undefined,
): SubmissionPortal {
  const hay = (agency ?? "").toLowerCase();
  if (!hay.trim()) return FALLBACK;

  if (/\bunhcr\b/.test(hay) || hay.includes("refugee")) return UNHCR;

  if (
    /\b(undp|unfpa|uncdf|unv)\b/.test(hay) ||
    hay.includes("un women") ||
    hay.includes("development programme") ||
    hay.includes("population fund") ||
    hay.includes("capital development") ||
    hay.includes("united nations volunteers")
  ) {
    return QUANTUM;
  }

  return FALLBACK;
}

export type FirstTimeRisk = "none" | "tight" | "very-tight";

export interface RegistrationTiming {
  /** Calendar days until the deadline (null when unknown/unparseable). */
  daysUntilDeadline: number | null;
  /** How risky first-time registration is against the remaining time. */
  firstTimeRisk: FirstTimeRisk;
}

/**
 * Judge whether a brand-new supplier can realistically register on the portal
 * before this tender's deadline. Coarse by design: compares calendar days left
 * to the portal's estimated lead-time band.
 */
export function assessRegistrationTiming(
  deadline: string | null | undefined,
  portal: SubmissionPortal,
): RegistrationTiming {
  if (!deadline) return { daysUntilDeadline: null, firstTimeRisk: "none" };
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return { daysUntilDeadline: null, firstTimeRisk: "none" };

  const days = Math.ceil((time - Date.now()) / 86_400_000);
  const [low, high] = portal.leadTimeBusinessDays;

  let firstTimeRisk: FirstTimeRisk = "none";
  if (days >= 0 && days <= low) firstTimeRisk = "very-tight";
  else if (days >= 0 && days <= high) firstTimeRisk = "tight";

  return { daysUntilDeadline: days, firstTimeRisk };
}
