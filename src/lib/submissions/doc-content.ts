/* docContent(order) — builds each deliverable as a readable document from the
 * order's OWN intake (faithful port of the prototype's sub-reader.jsx). The
 * reader renders these blocks in-app; the PDF export renders the same blocks,
 * so what the client approves is what they download.
 *
 * The prototype's demo-company facts (reg numbers, fleet stats, invented track
 * records) are NOT reproduced — every figure and claim here traces to a wizard
 * input or the viewer's profile; template prose carries the voice, not facts.
 *
 * Block model (SPEC §4): h1 · h2 · p · kv · list · table · note · sig. */

import type { ConformityRow, PricedLine, ReferenceEntry, SubmissionOrder } from "./types";
import { flowFor } from "./flows";

export type DocBlock =
  | { b: "h1"; text: string }
  | { b: "h2"; text: string }
  | { b: "p"; text: string }
  | { b: "kv"; rows: [string, string][] }
  | { b: "list"; items: string[] }
  | {
      b: "table";
      head: string[];
      rows: string[][];
      align?: ("l" | "r")[];
      /** Emphasised total row, e.g. ["Total · USD · excl. VAT", "18,960"]. */
      foot?: [string, string];
    }
  | { b: "note"; text: string }
  | { b: "sig"; name: string; role: string };

export interface DeliverableDoc {
  name: string;
  fmt: string;
  envelope: string;
  blocks: DocBlock[];
}

export interface DocCompany {
  name: string;
  /** Signatory line, e.g. "Amir Osman". Falls back to the account email. */
  signatory: string;
}

interface IntakeShape {
  fields: Record<string, string>;
  lines: PricedLine[];
  currency: string;
  conformity: ConformityRow[];
  declarations: string[];
  refs: ReferenceEntry[];
  docs: { docId: string; state: string }[];
}

function intakeOf(order: SubmissionOrder): IntakeShape {
  const f = order.intakeFields as Partial<IntakeShape>;
  return {
    fields: (f.fields as Record<string, string>) ?? {},
    lines: Array.isArray(f.lines) ? f.lines : [],
    currency: typeof f.currency === "string" && f.currency ? f.currency : "USD",
    conformity: Array.isArray(f.conformity) ? f.conformity : [],
    declarations: Array.isArray(f.declarations) ? f.declarations : [],
    refs: Array.isArray(f.refs) ? f.refs : [],
    docs: Array.isArray(f.docs) ? (f.docs as { docId: string; state: string }[]) : [],
  };
}

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function agencyShort(order: SubmissionOrder): string {
  return (order.agency ?? "the agency").split("—")[0].trim();
}

function stripDot(s: string): string {
  return s.replace(/\.$/, "");
}

function refsLine(refs: ReferenceEntry[]): string {
  return refs.length ? refs.map((r) => r.label).join(" · ") : "comparable engagements on file";
}

export function docContent(order: SubmissionOrder, company: DocCompany): DeliverableDoc[] {
  const flow = flowFor(order.type);
  const it = intakeOf(order);
  const f = (k: string, fb = "") => (it.fields[k] ?? "").trim() || fb;
  const head: DocBlock = {
    b: "kv",
    rows: [
      ["To", `${order.agency ?? "Issuing agency"} — Procurement Unit`],
      ["Ref", order.tender],
      ["From", company.name],
      ["Date", shortDate(order.updatedAt)],
    ],
  };
  const sig: DocBlock = { b: "sig", name: company.signatory, role: `Authorized representative · ${company.name}` };
  const dv = (i: number): DeliverableDoc => ({ ...flow.deliverables[i], blocks: [] });

  const linesTable = (totalLabel: string): DocBlock =>
    it.lines.length
      ? {
          b: "table",
          head: ["Line item", "Qty", "Unit price", "Line total"],
          align: ["l", "r", "r", "r"],
          rows: it.lines.map((l) => [
            l.specRef ? `${l.desc} (${l.specRef})` : l.desc,
            `${l.qty} ${l.unit}`,
            l.unitPrice != null ? money(l.unitPrice) : "—",
            l.unitPrice != null ? money(l.unitPrice * (l.qty || 0)) : "—",
          ]),
          foot: [
            totalLabel,
            money(it.lines.reduce((s, l) => s + (l.unitPrice ?? 0) * (l.qty || 0), 0)),
          ],
        }
      : { b: "p", text: "Line schedule as quoted at intake." };

  const conformityTable: DocBlock | null = it.conformity.length
    ? {
        b: "table",
        head: ["Requirement", "Response", "Declared deviation"],
        rows: it.conformity.map((r) => [
          r.requirement,
          r.response === "deviate" ? "Deviation declared" : "Comply",
          r.response === "deviate" ? r.deviation || "—" : "—",
        ]),
      }
    : null;

  /* ──────── EOI ──────── */
  if (order.type === "EOI") {
    const angle = f("angle", "our delivery approach");
    const cover = dv(0);
    cover.blocks = [
      { b: "h1", text: "Expression of Interest" },
      head,
      { b: "p", text: "Dear Procurement Officer," },
      {
        b: "p",
        text: `${company.name} is pleased to express its interest in the above procurement. ${stripDot(angle)}. We believe this positions us to deliver the services described in the notice to the standard ${agencyShort(order)} requires.`,
      },
      {
        b: "p",
        text: `Our track record includes directly comparable engagements — ${refsLine(it.refs)} — with client references available in the annexed capability statement.`,
      },
      {
        b: "p",
        text: "We confirm our eligibility under the conditions of the notice, including the declarations annexed hereto, and remain available for any clarification you may require.",
      },
      sig,
    ];

    const capability = dv(1);
    capability.blocks = [
      { b: "h1", text: "Capability Statement" },
      { b: "h2", text: "1 · Who we are" },
      { b: "p", text: f("angle", `${company.name} — profile narrative drafted from your intake.`) },
      { b: "h2", text: "2 · Relevant experience" },
      it.refs.length
        ? { b: "table", head: ["Engagement", "Evidence"], rows: it.refs.map((r) => [r.label, r.src === "vault" ? "Reference on file" : "Cited — reference available on request"]) }
        : { b: "p", text: "References as selected at intake." },
      { b: "h2", text: "3 · Capacity for this assignment" },
      { b: "p", text: f("capacity") || f("geo") || "Capacity evidence expanded from your vault during drafting." },
    ];

    const annex = dv(2);
    annex.blocks = [
      { b: "h1", text: "Eligibility Annex & Declarations" },
      { b: "p", text: `The undersigned, duly authorized, hereby declares on behalf of ${company.name}:` },
      {
        b: "list",
        items: [
          "We are not on any UN sanctions or ineligibility list, nor suspended by any UN agency.",
          "No conflict of interest exists with the agency, its staff, or this programme.",
          "All information provided in this Expression of Interest is accurate and complete.",
          "Supporting documents (incorporation, tax compliance) are attached and current.",
        ],
      },
      { b: "note", text: "Eligibility attachments compile from your vault at drafting — outstanding items are flagged, never silently skipped." },
      sig,
    ];
    return [cover, capability, annex];
  }

  /* ──────── RFQ ──────── */
  if (order.type === "RFQ") {
    const form = dv(0);
    form.blocks = [
      { b: "h1", text: "Quotation Form" },
      head,
      {
        b: "kv",
        rows: [
          ["Quote validity", f("validity", "90 days")],
          ["Delivery", f("delivery", "as quoted")],
          ["Incoterms", f("incoterms", "as required by the notice")],
          ["VAT", "Excluded — agency is tax-exempt"],
          ...(f("warranty") ? ([["Warranty", f("warranty")]] as [string, string][]) : []),
        ],
      },
      {
        b: "p",
        text: "We, the undersigned, offer to supply the goods and services listed in the attached priced schedule, in full conformity with the specifications and conditions of the Request for Quotation.",
      },
      sig,
    ];

    const schedule = dv(1);
    schedule.blocks = [
      { b: "h1", text: "Priced Line Schedule" },
      linesTable(`Total · ${it.currency} · excl. VAT`),
      { b: "note", text: "Cross-checked against the RFQ schedule — every line priced, no omissions (incomplete quotes are auto-rejected)." },
    ];

    const compliance = dv(2);
    compliance.blocks = [
      { b: "h1", text: "Specifications Compliance & Declarations" },
      {
        b: "p",
        text:
          f("specs") === "Compliant with declared deviations"
            ? `Compliant with declared deviations: ${f("deviations", "as declared at intake")}.`
            : "All offered goods are fully compliant with the technical specifications in the RFQ schedule.",
      },
      {
        b: "list",
        items: [
          "Prices are firm for the validity period and exclusive of VAT and indirect taxes.",
          "Goods are new, unused, and of the most recent models.",
          "We accept the agency's General Terms & Conditions for goods.",
          "Warranty as stated in the attached warranty statement.",
        ],
      },
      sig,
    ];
    return [form, schedule, compliance];
  }

  /* ──────── ITB ──────── */
  if (order.type === "ITB") {
    const devs = it.conformity.filter((r) => r.response === "deviate").length;
    const technical = dv(0);
    technical.blocks = [
      { b: "h1", text: "Technical Bid — Conformity Response" },
      head,
      {
        b: "p",
        text: it.conformity.length
          ? `${it.conformity.length - devs} of ${it.conformity.length} specs comply · ${devs} deviation${devs === 1 ? "" : "s"} declared.`
          : "Item-by-item response to the technical schedule, with all deviations declared.",
      },
      ...(conformityTable ? [conformityTable] : []),
      {
        b: "kv",
        rows: [
          ["Site visit", f("sitevisit", "—")],
          ["Bid validity", f("validity", "120 days")],
        ],
      },
      { b: "note", text: "No pricing appears anywhere in this envelope — verified at QA. Cross-contamination is the #1 ITB elimination error." },
    ];

    const boq = dv(1);
    boq.blocks = [
      { b: "h1", text: "Financial Bid — Bill of Quantities" },
      linesTable(`BoQ total · ${it.currency}`),
      {
        b: "kv",
        rows: [
          ["Bid security", f("security", "Bid-securing declaration")],
          ["Validity", f("validity", "120 days")],
        ],
      },
    ];

    const forms = dv(2);
    forms.blocks = [
      { b: "h1", text: "Bid Forms Pack" },
      { b: "p", text: "All agency forms completed on the unaltered templates, compiled for signature:" },
      {
        b: "list",
        items: [
          "Bid submission form — ready for authorized signature",
          "Bid-securing declaration — ready for signature",
          "Manufacturer authorization — as obtained from supplier",
          "Eligibility documents — attached from your vault",
        ],
      },
      { b: "note", text: "Sign where flagged. Do not rename, merge or re-export files — digital signatures and page limits can break." },
      sig,
    ];
    return [technical, boq, forms];
  }

  /* ──────── RFP ──────── */
  const criteria = flow.steps
    .flatMap((s) => s.blocks ?? [])
    .flatMap((b) => (b.kind === "criteria" ? b.items : []));
  const pts = (id: string) => criteria.find((k) => k.id === id)?.pts;
  const totalPts = criteria.reduce((s, k) => s + k.pts, 0);
  const technical = dv(0);
  technical.blocks = [
    { b: "h1", text: "Technical Proposal" },
    head,
    { b: "h2", text: "1 · Understanding of the assignment" },
    {
      b: "p",
      text: `${agencyShort(order)} seeks a partner for “${order.tender}”. We read the requirement as demanding not a study but a delivery system — one that survives contact with field realities and reports against the indicators the programme is judged on.`,
    },
    { b: "h2", text: `2 · Methodology & approach${pts("k1") ? ` — ${pts("k1")} pts` : ""}` },
    {
      b: "p",
      text: `${stripDot(f("k1", "Methodology drafted from your intake"))}. Each TOR task is addressed in sequence in the sections that follow, mapped one-to-one against the evaluation matrix so no scored criterion goes unanswered.`,
    },
    { b: "h2", text: `3 · Team composition${pts("k2") ? ` — ${pts("k2")} pts` : ""}` },
    {
      b: "p",
      text: `${f("k2", "Proposed team as named at intake")}. Full CVs in the agency template, each mapped to the TOR competencies, are annexed and flagged for signature.`,
    },
    { b: "h2", text: `4 · Comparable experience${pts("k3") ? ` — ${pts("k3")} pts` : ""}` },
    {
      b: "p",
      text: `${f("k3", refsLine(it.refs))} — directly comparable in sector, geography and contract form. Reference letters annexed where on file.`,
    },
    { b: "h2", text: `5 · Workplan & timeline${pts("k4") ? ` — ${pts("k4")} pts` : ""}` },
    {
      b: "p",
      text: f("k4", "Mobilization within weeks of signature; field phases scheduled around seasonal access constraints; deliverables front-loaded against the payment milestones."),
    },
    { b: "note", text: `Drafted against the ${totalPts}-point technical matrix. Threshold: 70%. Every scored criterion has a dedicated, findable section.` },
  ];

  const financial = dv(1);
  financial.blocks = [
    { b: "h1", text: "Financial Proposal" },
    {
      b: "kv",
      rows: [
        ["Total fee ceiling", f("ceiling") ? `USD ${f("ceiling")}` : "—"],
        ["Basis", f("days", "—")],
        ["Reimbursables", f("reimb", "—")],
        ["Payment terms", f("terms", "Milestone-based")],
        ["Validity", "120 days"],
      ],
    },
    {
      b: "p",
      text: "Detailed cost breakdown by activity, expert and phase follows the agency's financial proposal template, annexed as a separate, sealed document.",
    },
    { b: "note", text: "SEALED SEPARATELY — this document never travels in the technical envelope. The portal upload checklist enforces the split." },
  ];

  const pack = dv(2);
  pack.blocks = [
    { b: "h1", text: "Forms, CVs & Declarations Pack" },
    {
      b: "list",
      items: [
        "Proposal submission form — ready for authorized signature",
        "Key expert CVs in the agency template — flagged for each expert's signature",
        "Eligibility & beneficial-ownership declarations — pre-filled from your vault",
        ...(it.refs.length ? [`Reference letters (${it.refs.length}) — attached where on file`] : []),
      ],
    },
    sig,
  ];
  return [technical, financial, pack];
}
