import { sql } from "@/lib/db";
import type { BotButton } from "./types";

/**
 * Proactive nudge content for a linked user: brand-new matches since their last
 * nudge + tenders whose deadline is approaching. Reads the same pipeline_items
 * the dashboard and the weekly digest populate — the bot is a new delivery
 * surface, not a new matching engine.
 */

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.tenderpath.me").replace(/\/+$/, "");

export interface NudgeItem {
  title: string;
  agency: string | null;
  daysLeft: number | null;
}

export interface UserNudge {
  newMatches: NudgeItem[];
  urgent: NudgeItem[];
}

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

interface Row {
  tender_title: string;
  tender_agency: string | null;
  tender_deadline: string | null;
}

/** Returns the nudge for a user, or null when there's nothing worth sending. */
export async function buildUserNudge(userId: number, sinceIso: string): Promise<UserNudge | null> {
  const newRows = await sql`
    SELECT pi.tender_title, pi.tender_agency, pi.tender_deadline
    FROM pipeline_items pi
    LEFT JOIN user_tender_feedback f ON f.user_id = pi.user_id AND f.tender_id = pi.tender_id
    WHERE pi.user_id = ${userId} AND pi.created_at > ${sinceIso}
      AND (f.status IS NULL OR f.status <> 'not_relevant')
    ORDER BY pi.fit_score DESC NULLS LAST, pi.id
    LIMIT 3
  `;
  const urgentRows = await sql`
    SELECT pi.tender_title, pi.tender_agency, pi.tender_deadline
    FROM pipeline_items pi
    LEFT JOIN user_tender_feedback f ON f.user_id = pi.user_id AND f.tender_id = pi.tender_id
    WHERE pi.user_id = ${userId}
      AND pi.tender_deadline IS NOT NULL
      AND pi.tender_deadline >= CURRENT_DATE
      AND pi.tender_deadline <= CURRENT_DATE + INTERVAL '14 days'
      AND (f.status IS NULL OR f.status NOT IN ('not_relevant','submitted','applied'))
    ORDER BY pi.tender_deadline ASC
    LIMIT 3
  `;

  const newMatches = (newRows as Row[]).map((r) => ({ title: r.tender_title, agency: r.tender_agency, daysLeft: daysLeft(r.tender_deadline) }));
  const urgent = (urgentRows as Row[]).map((r) => ({ title: r.tender_title, agency: r.tender_agency, daysLeft: daysLeft(r.tender_deadline) }));

  if (newMatches.length === 0 && urgent.length === 0) return null;
  return { newMatches, urgent };
}

export function nudgeSummaryLine(nudge: UserNudge): string {
  const parts: string[] = [];
  if (nudge.newMatches.length) parts.push(`${nudge.newMatches.length} new match${nudge.newMatches.length > 1 ? "es" : ""}`);
  if (nudge.urgent.length) parts.push(`${nudge.urgent.length} deadline${nudge.urgent.length > 1 ? "s" : ""} approaching`);
  return parts.join(" · ") || "new activity";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram free-form body (HTML subset). */
export function renderNudgeText(displayName: string, nudge: UserNudge): string {
  const lines: string[] = [`Hi ${escapeHtml(displayName)} 👋`, ""];
  if (nudge.newMatches.length) {
    lines.push(`<b>🎯 New matches for you</b>`);
    for (const m of nudge.newMatches) lines.push(`• ${escapeHtml(m.title)} — ${escapeHtml(m.agency ?? "agency")}`);
    lines.push("");
  }
  if (nudge.urgent.length) {
    lines.push(`<b>⏰ Deadlines approaching</b>`);
    for (const m of nudge.urgent) {
      const dl = m.daysLeft == null ? "soon" : m.daysLeft <= 0 ? "due today" : `in ${m.daysLeft} day${m.daysLeft === 1 ? "" : "s"}`;
      lines.push(`• ${escapeHtml(m.title)} — ${dl}`);
    }
    lines.push("");
  }
  lines.push(`<a href="${APP_URL}/dashboard">Open your dashboard →</a>`);
  return lines.join("\n");
}

export function nudgeButtons(): BotButton[][] {
  return [
    [{ label: "🎯 My matches", action: "menu_matches" }],
    [{ label: "🔕 Pause alerts", action: "nudge_off" }],
  ];
}

/**
 * WhatsApp utility template descriptor. The template named here must be created
 * and approved in Meta with two body variables: {{1}} = name, {{2}} = summary.
 * See docs/agents/whatsapp-setup.md.
 */
export const WHATSAPP_NUDGE_TEMPLATE = "tenderpath_alert";

export function whatsappNudgeTemplate(displayName: string, nudge: UserNudge) {
  return {
    name: WHATSAPP_NUDGE_TEMPLATE,
    languageCode: "en",
    variables: [displayName, nudgeSummaryLine(nudge)],
  };
}
