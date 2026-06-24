//
// Pure, side-effect-free helpers that turn Network/bizdev matches into
// ready-to-send outreach drafts + a CSV worklist.
//
// ISOLATION INVARIANT (do not break): this module NEVER sends anything and
// never touches the DB. It only produces copy + CSV for the operator to send
// MANUALLY from their own inbox. The Network subsystem must stay out of
// email_queue / sendAssessmentEmail / funnel track() — see the
// project_network_bizdev_matching note + AGENTS.md.
//

import type { Gap } from "@/lib/types";
import { isUngmAgency } from "@/lib/tenders/submission-portals";

export type OutreachReadiness = "send_ready" | "needs_email";

/**
 * Operator-recorded UNGM vendor-registration status of a prospect. We can't
 * auto-detect it, so this reflects what the operator knows; 'unknown' is the
 * safe default and keeps the outreach copy conditional rather than asserting a
 * registration the prospect may not have.
 */
export type ProspectUngmStatus =
  | "unknown"
  | "not_registered"
  | "basic"
  | "level-1"
  | "level-2";

/** Shape of a fresh match row as returned by /api/admin/network-companies (GET). */
export interface OutreachMatch {
  id: number;
  score: number;
  match_reasons: string[] | null;
  status: string;
  first_seen_at: string;
  company_id: number;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  tender_id: number;
  tender_title: string;
  tender_agency: string | null;
  tender_country: string | null;
  tender_sector: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  tender_source_url: string | null;
  tender_reference: string | null;
  tender_type: string | null;
  // Per-company engagement context (same for every match of a company), plus a
  // per-row flag — operator judgement aids, never shown to the prospect. All
  // optional so callers/builders that don't hydrate them still typecheck.
  contacted_count?: number;
  replied_count?: number;
  booked_count?: number;
  paid_count?: number;
  not_relevant_count?: number;
  won_count?: number;
  lost_count?: number;
  /** This company has a `lost` match with the same agency as this tender. */
  lost_agency_before?: boolean;
  // ── Company-level profile signals (identical on every match of a company,
  // mirrored onto each row like the engagement counts above). They power the
  // value-first "mini-assessment" framing in the bundle email + the shareable
  // prospect briefing. All optional so callers that don't hydrate them still
  // typecheck (single-tender CSV drafts, tests, older callers).
  company_industry?: string | null;
  company_website?: string | null;
  /** Confirmed strengths from the company's profile (ai_analysis.strengths). */
  company_strengths?: string[] | null;
  /** Raw gaps from the company's profile; filter with selectInsightfulGaps before showing. */
  company_gaps?: Gap[] | null;
  /** Operator-recorded UNGM status of the prospect. */
  ungm_status?: ProspectUngmStatus | null;
  /** Unguessable token for the public briefing page (/n/<token>). */
  share_token?: string | null;
}

export interface OutreachDraft {
  subject: string;
  body: string;
}

const MS_PER_DAY = 86_400_000;

function todayLocalDateAsUtcMs(): number {
  const today = new Date();
  return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
}

function deadlineUtcDateAsUtcMs(deadline: string): number | null {
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  return Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
}

function deadlineAsLocalMidnight(deadline: string): Date | null {
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  return new Date(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
}

/** Calendar-day count until a deadline. null when missing/unparseable. Negative = already past. */
export function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const target = deadlineUtcDateAsUtcMs(deadline);
  if (target === null) return null;
  return Math.round((target - todayLocalDateAsUtcMs()) / MS_PER_DAY);
}

/**
 * Business days (Mon–Fri) strictly between today and the deadline.
 * 0 when the deadline is today/past/unparseable — so a `>= N` filter naturally
 * drops closed and too-soon tenders. Holidays are not modelled (cheap, honest
 * approximation): the operator's adjustable threshold absorbs the slack.
 */
export function businessDaysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const end = deadlineAsLocalMidnight(deadline);
  if (!end) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(today);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/** Deadline phrase that leads with business days: "10 business days left", "closed". */
export function relBusinessDeadline(deadline: string | null): string {
  const cal = daysUntil(deadline);
  if (cal === null) return "no deadline";
  if (cal < 0) return `closed ${Math.abs(cal)}d ago`;
  const biz = businessDaysUntil(deadline) ?? 0;
  if (biz === 0) return cal === 0 ? "closes today" : "closes this weekend";
  return `${biz} business day${biz === 1 ? "" : "s"} left`;
}

/** Human deadline phrase for the UI: "in 11 days", "today", "2d ago", "no deadline". */
export function relDeadline(deadline: string | null): string {
  const d = daysUntil(deadline);
  if (d === null) return "no deadline";
  if (d < 0) return `${Math.abs(d)}d ago`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

/** Short, human date for subject lines: "12 Jun". Empty string when unknown. */
export function shortDate(deadline: string | null): string {
  if (!deadline) return "";
  const dt = new Date(deadline);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/** Send-ready when we hold a usable email; otherwise it needs enrichment first. */
export function readiness(m: Pick<OutreachMatch, "contact_email">): OutreachReadiness {
  const e = m.contact_email?.trim() ?? "";
  return e.includes("@") ? "send_ready" : "needs_email";
}

export function hasLinkedIn(m: Pick<OutreachMatch, "contact_linkedin">): boolean {
  return /linkedin\.com/i.test(m.contact_linkedin ?? "");
}

export type OutreachChannel = "email" | "linkedin" | "none";

/** Best channel to reach a prospect: email if we hold one, else LinkedIn, else nothing. */
export function reachableChannel(m: Pick<OutreachMatch, "contact_email" | "contact_linkedin">): OutreachChannel {
  if (readiness(m) === "send_ready") return "email";
  if (hasLinkedIn(m)) return "linkedin";
  return "none";
}

// Consultancy / advisory / individual-expert work. The shared matchTenders
// engine already drops `opportunity_type === "Consultancy"` and individual-
// contractor postings for non-consulting profiles, but UN/IFI feeds routinely
// tag advisory RFPs as "RFP"/"Services"/null. This catches the untagged ones
// (and any company mis-classified as consulting) so the operator can keep the
// bizdev radar focused on tenders our SMEs can actually deliver + bid. It's a
// default-ON display filter, not a hard rule — toggle it off for a network
// company that genuinely IS a consultancy.
const CONSULTANCY_TYPE_RE = /consultanc/i;
const CONSULTANCY_TITLE_RE = /\b(individual|national|international|senior|junior|home[- ]based)?\s*consultant|consultanc(?:y|ies)|terms of reference|\btors?\b|technical assistance|capacity[- ]building|feasibility study|baseline (?:study|survey|assessment)|mid[- ]?term review|end[- ]?line (?:study|survey|evaluation)|monitoring (?:and|&) evaluation|\bm\s?&\s?e\b|\bm and e\b|impact evaluation|research (?:study|consultancy)|advisory services|call for (?:experts?|cvs?)|roster of (?:experts?|consultants?)\b/i;

/** True when a match looks like consultancy/advisory/individual-expert work. */
export function isConsultancyTender(m: Pick<OutreachMatch, "tender_type" | "tender_title">): boolean {
  if (m.tender_type && CONSULTANCY_TYPE_RE.test(m.tender_type)) return true;
  return CONSULTANCY_TITLE_RE.test(m.tender_title ?? "");
}

/** Best-effort: only surface an estimated value when it looks meaningful — never invent one. */
export function meaningfulValue(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (/^(n\/?a|tbd|unknown|none|null|0)$/i.test(s)) return null;
  if (/not\s*(specified|disclosed|available|provided)/i.test(s)) return null;
  return s;
}

// ── Boilerplate gaps we never surface to a cold prospect: administrative /
// financial / paperwork items that (a) every vendor needs, so they aren't
// insightful, and (b) read as presumptuous in a first-touch email. We keep the
// capability / experience / track-record / sector-evidence gaps — the ones that
// show we understood the business and that TenderPath actually helps close. The
// assessment prompt already avoids scoring audited financials as a gap; this is
// a second, display-time net for whatever boilerplate still slips through.
const BOILERPLATE_GAP_RE =
  /audited|audit report|financial statement|\bfinancials\b|annual turnover|\bturnover\b|balance sheet|bank (?:statement|reference|guarantee)|proof of funds|tax (?:registration|clearance|compliance|certificate|id)|\bvat\b|certificate of (?:incorporation|registration)|business registration|company registration|trade licen[sc]e|registration certificate|legal registration|professional indemnity|liability insurance|\binsurance\b|power of attorney|ungm (?:registration|vendor)|register(?:ed|ing)? (?:on|with) ungm|vendor registration|notar(?:ised|ized|y)/i;

const GAP_SEVERITY_RANK: Record<Gap["severity"], number> = { high: 0, medium: 1, low: 2 };

export function prospectGapIssueText(gap: Pick<Gap, "gap"> | string): string {
  const value = typeof gap === "string" ? gap : gap.gap;
  const raw = value
    .replace(/^\s*(evidence needed|need evidence|missing|gap)\s*:?\s*/i, "")
    .replace(/^\s*no evidence of\s+/i, "")
    .replace(/^\s*no\s+/i, "confirm ")
    .replace(/website content is minimal\/placeholder\s*[—-]\s*/i, "")
    .trim();
  return raw || value.trim();
}

export function prospectGapFixText(fix: string | null | undefined): string {
  return fix
    ? fix
        .replace(/^\s*(supply|provide|add|attach)\s+/i, "")
        .trim()
    : "";
}

export function prospectGapText(gap: Gap): string {
  const issue = prospectGapIssueText(gap);
  const fix = prospectGapFixText(gap.fix);
  return `${issue}${fix ? ` — ${fix}` : ""}`;
}

/**
 * Pick the gaps worth showing a prospect: drop administrative/financial
 * boilerplate (audited statements, registration certs, tax/VAT, insurance — the
 * stuff every vendor needs and that reads as presumptuous cold), keep the
 * capability/experience/positioning gaps, most-severe first, capped at n.
 */
export function selectInsightfulGaps(gaps: Gap[] | null | undefined, n = 3): Gap[] {
  if (!Array.isArray(gaps)) return [];
  return gaps
    .filter((g) => g && typeof g.gap === "string" && g.gap.trim() && !BOILERPLATE_GAP_RE.test(g.gap))
    .slice()
    .sort((a, b) => (GAP_SEVERITY_RANK[a.severity] ?? 1) - (GAP_SEVERITY_RANK[b.severity] ?? 1))
    .slice(0, Math.max(0, n));
}

export interface UngmReadiness {
  /** UNGM is relevant — at least one matched tender is a genuine UN-agency buyer. */
  applies: boolean;
  /** How many of the supplied matches are UN-agency (UNGM-submitted) tenders. */
  unCount: number;
  /** Honest one-line readiness note, or null when UNGM doesn't apply. */
  line: string | null;
}

const UNGM_LEVEL_LABEL: Record<"basic" | "level-1" | "level-2", string> = {
  basic: "Basic",
  "level-1": "Level 1",
  "level-2": "Level 2",
};

/**
 * Compute the UNGM-readiness note for a prospect's matches. Only fires when some
 * matched tenders are genuine UN-agency buyers (isUngmAgency). Honest by
 * construction — never claims a registration the operator hasn't recorded; when
 * status is unknown the copy stays conditional ("if you're not registered…").
 */
export function ungmReadiness(
  matches: Pick<OutreachMatch, "tender_agency">[],
  status: ProspectUngmStatus | null | undefined,
): UngmReadiness {
  const unCount = matches.filter((m) => isUngmAgency(m.tender_agency)).length;
  if (unCount === 0) return { applies: false, unCount: 0, line: null };
  const noun = unCount === 1 ? "opportunity" : "opportunities";
  let line: string;
  if (status === "basic" || status === "level-1" || status === "level-2") {
    line = `You're already registered on UNGM (${UNGM_LEVEL_LABEL[status]}), so you can move straight to bidding on the ${unCount} UN-agency ${noun} here.`;
  } else if (status === "not_registered") {
    line = `${unCount} of these are UN-agency tenders, submitted through UNGM (ungm.org). You'll need a free UNGM vendor account to bid — first-time registration is quick at Basic level, so worth starting now.`;
  } else {
    line = `${unCount} of these are UN-agency tenders, submitted through UNGM (ungm.org). If you're not already registered there, the free Basic level is usually enough to bid and is quick to set up.`;
  }
  return { applies: true, unCount, line };
}

const DEFAULT_BRIEFING_ORIGIN = "https://www.tenderpath.me";

/** Relative path to a prospect's public briefing, or null without a token. */
export function prospectBriefingPath(token: string | null | undefined): string | null {
  const t = (token ?? "").trim();
  return t ? `/n/${encodeURIComponent(t)}` : null;
}

/**
 * Absolute URL to a prospect's public briefing for pasting into outreach. Pass
 * the runtime origin (window.location.origin client-side, NEXT_PUBLIC_APP_URL
 * server-side); falls back to the prod origin so a generated draft always has a
 * working link even when no origin is supplied (e.g. the CSV export).
 */
export function briefingUrl(token: string | null | undefined, origin?: string | null): string | null {
  const path = prospectBriefingPath(token);
  if (!path) return null;
  const base = (origin && origin.trim() ? origin : DEFAULT_BRIEFING_ORIGIN).replace(/\/+$/, "");
  return `${base}${path}`;
}

function firstName(contactName: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

function companyInSentence(companyName: string): string {
  return companyName.trim().replace(/[.!?]+$/, "") || "your team";
}

function agencyOf(m: OutreachMatch): string { return m.tender_agency?.trim() || "A buyer"; }
function sectorOf(m: OutreachMatch): string { return m.tender_sector?.trim() || ""; }

/** Honest deadline phrase for message bodies — never claims a deadline it doesn't have. */
function deadlinePhraseOf(m: OutreachMatch): string {
  const days = daysUntil(m.tender_deadline);
  const dateShort = shortDate(m.tender_deadline);
  if (days === null) return "closing soon";
  if (days < 0) return `(note: this one closed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago — confirm it's still live)`;
  if (days === 0) return `closing today${dateShort ? ` (${dateShort})` : ""}`;
  return `closing in ${days} day${days === 1 ? "" : "s"}${dateShort ? ` (${dateShort})` : ""}`;
}

function humanTenderIntro(companyName: string, count: number): string {
  const company = companyInSentence(companyName);
  return count === 1
    ? `I came across this and thought it was worth putting in front of ${company}. Details are below so you can check quickly.`
    : `I came across these and thought they were worth putting in front of ${company}. Details are below so you can check quickly.`;
}

/**
 * Turn a match into a short, specific, deadline-anchored cold EMAIL draft.
 * Deterministic (no LLM): instant, free, predictable, easy to tweak before
 * sending. Degrades gracefully when fields are missing.
 */
export function buildOutreachDraft(m: OutreachMatch, signoff: string): OutreachDraft {
  const agency = agencyOf(m);
  const sector = sectorOf(m);
  const dateShort = shortDate(m.tender_deadline);
  const subjectSector = sector ? `${sector} ` : "";
  const subject = (
    dateShort
      ? `${agency} ${subjectSector}tender — closes ${dateShort}`
      : `${agency} ${subjectSector}tender I thought worth sending`
  ).replace(/\s+/g, " ").trim();

  const value = meaningfulValue(m.tender_value);
  const where = [m.tender_agency?.trim(), m.tender_country?.trim(), sector].filter(Boolean).join(" · ");

  const body = [
    `Hi ${firstName(m.contact_name)},`,
    "",
    humanTenderIntro(m.company_name, 1),
    "",
    `"${m.tender_title}"${where ? ` — ${where}` : ""}`,
    `${deadlinePhraseOf(m).replace(/^closing/, "Closes")}${value ? ` · est. ${value}` : ""}`,
    ...(m.tender_source_url ? [m.tender_source_url] : []),
    "",
    signoff || "[Your name]\nTenderPath",
  ].join("\n");

  return { subject, body };
}

export interface LinkedInDraft {
  note: string;     // <=300 chars — fits a LinkedIn connection-request note
  message: string;  // fuller first DM / InMail, once connected
}

const NOTE_LIMIT = 300;
/**
 * LinkedIn variant for the majority of bizdev prospects who have no email.
 * `note` is trimmed to LinkedIn's 300-char connection-note ceiling; `message`
 * is the fuller follow-up to send once they accept.
 */
export function buildLinkedInDraft(m: OutreachMatch, signoff: string): LinkedInDraft {
  const agency = agencyOf(m);
  const sector = sectorOf(m);
  const dateShort = shortDate(m.tender_deadline);
  const sectorWord = sector ? `${sector} ` : "";

  let note = `Hi ${firstName(m.contact_name)} — I came across a live ${agency} ${sectorWord}tender${dateShort ? ` (closes ${dateShort})` : ""} and thought of ${companyInSentence(m.company_name)}. Might be useful.`
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_LIMIT) note = `${note.slice(0, NOTE_LIMIT - 1).trimEnd()}…`;

  const messageParts: string[] = [
    `Hi ${firstName(m.contact_name)},`,
    "",
    humanTenderIntro(m.company_name, 1),
    "",
    bundleTenderLine(m, 0),
  ];
  messageParts.push("", signoff || "[Your name]\nTenderPath");

  return { note, message: messageParts.join("\n") };
}

/** Primary ordering of the worklist + bundles. */
export type OutreachSort = "deadline" | "fit";

export interface ShortlistOptions {
  /** Minimum business days until the deadline (default 10 — below that it's too close to pitch). */
  minBusinessDays?: number;
  /** Minimum fit score to surface (default 70 — outreach is for high matches only). */
  minScore?: number;
  /** Drop consultancy/advisory tenders (default true). */
  excludeConsultancies?: boolean;
  /** Email-ready (we hold a usable email) only. */
  sendReadyOnly?: boolean;
  /**
   * Drop tenders from agencies this company has already LOST with. Default
   * false: a prior loss is surfaced as a flag (operator judgement), not silently
   * hidden — losing one bid ≠ never pitch that agency again. Opt-in bulk hide.
   */
  hideLostAgencies?: boolean;
  /** Lead with soonest deadline (default) or highest fit. */
  sort?: OutreachSort;
}

/** Comparator for the chosen primary ordering. */
function comparatorFor(sort: OutreachSort): (a: OutreachMatch, b: OutreachMatch) => number {
  return sort === "fit" ? byScoreThenDeadline : byDeadlineThenScore;
}

export const OUTREACH_DEFAULTS = {
  // 0 = no client-side lead-time floor by default. Lead time is governed
  // server-side by the page-level "Min lead time" control (?min_days, applied
  // BEFORE the row cap in network-companies/route.ts). A second client-side
  // floor here double-filtered in mismatched units (this is BUSINESS days; the
  // server is CALENDAR days) and silently emptied the worklist. Operators can
  // still set a business-days floor manually; it just no longer fights the
  // server control out of the box.
  minBusinessDays: 0,
  minScore: 70,
  excludeConsultancies: true,
} as const;

/**
 * Apply the operator's filters then sort soonest-deadline-first, then fit.
 * Lead time is enforced server-side (page "Min lead time" → ?min_days, before
 * the row cap); the optional minBusinessDays here is an extra manual floor,
 * off by default. High fit + no consultancies stay on by default.
 */
export function rankForOutreach(matches: OutreachMatch[], opts: ShortlistOptions = {}): OutreachMatch[] {
  const minBusinessDays = opts.minBusinessDays ?? OUTREACH_DEFAULTS.minBusinessDays;
  const minScore = opts.minScore ?? OUTREACH_DEFAULTS.minScore;
  const excludeConsultancies = opts.excludeConsultancies ?? OUTREACH_DEFAULTS.excludeConsultancies;
  const cmp = comparatorFor(opts.sort ?? "deadline");

  return matches
    .filter((m) => {
      if (minScore > 0 && m.score < minScore) return false;
      if (excludeConsultancies && isConsultancyTender(m)) return false;
      if (opts.hideLostAgencies && m.lost_agency_before) return false;
      if (minBusinessDays > 0) {
        const biz = businessDaysUntil(m.tender_deadline);
        // No deadline → keep (can't disqualify on a date we don't have).
        if (biz !== null && biz < minBusinessDays) return false;
      }
      if (opts.sendReadyOnly && readiness(m) !== "send_ready") return false;
      return true;
    })
    .sort(cmp);
}

/** A company and the qualifying tenders we can pitch it in one go. */
export interface CompanyGroup {
  company_id: number;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  channel: OutreachChannel;
  matches: OutreachMatch[];
}

/**
 * Bundle an already-filtered, already-ranked match list by company. Groups keep
 * the incoming (deadline-first) order; companies are ordered by their soonest
 * deadline so the most time-critical bundles surface first.
 */
export function groupByCompany(matches: OutreachMatch[], sort: OutreachSort = "deadline"): CompanyGroup[] {
  const groups = new Map<number, CompanyGroup>();
  for (const m of matches) {
    let g = groups.get(m.company_id);
    if (!g) {
      g = {
        company_id: m.company_id,
        company_name: m.company_name,
        contact_name: m.contact_name,
        contact_email: m.contact_email,
        contact_linkedin: m.contact_linkedin,
        channel: reachableChannel(m),
        matches: [],
      };
      groups.set(m.company_id, g);
    }
    g.matches.push(m);
  }
  // Order companies by their leading match under the same comparator the list
  // was ranked with, so a fit-first list also surfaces best-fit companies first.
  const cmp = comparatorFor(sort);
  return [...groups.values()].sort((a, b) => cmp(a.matches[0], b.matches[0]));
}

/** One numbered tender line for a bundle email body. */
function bundleTenderLine(m: OutreachMatch, idx: number): string {
  const where = [m.tender_agency?.trim(), m.tender_country?.trim()].filter(Boolean).join(" · ");
  const value = meaningfulValue(m.tender_value);
  const parts = [
    `${idx + 1}. "${m.tender_title}"${where ? ` — ${where}` : ""}`,
    `   ${deadlinePhraseOf(m).replace(/^closing/, "Closes")}${value ? ` · est. ${value}` : ""}`,
  ];
  if (m.tender_source_url) parts.push(`   ${m.tender_source_url}`);
  return parts.join("\n");
}

/**
 * Turn a company's bundle into ONE cold email listing every selected tender.
 * Deterministic (no LLM), honest on every deadline, and preserves the isolation
 * invariant — this only builds copy for the operator to send from their own
 * inbox. Pass the (possibly de-selected) subset the operator wants to pitch.
 */
export function buildBundleEmail(
  group: Pick<CompanyGroup, "company_name" | "contact_name">,
  matches: OutreachMatch[],
  signoff: string,
): OutreachDraft {
  const n = matches.length;
  const subject = n === 1
    ? buildOutreachDraft(matches[0], signoff).subject
    : "A few tenders I thought worth sending";

  const sections: string[] = [
    `Hi ${firstName(group.contact_name)},`,
    "",
    humanTenderIntro(group.company_name, n),
    "",
    matches.map(bundleTenderLine).join("\n\n"),
    "",
    signoff || "[Your name]\nTenderPath",
  ];

  return { subject, body: sections.join("\n") };
}

function byDeadlineThenScore(a: OutreachMatch, b: OutreachMatch): number {
  const da = daysUntil(a.tender_deadline);
  const db = daysUntil(b.tender_deadline);
  if (da === null && db === null) return b.score - a.score;
  if (da === null) return 1;
  if (db === null) return -1;
  if (da !== db) return da - db;
  return b.score - a.score;
}

/** Highest fit first; ties broken by soonest deadline (no-deadline last). */
function byScoreThenDeadline(a: OutreachMatch, b: OutreachMatch): number {
  if (a.score !== b.score) return b.score - a.score;
  const da = daysUntil(a.tender_deadline);
  const db = daysUntil(b.tender_deadline);
  if (da === null && db === null) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da - db;
}

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const PILOT_EMAIL_TARGET = 25;
export const PILOT_LINKEDIN_TARGET = 25;
export const PILOT_MIN_SCORE = 85;
export const PILOT_MIN_MATCHES = 2;

/**
 * A conservative first shipping batch: high-fit companies with at least two
 * live opportunities and a shareable briefing. Keeps the first cold run small,
 * measurable, and worth manual review before scaling.
 */
export function isPilotEligibleGroup(group: CompanyGroup): boolean {
  if (group.matches.length < PILOT_MIN_MATCHES) return false;
  const topScore = Math.max(...group.matches.map((m) => m.score));
  return (
    topScore >= PILOT_MIN_SCORE &&
    Boolean(group.matches[0]?.share_token) &&
    (group.channel === "email" || group.channel === "linkedin")
  );
}

/** Select the first 25 email-ready + first 25 LinkedIn-ready eligible bundles. */
export function selectPilotGroups(
  groups: CompanyGroup[],
  opts: { emailTarget?: number; linkedinTarget?: number } = {},
): CompanyGroup[] {
  const emailTarget = opts.emailTarget ?? PILOT_EMAIL_TARGET;
  const linkedinTarget = opts.linkedinTarget ?? PILOT_LINKEDIN_TARGET;
  const eligible = groups.filter(isPilotEligibleGroup);
  const email = eligible.filter((g) => g.channel === "email").slice(0, emailTarget);
  const linkedin = eligible.filter((g) => g.channel === "linkedin").slice(0, linkedinTarget);
  return [...email, ...linkedin];
}

/**
 * Pilot CSV for the first revenue run. One row per company, with outcome
 * columns included so the exported sheet can become the reply/booked/paid log.
 */
export function toPilotCsv(groups: CompanyGroup[], signoff: string, opts: { origin?: string | null } = {}): string {
  const pilot = selectPilotGroups(groups);
  const headers = [
    "pilot_channel",
    "company",
    "contact_name",
    "contact_email",
    "contact_linkedin",
    "top_fit_score",
    "selected_tender_count",
    "soonest_deadline",
    "briefing_url",
    "draft_subject",
    "draft_body",
    "linkedin_note",
    "linkedin_follow_up",
    "outcome_contacted",
    "outcome_replied",
    "outcome_booked",
    "outcome_paid",
    "outcome_not_relevant",
    "notes",
  ];

  const rows = pilot.map((g) => {
    const picked = g.matches.slice(0, 3);
    const top = picked[0];
    const draft = buildBundleEmail(g, picked, signoff);
    const linkedIn = top ? buildLinkedInDraft(top, signoff) : { note: "", message: "" };
    return [
      g.channel,
      g.company_name,
      g.contact_name ?? "",
      g.contact_email ?? "",
      g.contact_linkedin ?? "",
      Math.max(...g.matches.map((m) => m.score)),
      picked.length,
      top?.tender_deadline ?? "",
      briefingUrl(top?.share_token, opts.origin) ?? "",
      draft.subject,
      draft.body,
      g.channel === "linkedin" ? linkedIn.note : "",
      g.channel === "linkedin" ? linkedIn.message : "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].map(csvCell).join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}

/**
 * CSV worklist for working outside the app (mail-merge / tracking sheet).
 * Send-ready rows first so you can fire those immediately and enrich the rest
 * in parallel. Includes the generated draft so the sheet doubles as the tracker.
 */
export function toOutreachCsv(matches: OutreachMatch[], signoff: string, opts: { origin?: string | null } = {}): string {
  const ordered = matches.slice().sort((a, b) => {
    const ra = readiness(a) === "send_ready" ? 0 : 1;
    const rb = readiness(b) === "send_ready" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return byDeadlineThenScore(a, b);
  });

  const headers = [
    "readiness", "channel", "company", "contact_name", "contact_email", "contact_linkedin",
    "tender", "agency", "sector", "country",
    "deadline", "days_to_deadline", "value", "fit_score",
    "source_url", "reference", "status", "briefing_url", "draft_subject", "draft_body", "linkedin_note",
  ];

  const rows = ordered.map((m) => {
    const draft = buildOutreachDraft(m, signoff);
    const li = buildLinkedInDraft(m, signoff);
    return [
      readiness(m), reachableChannel(m), m.company_name, m.contact_name ?? "", m.contact_email ?? "", m.contact_linkedin ?? "",
      m.tender_title, m.tender_agency ?? "", m.tender_sector ?? "", m.tender_country ?? "",
      m.tender_deadline ?? "", daysUntil(m.tender_deadline) ?? "", meaningfulValue(m.tender_value) ?? "", m.score,
      m.tender_source_url ?? "", m.tender_reference ?? "", m.status, briefingUrl(m.share_token, opts.origin) ?? "", draft.subject, draft.body, li.note,
    ].map(csvCell).join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}
