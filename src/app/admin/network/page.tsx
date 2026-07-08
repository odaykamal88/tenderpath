"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import OutreachTable from "./OutreachTable";
import ImportPanel from "./ImportPanel";
import { type OutreachMatch, briefingUrl, foldedOpportunityCount } from "@/lib/network/outreach";

interface CompanyRow {
  id: number;
  name: string;
  website: string | null;
  services_text: string | null;
  countries: string[] | null;
  sectors: string[] | null;
  org_type: string | null;
  profile_status: string;
  profile_error: string | null;
  contact_name: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_email_status: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  un_buyer: string | null;
  city: string | null;
  is_active: boolean;
  pipeline_stage: string;
  last_matched_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  detected_industry: string | null;
  ungm_status: string | null;
  share_token: string | null;
  match_count: number;
  fresh_count: number;
  top_score: number;
}

const PIPELINE_STAGES = ["lead", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
type PipelineStage = (typeof PIPELINE_STAGES)[number];
const STAGE_LABELS: Record<PipelineStage, string> = {
  lead: "Lead",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting",
  proposal: "Proposal",
  won: "Won",
  lost: "Lost",
};

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

function matchIdsFor(match: OutreachMatch): number[] {
  return Array.isArray(match.duplicate_match_ids) && match.duplicate_match_ids.length > 0
    ? match.duplicate_match_ids
    : [match.id];
}

function overlapsMatchIds(match: OutreachMatch, ids: Set<number>): boolean {
  return matchIdsFor(match).some((id) => ids.has(id));
}

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
  // CRM list filters (client-side over the loaded companies).
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [freshOnly, setFreshOnly] = useState(false);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null);

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
    const fresh = data?.fresh ?? [];
    const foldedCrawlerRows = fresh.reduce((sum, match) => sum + Math.max(0, foldedOpportunityCount(match) - 1), 0);
    return {
      companies: companies.length,
      active: companies.filter((c) => c.is_active).length,
      fresh: fresh.length,
      withFresh: companies.filter((c) => c.fresh_count > 0).length,
      foldedCrawlerRows,
    };
  }, [data]);

  const pendingCount = useMemo(
    () => (data?.companies ?? []).filter((c) => c.is_active && c.profile_status !== "ready").length,
    [data],
  );

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of data?.companies ?? []) for (const co of c.countries ?? []) if (co.trim()) set.add(co.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filteredCompanies = useMemo(() => {
    const companies = data?.companies ?? [];
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (stageFilter !== "all" && (c.pipeline_stage ?? "lead") !== stageFilter) return false;
      if (countryFilter !== "all" && !(c.countries ?? []).some((co) => co.trim() === countryFilter)) return false;
      if (freshOnly && c.fresh_count <= 0) return false;
      if (q) {
        const hay = [
          c.name, c.contact_name, c.contact_title, c.contact_email, c.un_buyer, c.city,
          c.detected_industry, (c.countries ?? []).join(" "), (c.sectors ?? []).join(" "),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, stageFilter, countryFilter, freshOnly]);

  async function setMatchStatus(matchId: number, status: string, reason?: string) {
    // Optimistic + background: the change applies in place and the PATCH fires
    // without reloading the page. A status change drops the match out of the
    // 'new' worklist immediately and decrements its company's fresh count.
    const match = data?.fresh.find((m) => m.id === matchId || matchIdsFor(m).includes(matchId));
    const affectedIds = new Set(match ? matchIdsFor(match) : [matchId]);
    setData((d) => (d ? {
      ...d,
      fresh: d.fresh.filter((m) => !overlapsMatchIds(m, affectedIds)),
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
    const affected = (data?.fresh ?? []).filter((m) => overlapsMatchIds(m, idSet));
    const decByCompany = new Map<number, number>();
    for (const m of affected) decByCompany.set(m.company_id, (decByCompany.get(m.company_id) ?? 0) + 1);
    setData((d) => (d ? {
      ...d,
      fresh: d.fresh.filter((m) => !overlapsMatchIds(m, idSet)),
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

  // Freshly-imported contacts land as profile_status='pending' and are NOT picked
  // up by the daily match cron (which only re-scores ready profiles). This builds
  // their profile (crawl + AI) and runs an initial match, one at a time so we don't
  // hammer targets. Reuses the per-company rematch endpoint.
  async function buildPending() {
    const pend = (data?.companies ?? []).filter((c) => c.is_active && c.profile_status !== "ready");
    if (!pend.length || buildProgress) return;
    setBuildProgress({ done: 0, total: pend.length });
    setToast(null);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < pend.length; i++) {
      try {
        const res = await fetch(`/api/admin/network-companies/${pend[i].id}/rematch`, { method: "POST", headers: authHeaders() });
        if (res.ok) {
          const b = await res.json().catch(() => ({}));
          if (b.profile && b.profile.status !== "ready") failed++; else ok++;
        } else failed++;
      } catch { failed++; }
      setBuildProgress({ done: i + 1, total: pend.length });
    }
    setBuildProgress(null);
    setToast({ ok: failed === 0, msg: `Built ${ok} profile${ok === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.` });
    await load({ silent: true });
  }

  async function setPipelineStage(companyId: number, stage: string) {
    // Optimistic + background PATCH — the CRM table updates in place; reconcile on failure.
    setData((d) => (d ? {
      ...d,
      companies: d.companies.map((c) => (c.id === companyId ? { ...c, pipeline_stage: stage } : c)),
    } : d));
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ pipeline_stage: stage }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Moved to ${STAGE_LABELS[stage as PipelineStage] ?? stage}.` });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update stage" });
      await load({ silent: true });
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
            Fresh high-fit opportunities surface here for outreach — by default only those closing 10+ days
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
            {showImport ? "Close import" : "Import contacts"}
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
          <div className={styles.heroStatLabel}>Fresh opportunities</div>
          <div className={styles.heroStatValue}>{stats.fresh}</div>
          <div className={styles.heroStatMeta}>{stats.foldedCrawlerRows} crawler copies folded</div>
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
            <h2 className={styles.panelTitle}>Contacts</h2>
            <p className={styles.panelSub}>Your outbound CRM. Search, filter by pipeline stage, move a contact along, or open one for the full timeline and matches.</p>
          </div>
          {data && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {pendingCount > 0 && (
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={buildPending}
                  disabled={buildProgress !== null}
                  title="Freshly imported contacts have no match profile yet. This crawls + profiles them and runs an initial match. Runs one at a time — keep this tab open."
                  style={{ padding: "5px 11px", fontSize: 12 }}
                >
                  {buildProgress ? `Building ${buildProgress.done}/${buildProgress.total}…` : `Build & match pending (${pendingCount})`}
                </button>
              )}
              <span className={styles.panelMeta}>
                {filteredCompanies.length === data.companies.length
                  ? `${data.companies.length} total`
                  : `${filteredCompanies.length} of ${data.companies.length}`}
              </span>
            </div>
          )}
        </header>

        {data && data.companies.length > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 22px 4px" }}>
            <input
              className={styles.adminSearchInput}
              placeholder="Search name, contact, email, UN buyer, sector…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search contacts"
              style={{ flex: 1, minWidth: 220, padding: "6px 10px" }}
            />
            <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              Stage
              <select className={styles.adminSearchInput} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ padding: "6px 8px" }}>
                <option value="all">All</option>
                {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </label>
            <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              Country
              <select className={styles.adminSearchInput} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} style={{ padding: "6px 8px", maxWidth: 160 }}>
                <option value="all">All</option>
                {countryOptions.map((co) => <option key={co} value={co}>{co}</option>)}
              </select>
            </label>
            <label className={styles.sessionSubtle} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={freshOnly} onChange={(e) => setFreshOnly(e.target.checked)} />
              With fresh matches
            </label>
          </div>
        )}

        {loading ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : !data || data.companies.length === 0 ? (
          <div className={styles.woEmpty}>No contacts yet — <strong>Import contacts</strong> or <strong>Add company</strong> above.</div>
        ) : filteredCompanies.length === 0 ? (
          <div className={styles.woEmpty}>No contacts match those filters. <button type="button" className={styles.btnGhost} onClick={() => { setSearch(""); setStageFilter("all"); setCountryFilter("all"); setFreshOnly(false); }} style={{ padding: "4px 10px", fontSize: 12, marginLeft: 4 }}>Clear filters</button></div>
        ) : (
          <div className={styles.tableWrap} style={{ maxHeight: "52vh", overflow: "auto" }}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Company / contact</th>
                  <th>Reach</th>
                  <th>Location</th>
                  <th>Sector</th>
                  <th>UN buyer</th>
                  <th>Stage</th>
                  <th className={styles.num}>Fresh</th>
                  <th>Last touch</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((c) => (
                  <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.55 }}>
                    <td style={{ maxWidth: 260 }}>
                      <Link href={`/admin/network/${c.id}`} className={styles.tableLink}>{c.name}</Link>
                      <div className={styles.sessionSubtle} style={{ fontSize: 11 }}>
                        {[c.contact_name, c.contact_title].filter(Boolean).join(" · ") || (c.website ?? "no website")}
                        {c.is_active ? "" : " · paused"}
                        {(!c.countries || c.countries.length === 0) && (
                          <span style={{ color: "var(--color-warn, #c8973e)" }}> · ⚠ no country</span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {c.contact_email ? (
                        <a className={styles.tableLink} href={`mailto:${c.contact_email}`}>{c.contact_email}</a>
                      ) : <span className={styles.sessionSubtle}>no email</span>}
                      <div style={{ display: "flex", gap: 6, marginTop: 3, alignItems: "center" }}>
                        {c.contact_email_status && (
                          <span className={`${styles.tag} ${c.contact_email_status.toLowerCase() === "verified" ? styles.tagPos : styles.tagMute}`} style={{ fontSize: 10 }}>
                            {c.contact_email_status}
                          </span>
                        )}
                        {c.contact_linkedin && (
                          <a className={styles.tableLink} href={c.contact_linkedin} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>in ↗</a>
                        )}
                        {c.contact_phone && <span className={styles.sessionSubtle}>{c.contact_phone}</span>}
                      </div>
                    </td>
                    <td className={styles.sessionSubtle} style={{ fontSize: 12 }}>
                      {[(c.countries ?? []).join(", "), c.city].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className={styles.sessionSubtle} style={{ fontSize: 12, maxWidth: 160 }}>
                      {c.detected_industry || (c.sectors ?? []).slice(0, 2).join(", ") || "—"}
                    </td>
                    <td className={styles.sessionSubtle} style={{ fontSize: 12, maxWidth: 120 }}>{c.un_buyer || "—"}</td>
                    <td>
                      <select
                        value={(c.pipeline_stage ?? "lead")}
                        onChange={(e) => setPipelineStage(c.id, e.target.value)}
                        className={styles.adminSearchInput}
                        aria-label={`Pipeline stage for ${c.name}`}
                        style={{ padding: "4px 6px", fontSize: 11 }}
                      >
                        {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td className={`${styles.num} ${c.fresh_count > 0 ? styles.posNum : styles.muteNum}`} title={`${c.match_count} total matches`}>{c.fresh_count}</td>
                    <td className={styles.sessionSubtle} style={{ fontSize: 11 }}>{fmtDate(c.last_activity_at ?? c.last_matched_at)}</td>
                    <td className={styles.num}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Link href={`/admin/network/${c.id}`} className={styles.btnGhost} style={{ padding: "5px 9px", fontSize: 11 }}>Open</Link>
                        {c.share_token && (
                          <a
                            href={briefingUrl(c.share_token, typeof window !== "undefined" ? window.location.origin : undefined) ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.btnGhost}
                            style={{ padding: "5px 9px", fontSize: 11, textDecoration: "none" }}
                            title="Open the public prospect briefing"
                          >
                            Briefing ↗
                          </a>
                        )}
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
