/**
 * rubric-extractor.ts — turn a LoadedTender into a TenderRubric.
 *
 * One Claude Sonnet call with:
 *   - tender metadata as a strong prior (lane, methodology, lotMetadata)
 *   - prioritized + truncated document texts (rubric-bearing roles first)
 *   - binding Q&A clarifications as authoritative refinements
 *
 * Sprint 1 scope per docs/agents/proposal-engine-build-plan.md. Always sets
 * rubricVersion=1 on first extraction; Sprint 3's reextractAndDiff bumps it
 * on amendments. Wires into DefaultScoringEngine.extractRubric.
 *
 * Uses the same safeParseJSON pattern as llm.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  TenderRubric,
  TenderInput,
  LotRubric,
  Disqualifier,
  EvaluationCriterion,
  IngestedDoc,
  SourceRef,
  Methodology,
  RubricExtractionConfidence,
} from "./scoring-engine";
import type { LoadedTender } from "./manifest-loader";
import { filterBinding } from "./qa-extractor";
import { safeParseJSON } from "./llm";

const SONNET_MODEL = "claude-sonnet-4-6";
const PROMPT_DOC_BUDGET_CHARS = 180_000;
const PROMPT_PER_DOC_CAP_CHARS = 60_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 180_000 });
  }
  return _client;
}

/** High-level convenience: load a tender + extract its rubric in one call. */
export async function extractRubricFromTender(tender: LoadedTender): Promise<TenderRubric> {
  const input = toTenderInput(tender);
  return extractRubricFromInput(input, tender.docs);
}

/** Implements ScoringEngine.extractRubric. The docs list arg also lives in
 *  `input.docs`; we accept it as a separate param so the assembly step has a
 *  stable handle to the IngestedDoc[] without re-walking input. */
export async function extractRubricFromInput(
  input: TenderInput,
  docsForAssembly?: IngestedDoc[],
  corrections?: string[],
): Promise<TenderRubric> {
  const docs = docsForAssembly ?? input.docs;
  const client = getClient();

  const docsBlock = formatDocsForPrompt(docs);
  const qaBlock = formatBindingQA(input.bindingClarifications ?? []);
  // Loop 4: promoted, human-curated extraction corrections for this agency's
  // tender format, injected as a prior so the extractor stops repeating known
  // format-specific mistakes. Empty string when there are none.
  const correctionsBlock = formatCorrectionsForPrompt(corrections ?? []);
  const lotMetaJson = JSON.stringify(input.lotMetadata, null, 2);

  const prompt = `You are a UN procurement rubric extractor. Read the document set below and return a structured rubric matching the schema. Do NOT invent criteria or weights — mirror exactly what the call publishes.

TENDER METADATA (authoritative prior — do not contradict):
- tenderId: ${input.tenderId}
- lane: ${input.lane}
- methodology: ${input.methodology}
- lots: ${lotMetaJson}

${docsBlock}

${qaBlock}
${correctionsBlock}
Return a JSON object with EXACTLY these top-level keys:

{
  "lots": [
    {
      "lotId": "<must match a lotId from TENDER METADATA>",
      "label": "<copy from metadata>",
      "scope": "<optional, copy or refine from metadata>",
      "criteria": [
        {
          "id": "<as labelled by the call, e.g. '1.2'>",
          "label": "<short>",
          "weight": <0..1 normalized share; if the rubric is point-based, divide by total max>,
          "maxScore": <number — max points for this criterion>,
          "doubleWeighted": <true | omit if not explicitly double-weighted>,
          "gatingThreshold": <number | omit if no gating threshold published>,
          "source": { "docId": "<from DOCUMENT SET docIds>", "section": "<e.g. 'Section 7.1.4a'>", "rubricVersion": 1 }
        }
      ],
      "disqualifiers": [
        {
          "id": "<short slug>",
          "rule": "<human-readable, e.g. 'Must offer 100% of Lot 1 items and quantities'>",
          "kind": "mandatory_form" | "eligibility" | "format" | "deadline" | "financial",
          "source": { "docId": "<from DOCUMENT SET>", "section": "<e.g. 'Lot 1 Section II'>", "rubricVersion": 1 }
        }
      ],
      "financialFormRef": { "docId": "<docId of the per-lot price form, if one exists>", "section": "<sheet name or section>", "rubricVersion": 1 }
    }
  ],
  "noticeWideDisqualifiers": [
    { "id": "...", "rule": "...", "kind": "...", "source": {...} }
  ]
}

Rules:
1. The "lots" array MUST contain one entry per lotId in TENDER METADATA, in the same order.
2. For methodology="lowest_compliant" (goods RFQs): it is NORMAL for lots to have NO scored criteria (criteria: []) — the rubric is "pass disqualifiers, lowest price wins". All technical-spec failures go in lots[i].disqualifiers (kind: "format" usually).
3. For methodology="cumulative" (services RFPs): populate lots[i].criteria with the actual scoring breakdown.
4. For single-lot tenders (lotMetadata has exactly one entry with lotId "main"), put ALL scored criteria in lots[0].criteria.
5. For multi-lot tenders: identify which lot each criterion or disqualifier belongs to. Look for "Lot N" labels in the source text AND in the DOCUMENT SET filenames (e.g. "Schedule of Requirements _Lot 3.docx").
6. Notice-wide disqualifiers (submission deadline, lead-applicant eligibility, submission channel, page/format/language requirements) go in noticeWideDisqualifiers, NOT per-lot.
7. source.docId MUST be one of the docIds listed in the DOCUMENT SET section. Format is "<noticeId>/<filename>".
8. If a BINDING Q&A clarification refines a criterion or disqualifier, USE the clarified interpretation. Do NOT add the pre-clarification version separately.
9. rubricVersion is ALWAYS 1 for first extraction.
10. Return ONLY valid JSON, no prose around it.`;

  const response = await client.messages.create({
    model: SONNET_MODEL,
    // Multi-lot tenders fan out criteria + disqualifiers per lot, so output can
    // approach 16k tokens. UNOPS RFQ/2026/61438 (3 lots) truncated at 8k on
    // first run with a mid-disqualifier cutoff. 16k matches the pattern
    // established by Sprint 10 + 14 for proposal/roster generation (also
    // Sonnet, also large structured output) — see llm.ts for that history.
    max_tokens: 16000,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<Partial<TenderRubric>>(text, {}, "rubric_extract");

  return assembleTenderRubric(parsed, input, docs);
}

/** Build a TenderInput from a LoadedTender (manifest + docs + Q&A). */
export function toTenderInput(tender: LoadedTender): TenderInput {
  const binding = filterBinding(tender.qaEntries).map((q) => ({
    entryId: q.entryId,
    touches: q.touches,
    content: q.content,
  }));
  return {
    tenderId: tender.manifest.tenderId,
    lane: tender.manifest.lane,
    methodology: tender.manifest.methodology,
    lotMetadata: tender.manifest.lotMetadata,
    docs: tender.docs,
    bindingClarifications: binding.length > 0 ? binding : undefined,
  };
}

function formatDocsForPrompt(docs: IngestedDoc[]): string {
  // Priority order: rubric-bearing roles first so they survive the truncation budget.
  const rolePriority: Record<string, number> = {
    solicitation: 0,
    tor: 1,
    amendment: 2,
    annex: 3,
    qa: 4,
    guidelines: 5,
    info_session: 6,
    supporting: 7,
    draft: 99,
  };
  const sorted = [...docs].sort(
    (a, b) =>
      (rolePriority[a.manifest.role] ?? 99) - (rolePriority[b.manifest.role] ?? 99),
  );

  let budget = PROMPT_DOC_BUDGET_CHARS;
  const blocks: string[] = ["DOCUMENT SET (use these docIds in source.docId):"];
  for (const doc of sorted) {
    if (budget <= 0) break;
    const cap = Math.min(PROMPT_PER_DOC_CAP_CHARS, budget);
    const snippet = doc.text.slice(0, cap);
    if (!snippet) continue;
    const supersedesNote =
      doc.manifest.supersedes && doc.manifest.supersedes.length > 0
        ? ` [supersedes: ${doc.manifest.supersedes.join(", ")}]`
        : "";
    const truncatedNote =
      doc.text.length > cap ? `\n[...truncated; doc total ${doc.text.length} chars]` : "";
    blocks.push(
      `\n=== docId: ${doc.manifest.docId} | role: ${doc.manifest.role}${supersedesNote} ===\n${snippet}${truncatedNote}`,
    );
    budget -= snippet.length;
  }
  return blocks.join("\n");
}

function formatBindingQA(
  binding: Array<{ entryId: string; touches: string; content: string }>,
): string {
  if (binding.length === 0) return "BINDING Q&A CLARIFICATIONS: (none)";
  const blocks = binding.map(
    (q) => `[${q.entryId}] touches: ${q.touches || "(unspecified)"}\n${q.content}`,
  );
  return `BINDING Q&A CLARIFICATIONS (pre-classified; treat as authoritative refinements to the base rubric):\n${blocks.join("\n\n---\n\n")}`;
}

/**
 * Loop 4: format PROMOTED, human-curated extraction corrections for the
 * tender's agency/format into a prompt prior. These encode recurring extraction
 * mistakes a domain expert flagged (e.g. "UNICEF RFPs double-weight the
 * methodology criterion"). Returns "" when there are none. Exported so the
 * acceptance script can exercise the formatting.
 */
export function formatCorrectionsForPrompt(corrections: string[]): string {
  const clean = corrections.map((c) => c.trim()).filter(Boolean);
  if (clean.length === 0) return "";
  const items = clean.map((c, i) => `${i + 1}. ${c}`).join("\n");
  return `KNOWN FORMAT CORRECTIONS (human-curated priors for this agency's tender format — apply each when it fits the documents; they flag recurring extraction mistakes to avoid). Do NOT invent criteria from these; use them only to read the PUBLISHED rubric correctly:\n${items}\n`;
}

function assembleTenderRubric(
  parsed: Partial<TenderRubric>,
  input: TenderInput,
  docs: IngestedDoc[],
): TenderRubric {
  // Trust LLM output for criteria/disqualifiers details, but enforce invariants:
  //  - tender metadata from manifest is authoritative
  //  - lots array order matches input.lotMetadata
  //  - documentSet from loaded tender
  //  - rubricVersion=1 always
  const llmLotsById = new Map<string, LotRubric>();
  for (const lot of parsed.lots ?? []) {
    if (lot && typeof lot.lotId === "string") {
      llmLotsById.set(lot.lotId, normalizeLot(lot));
    }
  }

  const lots: LotRubric[] = input.lotMetadata.map((meta) => {
    const fromLlm = llmLotsById.get(meta.lotId);
    if (fromLlm) {
      return {
        ...fromLlm,
        lotId: meta.lotId,
        label: meta.label,
        scope: fromLlm.scope ?? meta.scope,
      };
    }
    // LLM didn't return this lot — emit an empty shell.
    return {
      lotId: meta.lotId,
      label: meta.label,
      scope: meta.scope,
      criteria: [],
      disqualifiers: [],
    };
  });

  const noticeWideDisqualifiers: Disqualifier[] = Array.isArray(parsed.noticeWideDisqualifiers)
    ? parsed.noticeWideDisqualifiers.filter(isValidDisqualifier).map(normalizeDisqualifier)
    : [];

  // A3: record how confidently we parsed the rubric. lotsReturned counts the
  // lots the LLM actually populated (vs. empty shells emitted above when a lot
  // was missing); docCharsTotal is the raw input the extractor had to work with.
  const lotsReturned = input.lotMetadata.filter((m) => llmLotsById.has(m.lotId)).length;
  const docCharsTotal = docs.reduce((sum, d) => sum + d.text.length, 0);
  const extractionConfidence = computeExtractionConfidence({
    lotsRequested: input.lotMetadata.length,
    lotsReturned,
    lots,
    noticeWideDisqualifiers,
    methodology: input.methodology,
    docCharsTotal,
  });

  return {
    tenderId: input.tenderId,
    lane: input.lane,
    methodology: input.methodology,
    lots,
    noticeWideDisqualifiers,
    documentSet: docs,
    rubricVersion: 1,
    extractionConfidence,
  };
}

/**
 * A3 — mechanical confidence in the extraction. Structural only (no LLM
 * self-rating): reads the completeness of the parsed rubric. Exported so the
 * acceptance script can exercise the banding directly, and so reextract.ts can
 * recompute it after an amendment re-extraction.
 *
 *   low    — a structural failure makes the rubric untrustworthy: a lot failed
 *            to parse, a cumulative tender returned zero criteria, the rubric
 *            is entirely empty, ≥half the criteria lack a readable max score,
 *            or the input was too thin to extract from.
 *   medium — partial gaps: some unanchored criteria/disqualifiers, a missing
 *            max score here and there, or a thinnish document set.
 *   high   — clean: every criterion carries a max score and a source anchor.
 */
export function computeExtractionConfidence(args: {
  lotsRequested: number;
  lotsReturned: number;
  lots: LotRubric[];
  noticeWideDisqualifiers: Disqualifier[];
  methodology: Methodology;
  docCharsTotal: number;
}): RubricExtractionConfidence {
  const { lotsRequested, lotsReturned, lots, noticeWideDisqualifiers, methodology, docCharsTotal } = args;

  const allCriteria = lots.flatMap((l) => l.criteria);
  const allDisqualifiers = [...noticeWideDisqualifiers, ...lots.flatMap((l) => l.disqualifiers)];
  const criteriaTotal = allCriteria.length;
  const criteriaMissingMaxScore = allCriteria.filter((c) => !(c.maxScore > 0)).length;
  const criteriaMissingSource = allCriteria.filter((c) => !c.source.docId).length;
  const disqualifiersMissingSource = allDisqualifiers.filter((d) => !d.source.docId).length;
  // A scored (cumulative) tender that came back with zero criteria means the
  // rubric format defeated extraction. lowest_compliant tenders legitimately
  // have no scored criteria (pass disqualifiers, lowest price wins) so they
  // are NOT flagged here.
  const expectedScoredButEmpty = methodology === "cumulative" && criteriaTotal === 0;
  // Nothing at all parsed — neither criteria nor disqualifiers — is an empty
  // rubric regardless of methodology.
  const emptyRubric = criteriaTotal === 0 && allDisqualifiers.length === 0;

  const warnings: string[] = [];
  if (lotsReturned < lotsRequested) {
    warnings.push(
      `We could not parse ${lotsRequested - lotsReturned} of ${lotsRequested} lot(s) — those were left empty.`,
    );
  }
  if (expectedScoredButEmpty) {
    warnings.push(
      "This is a scored (cumulative) tender, but no scoring criteria could be extracted — the rubric may be in a format we could not read.",
    );
  }
  if (emptyRubric) {
    warnings.push("No scoring criteria or disqualifiers could be extracted from this tender.");
  }
  if (criteriaTotal > 0 && criteriaMissingMaxScore > 0) {
    warnings.push(
      `${criteriaMissingMaxScore} of ${criteriaTotal} criteria came back without a readable maximum score.`,
    );
  }
  if (criteriaTotal > 0 && criteriaMissingSource > 0) {
    warnings.push(
      `${criteriaMissingSource} of ${criteriaTotal} criteria could not be anchored to a source clause.`,
    );
  }
  if (allDisqualifiers.length > 0 && disqualifiersMissingSource > 0) {
    warnings.push(
      `${disqualifiersMissingSource} of ${allDisqualifiers.length} disqualifiers could not be anchored to a source clause.`,
    );
  }
  if (docCharsTotal < 2000) {
    warnings.push(
      "The tender document set was very thin — there may not have been enough text to extract a reliable rubric.",
    );
  }

  const halfCriteriaMissingScore = criteriaTotal > 0 && criteriaMissingMaxScore / criteriaTotal >= 0.5;
  let level: RubricExtractionConfidence["level"];
  if (expectedScoredButEmpty || emptyRubric || lotsReturned < lotsRequested || halfCriteriaMissingScore || docCharsTotal < 2000) {
    level = "low";
  } else if (criteriaMissingMaxScore > 0 || criteriaMissingSource > 0 || disqualifiersMissingSource > 0 || docCharsTotal < 10000) {
    level = "medium";
  } else {
    level = "high";
  }

  return {
    level,
    warnings,
    signals: {
      lotsRequested,
      lotsReturned,
      criteriaTotal,
      criteriaMissingMaxScore,
      criteriaMissingSource,
      disqualifiersMissingSource,
      expectedScoredButEmpty,
      emptyRubric,
      docCharsTotal,
    },
  };
}

function normalizeLot(lot: Partial<LotRubric>): LotRubric {
  return {
    lotId: String(lot.lotId ?? ""),
    label: String(lot.label ?? ""),
    scope: lot.scope ? String(lot.scope) : undefined,
    criteria: Array.isArray(lot.criteria)
      ? lot.criteria.filter(isValidCriterion).map(normalizeCriterion)
      : [],
    disqualifiers: Array.isArray(lot.disqualifiers)
      ? lot.disqualifiers.filter(isValidDisqualifier).map(normalizeDisqualifier)
      : [],
    financialFormRef:
      lot.financialFormRef && isValidSourceRef(lot.financialFormRef)
        ? normalizeSourceRef(lot.financialFormRef)
        : undefined,
  };
}

function normalizeCriterion(c: Partial<EvaluationCriterion>): EvaluationCriterion {
  return {
    id: String(c.id ?? ""),
    label: String(c.label ?? ""),
    weight:
      typeof c.weight === "number" && Number.isFinite(c.weight)
        ? Math.max(0, Math.min(1, c.weight))
        : 0,
    maxScore:
      typeof c.maxScore === "number" && Number.isFinite(c.maxScore) ? c.maxScore : 0,
    doubleWeighted: c.doubleWeighted === true ? true : undefined,
    gatingThreshold:
      typeof c.gatingThreshold === "number" && Number.isFinite(c.gatingThreshold)
        ? c.gatingThreshold
        : undefined,
    source: normalizeSourceRef(c.source),
  };
}

function normalizeDisqualifier(d: Partial<Disqualifier>): Disqualifier {
  const VALID_KINDS = [
    "mandatory_form",
    "eligibility",
    "format",
    "deadline",
    "financial",
  ] as const;
  const kind: Disqualifier["kind"] = (VALID_KINDS as readonly string[]).includes(
    String(d.kind),
  )
    ? (d.kind as Disqualifier["kind"])
    : "format";
  return {
    id: String(d.id ?? ""),
    rule: String(d.rule ?? ""),
    kind,
    source: normalizeSourceRef(d.source),
  };
}

function isValidCriterion(c: unknown): c is Partial<EvaluationCriterion> {
  return Boolean(
    c &&
      typeof c === "object" &&
      typeof (c as Partial<EvaluationCriterion>).id === "string",
  );
}

function isValidDisqualifier(d: unknown): d is Partial<Disqualifier> {
  return Boolean(
    d && typeof d === "object" && typeof (d as Partial<Disqualifier>).rule === "string",
  );
}

function isValidSourceRef(s: unknown): boolean {
  if (!s || typeof s !== "object") return false;
  const ref = s as { docId?: unknown };
  return typeof ref.docId === "string";
}

function normalizeSourceRef(s: unknown): SourceRef {
  if (s && typeof s === "object") {
    const ref = s as { docId?: unknown; section?: unknown };
    return {
      docId: String(ref.docId ?? ""),
      section: typeof ref.section === "string" ? ref.section : undefined,
      rubricVersion: 1,
    };
  }
  return { docId: "", rubricVersion: 1 };
}
