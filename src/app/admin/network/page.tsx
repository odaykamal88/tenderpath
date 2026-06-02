"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";

interface FreshMatch {
  id: number;
  score: number;
  match_reasons: string[] | null;
  status: string;
  first_seen_at: string;
  company_id: number;
  company_name: string;
  contact_name: string | null;
  contact_email: string | null;
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

interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  services_text: string | null;
  countries: string[] | null;
  org_type: string | null;
  profile_status: string;
  profile_error: string | null;
  contact_name: string | null;
  contact_email: string | null;
  is_active: boolean;
  last_matched_at: string | null;
  created_at: string;
  detected_industry: string | null;
  match_count: number;
  fresh_count: number;
  top_score: number;
}

interface ListResponse {
  companies: CompanyRow[];
  fresh: FreshMatch[];
  total: number;
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
function relDeadline(value: string | null): string {
  if (!value) return "no deadline";
  const d = new Date(value).getTime();
  if (Number.isNaN(d)) return "—";
  const days = Math.round((d - Date.now()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

const EMPTY_FORM = {
  name: "",
  website: "",
  services_text: "",
  countries: "",
  contact_name: "",
  contact_email: "",
  notes: "",
};

export default function AdminNetworkPage() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/network-companies", { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load network companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const companies = data?.companies ?? [];
    return {
      companies: companies.length,
      active: companies.filter((c) => c.is_active).length,
      fresh: data?.fresh.length ?? 0,
      withFresh: companies.filter((c) => c.fresh_count > 0).length,
    };
  }, [data]);

  async function setMatchStatus(matchId: number, status: string, reason?: string) {
    setBusy(matchId);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/matches/${matchId}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify(reason !== undefined ? { status, reason } : { status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Marked ${status}.` });
      setDismissingId(null);
      setDismissReason("");
      await load();
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update match" });
    } finally {
      setBusy(null);
    }
  }

  async function deleteCompany(companyId: number, name: string) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${name}" and all its matches? This cannot be undone.`)) return;
    setBusy(companyId);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}`, { method: "DELETE", headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Deleted ${name}.` });
      await load();
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to delete company" });
    } finally {
      setBusy(null);
    }
  }

  async function submitCompany(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setToast({ ok: false, msg: "Company name is required." });
      return;
    }
    setSubmitting(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/network-companies", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          name: form.name,
          website: form.website || null,
          services_text: form.services_text || null,
          countries: form.countries,
          contact_name: form.contact_name || null,
          contact_email: form.contact_email || null,
          notes: form.notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const profileStatus = body.profile?.status;
      const newCount = body.match?.newMatches ?? 0;
      setToast({
        ok: profileStatus === "ready",
        msg: profileStatus === "ready"
          ? `Added ${body.company?.name ?? "company"} — ${newCount} match${newCount === 1 ? "" : "es"} found.`
          : `Added, but profile build failed: ${body.profile?.error ?? "unknown"}. Use Re-match on the company to retry.`,
      });
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      await load();
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to add company" });
    } finally {
      setSubmitting(false);
    }
  }

  const fresh = data?.fresh ?? [];

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>06 — Network</div>
          <h1 className={styles.pageTitle}>Bizdev match radar</h1>
          <p className={styles.pageSub}>
            Companies from your network, auto-matched against live tenders every couple of days.
            Fresh high-fit matches surface here for outreach.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnPrimary} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "Add company"}
          </button>
          <button type="button" className={styles.btnGhost} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}
      {toast && <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>{toast.msg}</div>}

      <section className={styles.heroRow}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Companies</div>
          <div className={styles.heroStatValue}>{stats.companies}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Active</div>
          <div className={styles.heroStatValue}>{stats.active}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Fresh matches</div>
          <div className={styles.heroStatValue}>{stats.fresh}</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Companies with fresh</div>
          <div className={styles.heroStatValue}>{stats.withFresh}</div>
        </div>
      </section>

      {showForm && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Add a network company</h2>
              <p className={styles.panelSub}>We crawl the website + your service notes to build a match profile, then score it against open tenders.</p>
            </div>
          </header>
          <form onSubmit={submitCompany} style={{ padding: "14px 22px 22px", display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <input className={styles.adminSearchInput} placeholder="Company name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Website (https://…)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Countries they deliver in — strongly improves matching (comma-separated)" value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Contact name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Contact email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
            </div>
            <textarea
              className={styles.adminSearchInput}
              placeholder="What do they supply / do? (services, sectors, capabilities — the richer, the better the matching)"
              value={form.services_text}
              onChange={(e) => setForm({ ...form, services_text: e.target.value })}
              rows={3}
              style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
            />
            <textarea
              className={styles.adminSearchInput}
              placeholder="Private relationship notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              style={{ width: "100%", padding: 8, fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="submit" className={styles.btnPrimary} disabled={submitting}>
                {submitting ? "Building profile…" : "Add & match"}
              </button>
              <span className={styles.sessionSubtle}>Building the profile crawls the site + runs AI — this can take a few seconds.</span>
            </div>
          </form>
        </section>
      )}

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Fresh matches</h2>
            <p className={styles.panelSub}>New since the last match run, soonest deadline first — act before they close. Mark contacted or dismissed to clear them.</p>
          </div>
          <span className={styles.panelMeta}>{fresh.length} fresh</span>
        </header>
        {loading ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : fresh.length === 0 ? (
          <div className={styles.woEmpty}>No fresh matches. Add companies, or wait for the next match run.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Tender</th>
                  <th>Country</th>
                  <th>Deadline</th>
                  <th className={styles.num}>Fit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fresh.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/admin/network/${m.company_id}`} className={styles.tableLink}>{m.company_name}</Link>
                      <div className={styles.sessionSubtle}>{m.contact_email ?? m.contact_name ?? "no contact on file"}</div>
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      {m.tender_source_url ? (
                        <a className={styles.tableLink} href={m.tender_source_url} target="_blank" rel="noreferrer">{m.tender_title}</a>
                      ) : (
                        <span className={styles.cellName}>{m.tender_title}</span>
                      )}
                      <div className={styles.sessionSubtle}>
                        {[m.tender_agency, m.tender_sector].filter(Boolean).join(" · ") || "—"}
                        {Array.isArray(m.match_reasons) && m.match_reasons.length > 0 && ` · ${m.match_reasons.slice(0, 2).join("; ")}`}
                      </div>
                    </td>
                    <td>{m.tender_country || "—"}</td>
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
                            <button type="button" className={styles.btnPrimary} disabled={busy === m.id} onClick={() => setMatchStatus(m.id, "dismissed", dismissReason)} style={{ padding: "4px 8px", fontSize: 11 }}>Confirm dismiss</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => setMatchStatus(m.id, "contacted")} style={{ padding: "4px 8px", fontSize: 11 }}>Contacted</button>
                          <button type="button" className={styles.btnGhost} disabled={busy === m.id} onClick={() => { setDismissingId(m.id); setDismissReason(""); }} style={{ padding: "4px 8px", fontSize: 11 }}>Dismiss</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Companies</h2>
            <p className={styles.panelSub}>Your bizdev database. Open one to see all its matches, edit it, or re-match on demand.</p>
          </div>
          {data && <span className={styles.panelMeta}>{data.companies.length} total</span>}
        </header>
        {loading ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : !data || data.companies.length === 0 ? (
          <div className={styles.woEmpty}>No companies yet — add one above.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Industry</th>
                  <th>Profile</th>
                  <th className={styles.num}>Matches</th>
                  <th className={styles.num}>Fresh</th>
                  <th>Last matched</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map((c) => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                    <td>
                      <Link href={`/admin/network/${c.id}`} className={styles.tableLink}>{c.name}</Link>
                      <div className={styles.sessionSubtle}>
                        {c.website ?? "no website"}{c.is_active ? "" : " · paused"}
                        {(!c.countries || c.countries.length === 0) && (
                          <span style={{ color: "var(--color-warn, #c8973e)" }}> · ⚠ no countries — add to improve matches</span>
                        )}
                      </div>
                    </td>
                    <td>{c.detected_industry ?? "—"}</td>
                    <td>
                      <span className={`${styles.tag} ${c.profile_status === "ready" ? styles.tagPos : c.profile_status === "failed" ? styles.tagNeg : styles.tagMute}`}>
                        {c.profile_status}
                      </span>
                    </td>
                    <td className={`${styles.num} ${c.match_count > 0 ? styles.posNum : styles.muteNum}`}>{c.match_count}</td>
                    <td className={`${styles.num} ${c.fresh_count > 0 ? styles.posNum : styles.muteNum}`}>{c.fresh_count}</td>
                    <td className={styles.sessionSubtle}>{fmtDate(c.last_matched_at)}</td>
                    <td className={styles.num}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Link href={`/admin/network/${c.id}`} className={styles.btnGhost} style={{ padding: "5px 9px", fontSize: 11 }}>Open</Link>
                        <button type="button" className={styles.btnGhost} disabled={busy === c.id} onClick={() => deleteCompany(c.id, c.name)} style={{ padding: "5px 9px", fontSize: 11, color: "var(--color-red)" }}>Delete</button>
                      </div>
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
