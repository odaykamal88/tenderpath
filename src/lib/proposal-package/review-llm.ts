/**
 * LLM pass for the FREE shallow compliance-gap check (P1.1). Mirrors the
 * bid-no-bid client + safe-parse pattern. Uses Haiku — this is a fast, cheap
 * administrative-gate match of the applicant's draft against the call, NOT the
 * paid deep per-criterion scoring. Degrades honestly: on missing key / parse
 * failure it returns gates marked `unverified` with a plain reason, never a
 * fabricated "all clear".
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ReviewSeverity, ReviewEvidenceLabel, ReviewGateStatus } from "./review-types";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: key, maxRetries: 4, timeout: 60_000 });
  }
  return _anthropic;
}

function safeParseJSON<T>(text: string, fallback: T): T {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    if (start >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try { return JSON.parse(candidate.slice(start, i + 1)) as T; } catch { break; }
          }
        }
      }
    }
    console.error("[proposal-review:json_parse_failed]", { preview: text.slice(0, 220), length: text.length });
    return fallback;
  }
}

export interface RawAdminGate {
  id: string;
  label: string;
  status: ReviewGateStatus;
  severity: ReviewSeverity;
  action: string;
  evidence_label: ReviewEvidenceLabel;
  note?: string;
}
export interface RawExclusion {
  id: string;
  label: string;
  addressed: boolean;
  evidence_label: ReviewEvidenceLabel;
  notes: string;
}
export interface RawTopGap {
  severity: ReviewSeverity;
  issue: string;
  evidence_label: ReviewEvidenceLabel;
  gate_id?: string;
}
export interface RawComplianceFindings {
  admin_gates: RawAdminGate[];
  mandatory_exclusions: RawExclusion[];
  top_gaps: RawTopGap[];
  overall_note: string;
  quality_warnings: string[];
  /** True when this came from the degraded fallback, not the model. */
  degraded?: boolean;
}

/** Honest fallback: we could not run the check — say so, assert nothing. */
export function degradedFindings(reason: string): RawComplianceFindings {
  return {
    admin_gates: [],
    mandatory_exclusions: [],
    top_gaps: [],
    overall_note: reason,
    quality_warnings: [reason],
    degraded: true,
  };
}

export interface ComplianceCheckInputs {
  tenderText: string;
  draftText: string;
  companyContext: string;
}

export async function checkDraftCompliance(inputs: ComplianceCheckInputs): Promise<RawComplianceFindings> {
  const client = getClient();
  if (!client) return degradedFindings("Compliance analysis is not configured (no model key).");

  try {
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2400,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: `You are a senior UN/donor procurement reviewer running a FAST, SHALLOW compliance-gap check.
Your ONLY job here is administrative/eligibility compliance: whether the applicant's DRAFT satisfies the call's
mandatory forms, eligibility conditions, format/packaging rules, and mandatory cross-cutting requirements. Do NOT
score technical quality per-criterion — that is a separate paid deep review. Be conservative and honest: if the
draft does not clearly address a requirement, mark it "missing" or "partial"; if you cannot tell from the text,
mark it "unverified" — never assume compliance you cannot see.

CALL / TENDER:
${inputs.tenderText.slice(0, 12000)}

APPLICANT COMPANY (context):
${inputs.companyContext || "Not provided."}

APPLICANT'S DRAFT (the document under review):
${inputs.draftText.slice(0, 16000)}

Return ONLY valid JSON with this exact shape:
{
  "admin_gates": [
    {
      "id": "short_snake_case_id",
      "label": "Human label, e.g. 'Mandatory technical proposal form'",
      "status": "ok" | "missing" | "partial" | "unverified" | "not_applicable",
      "severity": "BLOCK" | "HIGH" | "MED" | "LOW",
      "action": "What the applicant must do (imperative, specific)",
      "evidence_label": "evidence" | "inference" | "gap" | "unverified",
      "note": "one short line grounding the finding"
    }
  ],
  "mandatory_exclusions": [
    { "id": "gender_sensitivity", "label": "...", "addressed": true|false, "evidence_label": "...", "notes": "..." }
  ],
  "top_gaps": [
    { "severity": "BLOCK"|"HIGH"|"MED"|"LOW", "issue": "one line", "evidence_label": "...", "gate_id": "matching admin_gate id or omit" }
  ],
  "overall_note": "one or two sentences on the overall administrative-compliance picture",
  "quality_warnings": ["any reason the check is limited, e.g. 'draft appears truncated'"]
}

Rules:
- A missing MANDATORY form or an eligibility breach is severity BLOCK (administrative rejection risk).
- Use "unverified" generously when the draft text does not let you confirm — that is the honest answer.
- Keep admin_gates to the 4-8 that matter most. top_gaps: the 3-5 highest-severity items.
Return ONLY the JSON object.`,
        },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const parsed = safeParseJSON<RawComplianceFindings>(text, degradedFindings("Could not parse the compliance analysis."));
    // Normalise arrays so downstream never sees undefined.
    return {
      admin_gates: Array.isArray(parsed.admin_gates) ? parsed.admin_gates : [],
      mandatory_exclusions: Array.isArray(parsed.mandatory_exclusions) ? parsed.mandatory_exclusions : [],
      top_gaps: Array.isArray(parsed.top_gaps) ? parsed.top_gaps : [],
      overall_note: typeof parsed.overall_note === "string" ? parsed.overall_note : "",
      quality_warnings: Array.isArray(parsed.quality_warnings) ? parsed.quality_warnings : [],
      degraded: parsed.degraded === true,
    };
  } catch (err) {
    console.error("[proposal-review:compliance_llm_failed]", { error: err instanceof Error ? err.message : String(err) });
    return degradedFindings("The compliance analysis could not be completed. Try again shortly.");
  }
}
