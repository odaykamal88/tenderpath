/* Required-document catalog with resolution strategies — faithful port of the
 * prototype's TPSUB.DOCS (sub-data.jsx). Demo vault states are replaced by
 * real vault matching (vaultTypes + nameHint); demo ask prefills are dropped.
 *
 * gen = what TenderPath does when a document is missing:
 *   mode "draft"   — we write the document itself from your vault + this tender
 *   mode "request" — official third-party paper we can't fabricate; we draft
 *                    the formal request letter, send it, and chase until it lands
 *   mode "guided"  — a registration only you can complete; Navigator walks you
 * Plus universal: Upload (→ resolved) and Acknowledge (→ proceed at risk). */

export type DocGenMode = "draft" | "request" | "guided";

export interface DocGen {
  mode: DocGenMode;
  cta?: string;
  blurb?: string;
  /** Input shown in the gen panel — its value travels to ops on the order. */
  ask?: { label: string; long?: boolean };
  /** Status line shown once drafted/requested. */
  result?: string;
}

export interface DocSpec {
  id: string;
  label: string;
  gen: DocGen | null;
  /** Vault matching: document `type` values that can satisfy this row. */
  vaultTypes: string[];
  nameHint?: RegExp;
}

export const DOCS_CATALOG: Record<string, DocSpec> = {
  inc: {
    id: "inc",
    label: "Certificate of incorporation",
    gen: null, // the company's own official paper: upload or acknowledge
    vaultTypes: ["certification"],
    nameHint: /incorporat/i,
  },
  reg: {
    id: "reg",
    label: "Company registration certificate",
    gen: null,
    vaultTypes: ["certification"],
    nameHint: /regist|licen[cs]e/i,
  },
  tax: {
    id: "tax",
    label: "Tax compliance certificate",
    gen: null,
    vaultTypes: ["certification"],
    nameHint: /tax/i,
  },
  bank: {
    id: "bank",
    label: "Bank reference letter",
    gen: {
      mode: "request",
      cta: "Draft the bank request",
      blurb: "We draft the standard reference-letter request to your bank, on the agency's wording.",
      ask: { label: "Send to" },
      result: "Request sent to your bank — typically 2–3 working days. We attach it on arrival.",
    },
    vaultTypes: ["financial"],
    nameHint: /bank/i,
  },
  cap: {
    id: "cap",
    label: "Capability statement",
    gen: {
      mode: "draft",
      cta: "Draft it for me",
      blurb: "Written from your profile, vault references and this tender's focus — 2 pages, agency-ready.",
      ask: { label: "Anything to emphasise?" },
      result: "Capability statement drafted — attached for your review in the final pack.",
    },
    vaultTypes: ["past_performance", "other"],
    nameHint: /capabilit|company profile/i,
  },
  coc: {
    id: "coc",
    label: "Code of Conduct / anti-corruption",
    gen: {
      mode: "draft",
      cta: "Generate the policy",
      blurb: "Standard UN-supplier policy adapted to your company — ready for director signature.",
      ask: { label: "Signatory" },
      result: "Policy drafted — flagged for signature in the final pack.",
    },
    vaultTypes: ["certification", "other"],
    nameHint: /conduct|corruption|ethic/i,
  },
  hs: {
    id: "hs",
    label: "Health & Safety policy",
    gen: {
      mode: "draft",
      cta: "Generate the policy",
      blurb: "Sector-appropriate H&S policy in the structure agencies expect — ready for signature.",
      ask: { label: "Signatory" },
      result: "Policy drafted — flagged for signature in the final pack.",
    },
    vaultTypes: ["certification", "other"],
    nameHint: /health|safety|hse/i,
  },
  dp: {
    id: "dp",
    label: "Data protection policy",
    gen: {
      mode: "draft",
      cta: "Generate the policy",
      blurb: "Data-protection policy aligned to the laws you operate under, adapted to your operations — ready for signature.",
      ask: { label: "Signatory" },
      result: "Policy drafted — flagged for signature in the final pack.",
    },
    vaultTypes: ["certification", "other"],
    nameHint: /data protection|privacy|gdpr/i,
  },
  ungm: {
    id: "ungm",
    label: "UNGM registration",
    gen: { mode: "guided" },
    vaultTypes: [],
  },
  fin: {
    id: "fin",
    label: "Audited financials (last 3 years)",
    gen: {
      mode: "request",
      cta: "Draft the auditor request",
      blurb:
        "Audited statements can only come from your auditor — we can't fabricate them. We draft the formal request (ISA format, all three years), send it, and chase until they land.",
      ask: { label: "Your auditor" },
      result:
        "Request sent to your auditor — ETA 3–5 working days. We attach the statements the moment they arrive and flag the interim status in the draft.",
    },
    vaultTypes: ["financial"],
    nameHint: /audit|financial statement/i,
  },
  manu: {
    id: "manu",
    label: "Manufacturer authorization letter",
    gen: {
      mode: "request",
      cta: "Draft the supplier letter",
      blurb:
        "Must come from the manufacturer — we draft it on the agency's required template (naming this tender, your company, and territory) so your supplier only has to sign and stamp.",
      ask: { label: "Supplier contact" },
      result: "Authorization letter sent to your supplier for signature — we chase and attach on arrival.",
    },
    vaultTypes: ["certification", "other"],
    nameHint: /manufactur|authori[sz]ation/i,
  },
  cat: {
    id: "cat",
    label: "Product catalogue / technical literature",
    gen: {
      mode: "request",
      cta: "Request from supplier",
      blurb:
        "Spec sheets must be the manufacturer's own. We request exactly the models in your line schedule — nothing extra for evaluators to trip on.",
      ask: { label: "Supplier contact" },
      result: "Literature requested for the exact quoted models — we attach and cross-reference each line on arrival.",
    },
    vaultTypes: ["other"],
    nameHint: /catalog|spec sheet|datasheet|literature/i,
  },
  warr: {
    id: "warr",
    label: "Warranty statement (on letterhead)",
    gen: {
      mode: "draft",
      cta: "Draft it for me",
      blurb:
        "Written to match the warranty you quoted, on your letterhead, in the agency's required wording — ready for signature.",
      ask: { label: "Warranty offered" },
      result: "Warranty statement drafted to match your quote — flagged for signature in the final pack.",
    },
    vaultTypes: ["other"],
    nameHint: /warrant/i,
  },
  cv3: {
    id: "cv3",
    label: "Third key-expert CV",
    gen: {
      mode: "draft",
      cta: "Build the CV for me",
      blurb:
        "Paste their background in any shape — LinkedIn, an old CV, bullet points — and we restructure it into the agency's CV template, mapped to the TOR competencies. Or leave it blank and we nominate from our vetted associate pool.",
      ask: { label: "Expert background (or leave blank to nominate)", long: true },
      result: "CV drafted in the agency template, mapped to the TOR — flagged for the expert's signature.",
    },
    vaultTypes: ["cv"],
  },
};

export function docSpec(id: string): DocSpec | null {
  return DOCS_CATALOG[id] ?? null;
}
