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

export const UNGM_URL = "https://www.ungm.org";

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

/** Calendar days until a deadline; null when missing/unparseable. */
function daysUntilDeadline(deadline: string | null | undefined): number | null {
  if (!deadline) return null;
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return null;
  return Math.ceil((time - Date.now()) / 86_400_000);
}

/** Coarse first-time risk: compare calendar days remaining to a [low, high]
 *  business-day lead band. Shared by portal and UNGM-level timing so both
 *  surfaces flag deadline risk with identical thresholds. */
function riskFromLeadBand(
  days: number | null,
  [low, high]: [number, number],
): FirstTimeRisk {
  if (days == null || days < 0) return "none";
  if (days <= low) return "very-tight";
  if (days <= high) return "tight";
  return "none";
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
  const days = daysUntilDeadline(deadline);
  return {
    daysUntilDeadline: days,
    firstTimeRisk: riskFromLeadBand(days, portal.leadTimeBusinessDays),
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * UNGM vendor registration — the UN-wide supplier *identity* layer.
 *
 * Distinct from the submission portals above: UNGM (ungm.org) is where a
 * supplier gets a vendor number and a registration LEVEL shared across ~30 UN
 * organisations; the bid itself is still uploaded on the agency's own portal
 * (Quantum, UNHCR Oracle, …). Levels are cumulative — each is a prerequisite
 * for the next.
 *
 * Verified against the UNGM Help Center (2026-06-04):
 *   - Basic   : general company info, NO documents. Free, ~immediate. Required
 *               by most UN organisations just to access docs and submit.
 *   - Level 1 : + Certificate of Incorporation, 3 client references, ownership
 *               structure. Free, but the organisation EVALUATES it (not instant).
 *   - Level 2 : + 3 reference letters + 3 yrs audited financials; company must
 *               be ≥3 years old. For high-value / sensitive procurements.
 *
 * GOLDEN RULE (same as the portal registry): assert only what UNGM states.
 * UNGM is explicit that the *required* level "varies by agency and procurement
 * opportunity", so we do NOT hardcode a per-agency minimum above Basic — Basic
 * is the assertable universal gate, and the specific notice states whether
 * Level 1/2 is needed. Lead-time bands are TenderPath planning estimates that
 * drive the deadline-risk flag, not UNGM SLAs.
 * ───────────────────────────────────────────────────────────────────────── */

export type UngmLevel = "basic" | "level-1" | "level-2";

export interface UngmLevelInfo {
  level: UngmLevel;
  /** Display label, e.g. "UNGM Level 1". */
  label: string;
  /** What this level unlocks / why it exists. */
  purpose: string;
  /** Concrete things the supplier must provide to reach this level. */
  requirements: string[];
  /** Whether this level requires uploading documents (→ real prep + eval time). */
  needsDocuments: boolean;
  /** Estimated [low, high] business days to become usable, incl. org evaluation. */
  leadTimeBusinessDays: [number, number];
  /** Hedged human-facing lead-time phrasing (an estimate, not an SLA). */
  leadTimeLabel: string;
}

export const UNGM_LEVELS: Record<UngmLevel, UngmLevelInfo> = {
  basic: {
    level: "basic",
    label: "UNGM Basic",
    purpose:
      "The free baseline most UN organisations require before you can access tender documents and submit a bid.",
    requirements: [
      "Company name, address, and contact details",
      "Business/ownership information and the goods or services you offer",
    ],
    needsDocuments: false,
    leadTimeBusinessDays: [0, 1],
    leadTimeLabel: "usually same day — free, email-verified, no documents",
  },
  "level-1": {
    level: "level-1",
    label: "UNGM Level 1",
    purpose:
      "Required by some organisations before award. The notice states whether this call needs it — start early, because the organisation has to evaluate it.",
    requirements: [
      "Certificate of Incorporation (or similar legal document) in English — if the original isn't in English, add a certified English translation",
      "Contact details for at least three independent, non-affiliated client references (ideally from the last year)",
      "Ownership structure — owners/principals, parent company, subsidiaries/affiliates, CEO/MD, plus any agents or intermediaries used for UN bids",
    ],
    needsDocuments: true,
    leadTimeBusinessDays: [3, 15],
    leadTimeLabel: "allow a couple of weeks — needs documents + UN evaluation",
  },
  "level-2": {
    level: "level-2",
    label: "UNGM Level 2",
    purpose:
      "For higher-value or sensitive procurements. Builds on Level 1 with financial and reference depth.",
    requirements: [
      "Three reference letters from recent, independent clients",
      "Audited/certified financial statements for the last three years",
      "Company established for at least three years",
    ],
    needsDocuments: true,
    leadTimeBusinessDays: [10, 30],
    leadTimeLabel: "several weeks — audited financials + references, then evaluation",
  },
};

export interface UngmRequirement {
  /**
   * Minimum level we can honestly assert is needed just to bid. Always "basic"
   * today: UNGM says higher minimums vary by agency AND opportunity, so we never
   * fabricate a per-agency mandate above Basic.
   */
  minLevelToBid: UngmLevel;
  /** Whether a higher level is commonly expected before *award* for this buyer
   *  (hedged — surfaced as "may be required", never as a hard rule). */
  higherLevelMayApply: boolean;
  /** Short buyer-specific honest note (verified) or the generic caveat. */
  note: string;
  /** True when `note` is the generic fallback (no buyer-specific verified copy). */
  isFallback?: boolean;
}

/**
 * Resolve the UNGM registration expectation for a buying agency. Basic is the
 * floor for everyone; we add a buyer-specific honest note where we have one,
 * otherwise the generic "the notice states the level" caveat. Structured so a
 * specific agency can be raised to a verified higher minimum later — but only
 * once UNGM/the agency publishes a fixed rule.
 */
export function resolveUngmRequirement(
  agency: string | null | undefined,
): UngmRequirement {
  const hay = (agency ?? "").toLowerCase();

  // UNDP "Quantum" family — UNDP works with "prospective suppliers" (Basic) for
  // bidding and applies additional vetting/levels before contract; the exact
  // level varies by procurement, so we keep Basic as the floor and explain.
  if (
    /\b(undp|unfpa|uncdf|unv)\b/.test(hay) ||
    hay.includes("un women") ||
    hay.includes("development programme") ||
    hay.includes("population fund") ||
    hay.includes("capital development") ||
    hay.includes("united nations volunteers")
  ) {
    return {
      minLevelToBid: "basic",
      higherLevelMayApply: true,
      note: "UNDP and its Quantum partner agencies let prospective suppliers bid at Basic level; higher levels and vetting apply before contract and vary by procurement — confirm the level this notice requires.",
    };
  }

  return {
    minLevelToBid: "basic",
    higherLevelMayApply: true,
    note: "Most UN organisations require at least free UNGM Basic registration to access documents and submit. Some require Level 1 or Level 2 before award — the notice states which. Start any document-based level early.",
    isFallback: true,
  };
}

/**
 * Judge whether a supplier can realistically reach a given UNGM level before
 * this tender's deadline. Reuses the same coarse band logic as portal timing.
 * Mainly meaningful for Level 1/2 (document + evaluation lead time); Basic is
 * near-instant so it rarely flags.
 */
export function assessUngmTiming(
  deadline: string | null | undefined,
  level: UngmLevel,
): RegistrationTiming {
  const days = daysUntilDeadline(deadline);
  return {
    daysUntilDeadline: days,
    firstTimeRisk: riskFromLeadBand(days, UNGM_LEVELS[level].leadTimeBusinessDays),
  };
}
