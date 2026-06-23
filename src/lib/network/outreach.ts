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

export type OutreachReadiness = "send_ready" | "needs_email";

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
  won_count?: number;
  lost_count?: number;
  /** This company has a `lost` match with the same agency as this tender. */
  lost_agency_before?: boolean;
}

export interface OutreachDraft {
  subject: string;
  body: string;
}

/** Whole-day count until a deadline. null when missing/unparseable. Negative = already past. */
export function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const t = new Date(deadline).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

/**
 * Business days (Mon–Fri) strictly between today and the deadline.
 * 0 when the deadline is today/past/unparseable — so a `>= N` filter naturally
 * drops closed and too-soon tenders. Holidays are not modelled (cheap, honest
 * approximation): the operator's adjustable threshold absorbs the slack.
 */
export function businessDaysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(end);
  target.setHours(0, 0, 0, 0);
  let count = 0;
  const cur = new Date(today);
  while (cur < target) {
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

function firstName(contactName: string | null): string {
  const first = (contactName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

function topReasons(reasons: string[] | null, n = 2): string {
  if (!Array.isArray(reasons)) return "";
  return reasons.map((r) => String(r).trim()).filter(Boolean).slice(0, n).join("; ");
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

/** "Why you" line, anchored in real match reasons; degrades to sector when reasons are thin. */
function fitSentenceOf(m: OutreachMatch): string {
  const reasons = topReasons(m.match_reasons);
  const sector = sectorOf(m);
  return reasons
    ? `Based on what ${m.company_name} does, you look like a strong fit: ${reasons}.`
    : `Based on what ${m.company_name} does, you look like a strong fit${sector ? ` for ${sector} work` : ""}.`;
}

// The CTA is the FREE bid/no-bid read (the on-ramp), not a hard sell.
const PITCH = "I help companies turn a match like this into a submission-ready bid, fast. Want a quick read on whether it's worth going for — the deadline, the key requirements, and where you'd be strong or weak? No cost to look.";

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
      : `${agency} ${subjectSector}tender — ${m.company_name} looks like a fit`
  ).replace(/\s+/g, " ").trim();

  const value = meaningfulValue(m.tender_value);
  const valueSentence = value ? `Estimated value: ${value}. ` : "";
  const sectorWord = sector ? `${sector} ` : "";

  const body = [
    `Hi ${firstName(m.contact_name)},`,
    "",
    `${agency} has a live ${sectorWord}opportunity — "${m.tender_title}" — ${deadlinePhraseOf(m)}. ${fitSentenceOf(m)}`,
    "",
    `${valueSentence}${PITCH}`,
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
const NOTE_PITCH = "I help firms turn matches like this into submission-ready bids — happy to share a quick read. Worth a look?";

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

  let note = `Hi ${firstName(m.contact_name)} — ${agency} has a live ${sectorWord}tender${dateShort ? ` (closes ${dateShort})` : ""} ${m.company_name} looks a strong fit for. ${NOTE_PITCH}`
    .replace(/\s+/g, " ")
    .trim();
  if (note.length > NOTE_LIMIT) note = `${note.slice(0, NOTE_LIMIT - 1).trimEnd()}…`;

  const value = meaningfulValue(m.tender_value);
  const valueSentence = value ? `Estimated value: ${value}. ` : "";
  const message = [
    `Hi ${firstName(m.contact_name)}, thanks for connecting.`,
    "",
    `${agency} has a live ${sectorWord}opportunity — "${m.tender_title}" — ${deadlinePhraseOf(m)}. ${fitSentenceOf(m)}`,
    "",
    `${valueSentence}${PITCH}`,
    "",
    signoff || "[Your name]\nTenderPath",
  ].join("\n");

  return { note, message };
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
  const reason = topReasons(m.match_reasons, 1);
  const parts = [
    `${idx + 1}. "${m.tender_title}"${where ? ` — ${where}` : ""}`,
    `   ${deadlinePhraseOf(m).replace(/^closing/, "Closes")}${value ? ` · est. ${value}` : ""}`,
  ];
  if (reason) parts.push(`   Why you: ${reason}`);
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
    : `${n} live tenders ${group.company_name} looks a strong fit for`;

  const intro = n === 1
    ? `A live opportunity just came up that ${group.company_name} looks like a strong fit for:`
    : `A few live opportunities just came up that ${group.company_name} looks like a strong fit for:`;

  const body = [
    `Hi ${firstName(group.contact_name)},`,
    "",
    intro,
    "",
    matches.map(bundleTenderLine).join("\n\n"),
    "",
    n === 1
      ? PITCH
      : "I help companies turn matches like these into submission-ready bids, fast. Want a quick read on any of them — the deadlines, the key requirements, and where you'd be strong or weak? No cost to look.",
    "",
    signoff || "[Your name]\nTenderPath",
  ].join("\n");

  return { subject, body };
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

/**
 * CSV worklist for working outside the app (mail-merge / tracking sheet).
 * Send-ready rows first so you can fire those immediately and enrich the rest
 * in parallel. Includes the generated draft so the sheet doubles as the tracker.
 */
export function toOutreachCsv(matches: OutreachMatch[], signoff: string): string {
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
    "source_url", "reference", "status", "draft_subject", "draft_body", "linkedin_note",
  ];

  const rows = ordered.map((m) => {
    const draft = buildOutreachDraft(m, signoff);
    const li = buildLinkedInDraft(m, signoff);
    return [
      readiness(m), reachableChannel(m), m.company_name, m.contact_name ?? "", m.contact_email ?? "", m.contact_linkedin ?? "",
      m.tender_title, m.tender_agency ?? "", m.tender_sector ?? "", m.tender_country ?? "",
      m.tender_deadline ?? "", daysUntil(m.tender_deadline) ?? "", meaningfulValue(m.tender_value) ?? "", m.score,
      m.tender_source_url ?? "", m.tender_reference ?? "", m.status, draft.subject, draft.body, li.note,
    ].map(csvCell).join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}
