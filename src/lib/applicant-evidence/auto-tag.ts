/**
 * Auto-tagger — Sprint 10.
 *
 * Pure function: given a filename, mime hint, and (optionally) extracted
 * text, return a refined evidence type and a set of capability tags.
 * Tags are short, lowercase, kebab-or-snake identifiers; the proposal
 * generator's findEvidenceFor() query matches against them.
 *
 * Keyword-based v1. Deliberately conservative — false negatives are
 * better than false positives (an uncategorised doc is harmless; a
 * mistagged doc could upgrade a "claimed" requirement to "evidenced"
 * when it shouldn't).
 *
 * Users can override the auto-assigned type and tags from the dashboard.
 */
import { EVIDENCE_TYPES, type EvidenceType } from "./types";

interface TagRule {
  /** A pattern that, if matched in filename/text, applies the tag and (optionally) the type. */
  pattern: RegExp;
  /** The capability tag to apply. */
  tag: string;
  /** If set, the rule also nudges the evidence type. Multiple rules can suggest a type; the last suggestion wins. */
  suggestsType?: EvidenceType;
}

const RULES: TagRule[] = [
  // CV-class
  { pattern: /\b(cv|curriculum vitae|résumé|resume)\b/i, tag: "cv", suggestsType: "cv" },
  { pattern: /\b(project manager|team leader|chief of party|key expert|m&e specialist)\b/i, tag: "key-personnel" },

  // Audit + financial
  { pattern: /\b(kpmg|deloitte|pwc|ey\b|ernst & young|bdo|grant thornton|mazars)\b/i, tag: "external-audit" },
  { pattern: /\baudit(ed|or'?s)?\b.*\b(report|opinion|statement)/i, tag: "external-audit", suggestsType: "audit" },
  { pattern: /\b(audited (financial|annual) (statement|report)s?)\b/i, tag: "audited-financials", suggestsType: "audit" },
  { pattern: /\b(annual report|financial statement|balance sheet|income statement|profit (and|&) loss)\b/i, tag: "financials", suggestsType: "financial" },
  { pattern: /\b(turnover|revenue|operating budget)\b.*\b(eur|usd|\$|€)\b/i, tag: "financial-capacity" },
  { pattern: /\b(co-?financing|co-?funding|matching funds?)\b/i, tag: "co-financing" },

  // Registrations / IDs
  { pattern: /\bPADOR\b/i, tag: "pador", suggestsType: "registration" },
  { pattern: /\bDUNS\b|\bD-U-N-S\b/i, tag: "duns", suggestsType: "registration" },
  { pattern: /\bUEI\b/i, tag: "uei", suggestsType: "registration" },
  { pattern: /\bNCAGE\b|\bCAGE code\b/i, tag: "ncage", suggestsType: "registration" },
  { pattern: /\bUNGM\b|\bUN Global Marketplace\b/i, tag: "ungm", suggestsType: "registration" },
  { pattern: /\bEuropeAid ID\b|\bPIC\s*\d/i, tag: "europeaid-id", suggestsType: "registration" },

  // Quality certs
  { pattern: /\bISO\s*9001\b/i, tag: "iso-9001", suggestsType: "certificate" },
  { pattern: /\bISO\s*14001\b/i, tag: "iso-14001", suggestsType: "certificate" },
  { pattern: /\bISO\s*27001\b/i, tag: "iso-27001", suggestsType: "certificate" },
  { pattern: /\bISO\s*45001\b/i, tag: "iso-45001", suggestsType: "certificate" },
  { pattern: /\bSA\s*8000\b/i, tag: "sa-8000", suggestsType: "certificate" },
  { pattern: /\bGDPR\b/i, tag: "gdpr" },

  // Past performance signals
  { pattern: /\b(past performance|track record|references?|case studies?)\b/i, tag: "past-performance", suggestsType: "past_performance" },
  { pattern: /\b(reference letter|recommendation letter|certificate of (good performance|satisfactory))\b/i, tag: "reference-letter", suggestsType: "past_performance" },
  { pattern: /\b(award notice|contract award|signed contract)\b/i, tag: "contract-award", suggestsType: "past_performance" },

  // Partnership / consortium
  { pattern: /\b(consortium agreement|joint venture|jv agreement|partnership agreement|moa|mou|memorandum of (understanding|agreement))\b/i, tag: "partnership", suggestsType: "partner_letter" },
  { pattern: /\b(letter of intent|loi\b)/i, tag: "letter-of-intent", suggestsType: "partner_letter" },
  { pattern: /\b(co-applicant|co-?lead|affiliated entit)/i, tag: "co-applicant" },

  // Capability statement
  { pattern: /\b(capability statement|company profile|corporate brochure|organisation(al)? profile)\b/i, tag: "capability-statement", suggestsType: "capability_statement" },

  // Tender / RFP context (when the applicant uploads the call itself)
  { pattern: /\b(call for proposals?|terms of reference|tor\b|request for proposals?|rfp\b|invitation to bid|itb\b)\b/i, tag: "tender-call", suggestsType: "tor_rfp" },
  { pattern: /\b(europeaid|prag|edf|interreg|horizon europe|cef\b)\b/i, tag: "eu-funded" },
  { pattern: /\b(unhcr|undp|unicef|wfp|unops|fao|who|iom|ohchr|ungm)\b/i, tag: "un-funded" },

  // Safeguarding / SEA-H
  { pattern: /\b(safeguarding|sea-?h|sexual exploitation|child protection)\b/i, tag: "safeguarding" },
  { pattern: /\b(prevention of sexual exploitation|psea)\b/i, tag: "psea" },

  // Legal / corporate
  { pattern: /\b(statutes|articles of (association|incorporation)|certificate of (incorporation|registration))\b/i, tag: "statutes", suggestsType: "registration" },
  { pattern: /\b(declaration of honour|exclusion criteria|conflict of interest declaration)\b/i, tag: "declaration", suggestsType: "registration" },

  // Sector-ish (used by capability_match)
  { pattern: /\b(journalism|journalist|press freedom|media (freedom|development|independence)|editorial)\b/i, tag: "media-development" },
  { pattern: /\b(gender equality|gender mainstreaming|women['']s empowerment)\b/i, tag: "gender" },
  { pattern: /\b(monitoring (and|&) evaluation|m&e|mel framework|logical framework|logframe)\b/i, tag: "monitoring-evaluation" },
  { pattern: /\b(risk register|risk management|risk matrix)\b/i, tag: "risk-management" },
];

export interface AutoTagInput {
  fileName: string;
  textExcerpt?: string | null;
  /** User-supplied type, if any. The auto-tagger never overrides this. */
  declaredType?: string | null;
}

export interface AutoTagResult {
  type: EvidenceType | string;
  tags: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isKnownType(value: string | null | undefined): value is EvidenceType {
  return typeof value === "string" && (EVIDENCE_TYPES as readonly string[]).includes(value);
}

/**
 * Apply the rules. The text payload is filename + first 8KB of extracted
 * text (enough for headers, exec summary, signature blocks — where the
 * tag-revealing keywords live without paying for full-doc scan).
 */
export function autoTag(input: AutoTagInput): AutoTagResult {
  const payload = `${input.fileName ?? ""}\n${(input.textExcerpt ?? "").slice(0, 8000)}`;
  const tags: string[] = [];
  let suggestedType: EvidenceType | null = null;

  for (const rule of RULES) {
    if (rule.pattern.test(payload)) {
      tags.push(rule.tag);
      if (rule.suggestsType) suggestedType = rule.suggestsType;
    }
  }

  // Respect a user-declared type when known; otherwise prefer the
  // auto-suggested type; otherwise fall back to "other".
  const declared = (input.declaredType ?? "").trim().toLowerCase();
  const type: EvidenceType | string =
    isKnownType(declared) ? declared
    : suggestedType ?? (declared || "other");

  return { type, tags: unique(tags) };
}
