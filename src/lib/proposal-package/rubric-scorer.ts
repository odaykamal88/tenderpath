/**
 * rubric-scorer.ts — score a DraftSection[] against a TenderRubric.
 *
 * Sprint 2 scope. The single scoring spine shared by the $299 Proposal Draft
 * (automatic self-check) and the Senior Review (human-confirmed). For each
 * lot in the rubric:
 *   - score per-criterion (cumulative methodology) via ONE batched LLM call
 *     per lot — all criteria scored together to share context
 *   - detect triggered disqualifiers via ONE batched LLM call per lot
 *
 * Notice-wide disqualifiers are detected once across the whole draft (any
 * notice-wide trigger fails every lot the bidder is quoting).
 *
 * Gating logic is deterministic — once per-criterion estimates and
 * disqualifier triggers are in, passesGating is a pure function over them.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  DraftSection,
  TenderRubric,
  ScoreResult,
  LotScoreResult,
  LotRubric,
  CriterionAssessment,
  Disqualifier,
  Confidence,
  EvaluationCriterion,
} from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import { formatApplicantForPrompt } from "./applicant-context";
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

export async function scoreDraft(
  draft: DraftSection[],
  rubric: TenderRubric,
  applicant?: ApplicantContext,
): Promise<ScoreResult> {
  // 1. Score per-criterion + detect disqualifiers per lot (in parallel across lots
  // when there's more than one — but each lot is sequential internally because
  // we want to share context across criteria within a lot).
  const lotResults: LotScoreResult[] = [];
  for (const lot of rubric.lots) {
    const lotDraft = draft.filter((d) => (d.lotId ?? "main") === lot.lotId);

    const perCriterion =
      lot.criteria.length > 0
        ? await scoreCriteriaForLot(lotDraft, lot, applicant)
        : [];

    const lotDisqualifiersTriggered =
      lot.disqualifiers.length > 0
        ? await detectDisqualifiers(lotDraft, lot.disqualifiers, applicant, `lot ${lot.lotId}`)
        : [];

    const estimatedTotal = perCriterion.reduce((s, c) => s + c.estimatedScore, 0);
    const passesLotGating = lotDisqualifiersTriggered.length === 0 && passesPerCriterionGating(perCriterion, lot.criteria);

    lotResults.push({
      lotId: lot.lotId,
      perCriterion,
      estimatedTotal,
      lotDisqualifiersTriggered,
      passesGating: passesLotGating,
    });
  }

  // 2. Detect notice-wide disqualifiers once across the whole draft.
  const noticeWideDisqualifiersTriggered =
    rubric.noticeWideDisqualifiers.length > 0
      ? await detectDisqualifiers(draft, rubric.noticeWideDisqualifiers, applicant, "notice-wide")
      : [];

  // 3. A triggered notice-wide disqualifier fails every lot the bidder is quoting.
  if (noticeWideDisqualifiersTriggered.length > 0) {
    for (const lr of lotResults) lr.passesGating = false;
  }

  return {
    rubricVersion: rubric.rubricVersion,
    lotResults,
    noticeWideDisqualifiersTriggered,
  };
}

// ============================================================================
// Per-criterion scoring (batched LLM call per lot)
// ============================================================================

async function scoreCriteriaForLot(
  lotDraft: DraftSection[],
  lot: LotRubric,
  applicant?: ApplicantContext,
): Promise<CriterionAssessment[]> {
  const client = getClient();
  const applicantBlock = applicant ? formatApplicantForPrompt(applicant) : "(applicant context not provided)";

  const criteriaBlock = lot.criteria
    .map(
      (c) =>
        `  • ${c.id} — ${c.label} (max ${c.maxScore}${c.doubleWeighted ? ", DOUBLE-WEIGHTED" : ""}${c.gatingThreshold != null ? `, gating ≥${c.gatingThreshold}` : ""})`,
    )
    .join("\n");

  const draftBlock = lotDraft
    .map((s) => {
      const claimsLine =
        s.claims.length > 0
          ? `    Claims: ${s.claims.map((cl) => `[${cl.provenance.kind}] ${cl.text.slice(0, 100)}`).join(" | ")}`
          : "    Claims: (none)";
      return `  >>> criterionId: ${s.criterionId}\n  Content: ${s.content.slice(0, 2400)}\n${claimsLine}`;
    })
    .join("\n\n");

  const prompt = `You are simulating a UN procurement evaluation panel. Score each criterion against the draft below. Be honest — under-score when evidence is thin; do not be generous.

LOT: ${lot.lotId} — ${lot.label}${lot.scope ? `\nSCOPE: ${lot.scope}` : ""}

CRITERIA TO SCORE (mirror these ids exactly):
${criteriaBlock}

APPLICANT EVIDENCE (the panel cross-references this against the draft):
${applicantBlock}

DRAFT SECTIONS FOR THIS LOT:
${draftBlock || "  (no draft sections submitted for this lot)"}

Return a JSON object with this exact shape:
{
  "assessments": [
    {
      "criterionId": "<must match a criterion id from the list above>",
      "estimatedScore": <0..maxScore; under-score if the draft doesn't clearly meet the criterion>,
      "confidence": "evidenced" | "inferred" | "gap" | "unverified",
      "weaknesses": [ "<short specific weakness in the draft against this criterion>" ],
      "missingEvidence": [ "<what specific evidence would lift the score>" ]
    }
  ]
}

Confidence rubric:
- "evidenced": the draft cites applicant-library claims that directly satisfy the criterion (past performance with name + year + value, named certifications, named personnel).
- "inferred": the draft makes a plausible case from related applicant evidence but doesn't cite a direct match.
- "gap": the draft doesn't address the criterion or no applicant evidence supports it.
- "unverified": the draft claims something the panel cannot independently confirm (e.g. "we have 50 staff" with no roster).

Rules:
- Return one assessment per criterion in the list above. Do not skip any.
- estimatedScore MUST be a number between 0 and the criterion's maxScore.
- weaknesses and missingEvidence are 1-4 SPECIFIC items each (or empty arrays).
- Use the EXACT criterion ids; do not invent ids.
- Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 8000,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{ assessments: Array<Partial<CriterionAssessment>> }>(
    text,
    { assessments: [] },
    "criteria_scoring",
  );

  return normalizeAssessments(parsed.assessments ?? [], lot.criteria);
}

// ============================================================================
// Disqualifier detection (batched LLM call)
// ============================================================================

async function detectDisqualifiers(
  draft: DraftSection[],
  disqualifiers: Disqualifier[],
  applicant: ApplicantContext | undefined,
  context: string,
): Promise<Disqualifier[]> {
  const client = getClient();
  const applicantBlock = applicant ? formatApplicantForPrompt(applicant) : "(applicant context not provided)";

  const disqBlock = disqualifiers
    .map((d) => `  • id: "${d.id}" | kind: ${d.kind} | rule: ${d.rule.slice(0, 280)}`)
    .join("\n");

  const draftBlock = draft
    .map((s) => `  [${s.lotId ?? "n/a"} / ${s.criterionId}]\n  ${s.content.slice(0, 1800)}`)
    .join("\n\n");

  const prompt = `You are checking whether a procurement draft + applicant context TRIGGERS any of these disqualifiers (i.e. whether the bid would be administratively rejected or technically non-compliant).

CONTEXT: ${context}

DISQUALIFIERS TO CHECK:
${disqBlock}

APPLICANT EVIDENCE:
${applicantBlock}

DRAFT EXCERPTS:
${draftBlock || "  (no draft sections submitted in this context)"}

For each disqualifier above, decide if the bid TRIGGERS it (would be disqualified) based on either the draft content or absences in the applicant evidence. Return a JSON object:

{
  "triggered": [
    { "id": "<disqualifier id from the list>", "reason": "<short explanation of why this triggers — cite the draft section or applicant gap>" }
  ]
}

Rules:
- ONLY include disqualifiers that ARE triggered. If none trigger, return triggered=[].
- A disqualifier triggers when: (a) the draft fails to provide required evidence/forms; (b) the applicant context shows the bid is ineligible (e.g. lead applicant nationality blocks the bid); (c) a technical spec is materially out of compliance.
- A disqualifier does NOT trigger when: applicant evidence + draft claims plausibly satisfy it, even if perfect verification isn't possible.
- DO NOT invent disqualifiers not in the list above.
- Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4000,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{ triggered: Array<{ id: string; reason?: string }> }>(
    text,
    { triggered: [] },
    "disqualifier_detection",
  );

  const triggeredIds = new Set((parsed.triggered ?? []).map((t) => String(t.id)));
  return disqualifiers.filter((d) => triggeredIds.has(d.id));
}

// ============================================================================
// Gating
// ============================================================================

function passesPerCriterionGating(
  assessments: CriterionAssessment[],
  criteria: EvaluationCriterion[],
): boolean {
  for (const c of criteria) {
    if (c.gatingThreshold == null) continue;
    const assess = assessments.find((a) => a.criterionId === c.id);
    if (!assess) return false; // missing assessment for a gated criterion is a fail
    if (assess.estimatedScore < c.gatingThreshold) return false;
  }
  return true;
}

// ============================================================================
// Normalization
// ============================================================================

function normalizeAssessments(
  raw: Array<Partial<CriterionAssessment>>,
  criteria: EvaluationCriterion[],
): CriterionAssessment[] {
  const byId = new Map<string, Partial<CriterionAssessment>>();
  for (const a of raw) if (a && typeof a.criterionId === "string") byId.set(a.criterionId, a);

  return criteria.map((c) => {
    const raw = byId.get(c.id);
    const VALID_CONF: Confidence[] = ["evidenced", "inferred", "gap", "unverified"];
    const confidence: Confidence = raw && VALID_CONF.includes(raw.confidence as Confidence)
      ? (raw.confidence as Confidence)
      : "gap";
    const rawScore = typeof raw?.estimatedScore === "number" && Number.isFinite(raw.estimatedScore)
      ? raw.estimatedScore
      : 0;
    return {
      criterionId: c.id,
      estimatedScore: Math.max(0, Math.min(c.maxScore, rawScore)),
      maxScore: c.maxScore,
      confidence,
      weaknesses: Array.isArray(raw?.weaknesses) ? raw!.weaknesses.filter((s): s is string => typeof s === "string").slice(0, 6) : [],
      missingEvidence: Array.isArray(raw?.missingEvidence) ? raw!.missingEvidence.filter((s): s is string => typeof s === "string").slice(0, 6) : [],
    };
  });
}
