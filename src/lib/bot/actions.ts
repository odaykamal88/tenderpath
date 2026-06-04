import { TIERS } from "@/lib/pricing";
import { upsertTenderFeedback } from "@/lib/dashboard/tender-feedback";
import type { BotButton } from "./types";
import type { BotMatch } from "./matches";

/**
 * Inline match actions (Save / Not relevant) + revenue-path deep links. Save and
 * dismiss write to the shared `user_tender_feedback` store; the bid-analysis
 * button deep-links into the existing paid service page. Slug + price come from
 * pricing.ts so the bot never drifts from the published offer.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me").replace(/\/+$/, "");

// Canonical bid-analysis tier slug (see TIERS in pricing.ts).
const BID_SLUG = "bid-no-bid";

export function bidAnalysisPriceLabel(): string {
  return TIERS.find((t) => t.slug === BID_SLUG)?.price ?? "$39";
}

export function bidAnalysisUrl(match: Pick<BotMatch, "pipelineItemId" | "title" | "agency">): string {
  const params = new URLSearchParams();
  params.set("pipeline_item_id", String(match.pipelineItemId));
  if (match.title) params.set("tender", match.title);
  if (match.agency) params.set("agency", match.agency);
  return `${APP_URL}/dashboard/services/${BID_SLUG}?${params.toString()}`;
}

/** Buttons shown under a single surfaced match. */
export function matchActionButtons(match: BotMatch): BotButton[][] {
  return [
    [
      { label: "💾 Save", action: `save:${match.tenderId}` },
      { label: "🚫 Not relevant", action: `dismiss:${match.tenderId}` },
    ],
    [{ label: `📊 Bid analysis ${bidAnalysisPriceLabel()}`, url: bidAnalysisUrl(match) }],
  ];
}

export interface MatchAction {
  kind: "save" | "dismiss";
  tenderId: number;
}

export function parseMatchAction(payload: string): MatchAction | null {
  const m = /^(save|dismiss):(\d+)$/.exec(payload);
  if (!m) return null;
  return { kind: m[1] as "save" | "dismiss", tenderId: Number(m[2]) };
}

export async function applyMatchAction(userId: number, action: MatchAction): Promise<void> {
  await upsertTenderFeedback({
    userId,
    tenderId: action.tenderId,
    status: action.kind === "save" ? "saved" : "not_relevant",
  });
}
