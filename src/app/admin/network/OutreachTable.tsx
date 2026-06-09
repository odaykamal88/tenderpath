"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import {
  type OutreachMatch,
  buildBundleEmail,
  buildLinkedInDraft,
  businessDaysUntil,
  groupByCompany,
  hasLinkedIn,
  isConsultancyTender,
  OUTREACH_DEFAULTS,
  rankForOutreach,
  relBusinessDeadline,
  toOutreachCsv,
} from "@/lib/network/outreach";

const SIGNOFF_KEY = "tp_outreach_signoff";
const FILTERS_KEY = "tp_outreach_filters_v1";
const DEFAULT_SIGNOFF = "[Your name]\nTenderPath";

interface Filters {
  minBusinessDays: number;
  minScore: number;
  excludeConsultancies: boolean;
  sendReadyOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  minBusinessDays: OUTREACH_DEFAULTS.minBusinessDays,
  minScore: OUTREACH_DEFAULTS.minScore,
  excludeConsultancies: OUTREACH_DEFAULTS.excludeConsultancies,
  sendReadyOnly: false,
};

function loadFilters(): Filters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const p = JSON.parse(raw) as Partial<Filters>;
    return {
      minBusinessDays: Number.isFinite(p.minBusinessDays) ? Number(p.minBusinessDays) : DEFAULT_FILTERS.minBusinessDays,
      minScore: Number.isFinite(p.minScore) ? Number(p.minScore) : DEFAULT_FILTERS.minScore,
      excludeConsultancies: typeof p.excludeConsultancies === "boolean" ? p.excludeConsultancies : DEFAULT_FILTERS.excludeConsultancies,
      sendReadyOnly: typeof p.sendReadyOnly === "boolean" ? p.sendReadyOnly : DEFAULT_FILTERS.sendReadyOnly,
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
  const groups = useMemo(() => groupByCompany(shortlist), [shortlist]);

  // Transparency on what the filters removed — never silently drop tenders.
  const hidden = useMemo(() => {
    const consultancy = filters.excludeConsultancies ? matches.filter(isConsultancyTender).length : 0;
    const tooSoon = filters.minBusinessDays > 0
      ? matches.filter((m) => { const b = businessDaysUntil(m.tender_deadline); return b !== null && b < filters.minBusinessDays; }).length
      : 0;
    const lowFit = filters.minScore > 0 ? matches.filter((m) => m.score < filters.minScore).length : 0;
    return { consultancy, tooSoon, lowFit };
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
    const csv = toOutreachCsv(shortlist, signoff);
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

  const hiddenParts = [
    hidden.consultancy > 0 ? `${hidden.consultancy} consultancy` : null,
    hidden.tooSoon > 0 ? `${hidden.tooSoon} closing too soon` : null,
    hidden.lowFit > 0 ? `${hidden.lowFit} below fit` : null,
  ].filter(Boolean);

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Outreach bundles</h2>
          <p className={styles.panelSub}>
            One high-fit bundle per company, soonest deadline first. Untick any tender you don&rsquo;t want,
            compose a single email, copy it, send from your own account, then mark contacted.
          </p>
        </div>
        <span className={styles.panelMeta}>{groups.length} {groups.length === 1 ? "company" : "companies"} · {shortlist.length} tenders</span>
      </header>

      {/* Adjustable filters — these are the launch rules, tunable per the operator. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", padding: "10px 22px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          Min business days
          <input
            type="number" min={0} value={filters.minBusinessDays}
            onChange={(e) => patchFilters({ minBusinessDays: clampInt(e.target.value, DEFAULT_FILTERS.minBusinessDays) })}
            className={styles.adminSearchInput}
            suppressHydrationWarning
            style={{ width: 64, padding: "4px 6px", fontSize: 12 }}
          />
        </label>
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
        <button type="button" className={styles.btnGhost} onClick={() => setFilters(DEFAULT_FILTERS)} style={{ padding: "4px 9px", fontSize: 11 }}>
          Reset
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className={styles.btnGhost} onClick={exportCsv} disabled={shortlist.length === 0} style={{ padding: "5px 10px", fontSize: 12 }}>
          Export CSV ({shortlist.length})
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
            : "Nothing meets these filters — loosen min business days, min fit, or the consultancy toggle above."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 22px 20px" }}>
          {groups.map((g) => {
            const selected = selectedFor(g);
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
                              {Array.isArray(m.match_reasons) && m.match_reasons.length > 0 && ` · ${m.match_reasons.slice(0, 2).join("; ")}`}
                            </div>
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
