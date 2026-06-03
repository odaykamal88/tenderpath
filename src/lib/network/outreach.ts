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

export interface ShortlistOptions {
  hideClosed?: boolean;
  sendReadyOnly?: boolean;
}

/** Soonest actionable deadline first, then fit. Optionally drops closed / non-send-ready rows. */
export function rankForOutreach(matches: OutreachMatch[], opts: ShortlistOptions = {}): OutreachMatch[] {
  let list = matches.slice();
  if (opts.hideClosed) {
    list = list.filter((m) => {
      const d = daysUntil(m.tender_deadline);
      return d === null || d >= 0;
    });
  }
  if (opts.sendReadyOnly) {
    list = list.filter((m) => readiness(m) === "send_ready");
  }
  return list.sort(byDeadlineThenScore);
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
