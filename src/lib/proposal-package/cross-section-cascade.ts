/**
 * cross-section-cascade.ts — Sprint 4.6 backstop for evidence-dependency cascades.
 *
 * The A5 empirical check (sprint4-5-a5-check.ts) caught this class of bug
 * in the UNICEF run: section 1.3 surfaced a `gap` claim — "OEM authorisation
 * letters are referenced but not confirmed as attached" — yet sections
 * 1.2, 1.4, 2.1, and 2.2b cited OEM authorisation as confirmed evidence
 * without acknowledging the upstream gap. A senior evaluator catches this
 * immediately; the result is that downstream "evidenced" claims are
 * actually at risk and the score should reflect it.
 *
 * The draft-generator prompt was tightened in Sprint 4.6 (DEPENDENCY RULE)
 * to surface these inline. This module is the backstop: a single LLM call
 * after generation that audits cross-section consistency, identifies any
 * cascades the LLM missed, and APPLIES THEM TO THE DRAFT by appending
 * gap-provenance claims to the affected sections. The cascaded gap then
 * flows through scoring + routing naturally (the gap-routing rules pick
 * up the cascade text via the same vocabulary it uses for any other gap).
 *
 * Deterministic from the LLM's perspective in the sense that we don't
 * re-judge anything — we only enrich the draft with cascades the model
 * identifies. The cascaded gaps are tagged with note="cascade from <id>"
 * so the UI can show the upstream link.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { DraftSection, Claim } from "./scoring-engine";
import type { ApplicantContext } from "./applicant-context";
import { safeParseJSON } from "./llm";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 120_000 });
  }
  return _client;
}

interface Cascade {
  sourceCriterionId: string; // section that flagged the gap
  missingArtifact: string;   // human-readable name of the missing evidence
  downstreamCriterionIds: string[]; // sections that cite this artifact without acknowledging the gap
  downgradeReason: string;   // short rationale
}

/**
 * Detect cross-section evidence-dependency cascades in a draft.
 *
 * Sends a single Haiku call (the cheapest model — this is structural pattern
 * matching, not deep reasoning). Returns the cascades found; callers
 * typically pass these straight to applyCascadesToDraft.
 *
 * Empty draft or no gap-provenance claims = no cascades, no LLM call.
 */
export async function detectCrossSectionCascades(
  draft: DraftSection[],
  _applicant?: ApplicantContext,
): Promise<Cascade[]> {
  // Only meaningful if at least one section already flags a gap to cascade from.
  const hasGapClaims = draft.some((s) => s.claims.some((c) => c.provenance.kind === "gap"));
  if (!hasGapClaims) return [];

  const client = getClient();

  const sectionsBlock = draft
    .map((s) => {
      const claimLines = s.claims
        .map((c) => `    [${c.provenance.kind}] ${c.text.slice(0, 240)}${c.provenance.note ? ` — note: ${c.provenance.note.slice(0, 120)}` : ""}`)
        .join("\n");
      return `### section criterionId=${s.criterionId} (lot=${s.lotId ?? "main"})\nContent: ${s.content.slice(0, 1200)}\nClaims:\n${claimLines || "  (no claims)"}`;
    })
    .join("\n\n");

  const prompt = `You are auditing a proposal draft for CROSS-SECTION EVIDENCE-DEPENDENCY CASCADES.

A cascade is this pattern: section X surfaces a "gap" claim about a specific document or certificate ("OEM authorisation letters not attached", "audited financials not provided", "named partner MoUs missing"), AND other sections cite the SAME document as confirmed evidence WITHOUT acknowledging that it's missing. A senior procurement evaluator treats every downstream citation as suspect when the upstream gap is real.

YOUR JOB: identify every such cascade in the draft below. Be specific — name the missing artifact, name the section that flagged the gap, name every other section that depends on the same artifact.

DRAFT SECTIONS:
${sectionsBlock}

Return a JSON object:
{
  "cascades": [
    {
      "sourceCriterionId": "<criterionId of the section that flagged the gap>",
      "missingArtifact": "<short name of the missing document, e.g. 'OEM authorisation letters' or 'audited financial statements'>",
      "downstreamCriterionIds": ["<criterionId>", "..."],
      "downgradeReason": "<one sentence: why these downstream sections are at risk given the upstream gap>"
    }
  ]
}

Rules:
- ONLY report cascades where the same artifact is BOTH gap-flagged in section X AND cited as evidence in section Y. Do not invent dependencies the draft doesn't actually contain.
- Use the EXACT criterionIds from the draft. Do not invent ids.
- If no cascades exist, return cascades=[].
- Return ONLY valid JSON.`;

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const parsed = safeParseJSON<{ cascades: Cascade[] }>(text, { cascades: [] }, "cross_section_cascade");

  // Defensive normalization
  const valid = (parsed.cascades ?? []).filter(
    (c) =>
      typeof c?.sourceCriterionId === "string" &&
      typeof c?.missingArtifact === "string" &&
      Array.isArray(c?.downstreamCriterionIds) &&
      c.downstreamCriterionIds.length > 0,
  );

  return valid;
}

/**
 * Apply cascades to a draft: append a gap-provenance claim to every
 * affected downstream section. Returns a NEW draft; never mutates the
 * input (claim arrays are cloned to keep immutability for snapshots).
 *
 * Cascaded claims are tagged with provenance.note = "cascade from <id>"
 * so downstream readers (UI, routing) can distinguish them from
 * directly-surfaced gaps.
 */
export function applyCascadesToDraft(
  draft: DraftSection[],
  cascades: Cascade[],
): DraftSection[] {
  if (cascades.length === 0) return draft;

  return draft.map((section) => {
    const newClaims: Claim[] = [...section.claims];
    for (const cascade of cascades) {
      if (!cascade.downstreamCriterionIds.includes(section.criterionId)) continue;
      // Avoid duplicate cascades on the same artifact in the same section.
      const alreadyMarked = newClaims.some(
        (c) => c.provenance.kind === "gap" && (c.text ?? "").toLowerCase().includes(cascade.missingArtifact.toLowerCase()),
      );
      if (alreadyMarked) continue;
      newClaims.push({
        text: `Cascade gap: ${cascade.missingArtifact} flagged as missing in section ${cascade.sourceCriterionId}; this section cites it as evidence.`,
        provenance: {
          kind: "gap",
          note: `cascade from ${cascade.sourceCriterionId}: ${cascade.downgradeReason}`,
        },
      });
    }
    return { ...section, claims: newClaims };
  });
}

/**
 * One-call convenience wrapper for revision-loop.ts: detect + apply.
 */
export async function detectAndApplyCascades(
  draft: DraftSection[],
  applicant?: ApplicantContext,
): Promise<{ draft: DraftSection[]; cascades: Cascade[] }> {
  const cascades = await detectCrossSectionCascades(draft, applicant);
  return { draft: applyCascadesToDraft(draft, cascades), cascades };
}

export type { Cascade };
