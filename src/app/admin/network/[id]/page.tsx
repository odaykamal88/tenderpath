"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "../../admin.module.css";
import { briefingUrl, foldedOpportunityCount, foldedSourceLabel, selectInsightfulGaps } from "@/lib/network/outreach";
import type { Gap } from "@/lib/types";

const STATUSES = ["new", "seen", "contacted", "replied", "booked", "paid", "not_relevant", "dismissed", "won", "lost"] as const;

const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  new: "new",
  seen: "seen",
  contacted: "contacted",
  replied: "replied",
  booked: "booked",
  paid: "paid",
  not_relevant: "not relevant",
  dismissed: "dismissed",
  won: "won",
  lost: "lost",
};

interface AIAnalysisLite {
  detected_industry?: string;
  summary?: string;
  services?: string[];
  capabilities?: string[];
  certifications_detected?: string[];
  strengths?: string[];
  gaps?: Gap[];
}

interface Company {
  id: number;
  name: string;
  website: string | null;
  services_text: string | null;
  countries: string[] | null;
  sectors: string[] | null;
  org_type: string | null;
  ai_analysis: AIAnalysisLite | null;
  profile_status: string;
  profile_error: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  ungm_status: string | null;
  share_token: string | null;
  last_matched_at: string | null;
  created_at: string;
}

interface Match {
  id: number;
  tender_id: number;
  score: number;
  match_reasons: string[] | null;
  status: string;
  dismiss_reason: string | null;
  first_seen_at: string;
  last_scored_at: string;
  tender_title: string;
  tender_agency: string | null;
  tender_country: string | null;
  tender_sector: string | null;
  tender_deadline: string | null;
  tender_value: string | null;
  tender_source_url: string | null;
  tender_source_name: string | null;
  tender_reference: string | null;
  tender_type: string | null;
  duplicate_count?: number;
  duplicate_match_ids?: number[];
  source_names?: string[];
}

interface DetailResponse {
  company: Company;
  matches: Match[];
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}
function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), "content-type": "application/json" };
}
function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function chips(values: string[] | null | undefined, limit = 8): string {
  if (!Array.isArray(values) || !values.length) return "—";
  return values.slice(0, limit).join(" · ") + (values.length > limit ? ` · +${values.length - limit}` : "");
}

function matchIdsFor(match: Match): number[] {
  return Array.isArray(match.duplicate_match_ids) && match.duplicate_match_ids.length > 0
    ? match.duplicate_match_ids
    : [match.id];
}

export default function AdminNetworkCompanyPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editReasonId, setEditReasonId] = useState<number | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isInteger(id) || id <= 0) {
      setError("Invalid company id");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load company");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function rematch() {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${id}/rematch`, { method: "POST", headers: authHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      if (body.profile && body.profile.status !== "ready") {
        setToast({ ok: false, msg: `Profile not ready: ${body.profile.error ?? "build failed"}.` });
      } else {
        const n = body.match?.newMatches ?? 0;
        setToast({ ok: true, msg: `Re-matched — ${n} new, ${body.match?.qualified ?? 0} qualifying.` });
      }
      await load();
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Re-match failed" });
    } finally {
      setBusy(false);
    }
  }

  async function generateArtifact() {
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${id}/artifact`, { method: "POST", headers: authHeaders() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const count = body.artifact?.tenders?.length ?? 0;
      const logged = body.artifact?.logged ?? 0;
      setToast({
        ok: true,
        msg: `Artifact ready — ${count} opportunit${count === 1 ? "y" : "ies"}, ${logged} logged to calibration. The prospect sees the full read on the share link below.`,
      });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Artifact generation failed" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteCompany() {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${c?.name ?? "this company"}" and all its matches? This cannot be undone.`)) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      window.location.href = "/admin/network";
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to delete company" });
      setBusy(false);
    }
  }

  async function setMatchStatus(matchId: number, status: string, reason?: string) {
    // Optimistic + background — update the row in place so the page doesn't
    // reload/flash on every status change. Reconcile silently on failure.
    const currentMatch = data?.matches.find((m) => m.id === matchId || matchIdsFor(m).includes(matchId));
    const affectedIds = new Set(currentMatch ? matchIdsFor(currentMatch) : [matchId]);
    setData((d) => (d ? {
      ...d,
      matches: d.matches.map((m) => (matchIdsFor(m).some((id) => affectedIds.has(id))
        ? { ...m, status, ...(reason !== undefined ? { dismiss_reason: reason || null } : {}) }
        : m)),
    } : d));
    setEditReasonId(null);
    setReasonDraft("");
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/matches/${matchId}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(reason !== undefined ? { status, reason } : { status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update match" });
      await load(); // reconcile on failure
    }
  }

  // Operator-recorded UNGM status. Optimistic + background PATCH (no re-crawl —
  // the route only re-builds the profile when website/services/countries change).
  async function setUngm(status: string) {
    setData((d) => (d && d.company ? { ...d, company: { ...d.company, ungm_status: status } } : d));
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ ungm_status: status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: "UNGM status saved." });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to save UNGM status" });
      await load();
    }
  }

  async function copyBriefing() {
    const token = data?.company?.share_token;
    const href = token ? briefingUrl(token, typeof window !== "undefined" ? window.location.origin : undefined) : null;
    if (!href) return;
    try {
      await navigator.clipboard.writeText(href);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      /* clipboard blocked — the read-only input stays visible for manual copy */
    }
  }

  if (error && !data) {
    return (
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>06 — Network</div>
          <h1 className={styles.pageTitle}>Company not loaded</h1>
          <p className={styles.pageSub}>{error}</p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/network" className={styles.btnGhost}>Back</Link>
        </div>
      </header>
    );
  }

  const c = data?.company;
  const ai = c?.ai_analysis;
  const insightfulGaps = selectInsightfulGaps(ai?.gaps, 3);
  const briefingHref = c?.share_token
    ? briefingUrl(c.share_token, typeof window !== "undefined" ? window.location.origin : undefined)
    : null;
  const allMatches = data?.matches ?? [];
  const dismissedCount = allMatches.filter((m) => m.status === "dismissed").length;
  const visibleMatches = showDismissed ? allMatches : allMatches.filter((m) => m.status !== "dismissed");
  const foldedCrawlerRows = visibleMatches.reduce((sum, match) => sum + Math.max(0, foldedOpportunityCount(match) - 1), 0);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>06 — Network · Company #{id}</div>
          <h1 className={styles.pageTitle}>{c?.name ?? (loading ? "Loading…" : "Company")}</h1>
          <p className={styles.pageSub}>
            {[ai?.detected_industry, chips(c?.countries, 4) !== "—" ? chips(c?.countries, 4) : null].filter(Boolean).join(" · ") || "—"}
            {c && !c.is_active && " · paused"}
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/network" className={styles.btnGhost}>← All companies</Link>
          {c?.website && <a href={c.website} target="_blank" rel="noreferrer" className={styles.btnGhost}>Website ↗</a>}
          <button type="button" className={styles.btnGhost} onClick={() => setEditing((s) => !s)}>{editing ? "Close edit" : "Edit"}</button>
          <button type="button" className={styles.btnPrimary} onClick={rematch} disabled={busy}>{busy ? "Working…" : "Re-match now"}</button>
          <button type="button" className={styles.btnGhost} onClick={generateArtifact} disabled={busy}>{busy ? "Working…" : "Generate & log artifact"}</button>
          <button type="button" className={styles.btnGhost} onClick={deleteCompany} disabled={busy} style={{ color: "var(--color-red)" }}>Delete</button>
        </div>
      </header>

      {toast && <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>{toast.msg}</div>}
      {c?.profile_status === "failed" && (
        <div className={`${styles.toast} ${styles.toastErr}`}>Profile build failed: {c.profile_error ?? "unknown"}. Fix the website/services and Re-match.</div>
      )}

      {editing && c && (
        <EditForm company={c} onSaved={async (msg) => { setEditing(false); setToast({ ok: true, msg }); await load(); }} onError={(msg) => setToast({ ok: false, msg })} />
      )}

      {c && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Profile</h2>
              <p className={styles.panelSub}>
                {c.profile_status === "ready" ? "Built from website crawl + your service notes." : `Profile ${c.profile_status}.`}
                {c.contact_email ? ` · ${c.contact_email}` : ""}
              </p>
            </div>
          </header>
          <div style={{ padding: "12px 22px 22px", display: "grid", gap: 8 }}>
            {ai?.summary && <p style={{ fontSize: 13, lineHeight: 1.55 }}>{ai.summary}</p>}
            <p className={styles.sessionSubtle}><strong>Services:</strong> {chips(ai?.services, 10)}</p>
            <p className={styles.sessionSubtle}><strong>Capabilities:</strong> {chips(ai?.capabilities, 10)}</p>
            <p className={styles.sessionSubtle}><strong>Sectors:</strong> {chips(c.sectors, 10)}</p>
            <p className={styles.sessionSubtle}><strong>Certifications:</strong> {chips(ai?.certifications_detected, 10)}</p>
            {Array.isArray(ai?.strengths) && ai!.strengths!.length > 0 && (
              <p className={styles.sessionSubtle}><strong>Strengths:</strong> {chips(ai?.strengths, 6)}</p>
            )}
            {insightfulGaps.length > 0 && (
              <div className={styles.sessionSubtle}>
                <strong>Gaps shown to prospect:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {insightfulGaps.map((g, i) => (
                    <li key={i}>{g.gap}{g.fix ? ` — ${g.fix}` : ""}</li>
                  ))}
                </ul>
              </div>
            )}
            {c.services_text && <p className={styles.sessionSubtle}><strong>Your notes:</strong> {c.services_text}</p>}
          </div>
        </section>
      )}

      {c && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Outreach &amp; sharing</h2>
              <p className={styles.panelSub}>What the bizdev email and the shareable briefing will say about this prospect.</p>
            </div>
          </header>
          <div style={{ padding: "12px 22px 22px", display: "grid", gap: 16 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 380 }}>
              <span className={styles.sessionSubtle}>UNGM registration status (what you know)</span>
              <select
                className={styles.adminSearchInput}
                value={c.ungm_status ?? "unknown"}
                onChange={(e) => setUngm(e.target.value)}
                disabled={busy}
                style={{ padding: "6px 8px" }}
              >
                <option value="unknown">Unknown</option>
                <option value="not_registered">Not registered on UNGM</option>
                <option value="basic">Registered — Basic</option>
                <option value="level-1">Registered — Level 1</option>
                <option value="level-2">Registered — Level 2</option>
              </select>
              <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>
                When set to a registered level, the outreach says they can bid on UN tenders right away. We never assert a registration you haven&rsquo;t recorded.
              </span>
            </label>

            {briefingHref && (
              <div style={{ display: "grid", gap: 6 }}>
                <span className={styles.sessionSubtle}>Shareable prospect briefing (public, unlisted, no-index)</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input className={styles.adminSearchInput} readOnly value={briefingHref} suppressHydrationWarning style={{ flex: 1, minWidth: 260, padding: "6px 8px", fontSize: 12 }} />
                  <button type="button" className={styles.btnPrimary} onClick={copyBriefing} style={{ padding: "6px 11px", fontSize: 12 }}>{copiedLink ? "Copied ✓" : "Copy link"}</button>
                  <a href={briefingHref} target="_blank" rel="noreferrer" className={styles.btnGhost} style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>Open ↗</a>
                </div>
                <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>
                  Shows this prospect&rsquo;s matches, strengths, and gaps — paste it into your outreach. Pausing the company disables the link.
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Matches ({visibleMatches.length})</h2>
            <p className={styles.panelSub}>
              Open opportunities this company fits, soonest deadline first. Fresh ones are flagged &lsquo;new&rsquo;.
              {foldedCrawlerRows > 0 ? ` ${foldedCrawlerRows} crawler copies are folded into these rows.` : ""}
            </p>
          </div>
          {dismissedCount > 0 && (
            <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
              Show dismissed ({dismissedCount})
            </label>
          )}
        </header>
        {loading ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : visibleMatches.length === 0 ? (
          <div className={styles.woEmpty}>
            {allMatches.length === 0 ? "No open-tender matches yet. Try Re-match now." : "No active matches — all dismissed. Tick ‘Show dismissed’ to review them."}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Tender</th>
                  <th>Country</th>
                  <th>Deadline</th>
                  <th className={styles.num}>Fit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleMatches.map((m) => (
                  <tr key={m.id}>
                    <td style={{ maxWidth: 360 }}>
                      {m.tender_source_url ? (
                        <a className={styles.tableLink} href={m.tender_source_url} target="_blank" rel="noreferrer">{m.tender_title}</a>
                      ) : (
                        <span className={styles.cellName}>{m.tender_title}</span>
                      )}
                      <div className={styles.sessionSubtle}>
                        {[m.tender_agency, m.tender_sector].filter(Boolean).join(" · ") || "—"}
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
                    </td>
                    <td>{m.tender_country || "—"}</td>
                    <td className={styles.mono}>{fmtDate(m.tender_deadline)}</td>
                    <td className={`${styles.num} ${m.score >= 70 ? styles.posNum : styles.muteNum}`}>{m.score}</td>
                    <td>
                      <select
                        value={m.status}
                        onChange={(e) => setMatchStatus(m.id, e.target.value)}
                        disabled={busy}
                        className={styles.adminSearchInput}
                        style={{ padding: "4px 6px", fontSize: 11 }}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                      {m.status === "dismissed" && (
                        editReasonId === m.id ? (
                          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                            <textarea
                              className={styles.adminSearchInput}
                              value={reasonDraft}
                              onChange={(e) => setReasonDraft(e.target.value)}
                              placeholder="Why isn't this a fit? (the AI uses this to filter future matches)"
                              rows={2}
                              style={{ padding: 6, fontFamily: "inherit", fontSize: 11 }}
                            />
                            <div style={{ display: "flex", gap: 6 }}>
                              <button type="button" className={styles.btnPrimary} disabled={busy} onClick={() => setMatchStatus(m.id, "dismissed", reasonDraft)} style={{ padding: "3px 7px", fontSize: 11 }}>Save</button>
                              <button type="button" className={styles.btnGhost} onClick={() => setEditReasonId(null)} style={{ padding: "3px 7px", fontSize: 11 }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.sessionSubtle} style={{ marginTop: 4, fontSize: 11 }}>
                            {m.dismiss_reason ? `"${m.dismiss_reason}" ` : "no reason "}
                            <button
                              type="button"
                              onClick={() => { setEditReasonId(m.id); setReasonDraft(m.dismiss_reason ?? ""); }}
                              style={{ background: "none", border: "none", color: "var(--color-accent)", cursor: "pointer", fontSize: 11, padding: 0 }}
                            >
                              {m.dismiss_reason ? "edit" : "+ add reason"}
                            </button>
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function EditForm({
  company,
  onSaved,
  onError,
}: {
  company: Company;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(company.name);
  const [website, setWebsite] = useState(company.website ?? "");
  const [services, setServices] = useState(company.services_text ?? "");
  const [countries, setCountries] = useState((company.countries ?? []).join(", "));
  const [contactName, setContactName] = useState(company.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(company.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(company.contact_phone ?? "");
  const [notes, setNotes] = useState(company.notes ?? "");
  const [isActive, setIsActive] = useState(company.is_active);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/network-companies/${company.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({
          name,
          website: website || null,
          services_text: services || null,
          countries,
          contact_name: contactName || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null,
          notes: notes || null,
          is_active: isActive,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const profileNote = body.profile ? ` Profile re-built (${body.profile.status}).` : "";
      onSaved(`Saved.${profileNote}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel}>
      <header className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Edit company</h2>
          <p className={styles.panelSub}>Changing the website, services, or countries re-builds the profile and re-matches automatically.</p>
        </div>
      </header>
      <div style={{ padding: "14px 22px 22px", display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <input className={styles.adminSearchInput} placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={styles.adminSearchInput} placeholder="Website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <input className={styles.adminSearchInput} placeholder="Countries (comma-separated)" value={countries} onChange={(e) => setCountries(e.target.value)} />
          <input className={styles.adminSearchInput} placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <input className={styles.adminSearchInput} placeholder="Contact email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          <input className={styles.adminSearchInput} placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
        <textarea className={styles.adminSearchInput} placeholder="Services / what they do" value={services} onChange={(e) => setServices(e.target.value)} rows={3} style={{ width: "100%", padding: 8, fontFamily: "inherit" }} />
        <textarea className={styles.adminSearchInput} placeholder="Private notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: "100%", padding: 8, fontFamily: "inherit" }} />
        <label className={styles.sessionSubtle} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active — include in the every-couple-of-days match run
        </label>
        <div>
          <button type="button" className={styles.btnPrimary} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </section>
  );
}
