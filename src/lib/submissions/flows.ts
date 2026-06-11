/* The four submission formats as data — steps, blocks, deliverables,
 * declarations, eliminators. Adding a fifth format = adding a schema here;
 * no new UI code. (Prototype: sub-flows.jsx → TPSUB.FLOWS.)
 *
 * Copy rules held from the handoff SPEC §3/§7 (load-bearing, do not soften):
 *   · the user-facing verb is "start" / "pay & start drafting" — never "commission"
 *   · VAT-exemption, time-zone and envelope-separation warnings stay
 *   · we draft, the user signs and submits
 *   · guarantee line at the pay button:
 *     "Draft late, or rejected for a compliance error we made? Full refund — no questions." */

import type { SubmissionCode } from "@/lib/workbench/pricing";
import type { EnvelopeKey } from "./types";

export interface FlowField {
  k: string;
  label: string;
  type: "text" | "textarea" | "select" | "date";
  required?: boolean;
  /** Static pre-fill (shows a "pre-filled" tag until the user edits it). */
  pre?: string;
  /** Pre-fill from the viewer's profile: resolved client-side, degrades to a
   *  plain input when the profile field is empty (empty-vault first-run rule). */
  preFrom?: "profile_description" | "country_focus" | "business_name";
  options?: string[];
  help?: string;
  placeholder?: string;
}

export interface FlowDeclaration {
  id: string;
  label: string;
  note?: string;
}

export type FlowBlock =
  | { kind: "tender" }
  | { kind: "fields"; id: string; fields: FlowField[] }
  | {
      kind: "lines";
      id: string;
      title: string;
      intro: string;
      /** Label for the total row, e.g. "Quotation total" / "BoQ total". */
      totalLabel: string;
      /** Typical winning band for the scope — only rendered when real data
       *  exists. Production bands derive from awarded-contract data per
       *  category + agency; never invent one. */
      bench: { low: number; high: number; note: string } | null;
    }
  | {
      kind: "conformity";
      id: string;
      title: string;
      intro: string;
      /** Minimum rows the matrix must carry before the step counts complete. */
      min?: number;
    }
  | { kind: "docs"; id: string; docs: string[] }
  | { kind: "declarations"; id: string; items: FlowDeclaration[] }
  | {
      kind: "pickrefs";
      id: string;
      label: string;
      min: number;
      help: string;
    }
  | {
      kind: "envelope";
      id: string;
      fields: FlowField[];
      note: string;
    }
  | { kind: "review" };

export interface FlowStep {
  title: string;
  /** Rough completion estimate shown in the step rail, e.g. "~6 min". */
  est?: string;
  blocks: FlowBlock[];
}

export interface FlowDeliverable {
  name: string;
  fmt: string;
  envelope: EnvelopeKey;
}

export interface SubmissionFlow {
  code: SubmissionCode;
  name: string;
  /** Card tag: LIGHT / PRICE-DRIVEN / COMPLIANCE-HEAVY / STRATEGY-HEAVY. */
  tag: string;
  price: number; // whole USD — must match SUBMISSION_TYPES in workbench/pricing
  desc: string;
  bullets: string[];
  steps: FlowStep[];
  deliverables: FlowDeliverable[];
  /** "Auto-eliminators we guard against" — the format's known kill-list. */
  eliminators: string[];
  /** What the final pack includes, shown at the pay card. */
  payIncludes: string;
  /** Abbreviated QA checklist shown in the ops queue (display version of the
   *  34-point gate). */
  qaChecklist: string[];
  /** Final-mile shepherd checklist (the client signs and submits). */
  shepherd: { id: string; label: string }[];
}

/* Declarations shared by every format. */
const COMMON_DECLARATIONS: FlowDeclaration[] = [
  {
    id: "accuracy",
    label: "The information provided is accurate and complete",
  },
  {
    id: "sanctions",
    label: "We are not suspended, debarred, or on any UN ineligibility list",
  },
  {
    id: "conflict",
    label: "No conflict of interest exists with the issuing agency",
  },
];

const GUARANTEE = "Draft late, or rejected for a compliance error we made? Full refund — no questions.";

export const FLOW_GUARANTEE = GUARANTEE;

export const FLOWS: Record<SubmissionCode, SubmissionFlow> = {
  /* ── EOI · $149 · LIGHT ─────────────────────────────────────────────── */
  EOI: {
    code: "EOI",
    name: "Expression of Interest",
    tag: "Light",
    price: 149,
    desc: "A capability-led response that positions you for the shortlist. No pricing — this is about credibility and eligibility.",
    bullets: ["EOI cover letter", "Capability statement (tailored)", "Eligibility annex & declarations"],
    steps: [
      { title: "The opportunity", blocks: [{ kind: "tender" }] },
      {
        title: "Capability & eligibility",
        est: "~5 min",
        blocks: [
          {
            kind: "fields",
            id: "capability",
            fields: [
              {
                k: "capability_angle",
                label: "Capability angle",
                type: "textarea",
                required: true,
                preFrom: "profile_description",
                placeholder: "What you deliver, for whom, and the proof that you can — 3–5 sentences.",
                help: "This drives the capability statement. Specific beats broad: name the services, the geographies, and one or two anchor clients.",
              },
              {
                k: "geographic_presence",
                label: "Geographic presence",
                type: "text",
                required: true,
                preFrom: "country_focus",
                placeholder: "e.g. Kenya (HQ Nairobi) · Somalia · South Sudan",
              },
              {
                k: "years_operating",
                label: "Years operating",
                type: "text",
                required: true,
                placeholder: "e.g. 8 years (registered 2018)",
              },
            ],
          },
          {
            kind: "pickrefs",
            id: "refs",
            label: "Past-performance references",
            min: 2,
            help: "Two or more comparable contracts. Pick from your vault or type them — client, scope, year, value.",
          },
          { kind: "docs", id: "docs", docs: ["capability_statement", "company_registration"] },
          { kind: "declarations", id: "decl", items: COMMON_DECLARATIONS },
        ],
      },
      { title: "Review & pay", blocks: [{ kind: "review" }] },
    ],
    deliverables: [
      { name: "EOI cover letter", fmt: "PDF", envelope: "forms" },
      { name: "Capability statement (tailored)", fmt: "PDF", envelope: "technical" },
      { name: "Eligibility annex & declarations", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Missing mandatory declarations",
      "Wrong submission channel",
      "Absent eligibility documents",
      "Late submission — EOI deadlines are rarely extended",
    ],
    payIncludes:
      "Includes drafting, the compliance QA gate, unlimited revisions until you approve, and final files in the channel's required format. Pay now — drafting starts immediately.",
    qaChecklist: [
      "Eligibility documents present",
      "Declarations complete & consistent",
      "Capability statement maps to the notice's scope",
      "References named with client + year",
      "Submission channel + deadline verified",
      "All signature points marked",
    ],
    shepherd: [
      { id: "download", label: "Download the final pack" },
      { id: "sign", label: "Sign at every marked signature point" },
      { id: "channel", label: "Submit through the exact channel the notice names — portal or email" },
      { id: "confirm", label: "Save the submission confirmation / receipt" },
    ],
  },

  /* ── RFQ · $199 · PRICE-DRIVEN ──────────────────────────────────────── */
  RFQ: {
    code: "RFQ",
    name: "Request for Quotation",
    tag: "Price-driven",
    price: 199,
    desc: "Lowest-priced, technically compliant offer wins. We make sure the quote is complete, the specs match, and nothing voids your offer.",
    bullets: ["Quotation form (agency template)", "Priced line schedule", "Specs compliance sheet & declarations"],
    steps: [
      { title: "The opportunity", blocks: [{ kind: "tender" }] },
      {
        title: "Price your lines",
        est: "~6 min",
        blocks: [
          {
            kind: "lines",
            id: "lines",
            title: "Price your lines",
            intro:
              "Line items from the RFQ schedule. Enter unit prices — totals, VAT treatment and currency rules are handled.",
            totalLabel: "Quotation total",
            bench: null,
          },
          {
            kind: "fields",
            id: "terms",
            fields: [
              {
                k: "quote_validity",
                label: "Quote validity",
                type: "select",
                required: true,
                pre: "60 days (required minimum)",
                options: ["60 days (required minimum)", "90 days", "120 days"],
                help: "Most UN RFQs require 60 or 90 days. Shorter than the notice asks = automatic rejection.",
              },
              {
                k: "delivery_lead_time",
                label: "Delivery lead time",
                type: "text",
                required: true,
                pre: "6 weeks from PO",
                help: "From purchase order to delivery at the named destination.",
              },
              {
                k: "incoterms",
                label: "Incoterms",
                type: "select",
                required: true,
                options: ["DAP — Delivered at Place", "DDP — Delivered Duty Paid", "CIP — Carriage & Insurance Paid", "EXW — Ex Works"],
                help: "Match the Incoterms the notice names. Quoting EXW when DAP is required voids the offer.",
              },
            ],
          },
        ],
      },
      {
        title: "Specs & documents",
        est: "~3 min",
        blocks: [
          {
            kind: "conformity",
            id: "specs",
            title: "Specs compliance",
            intro:
              "Confirm each specification, or declare the deviation. An undeclared deviation found at evaluation voids the quote — a declared equivalent often survives.",
          },
          { kind: "docs", id: "docs", docs: ["company_registration", "manufacturer_authorization"] },
          {
            kind: "declarations",
            id: "decl",
            items: [
              ...COMMON_DECLARATIONS,
              {
                id: "vat",
                label: "Prices exclude VAT and sales tax",
                note: "UN agencies are tax-exempt — a VAT-inclusive quote reads ~14% too high against compliant bidders.",
              },
              {
                id: "validity_hold",
                label: "Our quote holds for the full validity period stated",
              },
            ],
          },
        ],
      },
      { title: "Review & pay", blocks: [{ kind: "review" }] },
    ],
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
    payIncludes:
      "Includes drafting, the compliance QA gate, unlimited revisions until you approve, and final files in the agency's required format. Pay now — drafting starts immediately.",
    qaChecklist: [
      "Every line has a unit price — no blanks",
      "Validity ≥ the notice's minimum",
      "Incoterms + delivery terms match the notice",
      "VAT excluded throughout",
      "Spec deviations declared, none silent",
      "Quotation form signature points marked",
    ],
    shepherd: [
      { id: "download", label: "Download the final pack" },
      { id: "sign", label: "Sign the quotation form at every marked point" },
      { id: "channel", label: "Lodge the quote through the portal / channel in the notice" },
      { id: "deadline", label: "Check the deadline in the agency's local time zone — not yours" },
      { id: "confirm", label: "Save the submission confirmation / receipt number" },
    ],
  },

  /* ── ITB · $299 · COMPLIANCE-HEAVY ──────────────────────────────────── */
  ITB: {
    code: "ITB",
    name: "Invitation to Bid",
    tag: "Compliance-heavy",
    price: 299,
    desc: "Formal sealed bidding. Pass/fail conformity first, then lowest price wins. One missed form and the bid is dead — we run a 34-point compliance gate.",
    bullets: [
      "Technical bid — conformity response",
      "Financial bid — Bill of Quantities",
      "Bid forms pack (incl. bid-securing declaration)",
    ],
    steps: [
      { title: "The opportunity", blocks: [{ kind: "tender" }] },
      {
        title: "Conformity matrix",
        est: "~8 min",
        blocks: [
          {
            kind: "conformity",
            id: "conformity",
            title: "Technical conformity",
            min: 1,
            intro:
              "Respond to every specification: comply, or declare the deviation with what you offer instead. Evaluation is pass/fail — an undeclared deviation kills the bid; a declared equivalent can pass.",
          },
        ],
      },
      {
        title: "Bill of Quantities",
        est: "~6 min",
        blocks: [
          {
            kind: "lines",
            id: "boq",
            title: "Bill of Quantities",
            intro:
              "Price every BoQ line. After conformity, award goes to the lowest evaluated price — completeness matters more than polish.",
            totalLabel: "BoQ total",
            bench: null,
          },
          {
            kind: "fields",
            id: "terms",
            fields: [
              {
                k: "bid_validity",
                label: "Bid validity",
                type: "select",
                required: true,
                pre: "120 days",
                options: ["90 days", "120 days", "180 days"],
                help: "ITBs commonly require 90–120 days. Match or exceed the notice.",
              },
              {
                k: "site_visit",
                label: "Site visit",
                type: "select",
                required: true,
                options: [
                  "Attended — certificate in hand",
                  "Scheduled — before the deadline",
                  "Not required by this ITB",
                ],
                help: "Where an ITB makes the site visit mandatory, no certificate = automatic rejection.",
              },
            ],
          },
        ],
      },
      {
        title: "Forms & documents",
        est: "~4 min",
        blocks: [
          { kind: "docs", id: "docs", docs: ["company_registration", "audited_financials", "bid_securing_declaration"] },
          {
            kind: "declarations",
            id: "decl",
            items: [
              ...COMMON_DECLARATIONS,
              {
                id: "no_silent_deviation",
                label: "Every deviation from the specifications is declared in the conformity response",
              },
              {
                id: "envelope_separation",
                label: "No financial figures appear anywhere in the technical bid",
                note: "Two-envelope rule: price found in the technical envelope = bid rejected unread.",
              },
            ],
          },
        ],
      },
      { title: "Review & pay", blocks: [{ kind: "review" }] },
    ],
    deliverables: [
      { name: "Technical bid — conformity response", fmt: "PDF", envelope: "technical" },
      { name: "Financial bid — Bill of Quantities", fmt: "XLSX + PDF", envelope: "financial" },
      { name: "Bid forms pack (incl. bid-securing declaration)", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Unsigned bid forms",
      "Financial data in the technical envelope",
      "Undeclared specification deviations",
      "Missed mandatory site visit",
    ],
    payIncludes:
      "Includes drafting, the 34-point compliance gate, unlimited revisions until you approve, and final files split per envelope exactly as the ITB requires. Pay now — drafting starts immediately.",
    qaChecklist: [
      "All 34 gate points pass",
      "Conformity response covers every spec line",
      "Deviations declared with offered alternative",
      "BoQ complete — no blank lines",
      "Envelope separation clean (no price in technical)",
      "Bid-securing declaration + forms signature-marked",
    ],
    shepherd: [
      { id: "download", label: "Download both envelopes separately — never merge them" },
      { id: "sign", label: "Sign every form at the marked points (incl. bid-securing declaration)" },
      { id: "envelopes", label: "Upload each envelope to its own slot — financial files stay out of the technical slot" },
      { id: "deadline", label: "Check the deadline in the agency's local time zone — not yours" },
      { id: "confirm", label: "Save the submission receipt number" },
    ],
  },

  /* ── RFP · $349 · STRATEGY-HEAVY ────────────────────────────────────── */
  RFP: {
    code: "RFP",
    name: "Request for Proposal",
    tag: "Strategy-heavy",
    price: 349,
    desc: "Two-envelope, best-value selection — typically 70% technical, 30% financial. We build the methodology against the scoring matrix, point by point.",
    bullets: [
      "Technical proposal (methodology, workplan, team)",
      "Financial proposal — sealed separately",
      "Forms, CVs & declarations pack",
    ],
    steps: [
      { title: "The opportunity", blocks: [{ kind: "tender" }] },
      {
        title: "Technical approach",
        est: "~10 min",
        blocks: [
          {
            kind: "fields",
            id: "technical",
            fields: [
              {
                k: "methodology",
                label: "Delivery approach",
                type: "textarea",
                required: true,
                placeholder: "How you'd deliver this scope — phases, methods, quality control. Bullet points are fine; we structure it.",
                help: "Evaluators score the methodology against each TOR task in sequence. Address the tasks, not a general framework.",
              },
              {
                k: "workplan",
                label: "Workplan highlights",
                type: "textarea",
                required: true,
                placeholder: "Key milestones and rough timeline — e.g. inception 2 wks · field phase 6 wks · reporting 3 wks.",
              },
              {
                k: "team",
                label: "Proposed team / key personnel",
                type: "textarea",
                required: true,
                placeholder: "Names or roles you'd assign, with the one-line claim to fame for each.",
                help: "Each named expert needs a CV in the pack — weak competency mapping is a scored deduction.",
              },
            ],
          },
          {
            kind: "pickrefs",
            id: "refs",
            label: "Comparable assignments",
            min: 2,
            help: "Two or more assignments the evaluators can verify — client, scope, year, value.",
          },
        ],
      },
      {
        title: "Financial proposal",
        est: "~4 min",
        blocks: [
          {
            kind: "envelope",
            id: "financial",
            note: "Sealed separately. Nothing here appears in the technical envelope — financial data found there gets the whole proposal rejected before scoring.",
            fields: [
              {
                k: "financial_total",
                label: "Total fee",
                type: "text",
                required: true,
                placeholder: "e.g. USD 84,000 all-inclusive",
              },
              {
                k: "fee_structure",
                label: "Fee structure",
                type: "select",
                required: true,
                options: ["Lump sum", "Time & materials", "Milestone-based"],
              },
              {
                k: "financial_notes",
                label: "Cost notes (optional)",
                type: "textarea",
                placeholder: "Assumptions, exclusions, reimbursables…",
              },
            ],
          },
        ],
      },
      {
        title: "Documents & declarations",
        est: "~4 min",
        blocks: [
          { kind: "docs", id: "docs", docs: ["cv_key_personnel", "company_registration", "audited_financials", "client_references"] },
          {
            kind: "declarations",
            id: "decl",
            items: [
              ...COMMON_DECLARATIONS,
              {
                id: "envelope_separation",
                label: "No financial figures appear anywhere in the technical proposal",
                note: "Two-envelope rule: price found in the technical envelope = proposal rejected unread.",
              },
              {
                id: "cv_availability",
                label: "CVs are current and each named expert has confirmed availability",
              },
            ],
          },
        ],
      },
      { title: "Review & pay", blocks: [{ kind: "review" }] },
    ],
    deliverables: [
      { name: "Technical proposal (methodology, workplan, team)", fmt: "PDF", envelope: "technical" },
      { name: "Financial proposal — sealed separately", fmt: "PDF", envelope: "financial" },
      { name: "Forms, CVs & declarations pack", fmt: "PDF", envelope: "forms" },
    ],
    eliminators: [
      "Financial data in the technical envelope",
      "Technical score below the threshold (typically 70%)",
      "Missing or uncommitted CVs",
      "Page limits / format instructions ignored",
    ],
    payIncludes:
      "Includes drafting against the scoring matrix, the compliance QA gate, unlimited revisions until you approve, and final files split per envelope. Pay now — drafting starts immediately.",
    qaChecklist: [
      "Methodology maps to each TOR task in sequence",
      "Every named expert has a CV in the pack",
      "References cited with client + year",
      "Envelope separation clean (no price in technical)",
      "Page/format instructions followed",
      "All signature points marked",
    ],
    shepherd: [
      { id: "download", label: "Download both envelopes separately — never merge them" },
      { id: "sign", label: "Sign the forms and CV declarations at the marked points" },
      { id: "envelopes", label: "Upload technical and financial to their own slots — sealed means sealed" },
      { id: "deadline", label: "Check the deadline in the agency's local time zone — not yours" },
      { id: "confirm", label: "Save the submission receipt number" },
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
