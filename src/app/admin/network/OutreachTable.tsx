"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import {
  type OutreachMatch,
  buildLinkedInDraft,
  buildOutreachDraft,
  daysUntil,
  hasLinkedIn,
  rankForOutreach,
  reachableChannel,
  readiness,
  relDeadline,
  toOutreachCsv,
} from "@/lib/network/outreach";

const SIGNOFF_KEY = "tp_outreach_signoff";
const DEFAULT_SIGNOFF = "[Your name]\nTenderPath";

interface Props {
  matches: OutreachMatch[];
  loading: boolean;
  busy: number | null;
  onSetStatus: (matchId: number, status: string, reason?: string) => void;
}

type DraftState =
  | { id: number; mode: "email"; subject: string; body: string }
  | { id: number; mode: "linkedin"; note: string; message: string }
  | null;

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function OutreachTable({ matches, loading, busy, onSetStatus }: Props) {
  const [signoff, setSignoff] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_SIGNOFF;
    return localStorage.getItem(SIGNOFF_KEY) ?? DEFAULT_SIGNOFF;
  });
  const [hideClosed, setHideClosed] = useState(true);
  const [sendReadyOnly, setSendReadyOnly] = useState(false);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [draft, setDraft] = useState<DraftState>(null);
  const [copied, setCopied] = useState("");

  function updateSignoff(v: string) {
    setSignoff(v);
    if (typeof window !== "undefined") localStorage.setItem(SIGNOFF_KEY, v);
  }

  const shortlist = useMemo(
    () => rankForOutreach(matches, { hideClosed, sendReadyOnly }),
    [matches, hideClosed, sendReadyOnly],
  );
  const closedCount = useMemo(
    () => matches.filter((m) => { const d = daysUntil(m.tender_deadline); return d !== null && d < 0; }).length,
    [matches],
  );
  const readyCount = useMemo(() => matches.filter((m) => readiness(m) === "send_ready").length, [matches]);
  const linkedinCount = useMemo(() => matches.filter((m) => reachableChannel(m) === "linkedin").length, [matches]);

  function openEmail(m: OutreachMatch) {
    const d = buildOutreachDraft(m, signoff);
    setDraft({ id: m.id, mode: "email", subject: d.subject, body: d.body });
    setCopied("");
    setDismissingId(null);
  }
  function openLinkedIn(m: OutreachMatch) {
    const d = buildLinkedInDraft(m, signoff);
    setDraft({ id: m.id, mode: "linkedin", note: d.note, message: d.message });
    setCopied("");
    setDismissingId(null);
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

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Outreach shortlist</h2>
          <p className={styles.panelSub}>
            Soonest deadline first. Draft a message (email or LinkedIn), copy it, send it from your own account, then mark contacted.
          </p>
        </div>
        <span className={styles.panelMeta}>{shortlist.length} to work · {readyCount} email · {linkedinCount} LinkedIn</span>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 22px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} />
          Hide closed{closedCount > 0 ? ` (${closedCount})` : ""}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={sendReadyOnly} onChange={(e) => setSendReadyOnly(e.target.checked)} />
          Email-ready only
        </label>
        <div style={{ flex: 1 }} />
        <button type="button" className={styles.btnGhost} onClick={exportCsv} disabled={shortlist.length === 0} style={{ padding: "5px 10px", fontSize: 12 }}>
          Export CSV ({shortlist.length})
        </button>
      </div>

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
      ) : shortlist.length === 0 ? (
        <div className={styles.woEmpty}>
          {matches.length === 0
            ? "No fresh matches. Add or import companies, or wait for the next match run."
            : "Nothing in the shortlist with these filters — try unchecking the toggles above."}
        </div>
      ) : (
        <div className={styles.tableWrap} style={{ maxHeight: "44vh", overflow: "auto" }}>
          <table className={styles.dossierTable}>
            <thead>
              <tr>
                <th>Company</th>
                <th>Tender</th>
                <th>Deadline</th>
                <th className={styles.num}>Fit</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shortlist.map((m) => {
                const ch = reachableChannel(m);
                return (
                  <Fragment key={m.id}>
                    <tr>
                      <td>
                        <div style={{ marginBottom: 3 }}>
                          {ch === "email" ? (
                            <span className={`${styles.tag} ${styles.tagPos}`}>✉ email</span>
                          ) : ch === "linkedin" ? (
                            <span className={`${styles.tag} ${styles.tagMute}`}>in LinkedIn</span>
                          ) : (
                            <span className={`${styles.tag} ${styles.tagMute}`}>⚠ needs contact</span>
                          )}
                        </div>
                        <Link href={`/admin/network/${m.company_id}`} className={styles.tableLink}>{m.company_name}</Link>
                        <div className={styles.sessionSubtle}>{m.contact_email ?? m.contact_name ?? "no contact on file"}</div>
                        {hasLinkedIn(m) && (
                          <a href={m.contact_linkedin ?? "#"} target="_blank" rel="noreferrer" className={styles.tableLink} style={{ fontSize: 11 }}>LinkedIn ↗</a>
                        )}
                      </td>
                      <td style={{ maxWidth: 260 }}>
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
                        <div className={styles.sessionSubtle}>{relDeadline(m.tender_deadline)}</div>
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
                            {readiness(m) === "send_ready" && (
                              <button type="button" className={styles.btnPrimary} disabled={busy === m.id} onClick={() => openEmail(m)} style={{ padding: "4px 8px", fontSize: 11 }}>Email</button>
                            )}
                            {hasLinkedIn(m) && (
                              <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => openLinkedIn(m)} style={{ padding: "4px 8px", fontSize: 11 }}>LinkedIn</button>
                            )}
                            <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => onSetStatus(m.id, "contacted")} style={{ padding: "4px 8px", fontSize: 11 }}>Contacted</button>
                            <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { setDismissingId(m.id); setDismissReason(""); }} style={{ padding: "4px 8px", fontSize: 11 }}>Dismiss</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {draft && draft.id === m.id && (
                      <tr>
                        <td colSpan={5} style={{ background: "var(--admin-panel-alt, rgba(127,127,127,0.06))" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 4px" }}>
                            {draft.mode === "email" ? (
                              <>
                                <input
                                  className={styles.adminSearchInput}
                                  value={draft.subject}
                                  onChange={(e) => setDraft((prev) => (prev && prev.mode === "email" ? { ...prev, subject: e.target.value } : prev))}
                                  style={{ padding: 8, fontFamily: "inherit", fontSize: 12 }}
                                />
                                <textarea
                                  className={styles.adminSearchInput}
                                  value={draft.body}
                                  onChange={(e) => setDraft((prev) => (prev && prev.mode === "email" ? { ...prev, body: e.target.value } : prev))}
                                  rows={9}
                                  style={{ padding: 8, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}
                                />
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <button type="button" className={styles.btnPrimary} onClick={() => copy(`Subject: ${draft.subject}\n\n${draft.body}`, "email")} style={{ padding: "5px 12px", fontSize: 12 }}>
                                    {copied === "email" ? "Copied ✓" : "Copy message"}
                                  </button>
                                  <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { onSetStatus(m.id, "contacted"); setDraft(null); }} style={{ padding: "5px 12px", fontSize: 12 }}>Mark contacted</button>
                                  <button type="button" className={styles.btnGhost} onClick={() => setDraft(null)} style={{ padding: "5px 12px", fontSize: 12 }}>Close</button>
                                  <span className={styles.sessionSubtle}>Paste into your own email — TenderPath never sends this for you.</span>
                                </div>
                              </>
                            ) : (
                              <>
                                <span className={styles.sessionSubtle}>Connection request note ({draft.note.length}/300)</span>
                                <textarea
                                  className={styles.adminSearchInput}
                                  value={draft.note}
                                  onChange={(e) => setDraft((prev) => (prev && prev.mode === "linkedin" ? { ...prev, note: e.target.value } : prev))}
                                  rows={3}
                                  style={{ padding: 8, fontFamily: "inherit", fontSize: 12, lineHeight: 1.5 }}
                                />
                                <span className={styles.sessionSubtle}>Follow-up message (send once they accept)</span>
                                <textarea
                                  className={styles.adminSearchInput}
                                  value={draft.message}
                                  onChange={(e) => setDraft((prev) => (prev && prev.mode === "linkedin" ? { ...prev, message: e.target.value } : prev))}
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
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
