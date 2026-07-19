/**
 * Founder-sales reasoning engine for the Network CRM command center (/admin/crm).
 *
 * This is the DETERMINISTIC, honest core. Given a prospect's relationship state
 * (pipeline stage, last touch, contact channels) and their live TenderPath
 * matches (fit score, how many are fresh, the soonest deadline that gives the
 * deal a clock), it derives:
 *   - a set of typed sales `signals` (why this deal needs attention, or doesn't),
 *   - a `disposition` — should the founder ADVANCE it, NURTURE it, or SUNSET it,
 *   - an `urgency` band + score for ranking the "what needs you today" queue,
 *   - a concrete `recommendedAction` and one-line `rationale`.
 *
 * No LLM, no DB, no network — pure and testable. It works with zero API key and
 * NEVER fabricates: every disposition is backed by an explicit signal, and a
 * `sunset` call always carries a basis (mirroring the "never Constrained without
 * basis" discipline in src/lib/tenders/contestability.ts). The LLM layer in
 * next-steps-llm.ts only phrases and deepens this read — it does not invent it.
 *
 * Positioning (AGENTS.md, First-Revenue Sprint): "no-bid is a feature" applied
 * to the founder's own pipeline. The engine is willing to recommend letting a
 * deal go so the founder's time goes where it can actually close.
 */

export type SalesDisposition = "advance" | "nurture" | "sunset";
export type SalesUrgency = "now" | "soon" | "later" | "paused";

export type SalesSignalCode =
  | "reply_needs_action"
  | "hot_untapped"
  | "deadline_pressure"
  | "closing_stage"
  | "awaiting_followup"
  | "never_contacted"
  | "stale_in_stage"
  | "no_channel"
  | "no_live_matches"
  | "dead_air"
  | "won_nurture"
  | "closed_lost"
  | "paused";

export interface SalesSignal {
  code: SalesSignalCode;
  /** Short human phrase for chips / the queue row. */
  label: string;
  /** Contribution to the urgency score (can be negative for decay signals). */
  weight: number;
  /** Whether this signal is a valid basis for sunsetting the deal. */
  sunsetBasis?: boolean;
}

/** The minimal per-company shape the engine reasons over. */
export interface SalesSignalInput {
  id: number;
  name: string;
  pipeline_stage: string;
  is_active: boolean;
  profile_status?: string | null;
  created_at: string;
  /** Last touch of any kind (max activity timestamp), else null. */
  last_activity_at: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  /** Count of fresh (all-new) live matches with runway. */
  fresh_count: number;
  /** Count of total open, non-expired matches. */
  match_count: number;
  /** Best match fit score 0–100. */
  top_score: number;
  /** Soonest open-match deadline (ISO date), the clock driving the deal. */
  nearest_deadline: string | null;
  ungm_status?: string | null;
}

export interface SalesRead {
  companyId: number;
  name: string;
  disposition: SalesDisposition;
  urgency: SalesUrgency;
  /** 0–100; ranks the priority queue. */
  urgencyScore: number;
  /** -100..100; a decaying (−) vs advancing (+) trend cue. */
  momentum: number;
  signals: SalesSignal[];
  /** The deterministic next move (LLM may refine the phrasing). */
  recommendedAction: string;
  /** One-line reason, composed from the dominant signals. */
  rationale: string;
  daysSinceTouch: number | null;
  daysToNearestDeadline: number | null;
  stageAgeDays: number | null;
}

const TERMINAL_WON = "won";
const TERMINAL_LOST = "lost";

/** Days-in-stage beyond which a deal is considered "stalling" for that stage. */
const STAGE_STALE_DAYS: Record<string, number> = {
  lead: 14,
  contacted: 10,
  replied: 5,
  meeting: 10,
  proposal: 14,
};

function daysBetween(fromIso: string | null, now: Date): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / 86_400_000);
}

function daysUntil(toIso: string | null, now: Date): number | null {
  if (!toIso) return null;
  const t = new Date(toIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / 86_400_000);
}

function hasChannel(c: SalesSignalInput): boolean {
  return Boolean(c.contact_email || c.contact_linkedin || c.contact_phone);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Derive the full sales read for one prospect. `now` is injectable for testing.
 */
export function readSalesState(c: SalesSignalInput, now: Date = new Date()): SalesRead {
  const stage = (c.pipeline_stage || "lead").toLowerCase();
  const daysSinceTouch = daysBetween(c.last_activity_at ?? c.created_at, now);
  const daysToDeadline = daysUntil(c.nearest_deadline, now);
  const stageAgeDays = daysBetween(c.last_activity_at ?? c.created_at, now);
  const staleThreshold = STAGE_STALE_DAYS[stage] ?? 14;
  const channel = hasChannel(c);
  const hasLiveMatches = c.match_count > 0;
  const profileReady = (c.profile_status ?? "ready") === "ready";

  const signals: SalesSignal[] = [];

  // ---- Terminal / paused states short-circuit ------------------------------
  if (stage === TERMINAL_WON) {
    signals.push({ code: "won_nurture", label: "Closed-won", weight: 0 });
    return finalize(c, {
      disposition: "nurture",
      urgency: "paused",
      urgencyScore: 0,
      momentum: 40,
      signals,
      recommendedAction: "Closed-won — keep warm for the next tender and ask for a referral.",
      rationale: "Won. Nurture for repeat business.",
      daysSinceTouch,
      daysToNearestDeadline: daysToDeadline,
      stageAgeDays,
    });
  }
  if (stage === TERMINAL_LOST || !c.is_active) {
    signals.push({
      code: stage === TERMINAL_LOST ? "closed_lost" : "paused",
      label: stage === TERMINAL_LOST ? "Marked lost" : "Paused",
      weight: 0,
      sunsetBasis: true,
    });
    return finalize(c, {
      disposition: "sunset",
      urgency: "paused",
      urgencyScore: 0,
      momentum: -30,
      signals,
      recommendedAction:
        stage === TERMINAL_LOST
          ? "Lost — capture why in the log so the next similar prospect scores better."
          : "Paused — reactivate only if a strong new tender lands.",
      rationale: stage === TERMINAL_LOST ? "Deal marked lost." : "Company paused.",
      daysSinceTouch,
      daysToNearestDeadline: daysToDeadline,
      stageAgeDays,
    });
  }

  // ---- Live signals --------------------------------------------------------
  // They replied — the ball is in your court. Highest priority.
  if (stage === "replied") {
    signals.push({ code: "reply_needs_action", label: "Replied — your move", weight: 42 });
  }

  // Strong-fit prospect you haven't opened a conversation with yet.
  if (stage === "lead" && c.top_score >= 75 && c.fresh_count > 0) {
    signals.push({ code: "hot_untapped", label: "Hot lead, untapped", weight: 34 });
  }

  // A live tender is closing soon on an engaged deal — the clock to close on.
  if (
    hasLiveMatches &&
    daysToDeadline != null &&
    daysToDeadline <= 10 &&
    ["contacted", "replied", "meeting", "proposal"].includes(stage)
  ) {
    const boost = daysToDeadline <= 3 ? 16 : daysToDeadline <= 6 ? 8 : 0;
    signals.push({
      code: "deadline_pressure",
      label: daysToDeadline <= 0 ? "Tender closing today" : `Tender closes in ${daysToDeadline}d`,
      weight: 28 + boost,
    });
  }

  // Mid-funnel deal with something live to sell — push to a commitment.
  if (["meeting", "proposal"].includes(stage) && hasLiveMatches) {
    signals.push({ code: "closing_stage", label: `In ${stage} — push to close`, weight: 26 });
  }

  // Contacted but silent — nudge, and start the sunset clock.
  if (stage === "contacted" && daysSinceTouch != null && daysSinceTouch >= 4) {
    const decayed = daysSinceTouch > 20;
    signals.push({
      code: "awaiting_followup",
      label: `No reply in ${daysSinceTouch}d`,
      weight: clamp(12 + Math.floor(daysSinceTouch / 2), 12, 24),
      sunsetBasis: decayed,
    });
  }

  // New lead sitting untouched.
  if (stage === "lead" && daysSinceTouch != null && daysSinceTouch >= 3) {
    signals.push({
      code: "never_contacted",
      label: `Untouched ${daysSinceTouch}d`,
      weight: c.top_score >= 65 ? 18 : 10,
    });
  }

  // Stalling in stage (decay — negative momentum).
  if (daysSinceTouch != null && daysSinceTouch > staleThreshold && !["lead"].includes(stage)) {
    signals.push({
      code: "stale_in_stage",
      label: `Stalled in ${stage}`,
      weight: -8,
      sunsetBasis: daysSinceTouch > staleThreshold * 2,
    });
  }

  // No way to reach them — blocked.
  if (!channel) {
    signals.push({
      code: "no_channel",
      label: "No contact channel",
      weight: 6,
      sunsetBasis: !hasLiveMatches,
    });
  }

  // Nothing live to sell right now.
  if (profileReady && !hasLiveMatches) {
    signals.push({
      code: "no_live_matches",
      label: "No live tenders",
      weight: -6,
      sunsetBasis: daysSinceTouch != null && daysSinceTouch > 21,
    });
  }

  // Long dead air in a mid-funnel stage — a sunset candidate.
  if (
    ["contacted", "replied", "meeting"].includes(stage) &&
    daysSinceTouch != null &&
    daysSinceTouch > 28
  ) {
    signals.push({ code: "dead_air", label: `Dead air ${daysSinceTouch}d`, weight: -12, sunsetBasis: true });
  }

  // ---- Aggregate -----------------------------------------------------------
  const positiveWeight = signals.filter((s) => s.weight > 0).reduce((a, s) => a + s.weight, 0);
  const negativeWeight = signals.filter((s) => s.weight < 0).reduce((a, s) => a + s.weight, 0);
  const momentum = clamp(positiveWeight + negativeWeight * 2, -100, 100);

  const liveAdvance = signals.some((s) =>
    ["reply_needs_action", "hot_untapped", "deadline_pressure", "closing_stage"].includes(s.code),
  );
  const sunsetBases = signals.filter((s) => s.sunsetBasis);

  let disposition: SalesDisposition;
  if (liveAdvance) {
    // A live advancing signal always overrides a sunset basis — never drop a
    // deal that has a reply, a hot fit, or a closing tender in play.
    disposition = "advance";
  } else if (sunsetBases.length > 0 && !hasLiveMatches) {
    disposition = "sunset";
  } else if (sunsetBases.length >= 2) {
    // Multiple decay signals even with a live match on file → let it go.
    disposition = "sunset";
  } else {
    disposition = "nurture";
  }

  const urgencyScore = clamp(Math.round(positiveWeight + (disposition === "sunset" ? 8 : 0)), 0, 100);
  // Thresholds are tuned so a SINGLE strong live signal — a fresh reply (42) or a
  // tender closing within ~3 days (44) — reads as "now". Combos push higher.
  const urgency: SalesUrgency =
    disposition === "sunset"
      ? "soon"
      : urgencyScore >= 40
        ? "now"
        : urgencyScore >= 22
          ? "soon"
          : urgencyScore >= 10
            ? "later"
            : "paused";

  const { action, rationale } = deriveAction(c, stage, signals, disposition, daysToDeadline);

  return finalize(c, {
    disposition,
    urgency,
    urgencyScore,
    momentum,
    signals: signals.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
    recommendedAction: action,
    rationale,
    daysSinceTouch,
    daysToNearestDeadline: daysToDeadline,
    stageAgeDays,
  });
}

function finalize(
  c: SalesSignalInput,
  read: Omit<SalesRead, "companyId" | "name">,
): SalesRead {
  return { companyId: c.id, name: c.name, ...read };
}

function deriveAction(
  c: SalesSignalInput,
  stage: string,
  signals: SalesSignal[],
  disposition: SalesDisposition,
  daysToDeadline: number | null,
): { action: string; rationale: string } {
  const top = signals.find((s) => s.weight > 0) ?? signals[0];
  const dl = daysToDeadline != null ? `${daysToDeadline}d` : null;

  const byCode: Partial<Record<SalesSignalCode, { action: string; rationale: string }>> = {
    reply_needs_action: {
      action: "They replied — respond today: book a call or send the deep read and move them to Meeting.",
      rationale: "Prospect is engaged and waiting on you.",
    },
    hot_untapped: {
      action: `Strong fit (${c.top_score}) with ${c.fresh_count} fresh live tender${c.fresh_count === 1 ? "" : "s"} — send the briefing link and open the conversation.`,
      rationale: "High-fit lead with fresh opportunities, not yet contacted.",
    },
    deadline_pressure: {
      action: `Their best live tender closes in ${dl ?? "days"} — use it as the concrete reason to move now.`,
      rationale: "A live tender deadline is the clock on this deal.",
    },
    closing_stage: {
      action: `In ${stage} — push for the next commitment (scope, date, or the paid step).`,
      rationale: "Mid-funnel deal with something live to close on.",
    },
    awaiting_followup: {
      action: "No reply yet — send one more angle tied to a live tender, then decide to hold or drop.",
      rationale: "Contacted but silent; a follow-up is due.",
    },
    never_contacted: {
      action: "New lead sitting untouched — make first contact with the briefing, or drop it.",
      rationale: "Lead has aged without a first touch.",
    },
    no_channel: {
      action: "No way to reach them yet — find an email or LinkedIn before this can move.",
      rationale: "Missing a contact channel blocks any next step.",
    },
    no_live_matches: {
      action: "Nothing live to sell right now — hold until a strong new tender matches, or sunset.",
      rationale: "No open tenders currently fit this prospect.",
    },
    dead_air: {
      action: "Long silence with no progress — sunset it and free the time, unless you know something the log doesn't.",
      rationale: "Extended dead air with no forward motion.",
    },
    stale_in_stage: {
      action: `Stalled in ${stage} — one decisive follow-up, then advance or sunset.`,
      rationale: "Deal has stalled in its current stage.",
    },
  };

  if (disposition === "sunset") {
    const basis = signals.find((s) => s.sunsetBasis);
    const mapped = basis ? byCode[basis.code] : undefined;
    return {
      action: mapped?.action ?? "Sunset — the signals say your time closes more elsewhere. Log the reason and move on.",
      rationale: mapped?.rationale ?? "Decay signals outweigh any live opportunity.",
    };
  }

  const mapped = top ? byCode[top.code] : undefined;
  if (mapped) return mapped;
  return {
    action: "Keep warm — no urgent trigger. Re-touch when a fresh match lands.",
    rationale: "No pressing signal; steady nurture.",
  };
}

// ---- Portfolio aggregates ---------------------------------------------------

export interface PipelineFunnel {
  stage: string;
  label: string;
  count: number;
}

export const PIPELINE_STAGE_ORDER = ["lead", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
export const PIPELINE_STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

export interface PortfolioPulse {
  totalActive: number;
  needsMove: number;
  advancing: number;
  sunsetCandidates: number;
  deadlinesThisWeek: number;
  funnel: PipelineFunnel[];
}

/** Roll up a set of reads (+ their inputs) into the command-center header stats. */
export function summarizePortfolio(
  companies: SalesSignalInput[],
  reads: SalesRead[],
  now: Date = new Date(),
): PortfolioPulse {
  const activeReads = reads.filter((r, i) => companies[i]?.is_active);
  const funnelCounts = new Map<string, number>();
  for (const c of companies) {
    if (!c.is_active) continue;
    const s = (c.pipeline_stage || "lead").toLowerCase();
    funnelCounts.set(s, (funnelCounts.get(s) ?? 0) + 1);
  }
  const deadlinesThisWeek = companies.filter((c) => {
    if (!c.is_active) return false;
    const d = daysUntil(c.nearest_deadline, now);
    return d != null && d >= 0 && d <= 7;
  }).length;

  return {
    totalActive: companies.filter((c) => c.is_active).length,
    needsMove: activeReads.filter((r) => r.urgency === "now").length,
    advancing: activeReads.filter((r) => r.disposition === "advance").length,
    sunsetCandidates: activeReads.filter((r) => r.disposition === "sunset").length,
    deadlinesThisWeek,
    funnel: PIPELINE_STAGE_ORDER.map((stage) => ({
      stage,
      label: PIPELINE_STAGE_LABELS[stage] ?? stage,
      count: funnelCounts.get(stage) ?? 0,
    })),
  };
}
