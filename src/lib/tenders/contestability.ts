/**
 * Contestability band — the "three procurement systems" signal.
 *
 * TenderPath models how procurement *behaves*, not just how it's written:
 *   - official   : the published tender + criteria (what the notice says)
 *   - practical  : budgets shift, scope evolves, some requirements get waived
 *   - political  : relationships, incumbents, donor preference, cancellations
 *
 * The contestability band surfaces the practical + political layers as a coarse
 * Open / Mixed / Constrained read. It is DELIBERATELY conservative and it is
 * ORTHOGONAL to the merit/fit score — never blend the two. We model this to
 * *inform*, never to facilitate anything improper.
 *
 * DURABLE HONESTY RULES (see AGENTS.md → First-Revenue Sprint):
 *   - Thin evidence defaults to **Mixed**. When the listing doesn't tell us how
 *     the practical/political game will play, we say so — we do not guess Open.
 *   - Never surface **Constrained** without a concrete, observable basis. A false
 *     "this is captured" read on a clean tender is the one error that destroys
 *     insider trust, so `basis` is REQUIRED (non-empty) for a Constrained band and
 *     the code downgrades to Mixed if a Constrained verdict has no basis.
 *   - Every signal reads ONLY the tender's own public fields (title, description,
 *     type, deadline, registration lead-time). No customer/competitor data.
 */

export type ContestabilityBand = "Open" | "Mixed" | "Constrained";

/** Coarse first-time registration risk, mirrored from submission-portals. */
export type RegistrationRisk = "none" | "tight" | "very-tight";

export interface ContestabilityInput {
  title: string | null | undefined;
  description?: string | null;
  /** tenders.opportunity_type (EOI / RFQ / ITB / RFP / …) — free text, may be null. */
  opportunityType?: string | null;
  /** How tight first-time supplier registration is vs the deadline (a practical gate). */
  registrationRisk?: RegistrationRisk;
}

export interface ContestabilitySignal {
  band: ContestabilityBand;
  /** Concrete, observable reasons for the band. REQUIRED (non-empty) when Constrained. */
  basis: string[];
  /** True when we lacked evidence to move off the conservative Mixed default. */
  thinEvidence: boolean;
  /** One honest, prospect-safe line for the UI. */
  line: string;
}

// Language in a notice that points at a de-facto narrowed field (political /
// practical layer). Precision-biased — each phrase is a real re-tender / closed
// -field / incumbency signal, not a generic procurement word.
const CONSTRAINT_RE =
  /\b(incumbent|re-?advertis|re-?tender|re-?issue|sole[-\s]?source|single[-\s]?source|direct(?:\s+contracting|\s+award)|pre-?qualified\s+(?:suppliers?|vendors?|firms?)\s+only|by\s+invitation\s+only|shortlisted\s+(?:suppliers?|firms?)\s+only|existing\s+(?:framework|roster|LTA)|call[-\s]?off)\b/i;

// A pre-qualification / expression-of-interest step that gates a *later*, likely
// narrower competitive round. Not a constraint on its own — a Mixed nuance.
const PREQUAL_RE =
  /\b(expression[s]?\s+of\s+interest|\beoi\b|pre-?qualification|prequalif|request\s+for\s+information|\brfi\b|shortlist)\b/i;

// Signals of a broad, genuinely open competitive process (official layer looks
// open AND nothing narrows it). Framework/LTA usually means multiple awards.
const OPEN_RE =
  /\b(open\s+(?:international\s+)?(?:competitive\s+)?(?:bidding|tender|competition)|international\s+competitive\s+bidding|\bicb\b|framework\s+agreement|long[-\s]?term\s+agreement|\blta\b|multiple\s+awards?)\b/i;

function typeIsOpenGoods(opportunityType: string | null | undefined): boolean {
  const t = (opportunityType ?? "").toLowerCase();
  // RFQ/ITB for goods/works are the most contestable, lowest-relationship formats.
  return /\b(rfq|request\s+for\s+quotation|itb|invitation\s+to\s+bid|goods|supply|works)\b/.test(t);
}

/**
 * Classify a tender's contestability from its own public fields only.
 * Conservative by construction: defaults to Mixed, only reaches Open on a clear
 * open-competition signal with no constraint, and only reaches Constrained on a
 * concrete basis.
 */
export function classifyContestability(input: ContestabilityInput): ContestabilitySignal {
  const haystack = `${input.title ?? ""} ${input.description ?? ""}`.trim();
  const type = input.opportunityType ?? null;
  const regRisk = input.registrationRisk ?? "none";

  const basis: string[] = [];

  // ── Constrained candidates (require a concrete basis) ────────────────────────
  const constraintHit = haystack ? CONSTRAINT_RE.exec(haystack) : null;
  if (constraintHit) {
    basis.push(
      `The notice language ("${constraintHit[0].toLowerCase()}") points to a narrowed or incumbent-favoured field.`,
    );
  }
  if (regRisk === "very-tight") {
    basis.push(
      "The window is very short relative to first-time supplier registration — a practical barrier to a new entrant bidding in time.",
    );
  }

  if (basis.length > 0) {
    // Constrained ONLY with a real basis (enforced by the length check above).
    return {
      band: "Constrained",
      basis,
      thinEvidence: false,
      line:
        "Looks constrained on the practical/political layer — worth a closer look before committing real preparation time.",
    };
  }

  // ── Open candidates (clear open-competition signal, nothing narrowing it) ────
  const openHit = haystack ? OPEN_RE.test(haystack) : false;
  const prequal = haystack ? PREQUAL_RE.test(haystack) : false;
  if ((openHit || typeIsOpenGoods(type)) && !prequal) {
    const why = openHit
      ? "The notice describes an open competitive / framework process."
      : "A quotation/goods format like this is typically decided on price and compliance, not relationships.";
    return {
      band: "Open",
      basis: [why],
      thinEvidence: false,
      line: "Reads as genuinely open — decided on merit and price more than relationships.",
    };
  }

  // ── Mixed nuance: a pre-qual/EOI step gating a later, likely narrower round ──
  if (prequal) {
    return {
      band: "Mixed",
      basis: [
        "This is an entry / expression-of-interest step; the competitive round it leads to may be limited to a shortlist.",
      ],
      thinEvidence: false,
      line: "An entry step — getting shortlisted matters as much as the eventual bid.",
    };
  }

  // ── Conservative default ─────────────────────────────────────────────────────
  return {
    band: "Mixed",
    basis: [],
    thinEvidence: true,
    line:
      "The listing alone doesn't reveal how the practical/political side will play — treat as mixed until you know the field.",
  };
}
