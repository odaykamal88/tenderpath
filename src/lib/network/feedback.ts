import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import type { AIAnalysis, MatchedTender } from "@/lib/types";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

interface DismissedExample {
  title: string;
  agency: string | null;
  sector: string | null;
  reason: string;
}

/**
 * Incorporate the operator's dismissal reasons: suppress NEW candidate matches
 * that hit the same objections the operator raised when dismissing past matches
 * for this company. One Haiku call, and only when the company actually has
 * dismissals WITH reasons and there are new candidates — so companies with no
 * feedback cost nothing. FAILS OPEN: any error (or no feedback) returns the
 * candidates unchanged, because silently dropping a good match is worse than
 * occasionally showing one the operator might reject.
 */
export async function suppressByDismissalFeedback(
  companyId: number,
  analysis: AIAnalysis,
  newCandidates: MatchedTender[],
): Promise<{ kept: MatchedTender[]; suppressed: number }> {
  if (newCandidates.length === 0) return { kept: newCandidates, suppressed: 0 };

  let dismissed: DismissedExample[] = [];
  try {
    const rows = await sql`
      SELECT t.title, t.agency, t.sector, m.dismiss_reason AS reason
      FROM network_company_matches m
      JOIN tenders t ON t.id = m.tender_id
      WHERE m.network_company_id = ${companyId}
        AND m.status = 'dismissed'
        AND m.dismiss_reason IS NOT NULL AND TRIM(m.dismiss_reason) <> ''
      ORDER BY m.updated_at DESC
      LIMIT 25
    `;
    dismissed = rows
      .map((r) => ({
        title: String(r.title ?? ""),
        agency: (r.agency as string | null) ?? null,
        sector: (r.sector as string | null) ?? null,
        reason: String(r.reason ?? "").trim(),
      }))
      .filter((d) => d.reason);
  } catch (err) {
    console.error("[network:feedback:load_failed]", { companyId, error: err instanceof Error ? err.message : String(err) });
    return { kept: newCandidates, suppressed: 0 };
  }

  if (dismissed.length === 0) return { kept: newCandidates, suppressed: 0 };

  // Bound prompt size: only ask about the strongest new candidates.
  const cap = newCandidates.slice(0, 40);
  const profile = [
    analysis.detected_industry,
    ...(analysis.sectors ?? []).slice(0, 6),
    ...(analysis.services ?? []).slice(0, 6),
  ].filter(Boolean).join(", ");

  try {
    const msg = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      temperature: 0,
      messages: [{
        role: "user",
        content: `A bizdev operator matches this company to procurement tenders.

Company profile: ${profile || "(unknown)"}

The operator DISMISSED these past matches as poor fits, with their reasons:
${dismissed.map((d, i) => `${i + 1}. "${d.title}" [${d.agency ?? "?"} / ${d.sector ?? "?"}] — reason: ${d.reason}`).join("\n")}

Below are NEW candidate tenders. Return ONLY the ids of candidates that clearly hit the SAME objections the operator raised (i.e. they would dismiss them for the same reason). Be conservative — when in doubt, KEEP it (do not list it).

Candidates:
${cap.map((t) => `id=${t.id}: "${t.title}" [${t.agency ?? "?"} / ${t.sector ?? "?"}]`).join("\n")}

Return strict JSON only: {"suppress": [<id>, ...]}`,
      }],
    });
    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const parsed = (start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : {}) as { suppress?: unknown };
    const suppressIds = new Set(
      (Array.isArray(parsed.suppress) ? parsed.suppress : []).map((x) => Number(x)).filter((n) => Number.isFinite(n)),
    );
    if (suppressIds.size === 0) return { kept: newCandidates, suppressed: 0 };
    const kept = newCandidates.filter((t) => !suppressIds.has(t.id));
    const suppressed = newCandidates.length - kept.length;
    if (suppressed > 0) console.log("[network:feedback:suppressed]", { companyId, suppressed, candidates: newCandidates.length });
    return { kept, suppressed };
  } catch (err) {
    console.error("[network:feedback:llm_failed]", { companyId, error: err instanceof Error ? err.message : String(err) });
    return { kept: newCandidates, suppressed: 0 };
  }
}
