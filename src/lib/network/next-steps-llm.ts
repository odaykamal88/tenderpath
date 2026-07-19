/**
 * LLM enrichment for the founder-sales command center (/admin/crm).
 *
 * Takes the DETERMINISTIC `SalesRead` from next-steps.ts plus the prospect's real
 * context — their profile, their live TenderPath matches (agency · deadline · fit),
 * and the recent activity trail — and infers the founder-sales judgment the user
 * asked for: is this deal worth pushing CLOSER TO CLOSING, or should it be
 * SUNSET so the founder's time goes where it can actually convert?
 *
 * Mirrors the client + safe-parse + honest-degradation pattern of
 * proposal-package/review-llm.ts. Uses Sonnet (this is judgment, low volume —
 * ~20 prospects). Degrades HONESTLY: with no API key or on a parse failure it
 * returns the deterministic read mapped into the same shape, flagged
 * `source: "heuristic"`. It NEVER invents tender facts, contacts, or history —
 * it reasons only over the structured context it is given, and a `sunset` call
 * always carries a stated basis.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { SalesRead } from "./next-steps";

const SONNET_MODEL = "claude-sonnet-4-6";

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: key, maxRetries: 3, timeout: 60_000 });
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
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              return JSON.parse(candidate.slice(start, i + 1)) as T;
            } catch {
              return fallback;
            }
          }
        }
      }
    }
    return fallback;
  }
}

/** A live tender in play for the prospect, trimmed for the reasoning prompt. */
export interface SalesTenderContext {
  title: string;
  agency: string | null;
  country: string | null;
  deadline: string | null;
  score: number;
  type: string | null;
  status: string;
}

export interface SalesActivityContext {
  kind: string;
  body: string | null;
  created_at: string;
}

export interface SalesInferenceContext {
  read: SalesRead;
  company: {
    name: string;
    pipeline_stage: string;
    industry: string | null;
    summary: string | null;
    strengths: string[];
    gaps: string[];
    countries: string[];
    ungm_status: string | null;
    contact_name: string | null;
    contact_channels: string[];
    notes: string | null;
  };
  matches: SalesTenderContext[];
  activities: SalesActivityContext[];
}

export type InferenceDisposition = "advance" | "hold" | "sunset";

export interface SalesInference {
  source: "llm" | "heuristic";
  /** Push toward close (advance), keep warm (hold), or let go (sunset). */
  disposition: InferenceDisposition;
  /** One-line inferred read of where this deal stands. */
  headline: string;
  /** 2–4 sentences of reasoning grounded in the given context. */
  reasoning: string;
  /** The single concrete next move to get closer to closing (or to sunset). */
  nextMove: string;
  /** 1–3 specific levers tied to a tender / the prospect's context. */
  closeLevers: string[];
  /** When disposition = sunset, the stated basis for letting it go. */
  sunsetBasis?: string;
  /** What would change the call — the risk / signal to watch. */
  watchFor?: string;
}

/** Map the deterministic SalesRead → the inference shape (the honest fallback). */
function heuristicInference(ctx: SalesInferenceContext): SalesInference {
  const r = ctx.read;
  const disposition: InferenceDisposition =
    r.disposition === "advance" ? "advance" : r.disposition === "sunset" ? "sunset" : "hold";
  const basisSignal = r.signals.find((s) => s.sunsetBasis);
  return {
    source: "heuristic",
    disposition,
    headline:
      disposition === "advance"
        ? "Live and worth moving on now."
        : disposition === "sunset"
          ? "Signals point to sunsetting this one."
          : "Keep warm — no urgent trigger yet.",
    reasoning: r.rationale,
    nextMove: r.recommendedAction,
    closeLevers: r.signals.filter((s) => s.weight > 0).slice(0, 3).map((s) => s.label),
    sunsetBasis: disposition === "sunset" ? (basisSignal?.label ?? "Decay signals outweigh live opportunity.") : undefined,
    watchFor: undefined,
  };
}

function fmtDeadline(iso: string | null): string {
  if (!iso) return "no deadline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const days = Math.ceil((d.getTime() - Date.now()) / 86_400_000);
  const label = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return days < 0 ? `${label} (closed)` : `${label} (${days}d out)`;
}

function buildPrompt(ctx: SalesInferenceContext): string {
  const { read: r, company, matches, activities } = ctx;
  const matchLines = matches.length
    ? matches
        .slice(0, 6)
        .map(
          (m) =>
            `- "${m.title}" · ${m.agency ?? "agency n/a"} · ${m.country ?? "country n/a"} · ${m.type ?? "type n/a"} · fit ${m.score} · closes ${fmtDeadline(m.deadline)}`,
        )
        .join("\n")
    : "- (no live tenders currently matched)";
  const activityLines = activities.length
    ? activities
        .slice(0, 8)
        .map((a) => {
          const when = new Date(a.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
          return `- ${when} · ${a.kind}${a.body ? `: ${a.body.slice(0, 200)}` : ""}`;
        })
        .join("\n")
    : "- (no logged interactions yet)";

  return `You are the sales strategist for TenderPath, an early-stage startup running FOUNDER-LED outbound to a small set of prospects (development-sector suppliers/NGOs we help win UN & donor tenders). The founder has limited hours. For ONE prospect, infer whether to push this deal CLOSER TO CLOSING or to SUNSET it so the founder's time goes where it can actually convert. "No-bid is a feature": recommending we let a deal go is a valid, valuable answer — do not force optimism.

Reason ONLY over the facts below. Do not invent tenders, contacts, dates, or history. If evidence is thin, say so and lean to "hold". A "sunset" verdict MUST cite a concrete basis from the facts.

PROSPECT: ${company.name}
Pipeline stage: ${company.pipeline_stage}
Industry: ${company.industry ?? "unknown"}
What they do: ${company.summary ?? "n/a"}
Strengths: ${company.strengths.slice(0, 6).join(", ") || "n/a"}
Gaps: ${company.gaps.slice(0, 6).join(", ") || "n/a"}
Countries: ${company.countries.slice(0, 8).join(", ") || "n/a"}
UNGM registration: ${company.ungm_status ?? "unknown"}
Contact: ${company.contact_name ?? "unknown"} · channels: ${company.contact_channels.join(", ") || "none on file"}
Private notes: ${company.notes ?? "none"}

DETERMINISTIC READ (our engine's baseline — refine or overrule with reasons):
- Disposition: ${r.disposition} · urgency: ${r.urgency} (${r.urgencyScore}/100) · momentum: ${r.momentum}
- Days since last touch: ${r.daysSinceTouch ?? "n/a"} · nearest tender deadline: ${r.daysToNearestDeadline ?? "n/a"}d
- Signals: ${r.signals.map((s) => s.label).join("; ") || "none"}
- Baseline next move: ${r.recommendedAction}

LIVE TENDERS IN PLAY (the clock + the reason to engage):
${matchLines}

RECENT INTERACTIONS (most recent first):
${activityLines}

Return ONLY minified JSON, no prose, with this exact shape:
{
  "disposition": "advance" | "hold" | "sunset",
  "headline": "one line, <=90 chars, plain founder voice",
  "reasoning": "2-4 sentences grounded in the facts above, naming a specific tender/stage/signal",
  "nextMove": "the single most valuable concrete action this week (be specific: which tender, which channel)",
  "closeLevers": ["1-3 specific levers tied to a tender or the prospect's context"],
  "sunsetBasis": "if disposition is sunset, the concrete basis; else omit",
  "watchFor": "one risk or signal that would change this call; else omit"
}`;
}

const ALLOWED: InferenceDisposition[] = ["advance", "hold", "sunset"];

function sanitize(raw: unknown, ctx: SalesInferenceContext): SalesInference {
  const fallback = heuristicInference(ctx);
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const disposition = ALLOWED.includes(o.disposition as InferenceDisposition)
    ? (o.disposition as InferenceDisposition)
    : fallback.disposition;
  const str = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t ? t.slice(0, max) : undefined;
  };
  const headline = str(o.headline, 140) ?? fallback.headline;
  const reasoning = str(o.reasoning, 900) ?? fallback.reasoning;
  const nextMove = str(o.nextMove, 500) ?? fallback.nextMove;
  const closeLevers = Array.isArray(o.closeLevers)
    ? (o.closeLevers.map((x) => str(x, 160)).filter(Boolean) as string[]).slice(0, 3)
    : fallback.closeLevers;
  // A sunset verdict must carry a basis; if the model omitted one, keep the
  // deterministic basis rather than silently dropping the honesty guard.
  const sunsetBasis =
    disposition === "sunset"
      ? str(o.sunsetBasis, 400) ?? fallback.sunsetBasis ?? "Decay signals outweigh live opportunity."
      : undefined;
  const watchFor = str(o.watchFor, 300);

  return { source: "llm", disposition, headline, reasoning, nextMove, closeLevers, sunsetBasis, watchFor };
}

/**
 * Infer the close-vs-sunset judgment for one prospect. Never throws — returns
 * the honest heuristic fallback on any failure so the command center always
 * renders something truthful.
 */
export async function inferSalesIntelligence(ctx: SalesInferenceContext): Promise<SalesInference> {
  const client = getClient();
  if (!client) return heuristicInference(ctx);
  try {
    const msg = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 900,
      temperature: 0.3,
      messages: [{ role: "user", content: buildPrompt(ctx) }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsed = safeParseJSON<unknown>(text, null);
    if (parsed == null) {
      console.warn("[network:next-step:llm:parse_fail] falling back to heuristic");
      return heuristicInference(ctx);
    }
    return sanitize(parsed, ctx);
  } catch (err) {
    console.warn("[network:next-step:llm:error]", err instanceof Error ? err.message : err);
    return heuristicInference(ctx);
  }
}
