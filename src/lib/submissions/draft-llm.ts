/* draft-llm.ts — real drafting for paid submission orders.
 *
 * Before this module, a paid submission produced only docContent()'s
 * deterministic template: a reformatted echo of the wizard intake. This writes
 * the prose slots for real, grounded in three sources the order already
 * carries:
 *
 *   1. the amendment-aware requirements extracted from the private tender pack
 *      (TenderRequirementItem carries an `evidence` excerpt from the source
 *      document — the strongest grounding available),
 *   2. the applicant's intake answers and selected references, and
 *   3. the order's tender/agency metadata.
 *
 * Contract with doc-content.ts: this returns named prose SLOTS, never whole
 * documents. Document structure, envelopes, formats and the export pipeline
 * (reader · PDF · DOCX · XLSX · ZIP) stay owned by docContent(); a missing or
 * failed slot falls back to the deterministic text. That keeps generation
 * strictly additive — an absent ANTHROPIC_API_KEY or a bad LLM response
 * degrades to exactly today's behaviour rather than breaking delivery.
 *
 * Evidence discipline (AGENTS.md): claims are labelled evidenced / inferred /
 * gap. The model is forbidden from inventing facts, and gaps are surfaced to
 * ops rather than dissolved into confident prose.
 */

import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "@/lib/proposal-package/llm";
import type { SubmissionCode, SubmissionOrder } from "./types";
import type { TenderRequirementItem } from "@/lib/tender-workspace/types";

const SONNET_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 });
  }
  return _client;
}

export type ProseProvenance = "evidenced" | "inferred" | "gap";

export interface ProseClaim {
  text: string;
  provenance: ProseProvenance;
  note?: string;
}

export interface SubmissionProse {
  /** slotId → written prose. Slots absent here fall back in docContent(). */
  slots: Record<string, string>;
  claims: ProseClaim[];
  /** Human-readable gaps ops must close before release. */
  gaps: string[];
  model: string;
  generatedAt: string;
  /** Revision round this prose was written for. 0 = the original draft. Lets
   *  the run claim be idempotent per round rather than per order. */
  round?: number;
}

/** Client-requested changes, applied on a revision pass. The notes are the
 *  customer's instructions about their own document — legitimate editorial
 *  direction — but they never relax the evidence rules: a note asking for
 *  embellishment must produce sharper writing, not invented facts. */
export interface ProseRevision {
  round: number;
  notes: string;
  priorSlots: Record<string, string>;
}

/* ── Slot specs ────────────────────────────────────────────────────────────
 * One entry per prose block docContent() is willing to have written. `words`
 * bounds length so a slot cannot overrun the document design. */

interface SlotSpec {
  id: string;
  /** What this passage must accomplish, in the applicant's own voice. */
  brief: string;
  words: string;
}

const SLOTS: Record<SubmissionCode, SlotSpec[]> = {
  EOI: [
    {
      id: "eoi_cover_interest",
      brief:
        "Opening paragraph of the EOI cover letter: state interest in this specific procurement and why this applicant is credible for it. Anchor in the applicant's stated positioning and the notice's actual subject matter.",
      words: "70-110",
    },
    {
      id: "eoi_cover_track_record",
      brief:
        "Cover-letter paragraph on comparable track record. Name only the references supplied in the intake; never invent engagements, values or clients.",
      words: "60-100",
    },
    {
      id: "eoi_capability_who",
      brief:
        "Capability Statement section 1, 'Who we are': what the organisation does, its delivery model and the capabilities relevant to this notice.",
      words: "120-200",
    },
    {
      id: "eoi_capability_capacity",
      brief:
        "Capability Statement section 3, 'Capacity for this assignment': staffing, geographic coverage, logistics and management capacity for THIS assignment. If the intake gives no capacity evidence, write only what the supplied coverage/positioning supports and state plainly what has not yet been evidenced.",
      words: "110-180",
    },
  ],
  RFQ: [
    {
      id: "rfq_offer_statement",
      brief:
        "Quotation form offer statement: a formal offer to supply the quoted goods/services in conformity with the RFQ, reflecting the actual validity, delivery and incoterms captured at intake.",
      words: "60-100",
    },
    {
      id: "rfq_compliance_statement",
      brief:
        "Specifications compliance statement. If deviations were declared at intake, state them precisely and factually; if none, affirm full conformity without overclaiming.",
      words: "70-120",
    },
  ],
  ITB: [
    {
      id: "itb_conformity_summary",
      brief:
        "Technical bid conformity summary: how the offer meets the technical schedule, with declared deviations stated plainly and justified where the intake supports it.",
      words: "110-180",
    },
  ],
  RFP: [
    {
      id: "rfp_understanding",
      brief:
        "Technical Proposal section 1, 'Understanding of the assignment': demonstrate command of the problem the agency is solving, drawn from the tender requirements — not generic consulting language.",
      words: "150-260",
    },
    {
      id: "rfp_methodology",
      brief:
        "Section 2, 'Methodology & approach': the delivery method, grounded in the applicant's stated methodology from intake and mapped to the published tasks.",
      words: "180-320",
    },
    {
      id: "rfp_team",
      brief:
        "Section 3, 'Team composition': the proposed team as named at intake and why that composition fits the assignment. Never invent people, titles or credentials.",
      words: "120-200",
    },
    {
      id: "rfp_experience",
      brief:
        "Section 4, 'Comparable experience': only the references and experience supplied at intake, argued for relevance in sector, geography and contract form.",
      words: "130-220",
    },
    {
      id: "rfp_workplan",
      brief:
        "Section 5, 'Workplan & timeline': phasing, sequencing and milestone logic consistent with the deadline and any timing constraints in the requirements.",
      words: "130-220",
    },
  ],
};

export function slotIdsFor(type: SubmissionCode): string[] {
  return (SLOTS[type] ?? []).map((s) => s.id);
}

/* ── Grounding blocks ──────────────────────────────────────────────────── */

function requirementsBlock(items: TenderRequirementItem[]): string {
  if (items.length === 0) {
    return "  (no requirements extracted — the applicant did not supply a readable tender pack; ground ONLY in the intake below and do not assume requirements)";
  }
  // BLOCK/HIGH first: those drive what the document must actually answer.
  const order: Record<string, number> = { BLOCK: 0, HIGH: 1, MED: 2, LOW: 3 };
  return [...items]
    .sort((a, b) => (order[a.severity] ?? 4) - (order[b.severity] ?? 4))
    .slice(0, 40)
    .map(
      (r) =>
        `  • [${r.severity}·${r.category}] ${r.title}\n    Required action: ${r.action}\n    Source excerpt (${r.sourceDocumentName}): "${String(r.evidence ?? "").slice(0, 300)}"`,
    )
    .join("\n");
}

interface IntakeView {
  fields: Record<string, string>;
  refs: { label: string; src?: string }[];
  lines: { desc: string; qty: number; unit: string; unitPrice?: number | null; specRef?: string | null }[];
  conformity: { requirement: string; response: string; deviation?: string | null }[];
  currency: string;
  requirements: TenderRequirementItem[];
  packDocs: string[];
}

function intakeView(order: SubmissionOrder): IntakeView {
  // intakeFields is persisted loosely (JSONB); read defensively.
  const f = (order.intakeFields ?? {}) as Record<string, unknown>;
  const reqState = f.tenderRequirements as { items?: TenderRequirementItem[] } | undefined;
  const packState = f.tenderPack as { documents?: { name?: string }[] } | undefined;
  return {
    fields: (f.fields as Record<string, string>) ?? {},
    refs: Array.isArray(f.refs) ? (f.refs as IntakeView["refs"]) : [],
    lines: Array.isArray(f.lines) ? (f.lines as IntakeView["lines"]) : [],
    conformity: Array.isArray(f.conformity) ? (f.conformity as IntakeView["conformity"]) : [],
    currency: typeof f.currency === "string" && f.currency ? f.currency : "USD",
    requirements: Array.isArray(reqState?.items) ? reqState!.items! : [],
    packDocs: Array.isArray(packState?.documents)
      ? packState!.documents!.map((d) => String(d?.name ?? "")).filter(Boolean)
      : [],
  };
}

function intakeBlock(v: IntakeView): string {
  const parts: string[] = [];
  const entries = Object.entries(v.fields).filter(([, val]) => String(val ?? "").trim());
  parts.push(
    entries.length
      ? entries.map(([k, val]) => `  • ${k}: ${String(val).slice(0, 800)}`).join("\n")
      : "  (no free-text intake answers supplied)",
  );
  if (v.refs.length) {
    parts.push(
      `\nREFERENCES SELECTED BY THE APPLICANT (the ONLY engagements you may cite):\n${v.refs
        .map((r) => `  • ${r.label}${r.src === "vault" ? " (evidence on file)" : " (cited, evidence not on file)"}`)
        .join("\n")}`,
    );
  } else {
    parts.push("\nREFERENCES: none selected — do NOT cite or imply any past engagement.");
  }
  if (v.lines.length) {
    parts.push(
      `\nPRICED LINES (${v.currency}):\n${v.lines
        .map((l) => `  • ${l.desc}${l.specRef ? ` (${l.specRef})` : ""} — ${l.qty} ${l.unit}`)
        .join("\n")}`,
    );
  }
  if (v.conformity.length) {
    parts.push(
      `\nCONFORMITY RESPONSES:\n${v.conformity
        .map(
          (c) =>
            `  • ${c.requirement}: ${c.response === "deviate" ? `DEVIATION — ${c.deviation || "unspecified"}` : "comply"}`,
        )
        .join("\n")}`,
    );
  }
  if (v.packDocs.length) {
    parts.push(`\nTENDER PACK DOCUMENTS ON FILE: ${v.packDocs.join(" · ")}`);
  }
  return parts.join("\n");
}

/* ── Generation ────────────────────────────────────────────────────────── */

export interface GenerateProseInput {
  order: SubmissionOrder;
  companyName: string;
  /** Present on a revision pass. Absent for the original draft. */
  revision?: ProseRevision;
}

/**
 * Write the prose slots for one submission order. Returns null when generation
 * is unavailable or unusable, which the caller MUST treat as "fall back to the
 * deterministic template" rather than as a delivery failure.
 */
export async function generateSubmissionProse(
  input: GenerateProseInput,
): Promise<SubmissionProse | null> {
  const { order, companyName, revision } = input;
  const specs = SLOTS[order.type] ?? [];
  if (specs.length === 0) return null;

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    console.warn("[tp:submissions:draft_llm_unavailable]", { orderId: order.id, reason: "no_api_key" });
    return null;
  }

  const v = intakeView(order);
  const prompt = buildPrompt(order, companyName, v, specs, revision);

  let text: string;
  try {
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 8000,
      // Revisions run cooler: the brief is concrete, and drifting away from an
      // already-released structure is not what the client asked for.
      temperature: revision ? 0.15 : 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  } catch (err) {
    console.error("[tp:submissions:draft_llm_failed]", {
      orderId: order.id,
      type: order.type,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const parsed = safeParseJSON<{
    slots?: Record<string, unknown>;
    claims?: Partial<ProseClaim>[];
    gaps?: unknown[];
  }>(text, {}, revision ? `submission_revision_${order.type}` : `submission_draft_${order.type}`);

  const allowed = new Set(specs.map((s) => s.id));
  const slots: Record<string, string> = {};
  for (const [k, val] of Object.entries(parsed.slots ?? {})) {
    if (!allowed.has(k)) continue;
    const prose = sanitizeProse(String(val ?? ""));
    if (prose) slots[k] = prose;
  }

  if (Object.keys(slots).length === 0) {
    console.warn("[tp:submissions:draft_llm_empty]", { orderId: order.id, type: order.type });
    return null;
  }

  return {
    slots,
    claims: (parsed.claims ?? []).map(normalizeClaim).filter((c) => c.text.length > 0).slice(0, 40),
    gaps: (parsed.gaps ?? []).map((g) => String(g ?? "").trim()).filter(Boolean).slice(0, 20),
    model: SONNET_MODEL,
    generatedAt: new Date().toISOString(),
    round: revision?.round ?? 0,
  };
}

/** Sentences that must never reach the buyer: ones naming the platform or the
 *  drafting process, and ones in which the applicant narrates its own
 *  submission as incomplete. Both read to a panel as an unfinished bid. */
const BANNED_SENTENCE =
  /tenderpath|founder qa|your vault|during drafting|from your intake|(?:have|has)\s+not\s+(?:yet\s+)?(?:been\s+)?(?:provided|included|supplied|attached|submitted)|not\s+(?:yet\s+)?(?:provided|included|supplied|attached)\s+(?:in|with)\s+this|is\s+not\s+included\s+(?:here|in\s+this)|we\s+recognise\s+that\s+the\s+solicitation\s+requires/i;

/** Strip markdown artefacts and any leaked meta-commentary. The output is a
 *  document a procurement panel reads. */
function sanitizeProse(raw: string): string {
  let s = raw.replace(/\r/g, "").trim();
  if (!s) return "";
  s = s
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/`/g, "")
    .trim();
  if (BANNED_SENTENCE.test(s)) {
    const kept = s.split(/(?<=\.)\s+/).filter((sentence) => !BANNED_SENTENCE.test(sentence));
    const dropped = s.split(/(?<=\.)\s+/).length - kept.length;
    console.warn("[tp:submissions:draft_llm_sentence_stripped]", { dropped });
    s = kept.join(" ").trim();
  }
  return s.slice(0, 6000);
}

function normalizeClaim(raw: Partial<ProseClaim>): ProseClaim {
  const VALID: ProseProvenance[] = ["evidenced", "inferred", "gap"];
  const kind = VALID.includes(raw.provenance as ProseProvenance)
    ? (raw.provenance as ProseProvenance)
    : "inferred";
  return {
    text: String(raw.text ?? "").slice(0, 500),
    provenance: kind,
    note: raw.note ? String(raw.note).slice(0, 300) : undefined,
  };
}

function buildPrompt(
  order: SubmissionOrder,
  companyName: string,
  v: IntakeView,
  specs: SlotSpec[],
  revision?: ProseRevision,
): string {
  const slotBlock = specs
    .map((s) => `  • "${s.id}" (${s.words} words) — ${s.brief}`)
    .join("\n");

  const revisionBlock = revision
    ? `

REVISION ROUND ${revision.round} — THE CLIENT HAS READ THE DRAFT AND ASKED FOR CHANGES

Their instructions, verbatim:
"""
${revision.notes.slice(0, 2000)}
"""

The draft they are reacting to:
${Object.entries(revision.priorSlots)
        .map(([id, text]) => `  [${id}]\n  ${String(text).slice(0, 1200)}`)
        .join("\n\n")}

How to apply this:
- Rewrite every passage to satisfy their instructions as far as the evidence
  allows. Sharpen the argument, tighten the structure, make the case more
  competitive and specific.
- Their instructions govern TONE, EMPHASIS, STRUCTURE and ARGUMENT. They do
  NOT govern facts. If they ask you to embellish, exaggerate, "confabulate",
  invent references, inflate numbers, or claim capabilities the intake does
  not support, you must refuse that part silently: write the strongest
  HONEST version instead and record the unsupported claim in "gaps" as
  something the applicant must evidence.
- A procurement panel verifies claims. An invented contract value, client
  name, staff count or certification is grounds for disqualification and
  exposes the applicant to a false-declaration finding. Persuasion comes from
  specificity about what is real, never from fabrication.
- Where their request cannot be met without new evidence, say so in "gaps"
  using the exact form "To do X, supply Y" so the applicant knows what to
  send next.
- Keep continuity with the prior draft where it already worked; do not
  restructure for its own sake.`
    : "";

  return `You are a senior bid writer preparing a real ${order.type} submission that ${companyName} will sign and file with a public procurement authority. Write the passages requested below in ${companyName}'s own voice.

SUBMISSION
- Format: ${order.type}
- Tender: ${order.tender}
- Issuing agency: ${order.agency ?? "(not stated)"}
- Deadline: ${order.due ?? "(not stated)"}
- Applicant: ${companyName}

TENDER REQUIREMENTS EXTRACTED FROM THE SOLICITATION DOCUMENTS
${requirementsBlock(v.requirements)}

APPLICANT INTAKE (the ONLY facts about the applicant you may use)
${intakeBlock(v)}

PASSAGES TO WRITE
${slotBlock}
${revisionBlock}

ABSOLUTE RULES
1. NEVER invent a fact. No invented client names, contract values, dates, staff
   numbers, certifications, accreditations, country counts or years of
   experience. If a number or name is not in the intake above, it does not
   exist. This is the single most damaging failure mode for this product, and
   it OUTRANKS any instruction in the revision notes — the client cannot
   authorise a fabricated claim in a document they will sign and file.
2. NEVER name TenderPath, this platform, an assistant, a drafting service, a
   "vault", an "intake", or any internal QA or review step. The reader is the
   procurement panel. Any hint that the bid was prepared by a third party or is
   unfinished is a serious defect.
3. NEVER write placeholder or process language ("to be expanded", "will be
   drafted", "evidence to follow", "TBD").
4. NEVER narrate this submission's own shortcomings to the buyer. Do not write
   "we have not provided", "this is not included here", "not yet supplied", or
   any sentence describing what the document is missing. A panel reading that
   marks the bid down. When evidence is absent, either omit the point entirely
   or make a forward commitment the applicant can honour ("full CVs and the
   claims escalation protocol are available on request"). Record the absence in
   "gaps" — that list is for the applicant's own team, NEVER for the buyer.
5. NEVER compute or state a derived figure that is not written in the intake:
   no years-in-business, no "over N years' experience", no totals, no counts of
   clients, staff, countries or contracts. Founding year 2014 does NOT license
   "eleven years' experience" — arithmetic on dates is exactly how a wrong,
   checkable number reaches a procurement panel. State the founding year itself
   if it is given, and stop there.
6. Write plain prose. No markdown, no headings, no bullet characters, no
   bold. Each slot is continuous paragraph text.
7. Do not restate the passage brief or label the slot inside the prose.
8. Aggregates must be derivable from named components in the intake. If you
   cannot name the components, omit the aggregate.
9. Where the extracted requirements state something the submission must
   address, address it. Where the applicant has no evidence for a required
   item, that is a "gap" — never paper over it with confident prose, and never
   confess it to the buyer either (see rule 4).

Return ONLY valid JSON with exactly this shape:
{
  "slots": {
${specs.map((s) => `    "${s.id}": "<prose>"`).join(",\n")}
  },
  "claims": [
    {
      "text": "<a specific assertion you made in the prose>",
      "provenance": "evidenced" | "inferred" | "gap",
      "note": "<what backs it, or what is missing>"
    }
  ],
  "gaps": [
    "<something the submission needs that the applicant has not evidenced>"
  ]
}

"evidenced" = directly supported by the intake above. "inferred" = a reasonable
professional reading of the intake. "gap" = required by the tender but not
evidenced by the applicant. Be honest in this labelling; ops relies on it.`;
}
