/* response-draft.ts — answer the solicitation's own questions.
 *
 * Pairs with response-outline.ts. Where draft-llm.ts writes prose into slots
 * fixed by the submission format, this writes one section per question the
 * NOTICE asks, in the notice's order. The document's shape comes from the
 * solicitation rather than from flows.ts.
 *
 * The honesty rules are stricter here than for a format-driven draft, because a
 * question list invites bluffing. An RFI that asks for "independent audit
 * evidence", "air-gapped hardware footprint" or "two references from large
 * distributed organisations" will frequently hit things the applicant does not
 * have. The correct output for those is a short, factual statement of the real
 * position plus a gap — never a plausible-sounding invention, which a panel
 * verifies and which exposes the applicant to a false-declaration finding.
 */

import Anthropic from "@anthropic-ai/sdk";
import { safeParseJSON } from "@/lib/proposal-package/llm";
import { normalizeClaim, sanitizeProse, type ProseClaim } from "./draft-llm";
import type { SubmissionOrder } from "./types";
import type { ResponseOutline, TenderRequirementItem } from "@/lib/tender-workspace/types";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 });
  }
  return _client;
}

export interface ResponseSectionDraft {
  id: string;
  order: number;
  title: string;
  content: string;
  /** True when the applicant cannot substantively answer this question yet.
   *  Surfaced to the applicant; the prose still reads professionally. */
  unevidenced: boolean;
}

export interface ResponseDraft {
  documentTitle: string;
  sections: ResponseSectionDraft[];
  claims: ProseClaim[];
  gaps: string[];
  model: string;
  generatedAt: string;
  round?: number;
}

interface IntakeView {
  fields: Record<string, string>;
  refs: { label: string; src?: string }[];
  requirements: TenderRequirementItem[];
}

function intakeView(order: SubmissionOrder): IntakeView {
  const f = (order.intakeFields ?? {}) as Record<string, unknown>;
  const reqState = f.tenderRequirements as { items?: TenderRequirementItem[] } | undefined;
  return {
    fields: (f.fields as Record<string, string>) ?? {},
    refs: Array.isArray(f.refs) ? (f.refs as IntakeView["refs"]) : [],
    requirements: Array.isArray(reqState?.items) ? reqState!.items! : [],
  };
}

function applicantBlock(v: IntakeView, companyName: string): string {
  const parts: string[] = [`Applicant: ${companyName}`];
  const entries = Object.entries(v.fields).filter(([, val]) => String(val ?? "").trim());
  parts.push(
    entries.length
      ? entries.map(([k, val]) => `  • ${k}: ${String(val).slice(0, 900)}`).join("\n")
      : "  (no free-text intake answers supplied)",
  );
  parts.push(
    v.refs.length
      ? `\nREFERENCES SUPPLIED (the ONLY engagements you may cite):\n${v.refs
          .map((r) => `  • ${r.label}${r.src === "vault" ? " (evidence on file)" : " (cited, evidence not on file)"}`)
          .join("\n")}`
      : "\nREFERENCES: none supplied — do NOT cite or imply any past engagement, client or contract.",
  );
  if (v.requirements.length) {
    parts.push(
      `\nCOMPLIANCE POINTS EXTRACTED FROM THE SAME PACK:\n${v.requirements
        .slice(0, 20)
        .map((r) => `  • [${r.severity}] ${r.title} — ${r.action}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n");
}

export interface GenerateResponseInput {
  order: SubmissionOrder;
  companyName: string;
  outline: ResponseOutline;
  /** The solicitation text itself. REQUIRED for questions that reference the
   *  notice's own enumerations — "which of areas A–E", "which Section 3
   *  capabilities" — which cannot be answered from section titles alone.
   *  Without it the model correctly refuses to guess, but then explains the
   *  absence to the BUYER, which reads as an unfinished response. */
  corpus?: string | null;
  /** Client revision instructions, applied on a re-draft. */
  revision?: { round: number; notes: string; priorSections: ResponseSectionDraft[] };
}

export async function generateResponseDraft(
  input: GenerateResponseInput,
): Promise<ResponseDraft | null> {
  const { order, companyName, outline, revision } = input;
  const corpus = (input.corpus ?? "").slice(0, 40_000);
  const sections = outline.sections ?? [];
  if (sections.length === 0) return null;

  let client: Anthropic;
  try {
    client = getClient();
  } catch {
    console.warn("[tp:response-draft:unavailable]", { orderId: order.id, reason: "no_api_key" });
    return null;
  }

  const v = intakeView(order);
  const sectionBlock = sections
    .map((s) => `  [${s.id}] ${s.order}. ${s.title}\n      The notice asks: ${s.ask}\n      Notice wording: "${s.evidence.slice(0, 260)}"`)
    .join("\n\n");

  const revisionBlock = revision
    ? `\n\nREVISION ROUND ${revision.round} — the client read the draft and asked for changes.\nTheir instructions, verbatim:\n"""\n${revision.notes.slice(0, 2000)}\n"""\nPrior draft:\n${revision.priorSections
        .map((s) => `  [${s.id}] ${s.content.slice(0, 900)}`)
        .join("\n\n")}\n\nApply their instructions to tone, emphasis, structure and argument. They do NOT authorise inventing facts — if they ask you to embellish, write the strongest HONEST version and record the unsupported claim in "gaps".`
    : "";

  const corpusBlock = corpus
    ? `\n\nTHE SOLICITATION TEXT (authoritative — read it for any list, lettered area, numbered capability or definition a question refers to):\n${corpus}`
    : "";

  const prompt = `You are a senior bid writer preparing ${companyName}'s response to the solicitation below. The notice prescribes exactly what the response must contain. Write ONE section per item, in the given order, in ${companyName}'s own voice.

SOLICITATION
- Title: ${order.tender}
- Issuing body: ${order.agency ?? "(not stated)"}
- Deadline: ${order.due ?? "(not stated)"}
${outline.pageLimit ? `- Length limit: ${outline.pageLimit}` : ""}

SECTIONS THE NOTICE REQUIRES
${sectionBlock}${corpusBlock}

WHAT THE APPLICANT HAS ACTUALLY TOLD US
${applicantBlock(v, companyName)}${revisionBlock}

ABSOLUTE RULES
1. NEVER invent a fact. No invented client names, contract values, dates, staff
   numbers, certifications, audit reports, product features, deployment options,
   pricing tiers, country lists or references. If it is not in the applicant
   information above, it does not exist. A procurement panel verifies these,
   and a fabricated answer is grounds for disqualification.
2. This notice will ask for things the applicant may not have. That is EXPECTED.
   For such a section: write 2-4 honest sentences stating the applicant's real
   position and what they can commit to, set "unevidenced": true, and add a gap
   in the form "To answer '<section title>', supply <what is needed>".
   Do NOT pad an unanswerable section with generic filler.
3. NEVER claim a capability, certification, policy, audit, or deployment mode
   the applicant has not stated. "We are ISO 27001 certified" when nobody said
   so is the single worst failure this product can produce.
4. Do NOT narrate the response's own shortcomings to the reader ("we have not
   provided", "this is not included"). State the real position positively, or
   make a forward commitment the applicant can honour, and put the deficiency
   in "gaps" — that list is for the applicant's team, never the buyer.
   In particular NEVER tell the reader that part of their own notice was
   unavailable to you, or that you could not see a section, list or annex. The
   solicitation text is above; read it. If a detail genuinely is not in it,
   answer what you can and record the rest as a gap — silently.
5. Never name TenderPath, this platform, an assistant, drafting, or an intake.
6. Plain prose. No markdown, headings, bullets or bold inside content. Answer
   the question asked — do not restate it.
7. Length: proportionate to what the applicant can actually support. A section
   with real substance can run 150-300 words; an unevidenced one should be
   short and honest, not inflated.

Return ONLY valid JSON:
{
  "sections": [
    { "id": "<the [id] given above>", "content": "<the response prose>", "unevidenced": false }
  ],
  "claims": [
    { "text": "<a specific assertion made>", "provenance": "evidenced" | "inferred" | "gap", "note": "<what backs it or what is missing>" }
  ],
  "gaps": [
    "To answer '<section title>', supply <what the applicant must provide>"
  ]
}`;

  let text: string;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      temperature: revision ? 0.15 : 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  } catch (err) {
    console.error("[tp:response-draft:failed]", {
      orderId: order.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const parsed = safeParseJSON<{
    sections?: Array<Record<string, unknown>>;
    claims?: Partial<ProseClaim>[];
    gaps?: unknown[];
  }>(text, {}, "response_draft");

  const byId = new Map(sections.map((s) => [s.id, s]));
  const drafted: ResponseSectionDraft[] = [];
  for (const raw of parsed.sections ?? []) {
    const spec = byId.get(String(raw.id ?? ""));
    if (!spec) continue;
    const content = sanitizeProse(String(raw.content ?? ""));
    if (!content) continue;
    drafted.push({
      id: spec.id,
      order: spec.order,
      title: spec.title,
      content,
      unevidenced: raw.unevidenced === true,
    });
  }
  drafted.sort((a, b) => a.order - b.order);

  if (drafted.length === 0) {
    console.warn("[tp:response-draft:empty]", { orderId: order.id });
    return null;
  }

  return {
    documentTitle: outline.documentTitle?.trim() || `Response to ${order.tender}`,
    sections: drafted,
    claims: (parsed.claims ?? []).map(normalizeClaim).filter((c) => c.text.length > 0).slice(0, 60),
    gaps: (parsed.gaps ?? []).map((g) => String(g ?? "").trim()).filter(Boolean).slice(0, 30),
    model: MODEL,
    generatedAt: new Date().toISOString(),
    round: revision?.round ?? 0,
  };
}
