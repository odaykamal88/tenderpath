/* docContent(order) — builds each deliverable as a readable document from the
 * order's OWN intake (prototype: sub-reader.jsx). The reader renders these
 * blocks in-app; the PDF export renders the same blocks, so what the client
 * approves is what they download. Nothing here is invented: every figure and
 * claim traces to a wizard input; where ops drafting will expand a section,
 * the block says so explicitly.
 *
 * Block model (SPEC §4): h1 · h2 · p · kv · list · table · note · sig.
 * Signature points are explicit — nothing leaves unsigned silently. */

import type {
  ConformityRow,
  PricedLine,
  ReferenceEntry,
  SubmissionOrder,
} from "./types";
import { flowFor, type FlowDeclaration } from "./flows";
import { docSpec } from "./docs-catalog";

export type DocBlock =
  | { b: "h1"; text: string }
  | { b: "h2"; text: string }
  | { b: "p"; text: string }
  | { b: "kv"; rows: [string, string][] }
  | { b: "list"; items: string[] }
  | { b: "table"; head: string[]; rows: string[][]; align?: ("l" | "r")[] }
  | { b: "note"; text: string }
  | { b: "sig"; label: string };

export interface DeliverableDoc {
  /** Deliverable name (tab label). */
  name: string;
  fmt: string;
  envelope: string;
  blocks: DocBlock[];
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

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function header(order: SubmissionOrder, company: string): DocBlock {
  return {
    b: "kv",
    rows: [
      ["To", `${order.agency ?? order.source ?? "Issuing agency"} — Procurement Unit`],
      ["Ref", order.tender],
      ["From", company],
      ["Date", fmtDate(order.updatedAt)],
    ],
  };
}

function declarationLines(order: SubmissionOrder, affirmed: string[]): string[] {
  const flow = flowFor(order.type);
  const items: FlowDeclaration[] = flow.steps
    .flatMap((s) => s.blocks)
    .flatMap((b) => (b.kind === "declarations" ? b.items : []));
  return items.map((d) => `${affirmed.includes(d.id) ? "☑" : "☐"}  ${d.label}`);
}

function refsTable(refs: ReferenceEntry[]): DocBlock | null {
  if (!refs.length) return null;
  return {
    b: "table",
    head: ["#", "Reference"],
    rows: refs.map((r, i) => [String(i + 1), r.label]),
  };
}

function linesTable(lines: PricedLine[], currency: string, totalLabel: string): DocBlock[] {
  const total = lines.reduce((s, l) => s + (l.unitPrice ?? 0) * (l.qty || 0), 0);
  return [
    {
      b: "table",
      head: ["Item", "Qty", "Unit", `Unit price (${currency})`, "Amount"],
      align: ["l", "r", "l", "r", "r"],
      rows: lines.map((l) => [
        l.specRef ? `${l.desc}\n${l.specRef}` : l.desc,
        String(l.qty),
        l.unit,
        l.unitPrice != null ? money(l.unitPrice) : "—",
        l.unitPrice != null ? money(l.unitPrice * (l.qty || 0)) : "—",
      ]),
    },
    { b: "kv", rows: [[`${totalLabel} · ${currency}`, money(total)]] },
  ];
}

function conformitySummary(rows: ConformityRow[]): string {
  const comply = rows.filter((r) => r.response === "comply").length;
  const devs = rows.filter((r) => r.response === "deviate");
  const names = devs
    .map((d) => d.requirement.split(/[,—–(]/)[0]?.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
  return `${comply} of ${rows.length} specs comply · ${devs.length} deviation${devs.length === 1 ? "" : "s"} declared${names.length ? ` (${names.join(", ")})` : ""}`;
}

function conformityTable(rows: ConformityRow[]): DocBlock {
  return {
    b: "table",
    head: ["Requirement", "Response", "Declared deviation"],
    rows: rows.map((r) => [
      r.requirement,
      r.response === "comply" ? "Comply" : r.response === "deviate" ? "Deviation declared" : "—",
      r.response === "deviate" ? (r.deviation ?? "—") : "—",
    ]),
  };
}

const DRAFT_EXPANSION_NOTE =
  "Drafting expands this section from your intake — structure and figures stay exactly as you entered them.";

/** Builds the full document set for an order. `company` = the vendor's name. */
export function docContent(order: SubmissionOrder, company: string): DeliverableDoc[] {
  const flow = flowFor(order.type);
  const it = intakeOf(order);
  const docs: DeliverableDoc[] = [];

  const docStateLine = (id: string): string => {
    const state = it.docs.find((d) => d.docId === id)?.state ?? "missing";
    const spec = docSpec(id);
    const label = spec?.label ?? id;
    switch (state) {
      case "attached": return `${label} — attached`;
      case "drafted": return `${label} — drafted by TenderPath · for signature`;
      case "requested": return `${label} — requested from the issuer · attached on arrival`;
      case "acknowledged": return `${label} — not included · proceeding at risk (flagged)`;
      default: return `${label} — outstanding`;
    }
  };

  if (order.type === "EOI") {
    const angle = it.fields.capability_angle ?? "";
    const presence = it.fields.geographic_presence ?? "";
    const years = it.fields.years_operating ?? "";
    docs.push({
      ...flow.deliverables[0],
      blocks: [
        { b: "h1", text: "Expression of Interest — Cover Letter" },
        header(order, company),
        { b: "p", text: `We write to express our interest in “${order.tender}”${order.agency ? ` issued by ${order.agency}` : ""}. ${company} is ${years ? `a firm of ${years.replace(/^~?\s*/, "")}` : "an established supplier"}${presence ? ` operating across ${presence}` : ""}.` },
        ...(angle ? [{ b: "p", text: angle } as DocBlock] : []),
        { b: "p", text: "Our capability statement and eligibility annex accompany this letter. We confirm our availability for any clarification the evaluation panel may require." },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
    docs.push({
      ...flow.deliverables[1],
      blocks: [
        { b: "h1", text: "Capability Statement" },
        {
          b: "kv",
          rows: [
            ["Company", company],
            ...(presence ? [["Geographic presence", presence] as [string, string]] : []),
            ...(years ? [["Operating", years] as [string, string]] : []),
          ],
        },
        { b: "h2", text: "What we deliver" },
        { b: "p", text: angle || "— from your capability angle input —" },
        { b: "h2", text: "Track record" },
        ...(refsTable(it.refs) ? [refsTable(it.refs)!] : [{ b: "p", text: "References to be confirmed." } as DocBlock]),
        { b: "note", text: DRAFT_EXPANSION_NOTE },
      ],
    });
    docs.push({
      ...flow.deliverables[2],
      blocks: [
        { b: "h1", text: "Eligibility Annex & Declarations" },
        header(order, company),
        { b: "h2", text: "Declarations" },
        { b: "list", items: declarationLines(order, it.declarations) },
        { b: "h2", text: "Supporting documents" },
        { b: "list", items: it.docs.map((d) => docStateLine(d.docId)) },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
  }

  if (order.type === "RFQ") {
    const validity = it.fields.quote_validity ?? "—";
    const lead = it.fields.delivery_lead_time ?? "—";
    const incoterms = it.fields.incoterms ?? "—";
    docs.push({
      ...flow.deliverables[0],
      blocks: [
        { b: "h1", text: "Quotation Form" },
        header(order, company),
        {
          b: "kv",
          rows: [
            ["Quote validity", validity],
            ["Delivery lead time", lead],
            ["Incoterms", incoterms],
            ["Currency", it.currency],
          ],
        },
        { b: "p", text: "We offer to supply the items in the attached priced line schedule, in full conformity with the specifications except where a deviation is expressly declared." },
        { b: "note", text: "Prices exclude VAT and sales tax — UN agencies are tax-exempt." },
        { b: "sig", label: "Authorized signature — quotation form" },
      ],
    });
    docs.push({
      ...flow.deliverables[1],
      blocks: [
        { b: "h1", text: "Priced Line Schedule" },
        ...linesTable(it.lines, it.currency, "Quotation total"),
        { b: "note", text: "Issued as XLSX + PDF in the final pack, named per the portal's convention." },
      ],
    });
    docs.push({
      ...flow.deliverables[2],
      blocks: [
        { b: "h1", text: "Specs Compliance Sheet & Declarations" },
        ...(it.conformity.length
          ? [{ b: "p", text: conformitySummary(it.conformity) } as DocBlock, conformityTable(it.conformity)]
          : [{ b: "p", text: "Specification responses are completed during drafting from the RFQ schedule." } as DocBlock]),
        { b: "h2", text: "Declarations" },
        { b: "list", items: declarationLines(order, it.declarations) },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
  }

  if (order.type === "ITB") {
    docs.push({
      ...flow.deliverables[0],
      blocks: [
        { b: "h1", text: "Technical Bid — Conformity Response" },
        header(order, company),
        ...(it.conformity.length
          ? [{ b: "p", text: conformitySummary(it.conformity) } as DocBlock, conformityTable(it.conformity)]
          : [{ b: "p", text: "Conformity responses are completed during drafting from the ITB specifications." } as DocBlock]),
        { b: "note", text: "No financial figures appear in this envelope — price found here gets the bid rejected unread." },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
    docs.push({
      ...flow.deliverables[1],
      blocks: [
        { b: "h1", text: "Financial Bid — Bill of Quantities" },
        ...linesTable(it.lines, it.currency, "BoQ total"),
        {
          b: "kv",
          rows: [
            ["Bid security", it.docs.find((d) => d.docId === "bid_securing_declaration" && (d.state === "drafted" || d.state === "attached")) ? "Bid-securing declaration (signed)" : "Bid-securing declaration — outstanding"],
            ["Validity", it.fields.bid_validity ?? "—"],
          ],
        },
        { b: "note", text: "Sealed separately from the technical bid — one ZIP per envelope, never merged." },
      ],
    });
    docs.push({
      ...flow.deliverables[2],
      blocks: [
        { b: "h1", text: "Bid Forms Pack" },
        header(order, company),
        { b: "h2", text: "Declarations" },
        { b: "list", items: declarationLines(order, it.declarations) },
        { b: "h2", text: "Forms & supporting documents" },
        { b: "list", items: it.docs.map((d) => docStateLine(d.docId)) },
        ...(it.fields.site_visit ? [{ b: "kv", rows: [["Site visit", it.fields.site_visit]] } as DocBlock] : []),
        { b: "sig", label: "Bid-securing declaration — sign here" },
        { b: "sig", label: "Bid submission form — sign here" },
      ],
    });
  }

  if (order.type === "RFP") {
    const methodology = it.fields.methodology ?? "";
    const workplan = it.fields.workplan ?? "";
    const team = it.fields.team ?? "";
    docs.push({
      ...flow.deliverables[0],
      blocks: [
        { b: "h1", text: "Technical Proposal" },
        header(order, company),
        { b: "h2", text: "Methodology & delivery approach" },
        { b: "p", text: methodology || "— from your delivery-approach input —" },
        { b: "h2", text: "Workplan" },
        { b: "p", text: workplan || "— from your workplan input —" },
        { b: "h2", text: "Team & key personnel" },
        { b: "p", text: team || "— from your team input —" },
        { b: "h2", text: "Comparable assignments" },
        ...(refsTable(it.refs) ? [refsTable(it.refs)!] : [{ b: "p", text: "References to be confirmed." } as DocBlock]),
        { b: "note", text: `${DRAFT_EXPANSION_NOTE} Methodology is mapped to each TOR task in sequence — evaluators score against the matrix, point by point.` },
        { b: "note", text: "No financial figures appear in this envelope." },
      ],
    });
    docs.push({
      ...flow.deliverables[1],
      blocks: [
        { b: "h1", text: "Financial Proposal" },
        header(order, company),
        {
          b: "kv",
          rows: [
            ["Total fee", it.fields.financial_total ?? "—"],
            ["Fee structure", it.fields.fee_structure ?? "—"],
            ...(it.fields.financial_notes ? [["Cost notes", it.fields.financial_notes] as [string, string]] : []),
          ],
        },
        { b: "note", text: "Sealed separately. This document never travels with the technical envelope." },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
    docs.push({
      ...flow.deliverables[2],
      blocks: [
        { b: "h1", text: "Forms, CVs & Declarations Pack" },
        header(order, company),
        { b: "h2", text: "Declarations" },
        { b: "list", items: declarationLines(order, it.declarations) },
        { b: "h2", text: "CVs & supporting documents" },
        { b: "list", items: it.docs.map((d) => docStateLine(d.docId)) },
        { b: "sig", label: "Each CV — expert signature confirming availability" },
        { b: "sig", label: "Authorized representative — sign here" },
      ],
    });
  }

  return docs;
}
