/**
 * draft-generator.ts — produce DraftSection[] from a TenderRubric + applicant context.
 *
 * Sprint 2 scope. One Sonnet call per generation (initial or revision). The
 * output is `DraftSection[]` per the scoring-engine.ts contract: each section
 * carries criterionId + content + claims with provenance labels.
 *
 *   - cumulative (services RFP): one section per criterion in the rubric.
 *     UNICEF's 12 criteria → 12 sections, each ~200-400 words.
 *   - lowest_compliant (goods RFQ): one section per LOT covering all
 *     disqualifier compliance statements. criterionId is a synthetic
 *     "lot-<id>-compliance" placeholder so the scoring engine can still
 *     address sections by criterionId.
 *
 * Revision mode: pass `priorSections` + `revisionGuidance` to regenerate
 * only weak sections informed by the prior scoring pass.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  TenderInput,
  TenderRubric,
  DraftSection,
  Claim,
  ProvenanceKind,
} from "./scoring-engine";
import { type ApplicantContext, formatApplicantForPrompt } from "./applicant-context";
import { safeParseJSON } from "./llm";

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

export interface RevisionGuidance {
  criterionId: string;
  estimatedScore: number;
  maxScore: number;
  weaknesses: string[];
  missingEvidence: string[];
}

export interface GenerateDraftOptions {
  /** If provided, treat this as a revision pass — regenerate weak sections only. */
  revisionGuidance?: RevisionGuidance[];
  /** Prior draft sections. Used in revision mode to preserve strong sections
   *  while only rewriting weak ones. */
  priorSections?: DraftSection[];
}

export async function generateDraftSections(
  tenderInput: TenderInput,
  rubric: TenderRubric,
  applicant: ApplicantContext,
  options: GenerateDraftOptions = {},
): Promise<DraftSection[]> {
  const client = getClient();

  const isRevision = (options.revisionGuidance?.length ?? 0) > 0;
  const prompt = buildDraftPrompt(tenderInput, rubric, applicant, options);

  const response = await client.messages.create({
    model: SONNET_MODEL,
    // Initial draft can produce up to 12+ sections at 200-400 words each =
    // ~5k tokens output. Revision pass is smaller (just the weak sections).
    // 16000 leaves headroom matching the proposal-draft + rubric-extract
    // budgets in llm.ts / rubric-extractor.ts.
    max_tokens: 16000,
    temperature: isRevision ? 0.15 : 0.25,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{ sections: Array<Partial<DraftSection>> }>(
    text,
    { sections: [] },
    isRevision ? "draft_revision" : "draft_initial",
  );

  const generated = (parsed.sections ?? []).map(normalizeDraftSection);

  // Revision mode: merge generated sections over priorSections (sections not
  // revised keep their prior content). When the LLM returns only the weak
  // ones, that's the intended shape.
  if (isRevision && options.priorSections) {
    return mergeRevision(options.priorSections, generated);
  }
  return generated;
}

function buildDraftPrompt(
  tenderInput: TenderInput,
  rubric: TenderRubric,
  applicant: ApplicantContext,
  options: GenerateDraftOptions,
): string {
  const isRevision = (options.revisionGuidance?.length ?? 0) > 0;
  const applicantBlock = formatApplicantForPrompt(applicant);

  const lotsBlock = rubric.lots
    .map((lot) => {
      const criteriaText =
        lot.criteria.length > 0
          ? lot.criteria
              .map(
                (c) =>
                  `      • ${c.id} — ${c.label} (max ${c.maxScore}${c.doubleWeighted ? ", DOUBLE-WEIGHTED" : ""}${c.gatingThreshold != null ? `, gating ≥${c.gatingThreshold}` : ""})`,
              )
              .join("\n")
          : "      (none — lowest_compliant lot; compliance against disqualifiers below)";
      const disqText =
        lot.disqualifiers.length > 0
          ? lot.disqualifiers
              .map((d) => `      • [${d.kind}] ${d.rule.slice(0, 220)}`)
              .join("\n")
          : "      (none)";
      return `  ╭ ${lot.lotId} — ${lot.label}\n    Criteria:\n${criteriaText}\n    Disqualifiers:\n${disqText}\n  ╰`;
    })
    .join("\n");

  const noticeWideBlock =
    rubric.noticeWideDisqualifiers.length > 0
      ? rubric.noticeWideDisqualifiers
          .map((d) => `  • [${d.kind}] ${d.rule.slice(0, 220)}`)
          .join("\n")
      : "  (none)";

  const revisionBlock = isRevision
    ? `\nREVISION GUIDANCE (only regenerate sections for these criteria; keep all other sections from the prior draft):\n${options
        .revisionGuidance!.map(
          (g) =>
            `  • ${g.criterionId} (scored ${g.estimatedScore}/${g.maxScore})\n    Weaknesses: ${g.weaknesses.join("; ") || "(none cited)"}\n    Missing evidence: ${g.missingEvidence.join("; ") || "(none cited)"}`,
        )
        .join("\n\n")}\n`
    : "";

  const sectionInstructions =
    rubric.methodology === "lowest_compliant"
      ? `For methodology="lowest_compliant" (this tender):
- Generate EXACTLY ONE DraftSection PER LOT.
- Use criterionId = "<lotId>-compliance" (e.g. "lot-1-compliance"). This is a synthetic placeholder so the scoring engine can address the lot.
- content: a 250-400 word compliance statement covering all disqualifiers in that lot. Cite the applicant's certifications, past performance, and technical capability against the relevant specs (BS EN 10242 for GI fittings, ISO 9001 for QA, etc.).
- claims: 5-10 claims, one per major disqualifier addressed. Provenance is "applicant_library" when the applicant context cites the evidence, "inferred" for capabilities derived from past performance, "gap" for explicit absences.`
      : `For methodology="cumulative" (this tender):
- Generate ONE DraftSection PER CRITERION listed in the rubric.
- criterionId = the criterion's id exactly as published in the rubric (e.g. "1.1", "1.2", "2.1").
- content: a 200-400 word section addressing the criterion. Anchor in the applicant's evidence (past performance, personnel, certifications) for "evidenced" claims; flag absences as gaps.
- claims: 3-6 claims per section, each tagged with provenance.`;

  return `You are a senior UN procurement bid writer. Generate a structured draft for the tender below, addressing every criterion and disqualifier the rubric asks about. Anchor in the applicant's evidence; do NOT invent facts.

TENDER:
- tenderId: ${tenderInput.tenderId}
- lane: ${tenderInput.lane}
- methodology: ${tenderInput.methodology}

RUBRIC LOTS:
${lotsBlock}

NOTICE-WIDE DISQUALIFIERS (must be addressed; applicant must be eligible):
${noticeWideBlock}

APPLICANT EVIDENCE:
${applicantBlock}
${revisionBlock}
${sectionInstructions}

Return a JSON object with EXACTLY this shape:
{
  "sections": [
    {
      "lotId": "<lotId from rubric>",
      "criterionId": "<criterion id OR '<lotId>-compliance' for lowest_compliant>",
      "content": "<the draft prose, 200-400 words>",
      "claims": [
        {
          "text": "<a specific assertion made in the content>",
          "provenance": {
            "kind": "uploaded_document" | "applicant_library" | "inferred" | "gap",
            "note": "<why this kind — what evidence backs it, or what is missing>"
          }
        }
      ]
    }
  ]
}

Rules:
- Use the EXACT criterion ids from the rubric (or "<lotId>-compliance" for lowest_compliant lots).
- Use the EXACT lotIds from the rubric.
- For ${rubric.methodology === "cumulative" ? "cumulative" : "lowest_compliant"}: ${rubric.methodology === "cumulative" ? `produce ONE section per criterion across ALL lots; ${rubric.lots.reduce((s, l) => s + l.criteria.length, 0)} sections total.` : `produce ONE section per lot covering all disqualifiers; ${rubric.lots.length} sections total.`}
- Claims must be specific and tied back to applicant evidence. If you write "Atlas has ISO 9001", make ISO 9001 a claim with provenance "applicant_library".
- Mark a claim "gap" when the applicant context does NOT contain the required evidence. Sprint 2 surfaces these explicitly to the user — do not hide them in confident prose.

AGGREGATION RULE (Sprint 4.6 — added 2026-05-24 after A5 empirical check):
  If a claim states a TOTAL or COMBINED value across multiple contracts /
  engagements / years (e.g. "combined past-performance value: USD X",
  "total years of relevant experience: Y", "served Z countries"),
  EVERY component of the sum MUST be an applicant_library claim somewhere
  in the same section AND the arithmetic must check out. If you cannot
  list the named components AND have them sum to the stated aggregate,
  the aggregate is provenance="gap", note explaining what is missing —
  NOT "inferred". A fabricated aggregate tagged "inferred" is the
  worst kind of failure mode for this product because it ACTIVELY
  misleads the buyer. When in doubt, omit the aggregate and let the
  individual contracts stand on their own.

DEPENDENCY RULE (Sprint 4.6 — A5 finding #6, OEM-auth cascade case):
  When a section cites a document, certificate, or authorisation as
  supporting evidence (OEM authorisation letters, audited financials,
  partnership MoUs, ISO certificates, named-personnel CVs, sanctions
  declarations), and the applicant context does NOT confirm that
  document is in hand, EVERY section that depends on it must include
  a claim of provenance="gap" naming the missing dependency. Do NOT
  cite the document as confirmed evidence in section X while another
  section Y flags it as missing — that's a cross-section inconsistency
  a senior evaluator catches immediately. A separate cascade-
  detection pass runs after this draft (cross-section-cascade.ts),
  but solving this inline reduces post-processing dependencies.

- Do not output markdown. content is plain prose.
- Return ONLY valid JSON.${isRevision ? "\n- Revision mode: ONLY output sections for the criteria listed in REVISION GUIDANCE. Do not include other sections." : ""}`;
}

function normalizeDraftSection(raw: Partial<DraftSection>): DraftSection {
  return {
    lotId: raw.lotId ? String(raw.lotId) : undefined,
    criterionId: String(raw.criterionId ?? ""),
    content: String(raw.content ?? "").slice(0, 8000),
    claims: Array.isArray(raw.claims) ? raw.claims.map(normalizeClaim).filter((c) => c.text.length > 0) : [],
  };
}

function normalizeClaim(raw: Partial<Claim>): Claim {
  const VALID_KINDS: ProvenanceKind[] = ["uploaded_document", "applicant_library", "inferred", "gap"];
  const provRaw = raw.provenance as Partial<Claim["provenance"]> | undefined;
  const kind: ProvenanceKind = provRaw && VALID_KINDS.includes(provRaw.kind as ProvenanceKind)
    ? (provRaw.kind as ProvenanceKind)
    : "inferred";
  return {
    text: String(raw.text ?? "").slice(0, 600),
    provenance: {
      kind,
      sourceRef: provRaw?.sourceRef,
      note: provRaw?.note ? String(provRaw.note).slice(0, 400) : undefined,
    },
  };
}

/** Merge revised sections over prior sections (preserving sections not revised). */
function mergeRevision(prior: DraftSection[], revised: DraftSection[]): DraftSection[] {
  const revisedById = new Map<string, DraftSection>();
  for (const s of revised) revisedById.set(s.criterionId, s);
  return prior.map((p) => revisedById.get(p.criterionId) ?? p);
}
