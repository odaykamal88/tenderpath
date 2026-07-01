/**
 * PAID deep proposal review (P1.1). The senior-tier adjudication of the
 * applicant's OWN draft against the call's published rubric — the depth the free
 * compliance-gap check gates up to.
 *
 * "One spine, two SKUs" (scoring-engine-spec.md): this reuses the SAME
 * `extractRubricFromInput` + `scoreDraft` the $299 draft uses. The applicant's
 * draft enters as `IngestedDoc.role = 'draft'` (the seam the engine was designed
 * for), gets mapped to the rubric's criteria, is scored, and the `ScoreResult`
 * SEEDS the full `ReviewOutput`. The seed step (`buildReviewOutputFromScore`) is
 * PURE and unit-tested; the LLM orchestration around it owes a live walk.
 *
 * Guardrails respected: mirror the published rubric via extractRubric (never
 * invent one); evidence-vs-inference at the field level; contestability folded in
 * but ORTHOGONAL to the score; rendering (when added) exits only via pdfDocs.tsx.
 */

import { extractRubricFromInput } from "./rubric-extractor";
import { scoreDraft } from "./rubric-scorer";
import type {
  TenderInput,
  TenderRubric,
  ScoreResult,
  DraftSection,
  IngestedDoc,
  Confidence,
  Disqualifier,
  Methodology,
} from "./scoring-engine";
import { classifyContestability } from "@/lib/tenders/contestability";
import { deriveGoNoGo } from "./compliance-check";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ReviewOutput,
  CallRef,
  ApplicantRef,
  ScoringRow,
  AdminGate,
  EvaluationRisk,
  Strength,
  PriorityFix,
  ReadinessRow,
  ReviewSeverity,
  ReviewEvidenceLabel,
  ThresholdClearance,
  ComplianceContestability,
  EvaluationRubric,
  RubricSection,
  Rewrite,
} from "./review-types";

const AGENT_VERSION = "review-deep-1";

// ── Pure helpers ─────────────────────────────────────────────────────────────
function confToEvidence(c: Confidence): ReviewEvidenceLabel {
  return c === "evidenced" ? "evidence" : c === "inferred" ? "inference" : c; // 'gap' | 'unverified' pass through
}

/** How much of the gap-to-max is realistically recoverable, by LLM confidence. */
function gapClosability(c: Confidence): number {
  return c === "evidenced" ? 0.85 : c === "inferred" ? 0.7 : c === "unverified" ? 0.5 : 0.4;
}

interface CriterionMeta {
  label: string;
  maxScore: number;
  doubleWeighted: boolean;
  lotId: string;
  lotLabel: string;
}

function indexCriteria(rubric: TenderRubric): Map<string, CriterionMeta> {
  const idx = new Map<string, CriterionMeta>();
  for (const lot of rubric.lots) {
    for (const c of lot.criteria) {
      idx.set(c.id, {
        label: c.label,
        maxScore: c.maxScore,
        doubleWeighted: Boolean(c.doubleWeighted),
        lotId: lot.lotId,
        lotLabel: lot.label,
      });
    }
  }
  return idx;
}

function rubricToEvaluationRubric(rubric: TenderRubric): EvaluationRubric {
  const sections: RubricSection[] = rubric.lots.map((lot) => ({
    label: lot.label,
    max_score: lot.criteria.reduce((s, c) => s + c.maxScore, 0),
    criteria: lot.criteria.map((c) => ({
      id: c.id,
      label: c.label,
      max_score: c.maxScore,
      weight_multiplier: c.doubleWeighted ? 2 : 1,
      question: c.label, // EvaluationCriterion carries no verbatim question; label is the best anchor we hold
    })),
  }));
  return {
    name: `Extracted rubric v${rubric.rubricVersion}`,
    sections,
    total_max: sections.reduce((s, sec) => s + sec.max_score, 0),
  };
}

function disqualifierGate(d: Disqualifier, triggered: boolean): AdminGate {
  return {
    id: d.id,
    label: d.rule,
    status: triggered ? "missing" : "ok",
    severity: "BLOCK", // disqualifiers are administrative rejection gates regardless of pass/fail
    action: triggered ? `Resolve before submission: ${d.rule}` : "Verified addressed — keep it that way through final packaging.",
    owner: "Bid lead",
    evidence_label: "evidence",
    note: d.source?.section ? `Source: ${d.source.section}` : undefined,
  };
}

export interface BuildReviewInput {
  rubric: TenderRubric;
  score: ScoreResult;
  call: CallRef;
  applicant: ApplicantRef;
  contestability: ComplianceContestability;
  workOrderId: number;
  revision: number;
}

/**
 * PURE: seed a full ReviewOutput from a ScoreResult. This is the "spine seeds the
 * review" seam. No IO — fully unit-tested (proposal-review-deep-smoke).
 */
export function buildReviewOutputFromScore(input: BuildReviewInput): ReviewOutput {
  const { rubric, score, call, applicant, contestability } = input;
  const idx = indexCriteria(rubric);

  const triggeredIds = new Set<string>([
    ...score.noticeWideDisqualifiersTriggered.map((d) => d.id),
    ...score.lotResults.flatMap((l) => l.lotDisqualifiersTriggered.map((d) => d.id)),
  ]);

  // Scoring rows + strengths + risks from every scored criterion.
  const scoring: ScoringRow[] = [];
  const strengths: Strength[] = [];
  const evaluation_risks: EvaluationRisk[] = [];

  for (const lot of score.lotResults) {
    for (const a of lot.perCriterion) {
      const meta = idx.get(a.criterionId);
      const max = a.maxScore || meta?.maxScore || 0;
      const mult = meta?.doubleWeighted ? 2 : 1;
      const achievable = Math.min(max, Math.round(a.estimatedScore + (max - a.estimatedScore) * gapClosability(a.confidence)));
      const evidence_label = confToEvidence(a.confidence);
      const label = meta?.label ?? a.criterionId;

      scoring.push({
        criterion_id: a.criterionId,
        current_score: a.estimatedScore,
        achievable_score: achievable,
        rationale:
          [...a.weaknesses, ...a.missingEvidence].slice(0, 3).join(" ") ||
          `Scored ${a.estimatedScore}/${max} on ${label}.`,
        evidence_label,
        source_refs: [],
      });

      const ratio = max > 0 ? a.estimatedScore / max : 0;
      if (ratio >= 0.75) {
        strengths.push({
          label,
          where_in_proposal: `Response to ${a.criterionId}`,
          why_it_matters: `Scores near the top of this criterion (${a.estimatedScore}/${max})${mult > 1 ? " — and it is double-weighted, so the margin compounds." : "."}`,
          tied_to: "rubric_advantage",
          evidence_label,
          source_refs: [],
        });
      }
      if (a.estimatedScore < max) {
        evaluation_risks.push({
          criterion_id: a.criterionId,
          exposure_points: (max - a.estimatedScore) * mult,
          what_is_missing: [...a.missingEvidence, ...a.weaknesses].slice(0, 2).join(" ") || `Room to gain on ${label}.`,
          evidence_label,
        });
      }
    }
  }
  evaluation_risks.sort((a, b) => b.exposure_points - a.exposure_points);

  // Admin gates from ALL disqualifiers (triggered → BLOCK/missing, else BLOCK/ok).
  const allDisqualifiers: Disqualifier[] = [
    ...rubric.noticeWideDisqualifiers,
    ...rubric.lots.flatMap((l) => l.disqualifiers),
  ];
  const seenGate = new Set<string>();
  const admin_gates: AdminGate[] = [];
  for (const d of allDisqualifiers) {
    if (seenGate.has(d.id)) continue;
    seenGate.add(d.id);
    admin_gates.push(disqualifierGate(d, triggeredIds.has(d.id)));
  }

  // Priority fixes: triggered disqualifiers first (BLOCK), then top scoring risks.
  const fixes: Omit<PriorityFix, "rank">[] = [];
  for (const g of admin_gates.filter((g) => g.status === "missing")) {
    fixes.push({
      severity: "BLOCK",
      issue: `Administrative blocker: ${g.label}`,
      fix: g.action,
      owner: g.owner,
      deadline: "Now",
      addresses_criteria: [],
      addresses_admin_gates: [g.id],
    });
  }
  for (const r of evaluation_risks.slice(0, 5)) {
    const meta = idx.get(r.criterion_id);
    const severity: ReviewSeverity = r.exposure_points >= 8 || meta?.doubleWeighted ? "HIGH" : "MED";
    fixes.push({
      severity,
      issue: `${meta?.label ?? r.criterion_id}: ${Math.round(r.exposure_points)} pts exposed`,
      fix: r.what_is_missing,
      owner: "Bid lead",
      deadline: call.deadline ?? "Before submission",
      addresses_criteria: [r.criterion_id],
      addresses_admin_gates: [],
    });
  }
  const sevRank: Record<ReviewSeverity, number> = { BLOCK: 0, HIGH: 1, MED: 2, LOW: 3 };
  const priority_fixes: PriorityFix[] = fixes
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
    .map((f, i) => ({ ...f, rank: i + 1 }));

  // Totals + threshold clearance.
  const current = scoring.reduce((s, r) => s + r.current_score, 0);
  const achievable = scoring.reduce((s, r) => s + r.achievable_score, 0);
  const max = scoring.reduce((s, r) => s + (idx.get(r.criterion_id)?.maxScore ?? 0), 0);
  const anyFail = triggeredIds.size > 0 || score.lotResults.some((l) => !l.passesGating);
  const clearance: ThresholdClearance = anyFail ? "fails" : max > 0 && current / max < 0.6 ? "borderline" : "clears";

  const submission_readiness: ReadinessRow[] = admin_gates.map((g) => ({
    item: g.label,
    status: g.status,
    action: g.action,
    severity: g.severity,
  }));

  // go/no-go leans on the CLEARANCE + contestability, plus any ADMINISTRATIVE
  // blocker (a missing BLOCK gate). Routine scoring exposure (HIGH point gaps) is
  // upside to fix, not a reason to lean caution on an otherwise-clearing bid.
  const blockingGates = admin_gates.filter((g) => g.status === "missing").length;
  const verdictStatus = anyFail ? "blocked" : clearance === "borderline" ? "at_risk" : "clears";
  const go_no_go = deriveGoNoGo(verdictStatus, contestability.band, blockingGates);

  return {
    kind: "review",
    ref_tag: `REV-${(call.agency ?? call.title ?? "CALL").toString().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 8) || "CALL"}-${String(input.revision).padStart(3, "0")}`,
    work_order_id: input.workOrderId,
    revision: input.revision,
    generated_at: new Date().toISOString(),
    agent_version: AGENT_VERSION,
    call,
    applicant,
    rubric: rubricToEvaluationRubric(rubric),
    scoring,
    scoring_totals: { current, achievable, max, threshold_clearance: clearance },
    admin_gates,
    mandatory_exclusions: [],
    strengths: strengths.slice(0, 8),
    evaluation_risks,
    priority_fixes,
    rewrites: [], // drop-in rewrites are a follow-on LLM pass
    submission_readiness,
    timeline: [],
    contestability,
    go_no_go,
    evidence_used: [],
    output_quality: {
      status: anyFail ? "blocked" : rubric.extractionConfidence?.level === "low" || scoring.length === 0 ? "needs_review" : "ready",
      score_0_10: scoring.length === 0 ? 3 : anyFail ? 5 : rubric.extractionConfidence?.level === "low" ? 6 : 8,
      missing_inputs: scoring.length === 0 ? ["No scored criteria — the rubric could not be extracted from the provided call text."] : [],
      warnings: rubric.extractionConfidence?.warnings ?? [],
    },
  };
}

// ── LLM: map the applicant's draft to the rubric's criteria ──────────────────
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * Map an applicant's free-text draft into DraftSection[] keyed by rubric criterion.
 * Uses the shared Anthropic client via review-llm's module (Haiku). On any failure
 * it degrades to assigning the full draft to every criterion so scoreDraft still
 * has the text to judge (indicative, never silently empty).
 */
export async function mapDraftToSections(rubric: TenderRubric, draftText: string): Promise<DraftSection[]> {
  const criteria = rubric.lots.flatMap((lot) => lot.criteria.map((c) => ({ lotId: lot.lotId, id: c.id, label: c.label })));
  if (criteria.length === 0) return [];

  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = (): DraftSection[] =>
    criteria.map((c) => ({ lotId: c.lotId, criterionId: c.id, content: draftText.slice(0, 6000), claims: [] }));
  if (!key) return fallback();

  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60_000 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: `Split this proposal draft into the parts that answer each evaluation criterion. Assign the relevant
excerpt(s) of the draft to each criterion id. If a criterion is not addressed anywhere, return an empty string for it.

CRITERIA:
${criteria.map((c) => `- ${c.id} (lot ${c.lotId}): ${c.label}`).join("\n")}

DRAFT:
${draftText.slice(0, 18000)}

Return ONLY JSON: { "sections": [ { "lotId": "...", "criterionId": "...", "content": "the relevant draft excerpt, or empty string" } ] }`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    const parsed = JSON.parse((fenced ? fenced[1] : text).trim()) as { sections?: Array<{ lotId?: string; criterionId?: string; content?: string }> };
    const rows = Array.isArray(parsed.sections) ? parsed.sections : [];
    const byId = new Map(rows.filter((r) => r.criterionId).map((r) => [String(r.criterionId), r]));
    return criteria.map((c) => {
      const row = byId.get(c.id);
      return {
        lotId: c.lotId,
        criterionId: c.id,
        content: typeof row?.content === "string" && row.content.trim() ? row.content : "",
        claims: [],
      };
    });
  } catch (err) {
    console.error("[proposal-review:draft_mapping_failed]", { error: err instanceof Error ? err.message : String(err) });
    return fallback();
  }
}

const SONNET_MODEL = "claude-sonnet-4-6";

/**
 * PURE: validate + coerce raw LLM rewrites, dropping any without replacement text
 * and any addresses_fixes that don't map to a real priority-fix rank. Caps at 3.
 */
export function sanitizeRewrites(raw: unknown, validRanks: Set<number>): Rewrite[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: Rewrite[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const suggested = typeof r.suggested_text === "string" ? r.suggested_text.trim() : "";
    if (!suggested) continue; // no drop-in text → not a rewrite (never fabricate)
    const addresses = Array.isArray(r.addresses_fixes)
      ? r.addresses_fixes.map((n) => Number(n)).filter((n) => Number.isInteger(n) && validRanks.has(n))
      : [];
    out.push({
      section_id: typeof r.section_id === "string" && r.section_id.trim() ? r.section_id.trim() : "draft",
      current_text: typeof r.current_text === "string" ? r.current_text : "",
      suggested_text: suggested,
      addresses_fixes: addresses,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
    });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Drop-in editorial for the highest-impact fixes (Sonnet — this is the paid
 * tier's teeth: "drop-in over directional"). Grounds each rewrite in the
 * applicant's own draft where the section exists. Degrades honestly to [] on
 * missing key / parse failure — never fabricates editorial the model didn't
 * produce.
 */
export async function generateRewrites(sections: DraftSection[], fixes: PriorityFix[]): Promise<Rewrite[]> {
  const targets = fixes.slice(0, 3);
  if (targets.length === 0) return [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return [];

  const validRanks = new Set(targets.map((f) => f.rank));
  const contentByCriterion = new Map(sections.map((s) => [s.criterionId, s.content]));
  const fixBlocks = targets
    .map((f) => {
      const excerpt = f.addresses_criteria
        .map((cid) => contentByCriterion.get(cid))
        .filter(Boolean)
        .join("\n")
        .slice(0, 2000);
      return `Fix #${f.rank} [${f.severity}] ${f.issue}\nAction: ${f.fix}\nRelevant draft excerpt:\n${excerpt || "(this criterion is not addressed in the draft — write a concise addition)"}`;
    })
    .join("\n\n---\n\n");

  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 90_000 });
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 3000,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: `You are a senior proposal editor. For the highest-impact fixes below, write DROP-IN replacement text
the applicant can paste straight into their proposal. Provide the text itself — do not describe what good text would
look like. Ground each rewrite in the applicant's own draft where the section exists; where it is absent, write a
concise addition. Stay specific to this call; no generic "strategic alignment" filler.

${fixBlocks}

Return ONLY JSON: { "rewrites": [ { "section_id": "which part of the draft", "current_text": "quoted from the draft, or empty for an addition", "suggested_text": "the drop-in replacement text", "addresses_fixes": [fix rank numbers], "rationale": "one line on what changed and why" } ] }  (2-3 rewrites maximum).`,
        },
      ],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "";
    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
    const parsed = JSON.parse((fenced ? fenced[1] : text).trim()) as { rewrites?: unknown };
    return sanitizeRewrites(parsed.rewrites, validRanks);
  } catch (err) {
    console.error("[proposal-review:rewrites_failed]", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function guessMethodology(opportunityType: string | null | undefined): Methodology {
  const t = (opportunityType ?? "").toLowerCase();
  if (/\bitb\b|invitation to bid|\brfq\b|request for quotation|goods|supply/.test(t)) return "lowest_compliant";
  return "cumulative";
}

export interface DeepReviewTender {
  tender_id: number | null;
  title: string;
  agency: string | null;
  country: string | null;
  deadline: string | null;
  opportunity_type: string | null;
  description?: string | null;
}

export interface GenerateDeepReviewInput {
  tender: DeepReviewTender;
  /** Full solicitation / TOR text if the customer pasted it (richer than tender.description). */
  solicitationText?: string | null;
  draftText: string;
  applicant: ApplicantRef;
  workOrderId?: number;
  revision?: number;
}

/**
 * Fulfillment entry point for the deep review. Reachable via the admin endpoint
 * today (self-serve ~$150 checkout is P0.4-gated). Returns the ReviewOutput;
 * caller persists + logs. Owes a live end-to-end walk (3 chained LLM calls).
 */
export async function generateDeepReview(input: GenerateDeepReviewInput): Promise<ReviewOutput> {
  const { tender, draftText, applicant } = input;
  const solicitation = (input.solicitationText || tender.description || tender.title || "").trim();

  const solicitationDoc: IngestedDoc = {
    manifest: {
      docId: `sol-${tender.tender_id ?? hash(solicitation)}`,
      filename: "solicitation.txt",
      contentHash: hash(solicitation),
      role: "solicitation",
    },
    text: solicitation,
  };

  const tenderInput: TenderInput = {
    tenderId: String(tender.tender_id ?? `paste-${hash(solicitation)}`),
    lane: "procurement",
    methodology: guessMethodology(tender.opportunity_type),
    lotMetadata: [{ lotId: "main", label: tender.title || "Opportunity" }],
    docs: [solicitationDoc],
  };

  const rubric = await extractRubricFromInput(tenderInput, [solicitationDoc]);
  const sections = await mapDraftToSections(rubric, draftText);
  const score = await scoreDraft(sections, rubric);

  const contestabilitySignal = classifyContestability({
    title: tender.title,
    description: tender.description ?? null,
    opportunityType: tender.opportunity_type,
  });

  const review = buildReviewOutputFromScore({
    rubric,
    score,
    call: {
      tender_id: tender.tender_id,
      title: tender.title,
      agency: tender.agency,
      country: tender.country,
      deadline: tender.deadline,
      opportunity_type: tender.opportunity_type,
    },
    applicant,
    contestability: {
      band: contestabilitySignal.band,
      line: contestabilitySignal.line,
      basis: contestabilitySignal.basis,
    },
    workOrderId: input.workOrderId ?? 0,
    revision: input.revision ?? 1,
  });

  // Drop-in editorial for the top fixes (the paid tier's teeth). Best-effort:
  // an empty rewrites list is honest, never a blocker.
  review.rewrites = await generateRewrites(sections, review.priority_fixes);
  return review;
}
