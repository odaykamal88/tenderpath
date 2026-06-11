/* Required-document catalog with resolution strategies. (Prototype:
 * sub-data.jsx → TPSUB.DOCS.)
 *
 * Three gen modes — and we NEVER fabricate third-party paper:
 *   draft   — we author it (capability statements, CVs, policies, declarations);
 *             always flagged "for signature" in the final pack.
 *   request — official paper only a third party can issue (audited financials,
 *             manufacturer authorizations, bank/client references). We draft the
 *             request letter, send, chase, attach on arrival. Does NOT block
 *             payment — the order carries the blocker as `requested`.
 *   guided  — registrations only the user can complete (UNGM). Navigator path.
 * Plus universal: Upload (→ attached) and Acknowledge (→ proceed at risk,
 * flagged in the draft). */

export type DocGenMode = "draft" | "request" | "guided";

export interface DocSpec {
  id: string;
  label: string;
  /** Why the agency asks for it — one line, shown under the row. */
  why: string;
  sev: "high" | "medium";
  gen: {
    mode: DocGenMode;
    /** For mode "request": who issues the paper. */
    requestTarget?: "auditor" | "supplier" | "bank" | "client";
    /** CTA label, e.g. "Draft it for me" / "Draft the auditor request". */
    cta: string;
  } | null;
  /** Vault matching: document `type` values that can satisfy this row. */
  vaultTypes: string[];
  /** Vault matching fallback: name pattern. */
  nameHint?: RegExp;
}

export const DOCS_CATALOG: Record<string, DocSpec> = {
  capability_statement: {
    id: "capability_statement",
    label: "Capability statement",
    why: "The shortlisting evidence — what you deliver and the proof you can.",
    sev: "high",
    gen: { mode: "draft", cta: "Draft it for me" },
    vaultTypes: ["past_performance", "other"],
    nameHint: /capabilit|company profile/i,
  },
  company_registration: {
    id: "company_registration",
    label: "Company registration certificate",
    why: "Proves legal existence — a standard eligibility gate.",
    sev: "high",
    gen: null, // the company's own official paper: upload or acknowledge
    vaultTypes: ["certification"],
    nameHint: /regist|incorporat|licen[cs]e/i,
  },
  audited_financials: {
    id: "audited_financials",
    label: "Audited financial statements (last 2–3 years)",
    why: "Financial-standing check on larger contracts.",
    sev: "high",
    gen: { mode: "request", requestTarget: "auditor", cta: "Draft the auditor request" },
    vaultTypes: ["financial"],
    nameHint: /audit|financial statement/i,
  },
  manufacturer_authorization: {
    id: "manufacturer_authorization",
    label: "Manufacturer's authorization",
    why: "Required when quoting another maker's goods — acknowledge if you are the manufacturer.",
    sev: "medium",
    gen: { mode: "request", requestTarget: "supplier", cta: "Draft the manufacturer request" },
    vaultTypes: ["certification", "other"],
    nameHint: /manufactur|authori[sz]ation/i,
  },
  bid_securing_declaration: {
    id: "bid_securing_declaration",
    label: "Bid-securing declaration",
    why: "Replaces a bid bond on most UN ITBs — must be signed exactly as issued.",
    sev: "high",
    gen: { mode: "draft", cta: "Prepare it for signature" },
    vaultTypes: [],
  },
  cv_key_personnel: {
    id: "cv_key_personnel",
    label: "CVs — key personnel",
    why: "Scored directly; each named expert needs a current CV in the pack.",
    sev: "high",
    gen: { mode: "draft", cta: "Build CVs from my inputs" },
    vaultTypes: ["cv"],
  },
  client_references: {
    id: "client_references",
    label: "Client reference letters",
    why: "Verifiable past performance — evaluators do call.",
    sev: "medium",
    gen: { mode: "request", requestTarget: "client", cta: "Draft the reference request" },
    vaultTypes: ["past_performance"],
    nameHint: /reference|recommendation|completion/i,
  },
  bank_reference: {
    id: "bank_reference",
    label: "Bank reference letter",
    why: "Financial-standing evidence some agencies accept in lieu of audits.",
    sev: "medium",
    gen: { mode: "request", requestTarget: "bank", cta: "Draft the bank request" },
    vaultTypes: ["financial"],
    nameHint: /bank/i,
  },
  ungm_registration: {
    id: "ungm_registration",
    label: "UNGM registration",
    why: "Many UN agencies receive offers only through UNGM — Basic level is the universal gate.",
    sev: "high",
    gen: { mode: "guided", cta: "Fix with the Navigator" },
    vaultTypes: [],
  },
};

export function docSpec(id: string): DocSpec | null {
  return DOCS_CATALOG[id] ?? null;
}
