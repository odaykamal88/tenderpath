/* The four submission formats as data — steps, blocks, deliverables,
 * declarations, eliminators. Adding a fifth format = adding a schema here;
 * no new UI code. Faithful port of the prototype's sub-flows.jsx (TPSUB.FLOWS);
 * the prototype is the spec.
 *
 * Production adaptations (deliberate, documented):
 *   · the prototype's seed line-items / conformity rows / benchmark bands were
 *     demo-tender data — lines and conformity are user-built here, and `bench`
 *     stays null until real awarded-contract bands exist (never invent one);
 *   · per-tender helps ("FAO requires…", "DAP Mogadishu") are genericized.
 *
 * Copy rules held (SPEC §3/§7, load-bearing): "start" / "pay & start drafting"
 * — never "commission"; the guarantee line at the pay button; VAT, time-zone
 * and envelope-separation warnings stay. */

import type { SubmissionCode } from "@/lib/workbench/pricing";
import type { EnvelopeKey } from "./types";

export interface FlowField {
  k: string;
  label: string;
  type: "text" | "textarea" | "select" | "money";
  required?: boolean;
  /** Static pre-fill (wears a "pre-filled" tag until edited). */
  pre?: string;
  /** Pre-fill from the viewer's profile — degrades to a plain input when the
   *  profile is empty (empty-vault first-run rule). */
  preFrom?: "profile_description" | "country_focus" | "business_name";
  options?: string[];
  help?: string;
  placeholder?: string;
  /** Render only when another field holds a specific value. */
  showIf?: { k: string; v: string };
}

export interface FlowBlocker {
  id: string;
  sev: "high" | "medium";
  label: string;
  /** How to fix it — shown under the doc row while open. */
  fix: string;
}

export type FlowBlock =
  | { kind: "fields"; id: string; fields: FlowField[] }
  | {
      kind: "lines";
      id: string;
      /** "rfq" = quotation schedule · "boq" = bill of quantities. */
      mode: "rfq" | "boq";
      /** Typical winning band — only rendered when real data exists. */
      bench: { low: number; high: number; note: string } | null;
    }
  | {
      kind: "conformity";
      id: string;
      /** Minimum rows before the matrix counts complete. */
      min?: number;
    }
  | {
      kind: "criteria";
      id: string;
      items: { id: string; crit: string; pts?: number; fieldLabel: string; help?: string; preFrom?: FlowField["preFrom"] }[];
    }
  | {
      kind: "docs";
      id: string;
      docs: string[];
      /** Subset that counts toward completeness; the rest are good-to-have. */
      required?: string[];
      label?: string;
      /** Curated elimination risk attached to this block — ONLY these gate
       *  payment (regular missing docs just reduce completeness). */
      blocker?: FlowBlocker;
    }
  | { kind: "declarations"; id: string; items: string[] }
  | { kind: "pickrefs"; id: string; label: string; min: number; help: string }
  | {
      kind: "envelope";
      id: string;
      bench: { low: number; high: number; note: string } | null;
      fields: FlowField[];
    };

export interface FlowStep {
  id: string;
  title: string;
  kind?: "tender" | "review";
  est?: string;
  intro?: string;
  blocks?: FlowBlock[];
}

export interface FlowDeliverable {
  name: string;
  fmt: string;
  envelope: EnvelopeKey;
}

export interface SubmissionFlow {
  code: SubmissionCode;
  name: string;
  price: number; // whole USD — must match SUBMISSION_TYPES in workbench/pricing
  sla: string;
  complexity: string;
  tagline: string;
  blurb: string;
  deliverables: FlowDeliverable[];
  eliminators: string[];
  steps: FlowStep[];
}

/** Founder-operated first-10 delivery window. The clock starts only after the
 * tender pack and company evidence are complete and intake is confirmed. */
export const PILOT_SLA_MINS = 24 * 60;
export const PILOT_SLA_LABEL = "Within 1 business day";

export const FLOW_GUARANTEE =
  "Late after confirmed intake, or rejected for a compliance error TenderPath introduced? Full service-fee refund. Supplier omissions, buyer changes, portal outages, late supplier submission, and award outcome are excluded.";

const UNGM_BLOCKER = (why: string): FlowBlocker => ({
  id: "ungm",
  sev: "high",
  label: `UNGM registration — ${why}`,
  fix: "Register at Basic level (~20 min). Navigator has a guided path.",
});

export const FLOWS: Record<SubmissionCode, SubmissionFlow> = {
  /* ──────── EOI — Expression of Interest ──────── */
  EOI: {
    code: "EOI",
    name: "Expression of Interest",
    price: 149,
    sla: PILOT_SLA_LABEL,
    complexity: "Light",
    tagline: "Present the capability clearly",
    blurb:
      "A capability-led response that positions you for the shortlist. No pricing — this is about credibility and eligibility.",
    deliverables: [
      { name: "EOI cover letter", fmt: "DOCX + PDF", envelope: "forms" },
      { name: "Capability statement (tailored)", fmt: "PDF", envelope: "technical" },
      { name: "Eligibility annex & declarations", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Late submission",
      "Missing mandatory declarations",
      "Eligibility documents absent",
      "Wrong submission channel",
    ],
    steps: [
      { id: "tender", title: "The opportunity", kind: "tender" },
      {
        id: "capability",
        title: "Capability angle",
        est: "~4 min",
        intro: "Pulled from your profile and vault — adjust the angle, we draft the narrative.",
        blocks: [
          {
            kind: "fields",
            id: "capability",
            fields: [
              {
                k: "angle",
                label: "Positioning angle",
                type: "textarea",
                required: true,
                preFrom: "profile_description",
                placeholder: "What you deliver, for whom, and the proof you can — one or two sentences.",
                help: "One or two sentences on why you. We expand this into the letter.",
              },
              {
                k: "geo",
                label: "Counties / regions you can serve",
                type: "text",
                required: true,
                preFrom: "country_focus",
                placeholder: "e.g. Garissa, Wajir, Mandera, Turkana",
              },
              {
                k: "capacity",
                label: "Capacity evidence",
                type: "text",
                placeholder: "e.g. 8,400 m² bonded warehousing · 14 trucks · 96% on-time delivery 2025",
              },
            ],
          },
          {
            kind: "pickrefs",
            id: "refs",
            label: "Comparable experience",
            min: 2,
            help: "Agencies shortlist on evidence. Two strong references minimum; a third lifts you.",
          },
        ],
      },
      {
        id: "eligibility",
        title: "Eligibility & documents",
        est: "~3 min",
        intro:
          "Everything below auto-attaches from your vault. Red items would get you eliminated — resolve or acknowledge before you pay.",
        blocks: [
          { kind: "docs", id: "docs", docs: ["inc", "tax", "cap", "coc"], required: ["inc", "tax"] },
          {
            kind: "docs",
            id: "portal",
            docs: ["ungm"],
            required: ["ungm"],
            label: "Portal registration",
            blocker: UNGM_BLOCKER("submissions go through the UNGM portal"),
          },
          {
            kind: "declarations",
            id: "decl",
            items: [
              "We are not on any UN sanctions or ineligibility list",
              "No conflict of interest with the agency or programme",
              "Information provided is accurate and complete",
            ],
          },
        ],
      },
      { id: "review", title: "Review & pay", kind: "review" },
    ],
  },

  /* ──────── RFQ — Request for Quotation ──────── */
  RFQ: {
    code: "RFQ",
    name: "Request for Quotation",
    price: 199,
    sla: PILOT_SLA_LABEL,
    complexity: "Price-driven",
    tagline: "Quote it right",
    blurb:
      "RFQs are usually price-led after technical compliance. We follow the notice's exact evaluation method and guard against preventable omissions.",
    deliverables: [
      { name: "Quotation form (agency template)", fmt: "PDF", envelope: "financial" },
      { name: "Priced line schedule", fmt: "XLSX + PDF", envelope: "financial" },
      { name: "Specs compliance sheet & declarations", fmt: "PDF", envelope: "technical" },
    ],
    eliminators: [
      "Quote validity shorter than required",
      "Missing unit prices (incomplete quote)",
      "Wrong Incoterms / delivery terms",
      "Unsigned quotation form",
    ],
    steps: [
      { id: "tender", title: "The opportunity", kind: "tender" },
      {
        id: "lines",
        title: "Price your lines",
        est: "~6 min",
        intro:
          "Line items from the RFQ schedule. Enter unit prices — totals, VAT treatment and currency rules are handled.",
        blocks: [
          { kind: "lines", id: "lines", mode: "rfq", bench: null },
          {
            kind: "fields",
            id: "terms",
            fields: [
              {
                k: "validity",
                label: "Quote validity",
                type: "text",
                required: true,
                placeholder: "e.g. 60 days — copy from the RFQ",
                help: "Use the exact period in the live RFQ or amendment; TenderPath does not assume one.",
              },
              {
                k: "delivery",
                label: "Delivery lead time",
                type: "text",
                required: true,
                placeholder: "e.g. 6 weeks from purchase order",
                help: "From purchase order to delivery at the named destination — match the notice's ceiling.",
              },
              {
                k: "incoterms",
                label: "Incoterms",
                type: "text",
                required: true,
                placeholder: "e.g. DAP, named destination — copy from the RFQ",
                help: "Match the Incoterms the notice names. Quoting EXW when DAP is required voids the offer.",
              },
              {
                k: "tax",
                label: "Tax / VAT treatment",
                type: "text",
                required: true,
                placeholder: "Copy the treatment required by the RFQ template",
              },
              {
                k: "warranty",
                label: "Warranty offered",
                type: "text",
                placeholder: "Copy or exceed the published minimum",
                help: "Match or exceed the notice's minimum.",
              },
            ],
          },
        ],
      },
      {
        id: "compliance",
        title: "Specs & documents",
        est: "~3 min",
        intro:
          "Confirm your goods meet spec, attach the basics. Deviations must be declared — undeclared ones void the quote at inspection.",
        blocks: [
          {
            kind: "fields",
            id: "specs",
            fields: [
              {
                k: "specs",
                label: "Specification conformity",
                type: "select",
                required: true,
                options: ["Fully compliant with all specs", "Compliant with declared deviations"],
              },
              {
                k: "deviations",
                label: "Declared deviations (if any)",
                type: "textarea",
                showIf: { k: "specs", v: "Compliant with declared deviations" },
                placeholder: "What deviates, and the equivalent you offer — we phrase it to survive evaluation.",
              },
            ],
          },
          {
            kind: "docs",
            id: "goods",
            docs: ["cat", "warr"],
            required: ["cat", "warr"],
            label: "Goods evidence — most-missed in RFQs",
          },
          { kind: "docs", id: "docs", docs: ["inc", "tax", "bank"], required: ["inc", "tax"] },
          {
            kind: "docs",
            id: "portal",
            docs: ["ungm"],
            required: ["ungm"],
            label: "Portal registration",
            blocker: UNGM_BLOCKER("most UN quotes are lodged via UNGM"),
          },
          {
            kind: "declarations",
            id: "decl",
            items: [
              "Tax / VAT treatment matches the live RFQ template",
              "Price-firmness or escalation terms match the live RFQ",
              "Goods condition and model-year statements match the published specification",
              "Agency terms and any declared exceptions have been reviewed against the RFQ",
            ],
          },
        ],
      },
      { id: "review", title: "Review & pay", kind: "review" },
    ],
  },

  /* ──────── ITB — Invitation to Bid ──────── */
  ITB: {
    code: "ITB",
    name: "Invitation to Bid",
    price: 299,
    sla: PILOT_SLA_LABEL,
    complexity: "Compliance-heavy",
    tagline: "Control elimination risks",
    blurb:
      "Formal bidding often starts with pass/fail conformity before price evaluation. We follow the ITB's published method and run a 34-point compliance gate.",
    deliverables: [
      { name: "Technical bid — conformity response", fmt: "PDF", envelope: "technical" },
      { name: "Financial bid — Bill of Quantities", fmt: "XLSX + PDF", envelope: "financial" },
      { name: "Bid forms pack (incl. bid-securing declaration)", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Unsigned bid form or missing bid security",
      "Financial info leaked into technical envelope",
      "Bid validity shorter than required",
      "Undeclared spec deviations",
      "Missed site-visit certificate where mandatory",
    ],
    steps: [
      { id: "tender", title: "The opportunity", kind: "tender" },
      {
        id: "conformity",
        title: "Technical conformity",
        est: "~8 min",
        intro:
          "The ITB's technical schedule, item by item. Mark conformity honestly — we phrase declared deviations so they survive evaluation.",
        blocks: [
          { kind: "conformity", id: "conformity", min: 1 },
          {
            kind: "fields",
            id: "sitevisit",
            fields: [
              {
                k: "sitevisit",
                label: "Mandatory site visit",
                type: "select",
                options: [
                  "Attended — certificate on hand",
                  "Scheduled — before the deadline",
                  "Not required by this ITB",
                ],
                help: "Where an ITB makes the pre-bid site visit mandatory, no certificate = rejection.",
              },
            ],
          },
        ],
      },
      {
        id: "boq",
        title: "Bill of Quantities",
        est: "~8 min",
        intro:
          "Priced separately from the technical response — we keep envelopes sealed so nothing cross-contaminates.",
        blocks: [
          { kind: "lines", id: "boq", mode: "boq", bench: null },
          {
            kind: "fields",
            id: "terms",
            fields: [
              {
                k: "validity",
                label: "Bid validity",
                type: "text",
                required: true,
                placeholder: "e.g. 120 days — copy from the ITB",
                help: "Use the exact period in the live ITB or amendment; TenderPath does not assume one.",
              },
              {
                k: "security",
                label: "Bid security",
                type: "text",
                required: true,
                placeholder: "e.g. signed bid-securing declaration or exact guarantee requirement",
                help: "Copy the exact instrument and amount from the ITB; do not substitute one security form for another.",
              },
            ],
          },
        ],
      },
      {
        id: "forms",
        title: "Forms & eligibility",
        est: "~4 min",
        intro:
          "The forms pack that gets bids eliminated most. We pre-fill every form from your vault; you confirm.",
        blocks: [
          { kind: "docs", id: "docs", docs: ["inc", "reg", "tax", "manu"], required: ["inc", "reg", "tax", "manu"] },
          {
            kind: "docs",
            id: "portal",
            docs: ["ungm"],
            required: ["ungm"],
            label: "Portal registration",
            blocker: UNGM_BLOCKER("required for UN e-submission portals"),
          },
          {
            kind: "declarations",
            id: "decl",
            items: [
              "Bid form signed by an authorized signatory (we prepare for signature)",
              "Bid-security instrument or declaration matches the live ITB",
              "No alteration to the agency's bid forms",
              "Joint venture: not applicable / agreement attached",
            ],
          },
        ],
      },
      { id: "review", title: "Review & pay", kind: "review" },
    ],
  },

  /* ──────── RFP — Request for Proposal ──────── */
  RFP: {
    code: "RFP",
    name: "Request for Proposal",
    price: 349,
    sla: PILOT_SLA_LABEL,
    complexity: "Strategy-heavy",
    tagline: "Compete on substance",
    blurb:
      "Best-value selection often separates technical and financial responses. We map the methodology to the criteria and weights actually published in the notice.",
    deliverables: [
      { name: "Technical proposal (methodology, workplan, team)", fmt: "DOCX + PDF", envelope: "technical" },
      { name: "Financial proposal — sealed separately", fmt: "PDF", envelope: "financial" },
      { name: "Forms, CVs & declarations pack", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Financial data inside the technical envelope",
      "Missing the published technical threshold, where the notice sets one",
      "Key expert CVs missing or unsigned",
      "Page/format limits breached",
    ],
    steps: [
      { id: "tender", title: "The opportunity", kind: "tender" },
      {
        id: "strategy",
        title: "Technical strategy",
        est: "~10 min",
        intro:
          "Build the response evidence here. During assisted review, we map it to the tender's published evaluation matrix—never generic weights.",
        blocks: [
          {
            kind: "criteria",
            id: "criteria",
            items: [
              {
                id: "k1",
                crit: "Methodology & approach",
                fieldLabel: "Your angle",
                preFrom: "profile_description",
                help: "We map this to the TOR tasks and published criteria during assisted review.",
              },
              {
                id: "k2",
                crit: "Team composition & CVs",
                fieldLabel: "Proposed team",
                help: "Names or roles you'd assign — every named expert needs a CV in the pack.",
              },
              {
                id: "k3",
                crit: "Comparable experience",
                fieldLabel: "References to cite",
              },
              {
                id: "k4",
                crit: "Workplan & timeline",
                fieldLabel: "Delivery constraints",
                help: "Mobilization, seasonal windows, anything that shapes the timeline.",
              },
            ],
          },
          {
            kind: "docs",
            id: "experts",
            docs: ["cv3"],
            required: [],
            label: "Additional key-expert evidence",
          },
        ],
      },
      {
        id: "financial",
        title: "Financial envelope",
        est: "~6 min",
        intro:
          "Kept structurally separate from the technical envelope — the #1 elimination error in RFPs is cross-contamination.",
        blocks: [
          {
            kind: "envelope",
            id: "envelope",
            bench: null,
            fields: [
              {
                k: "ceiling",
                label: "Total fee ceiling",
                type: "money",
                required: true,
                placeholder: "e.g. 1,420,000",
                help: "Stay inside the TOR's budget band where one is published.",
              },
              {
                k: "days",
                label: "Person-days basis",
                type: "text",
                placeholder: "e.g. 2,140 person-days across 3 experts + field teams",
              },
              {
                k: "reimb",
                label: "Reimbursables",
                type: "text",
                placeholder: "e.g. 11% — travel, workshops, field logistics",
              },
              {
                k: "terms",
                label: "Payment schedule preference",
                type: "select",
                options: ["Milestone-based (recommended)", "Monthly invoicing", "Deliverable-based"],
                pre: "Milestone-based (recommended)",
              },
              {
                k: "validity",
                label: "Published proposal validity",
                type: "text",
                required: true,
                placeholder: "e.g. 180 days — copy from the notice",
                help: "Use the exact period in the live solicitation or amendment; TenderPath does not assume one.",
              },
            ],
          },
        ],
      },
      {
        id: "compliance",
        title: "Eligibility & forms",
        est: "~4 min",
        intro: "The agency's mandatory annexes, pre-filled from the vault. The financials flag below is the one to deal with.",
        blocks: [
          { kind: "docs", id: "docs", docs: ["inc", "tax", "coc", "dp"], required: ["inc", "tax"] },
          {
            kind: "docs",
            id: "financials",
            docs: ["fin"],
            required: [],
            label: "Financial capacity",
          },
          {
            kind: "pickrefs",
            id: "refs",
            label: "Reference projects",
            min: 2,
            help: "Cited under the comparable-experience criterion.",
          },
          {
            kind: "declarations",
            id: "decl",
            items: [
              "I confirmed the notice's technical / financial file-separation rule",
              "I confirmed the proposal-validity period against the live notice or amendment",
              "No conflict of interest; full beneficial-ownership disclosure",
            ],
          },
        ],
      },
      { id: "review", title: "Review & pay", kind: "review" },
    ],
  },
};

export function flowFor(code: SubmissionCode): SubmissionFlow {
  return FLOWS[code];
}

export const ENVELOPE_LABELS: Record<EnvelopeKey, string> = {
  technical: "Technical envelope",
  financial: "Financial envelope",
  forms: "Forms & annexes",
};

/* ── Final-mile shepherd (prototype: Shepherd in sub-tracker.jsx) ──────────
 * Dynamic: portal-aware, two-envelope branching for ITB/RFP. Ids are stable —
 * the server verifies every id is checked before final → submitted. */

export interface ShepherdStep {
  id: string;
  t: string;
  d: string;
}

export function shepherdSteps(type: SubmissionCode, portal: string | null, due: string | null): ShepherdStep[] {
  const twoEnv = type === "RFP" || type === "ITB";
  const portalName = portal?.trim() || "the portal named in the notice";
  const dueLabel = due
    ? new Date(due).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : "the date in the notice";
  const steps: (ShepherdStep | null)[] = [
    {
      id: "login",
      t: `Log in to ${portalName}`,
      d: "Use your registered company account — the one matching your UNGM profile. Submissions from personal accounts get disqualified.",
    },
    {
      id: "download",
      t: "Download the final pack below",
      d: "Files are named and formatted exactly as the notice requires. Don't rename, merge or re-export them — page limits and digital signatures can break.",
    },
    twoEnv
      ? {
          id: "upload-tech",
          t: "Upload the TECHNICAL envelope first",
          d: "Technical documents only. Double-check no pricing appears anywhere in it — this is the #1 elimination error and it is irreversible.",
        }
      : {
          id: "upload",
          t: "Upload your documents",
          d: "Upload every file in the pack. Partial uploads are evaluated as incomplete offers.",
        },
    twoEnv
      ? {
          id: "upload-fin",
          t: "Upload the FINANCIAL envelope separately",
          d: "The portal keeps it sealed until technical evaluation finishes. Confirm the file lands in the financial slot, not as a technical annex.",
        }
      : null,
    {
      id: "deadline",
      t: "Submit before the deadline — not at it",
      d: `Deadline: ${dueLabel}, at the time stated in the notice — check the agency's time zone, not yours. Portals reject at the second; aim to be done 24h early. We'll nudge you as it approaches.`,
    },
    {
      id: "receipt",
      t: "Save the confirmation receipt",
      d: "Screenshot or download the portal's submission receipt. It's your only proof if the agency's system has issues.",
    },
  ];
  return steps.filter(Boolean) as ShepherdStep[];
}

/** Abbreviated ops QA checklist (prototype SQ_QA) — the display version of the
 *  34-point gate, shared across formats. */
export const ADMIN_QA_CHECKLIST = [
  "Eligibility docs present and in date",
  "Forms unaltered, signed, correct template",
  "No financial data outside its envelope",
  "Validity, Incoterms & deadlines match the notice",
  "Page limits, naming and format per instructions",
];
