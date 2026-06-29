"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import {
  type OutreachMatch,
  type OutreachSort,
  type ProspectUngmStatus,
  briefingUrl,
  buildBundleEmail,
  buildLinkedInDraft,
  foldedOpportunityCount,
  foldedSourceLabel,
  groupByCompany,
  hasLinkedIn,
  isConsultancyTender,
  OUTREACH_DEFAULTS,
  rankForOutreach,
  relBusinessDeadline,
  selectPilotGroups,
  selectInsightfulGaps,
  toOutreachCsv,
  toPilotCsv,
  ungmReadiness,
} from "@/lib/network/outreach";

/** Origin for building absolute briefing links (falls back to prod server-side). */
function browserOrigin(): string | undefined {
  return typeof window !== "undefined" ? window.location.origin : undefined;
}

const UNGM_STATUS_LABEL: Record<ProspectUngmStatus, string> = {
  unknown: "UNGM status unknown",
  not_registered: "not on UNGM",
  basic: "UNGM Basic",
  "level-1": "UNGM Level 1",
  "level-2": "UNGM Level 2",
};

const SIGNOFF_KEY = "tp_outreach_signoff";
// v3: dropped the client-side "min business days" lead-time floor entirely. Lead
// time is now governed by the single server-side "Min lead time" control on the
// page (?min_days, applied before the row cap). Two floors in mismatched units
// (calendar vs business) confused operators and silently emptied the worklist.
// Bumping the key clears stale persisted shapes (v4 adds sort + hideLostAgencies).
const FILTERS_KEY = "tp_outreach_filters_v4";
const DEFAULT_SIGNOFF = "[Your name]\nTenderPath";

interface Filters {
  minScore: number;
  excludeConsultancies: boolean;
  sendReadyOnly: boolean;
  /** Bulk-hide tenders from agencies this company has already lost with (off = flag only). */
  hideLostAgencies: boolean;
  /** Lead with soonest deadline or highest fit. */
  sort: OutreachSort;
}

const DEFAULT_FILTERS: Filters = {
  minScore: OUTREACH_DEFAULTS.minScore,
  excludeConsultancies: OUTREACH_DEFAULTS.excludeConsultancies,
  sendReadyOnly: false,
  hideLostAgencies: false,
  sort: "deadline",
};

function loadFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw) as Partial<Filters>;
    return {
      minScore: Number.isFinite(p.minScore) ? Number(p.minScore) : DEFAULT_FILTERS.minScore,
      excludeConsultancies: typeof p.excludeConsultancies === "boolean" ? p.excludeConsultancies : DEFAULT_FILTERS.excludeConsultancies,
      sendReadyOnly: typeof p.sendReadyOnly === "boolean" ? p.sendReadyOnly : DEFAULT_FILTERS.sendReadyOnly,
      hideLostAgencies: typeof p.hideLostAgencies === "boolean" ? p.hideLostAgencies : DEFAULT_FILTERS.hideLostAgencies,
      sort: p.sort === "fit" || p.sort === "deadline" ? p.sort : DEFAULT_FILTERS.sort,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

interface Props {
  matches: OutreachMatch[];
  loading: boolean;
  busy: number | null;
  onSetStatus: (matchId: number, status: string, reason?: string) => void;
  onSetManyStatus: (matchIds: number[], status: string) => void;
}

type DraftState =
  | { kind: "bundle"; companyId: number; subject: string; body: string }
  | { kind: "linkedin"; matchId: number; note: string; message: string }
  | null;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function clampInt(raw: string, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export default function OutreachTable({ matches, loading, busy, onSetStatus, onSetManyStatus }: Props) {
  const [signoff, setSignoff] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SIGNOFF;
    return localStorage.getItem(SIGNOFF_KEY) ?? DEFAULT_SIGNOFF;
  });
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [draft, setDraft] = useState<DraftState>(null);
  const [copied, setCopied] = useState("");

  // Persist filter changes (write-only effect — no setState, so no cascade).
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  }, [filters]);

  function updateSignoff(v: string) {
    setSignoff(v);
    if (typeof window !== "undefined") localStorage.setItem(SIGNOFF_KEY, v);
  }
  function patchFilters(p: Partial<Filters>) { setFilters((f) => ({ ...f, ...p })); }

  const shortlist = useMemo(() => rankForOutreach(matches, filters), [matches, filters]);
  const groups = useMemo(() => groupByCompany(shortlist, filters.sort), [shortlist, filters.sort]);
  const pilotGroups = useMemo(() => selectPilotGroups(groups), [groups]);

  // Transparency on what the filters removed — never silently drop tenders.
  const hidden = useMemo(() => {
    const consultancy = filters.excludeConsultancies ? matches.filter(isConsultancyTender).length : 0;
    const lowFit = filters.minScore > 0 ? matches.filter((m) => m.score < filters.minScore).length : 0;
    const lostAgency = filters.hideLostAgencies ? matches.filter((m) => m.lost_agency_before).length : 0;
    const foldedCrawlerRows = matches.reduce((sum, match) => sum + Math.max(0, foldedOpportunityCount(match) - 1), 0);
    return { consultancy, lowFit, lostAgency, foldedCrawlerRows };
  }, [matches, filters]);

  function isIn(matchId: number): boolean { return !excluded.has(matchId); }
  function toggleExcluded(matchId: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId); else next.add(matchId);
      return next;
    });
  }
  function selectedFor(group: { matches: OutreachMatch[] }): OutreachMatch[] {
    return group.matches.filter((m) => isIn(m.id));
  }

  function composeBundle(group: { company_id: number; company_name: string; contact_name: string | null; matches: OutreachMatch[] }) {
    const picked = selectedFor(group);
    if (picked.length === 0) return;
    const d = buildBundleEmail(group, picked, signoff);
    setDraft({ kind: "bundle", companyId: group.company_id, subject: d.subject, body: d.body });
    setCopied("");
    setDismissingId(null);
  }
  function openLinkedIn(m: OutreachMatch) {
    const d = buildLinkedInDraft(m, signoff);
    setDraft({ kind: "linkedin", matchId: m.id, note: d.note, message: d.message });
    setCopied("");
    setDismissingId(null);
  }
  function markBundleContacted(group: { company_id: number; matches: OutreachMatch[] }) {
    const ids = selectedFor(group).map((m) => m.id);
    if (ids.length === 0) return;
    onSetManyStatus(ids, "contacted");
    setDraft((d) => (d && d.kind === "bundle" && d.companyId === group.company_id ? null : d));
  }

  async function copy(textToCopy: string, key: string) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(key);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      /* clipboard blocked — the textareas stay visible for manual select+copy */
    }
  }

  function exportCsv() {
    const csv = toOutreachCsv(shortlist, signoff, { origin: browserOrigin() });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenderpath-outreach-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportPilotCsv() {
    const csv = toPilotCsv(groups, signoff, { origin: browserOrigin() });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tenderpath-pilot-50-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const hiddenParts = [
    hidden.consultancy > 0 ? `${hidden.consultancy} consultancy` : null,
    hidden.lowFit > 0 ? `${hidden.lowFit} below fit` : null,
    hidden.lostAgency > 0 ? `${hidden.lostAgency} lost-agency` : null,
  ].filter(Boolean);

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Outreach bundles</h2>
          <p className={styles.panelSub}>
            One high-fit bundle per company, soonest deadline first. Untick any opportunity you don&rsquo;t want,
            compose a single email, copy it, send from your own account, then mark contacted.
          </p>
        </div>
        <span className={styles.panelMeta}>
          {groups.length} {groups.length === 1 ? "company" : "companies"} · {shortlist.length} opportunities
          {hidden.foldedCrawlerRows > 0 ? ` · ${hidden.foldedCrawlerRows} crawler copies folded` : ""}
        </span>
      </header>

      {/* Adjustable filters — these are the launch rules, tunable per the operator. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", padding: "10px 22px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          Min fit
          <input
            type="number" min={0} max={100} value={filters.minScore}
            onChange={(e) => patchFilters({ minScore: clampInt(e.target.value, DEFAULT_FILTERS.minScore) })}
            className={styles.adminSearchInput}
            suppressHydrationWarning
            style={{ width: 64, padding: "4px 6px", fontSize: 12 }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={filters.excludeConsultancies} onChange={(e) => patchFilters({ excludeConsultancies: e.target.checked })} suppressHydrationWarning />
          Exclude consultancies
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={filters.sendReadyOnly} onChange={(e) => patchFilters({ sendReadyOnly: e.target.checked })} suppressHydrationWarning />
          Email-ready only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }} title="Bulk-hide tenders from agencies this company has already lost with. Off by default — a prior loss is flagged on the row, not hidden.">
          <input type="checkbox" checked={filters.hideLostAgencies} onChange={(e) => patchFilters({ hideLostAgencies: e.target.checked })} suppressHydrationWarning />
          Hide lost agencies
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          Sort
          <select
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value as OutreachSort })}
            className={styles.adminSearchInput}
            suppressHydrationWarning
            style={{ width: "auto", padding: "4px 6px", fontSize: 12 }}
          >
            <option value="deadline">Soonest deadline</option>
            <option value="fit">Best fit</option>
          </select>
        </label>
        <button type="button" className={styles.btnGhost} onClick={() => setFilters(DEFAULT_FILTERS)} style={{ padding: "4px 9px", fontSize: 11 }}>
          Reset
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className={styles.btnGhost} onClick={exportCsv} disabled={shortlist.length === 0} style={{ padding: "5px 10px", fontSize: 12 }}>
          Export CSV ({shortlist.length})
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={exportPilotCsv}
          disabled={pilotGroups.length === 0}
          title="Exports the first 25 email-ready and first 25 LinkedIn-ready companies with 2+ tenders, 85+ top fit, and a briefing link."
          style={{ padding: "5px 10px", fontSize: 12 }}
        >
          Export pilot 50 ({pilotGroups.length})
        </button>
      </div>

      {hiddenParts.length > 0 && (
        <div className={styles.sessionSubtle} style={{ padding: "0 22px 8px", fontSize: 11 }}>
          Hidden by filters: {hiddenParts.join(" · ")}. Loosen a filter above to see them.
        </div>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "0 22px 12px" }}>
        <span className={styles.sessionSubtle} style={{ paddingTop: 6, whiteSpace: "nowrap" }}>Sign off as</span>
        <textarea
          className={styles.adminSearchInput}
          value={signoff}
          onChange={(e) => updateSignoff(e.target.value)}
          rows={2}
          placeholder={"[Your name]\nTenderPath"}
          suppressHydrationWarning
          style={{ flex: 1, padding: 6, fontFamily: "inherit", fontSize: 12 }}
        />
      </div>

      {loading ? (
        <div className={styles.woEmpty}>Loading…</div>
      ) : groups.length === 0 ? (
        <div className={styles.woEmpty}>
          {matches.length === 0
            ? "No fresh matches. Add or import companies, or wait for the next match run."
            : "Nothing meets these filters — lower Min fit, turn off the consultancy toggle, or widen Min lead time above."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 22px 20px" }}>
          {groups.map((g) => {
            const selected = selectedFor(g);
            // Per-company engagement context (same on every match of the company).
            const m0 = g.matches[0];
            const history = [
              (m0?.contacted_count ?? 0) > 0 ? `${m0!.contacted_count} contacted` : null,
              (m0?.replied_count ?? 0) > 0 ? `${m0!.replied_count} replied` : null,
              (m0?.booked_count ?? 0) > 0 ? `${m0!.booked_count} booked` : null,
              (m0?.paid_count ?? 0) > 0 ? `${m0!.paid_count} paid` : null,
              (m0?.not_relevant_count ?? 0) > 0 ? `${m0!.not_relevant_count} not relevant` : null,
              (m0?.won_count ?? 0) > 0 ? `${m0!.won_count} won` : null,
              (m0?.lost_count ?? 0) > 0 ? `${m0!.lost_count} lost` : null,
            ].filter(Boolean).join(" · ");
            // What the value-first email will carry for this prospect (same on every row).
            const insightfulGaps = selectInsightfulGaps(m0?.company_gaps, 3);
            const ungm = ungmReadiness(g.matches, m0?.ungm_status);
            const ungmStatus = (m0?.ungm_status ?? "unknown") as ProspectUngmStatus;
            const ungmRegistered = ungmStatus === "basic" || ungmStatus === "level-1" || ungmStatus === "level-2";
            const briefingLink = briefingUrl(m0?.share_token, browserOrigin());
            return (
              <div key={g.company_id} style={{ border: "1px solid var(--admin-border, rgba(127,127,127,0.22))", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--admin-panel-alt, rgba(127,127,127,0.06))" }}>
                  {g.channel === "email" ? (
                    <span className={`${styles.tag} ${styles.tagPos}`}>✉ email</span>
                  ) : g.channel === "linkedin" ? (
                    <span className={`${styles.tag} ${styles.tagMute}`}>in LinkedIn</span>
                  ) : (
                    <span className={`${styles.tag} ${styles.tagWarn}`}>⚠ needs contact</span>
                  )}
                  <div style={{ minWidth: 180 }}>
                    <Link href={`/admin/network/${g.company_id}`} className={styles.tableLink}>{g.company_name}</Link>
                    <div className={styles.sessionSubtle}>{g.contact_email ?? g.contact_name ?? "no contact on file"}</div>
                  </div>
                  {history && (
                    <span className={`${styles.tag} ${styles.tagMute}`} title="Your prior engagement with this company (all statuses)">
                      {history}
                    </span>
                  )}
                  <span className={styles.panelMeta}>{selected.length}/{g.matches.length} selected</span>
                  <div style={{ flex: 1 }} />
                  <button
                    type="button" className={styles.btnPrimary}
                    disabled={selected.length === 0}
                    onClick={() => composeBundle(g)}
                    style={{ padding: "5px 11px", fontSize: 12 }}
                  >
                    Compose email ({selected.length})
                  </button>
                  <button
                    type="button" className={styles.btnGhost}
                    disabled={selected.length === 0 || busy !== null}
                    onClick={() => markBundleContacted(g)}
                    style={{ padding: "5px 11px", fontSize: 12 }}
                  >
                    Mark contacted
                  </button>
                </div>

                {(insightfulGaps.length > 0 || ungm.applies || briefingLink) && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 14px", borderTop: "1px solid var(--admin-border, rgba(127,127,127,0.22))" }}>
                    <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>In the email + briefing:</span>
                    {insightfulGaps.length > 0 && (
                      <span className={`${styles.tag} ${styles.tagMute}`} title={insightfulGaps.map((g) => g.gap).join(" · ")}>
                        {insightfulGaps.length} gap{insightfulGaps.length === 1 ? "" : "s"} to close
                      </span>
                    )}
                    {ungm.applies && (
                      <span
                        className={`${styles.tag} ${ungmRegistered ? styles.tagPos : ungmStatus === "not_registered" ? styles.tagWarn : styles.tagMute}`}
                        title={ungm.line ?? undefined}
                      >
                        {ungm.unCount} UN · {UNGM_STATUS_LABEL[ungmStatus]}
                      </span>
                    )}
                    <div style={{ flex: 1 }} />
                    {briefingLink && (
                      <>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => copy(briefingLink, `link-${g.company_id}`)}
                          style={{ padding: "4px 9px", fontSize: 11 }}
                        >
                          {copied === `link-${g.company_id}` ? "Copied ✓" : "Copy briefing link"}
                        </button>
                        <a
                          href={briefingLink}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.btnGhost}
                          style={{ padding: "4px 9px", fontSize: 11, textDecoration: "none" }}
                        >
                          Open ↗
                        </a>
                      </>
                    )}
                  </div>
                )}

                <table className={styles.dossierTable}>
                  <tbody>
                    {g.matches.map((m) => (
                      <Fragment key={m.id}>
                        <tr style={{ opacity: isIn(m.id) ? 1 : 0.5 }}>
                          <td style={{ width: 34, textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={isIn(m.id)}
                              onChange={() => toggleExcluded(m.id)}
                              aria-label="Include in bundle"
                            />
                          </td>
                          <td style={{ maxWidth: 300 }}>
                            {m.tender_source_url ? (
                              <a className={styles.tableLink} href={m.tender_source_url} target="_blank" rel="noreferrer">{m.tender_title}</a>
                            ) : (
                              <span className={styles.cellName}>{m.tender_title}</span>
                            )}
                            <div className={styles.sessionSubtle}>
                              {[m.tender_agency, m.tender_sector, m.tender_country].filter(Boolean).join(" · ") || "—"}
                            </div>
                            <div className={styles.sessionSubtle} style={{ marginTop: 3, fontSize: 11 }}>
                              {foldedSourceLabel(m)}
                              {m.tender_reference ? ` · ${m.tender_reference}` : ""}
                            </div>
                            {Array.isArray(m.match_reasons) && m.match_reasons.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                                {m.match_reasons.slice(0, 2).map((reason, index) => (
                                  <span key={`${m.id}-reason-${index}`} className={`${styles.tag} ${styles.tagMute}`}>{reason}</span>
                                ))}
                              </div>
                            )}
                            {m.lost_agency_before && (
                              <span
                                className={`${styles.tag} ${styles.tagWarn}`}
                                style={{ marginTop: 4 }}
                                title="This company has lost a bid with this agency before — pitch with care."
                              >
                                ⚠ lost with this agency before
                              </span>
                            )}
                          </td>
                          <td>
                            <div className={styles.mono}>{fmtDate(m.tender_deadline)}</div>
                            <div className={styles.sessionSubtle}>{relBusinessDeadline(m.tender_deadline)}</div>
                          </td>
                          <td className={`${styles.num} ${m.score >= 70 ? styles.posNum : styles.muteNum}`}>{m.score}</td>
                          <td className={styles.num}>
                            {dismissingId === m.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 230 }}>
                                <textarea
                                  className={styles.adminSearchInput}
                                  placeholder="Why isn't this a fit? (the AI uses this to filter future matches)"
                                  value={dismissReason}
                                  onChange={(e) => setDismissReason(e.target.value)}
                                  rows={2}
                                  style={{ padding: 6, fontFamily: "inherit", fontSize: 11 }}
                                />
                                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                  <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { setDismissingId(null); setDismissReason(""); }} style={{ padding: "4px 8px", fontSize: 11 }}>Cancel</button>
                                  <button type="button" className={styles.btnPrimary} disabled={busy === m.id} onClick={() => { onSetStatus(m.id, "dismissed", dismissReason); setDismissingId(null); setDismissReason(""); }} style={{ padding: "4px 8px", fontSize: 11 }}>Confirm dismiss</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                                {hasLinkedIn(m) && (
                                  <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => openLinkedIn(m)} style={{ padding: "4px 8px", fontSize: 11 }}>LinkedIn</button>
                                )}
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "contacted")} style={{ padding: "4px 8px", fontSize: 11 }}>Contacted</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "replied")} style={{ padding: "4px 8px", fontSize: 11 }} title="They replied — keep this prospect out of the cold-outreach queue and follow up manually">Replied</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "booked")} style={{ padding: "4px 8px", fontSize: 11 }} title="Discovery or bid/no-bid call booked">Booked</button>
                                <button type="button" className={styles.btnPrimary} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "paid")} style={{ padding: "4px 8px", fontSize: 11 }} title="Paid proposal package or related service sold">Paid</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "not_relevant")} style={{ padding: "4px 8px", fontSize: 11 }} title="They replied or you learned this is not relevant right now">Not relevant</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "won")} style={{ padding: "4px 8px", fontSize: 11 }} title="Mark this tender won — records the outcome and drops it from the worklist">Won</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "lost")} style={{ padding: "4px 8px", fontSize: 11 }} title="Mark this tender lost — records the outcome and flags this agency on future matches">Lost</button>
                                <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { setDismissingId(m.id); setDismissReason(""); }} style={{ padding: "4px 8px", fontSize: 11 }}>Dismiss</button>
                              </div>
                            )}
                          </td>
                        </tr>
                        {draft?.kind === "linkedin" && draft.matchId === m.id && (
                          <tr>
                            <td colSpan={5} style={{ background: "var(--admin-panel-alt, rgba(127,127,127,0.06))" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 4px" }}>
                                <span className={styles.sessionSubtle}>Connection request note ({draft.note.length}/300)</span>
                                <textarea
                                  className={styles.adminSearchInput}
                                  value={draft.note}
                                  onChange={(e) => setDraft((prev) => (prev && prev.kind === "linkedin" ? { ...prev, note: e.target.value } : prev))}
                                  rows={3}
                                  style={{ padding: 8, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}
                                />
                                <span className={styles.sessionSubtle}>Follow-up message (send once they accept)</span>
                                <textarea
                                  className={styles.adminSearchInput}
                                  value={draft.message}
                                  onChange={(e) => setDraft((prev) => (prev && prev.kind === "linkedin" ? { ...prev, message: e.target.value } : prev))}
                                  rows={8}
                                  style={{ padding: 8, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}
                                />
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <button type="button" className={styles.btnPrimary} onClick={() => copy(draft.note, "note")} style={{ padding: "5px 12px", fontSize: 12 }}>
                                    {copied === "note" ? "Copied ✓" : "Copy note"}
                                  </button>
                                  <button type="button" className={styles.btnGhost} onClick={() => copy(draft.message, "dm")} style={{ padding: "5px 12px", fontSize: 12 }}>
                                    {copied === "dm" ? "Copied ✓" : "Copy follow-up"}
                                  </button>
                                  {hasLinkedIn(m) && (
                                    <a href={m.contact_linkedin ?? "#"} target="_blank" rel="noreferrer" className={styles.btnGhost} style={{ padding: "5px 12px", fontSize: 12, textDecoration: "none" }}>Open LinkedIn ↗</a>
                                  )}
                                  <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { onSetStatus(m.id, "contacted"); setDraft(null); }} style={{ padding: "5px 12px", fontSize: 12 }}>Mark contacted</button>
                                  <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { onSetStatus(m.id, "replied"); setDraft(null); }} style={{ padding: "5px 12px", fontSize: 12 }}>Mark replied</button>
                                  <button type="button" className={styles.btnGhost} onClick={() => setDraft(null)} style={{ padding: "5px 12px", fontSize: 12 }}>Close</button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>

                {draft?.kind === "bundle" && draft.companyId === g.company_id && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderTop: "1px solid var(--admin-border, rgba(127,127,127,0.22))" }}>
                    <input
                      className={styles.adminSearchInput}
                      value={draft.subject}
                      onChange={(e) => setDraft((prev) => (prev && prev.kind === "bundle" ? { ...prev, subject: e.target.value } : prev))}
                      style={{ padding: 8, fontFamily: "inherit", fontSize: 12 }}
                    />
                    <textarea
                      className={styles.adminSearchInput}
                      value={draft.body}
                      onChange={(e) => setDraft((prev) => (prev && prev.kind === "bundle" ? { ...prev, body: e.target.value } : prev))}
                      rows={14}
                      style={{ padding: 8, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}
                    />
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <button type="button" className={styles.btnPrimary} onClick={() => copy(`Subject: ${draft.subject}\n\n${draft.body}`, "bundle")} style={{ padding: "5px 12px", fontSize: 12 }}>
                        {copied === "bundle" ? "Copied ✓" : "Copy email"}
                      </button>
                      <button type="button" className={styles.btnGhost} disabled={busy !== null} onClick={() => markBundleContacted(g)} style={{ padding: "5px 12px", fontSize: 12 }}>
                        Mark {selected.length} contacted
                      </button>
                      <button type="button" className={styles.btnGhost} onClick={() => setDraft(null)} style={{ padding: "5px 12px", fontSize: 12 }}>Close</button>
                      <span className={styles.sessionSubtle}>Paste into your own email — TenderPath never sends this for you.</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
