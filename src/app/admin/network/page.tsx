"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import OutreachTable from "./OutreachTable";
import ImportPanel from "./ImportPanel";
import { type OutreachMatch } from "@/lib/network/outreach";

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
  fresh: OutreachMatch[];
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
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  // Minimum lead time on the outreach worklist (days until deadline). Defaults
  // to 10 so the shortlist surfaces tenders with real runway to apply, not the
  // closing-tomorrow ones that crowd a soonest-deadline-first list. "0" = all.
  const [minDays, setMinDays] = useState("10");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const qs = Number(minDays) > 0 ? `?min_days=${encodeURIComponent(minDays)}` : "";
      const res = await fetch(`/api/admin/network-companies${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      if (!opts?.silent) setError(err instanceof Error ? err.message : "Failed to load network companies");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [minDays]);

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
    // Optimistic + background: the change applies in place and the PATCH fires
    // without reloading the page. A status change drops the match out of the
    // 'new' worklist immediately and decrements its company's fresh count.
    const match = data?.fresh.find((m) => m.id === matchId);
    setData((d) => (d ? {
      ...d,
      fresh: d.fresh.filter((m) => m.id !== matchId),
      companies: match
        ? d.companies.map((c) => (c.id === match.company_id ? { ...c, fresh_count: Math.max(0, c.fresh_count - 1) } : c))
        : d.companies,
    } : d));
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
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update match" });
      await load({ silent: true }); // reconcile silently on failure
    } finally {
      setBusy(null);
    }
  }

  async function setManyStatus(matchIds: number[], status: string) {
    if (matchIds.length === 0) return;
    const idSet = new Set(matchIds);
    // Optimistic: drop the whole bundle in place and decrement each company's
    // fresh count by how many of its matches we just moved off the worklist.
    const affected = (data?.fresh ?? []).filter((m) => idSet.has(m.id));
    const decByCompany = new Map<number, number>();
    for (const m of affected) decByCompany.set(m.company_id, (decByCompany.get(m.company_id) ?? 0) + 1);
    setData((d) => (d ? {
      ...d,
      fresh: d.fresh.filter((m) => !idSet.has(m.id)),
      companies: d.companies.map((c) => decByCompany.has(c.id)
        ? { ...c, fresh_count: Math.max(0, c.fresh_count - (decByCompany.get(c.id) ?? 0)) }
        : c),
    } : d));
    setToast(null);
    try {
      const results = await Promise.all(matchIds.map((id) =>
        fetch(`/api/admin/network-companies/matches/${id}`, {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ status }),
        }).then((res) => res.ok),
      ));
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) throw new Error(`${failed} of ${matchIds.length} didn't update`);
      setToast({ ok: true, msg: `Marked ${matchIds.length} ${status}.` });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update matches" });
      await load({ silent: true }); // reconcile silently on failure
    }
  }

  async function deleteCompany(companyId: number, name: string) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${name}" and all its matches? This cannot be undone.`)) return;
    // Optimistic + background: drop the company and its fresh matches in place.
    setData((d) => (d ? {
      ...d,
      companies: d.companies.filter((c) => c.id !== companyId),
      fresh: d.fresh.filter((m) => m.company_id !== companyId),
    } : d));
    setBusy(companyId);
    setToast({ ok: true, msg: `Deleted ${name}.` });
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}`, { method: "DELETE", headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to delete company" });
      await load({ silent: true }); // restore on failure
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
      await load({ silent: true });
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
            Fresh high-fit matches surface here for outreach — by default only those closing 10+ days
            out, so there&rsquo;s runway to reach out. Use <em>Min lead time</em> to widen or narrow that.
          </p>
        </div>
        <div className={styles.pageActions}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--admin-muted, #888)" }}>
            Min lead time
            <select
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              className={styles.adminSearchInput}
              style={{ padding: "6px 8px" }}
              title="Only surface matches whose tender deadline is at least this far out, so there's still time to reach out and bid."
            >
              <option value="10">10+ days</option>
              <option value="7">7+ days</option>
              <option value="3">3+ days</option>
              <option value="0">All (incl. closing soon)</option>
            </select>
          </label>
          <button type="button" className={styles.btnPrimary} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Close" : "Add company"}
          </button>
          <button type="button" className={styles.btnGhost} onClick={() => setShowImport((s) => !s)}>
            {showImport ? "Close import" : "Import CSV"}
          </button>
          <button type="button" className={styles.btnGhost} onClick={() => load()} disabled={loading}>
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

      {showImport && (
        <ImportPanel
          existingNames={data?.companies.map((c) => c.name) ?? []}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load({ silent: true }); }}
        />
      )}

      {!loading && minDays !== "0" && fresh.length === 0 && (
        <section className={styles.panel} style={{ padding: "14px 22px" }}>
          <p className={styles.panelSub} style={{ margin: 0 }}>
            No fresh matches with <strong>{minDays}+ days</strong> of runway. Any tenders closing sooner
            are hidden by the <em>Min lead time</em> filter above.{" "}
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setMinDays("0")}
              style={{ padding: "4px 10px", fontSize: 12, marginLeft: 4 }}
            >
              Show all (incl. closing soon)
            </button>
          </p>
        </section>
      )}

      <OutreachTable
        matches={fresh}
        loading={loading}
        busy={busy}
        onSetStatus={setMatchStatus}
        onSetManyStatus={setManyStatus}
      />

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
          <div className={styles.tableWrap} style={{ maxHeight: "44vh", overflow: "auto" }}>
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
