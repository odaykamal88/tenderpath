"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "../../admin.module.css";

const ROUTED_SERVICES = [
  { value: "bid-no-bid", label: "Bid-No-Bid" },
  { value: "proposal-draft", label: "Proposal Draft" },
  { value: "roster-fast-track", label: "Roster Fast-Track" },
  { value: "matching", label: "Matching" },
] as const;

const STATUSES = ["suggested", "contacted", "applied", "shortlisted", "won", "lost"] as const;
const TIERS = ["T1", "T2", "REF"] as const;
const UNGM_STATUSES = ["registered", "pending", "unregistered", "unknown"] as const;

interface TenderDetail {
  id: number;
  title: string;
  description: string | null;
  agency: string | null;
  country: string | null;
  country_code: string | null;
  region: string | null;
  sector: string | null;
  deadline: string | null;
  estimated_value: string | null;
  source_url: string | null;
  source_name: string | null;
  opportunity_type: string | null;
  eligibility_summary: string | null;
  required_registrations: string | null;
  requirements: unknown;
  jv_allowed: boolean | null;
  experience_level: string | null;
  submission_language: string | null;
  reference_id: string | null;
  status: string | null;
  has_broken_link: boolean | null;
}

interface Candidate {
  id: number;
  company_name: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  sector: string | null;
  countries: string[] | null;
  org_type: string | null;
  readiness_score: number | null;
  services: string[] | null;
  capabilities: string[] | null;
  final_url: string | null;
  tier: string | null;
  ungm_status: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  relationship_notes: string | null;
  already_matched: boolean;
}

interface Match {
  id: number;
  tender_id: number;
  assessment_id: number;
  routed_service: string;
  status: string;
  fit_reasoning: string;
  outcome: string | null;
  created_at: string;
  updated_at: string;
  vendor_company: string | null;
  vendor_email: string | null;
  vendor_tier: string | null;
  created_by_email: string | null;
}

interface DetailResponse {
  tender: TenderDetail;
  candidates: Candidate[];
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

function relTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function label(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/_/g, " ").replace(/-/g, " ");
}

function chipList(values: string[] | null | undefined, limit = 6): string {
  if (!Array.isArray(values) || !values.length) return "—";
  const slice = values.slice(0, limit);
  return slice.join(" · ") + (values.length > limit ? ` · +${values.length - limit}` : "");
}

export default function AdminMatchingDetailPage() {
  const params = useParams<{ tenderId: string }>();
  const tenderId = Number(params.tenderId);

  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [appliedQ, setAppliedQ] = useState("");
  const [openMatchFor, setOpenMatchFor] = useState<number | null>(null);
  const [openTagFor, setOpenTagFor] = useState<number | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (query: string) => {
    if (!Number.isInteger(tenderId) || tenderId <= 0) {
      setError("Invalid tender id");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const u = new URLSearchParams({ limit: "150" });
      if (query) u.set("q", query);
      const res = await fetch(`/api/admin/matching/tenders/${tenderId}?${u.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tender");
    } finally {
      setLoading(false);
    }
  }, [tenderId]);

  useEffect(() => {
    load("");
  }, [load]);

  const matchedAssessmentIds = useMemo(
    () => new Set((data?.matches ?? []).map((m) => m.assessment_id)),
    [data]
  );

  async function submitMatch(candidate: Candidate, form: { routed_service: string; status: string; fit_reasoning: string; outcome: string }) {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/matching/matches", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          tender_id: tenderId,
          assessment_id: candidate.id,
          routed_service: form.routed_service,
          status: form.status,
          fit_reasoning: form.fit_reasoning,
          outcome: form.outcome || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Match logged for ${candidate.company_name ?? "vendor"}.` });
      setOpenMatchFor(null);
      await load(appliedQ);
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to save match" });
    } finally {
      setSaving(false);
    }
  }

  async function saveVendorProfile(candidate: Candidate, form: { tier: string; ungm_status: string; contact_name: string; contact_email: string; contact_phone: string; relationship_notes: string }) {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch("/api/admin/matching/vendor-profiles", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          assessment_id: candidate.id,
          tier: form.tier || null,
          ungm_status: form.ungm_status || null,
          contact_name: form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          relationship_notes: form.relationship_notes || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Tagged ${candidate.company_name ?? "vendor"}.` });
      setOpenTagFor(null);
      await load(appliedQ);
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to save vendor profile" });
    } finally {
      setSaving(false);
    }
  }

  async function patchMatchStatus(matchId: number, status: string) {
    setSaving(true);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/matching/matches/${matchId}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ status }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setToast({ ok: true, msg: `Moved to ${status}.` });
      await load(appliedQ);
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to update match" });
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) {
    return (
      <>
        <header className={styles.pageHeader}>
          <div>
            <div className={styles.eyebrow}>05 — Matching</div>
            <h1 className={styles.pageTitle}>Tender not loaded</h1>
            <p className={styles.pageSub}>{error}</p>
          </div>
          <div className={styles.pageActions}>
            <Link href="/admin/matching" className={styles.btnGhost}>Back</Link>
          </div>
        </header>
      </>
    );
  }

  const t = data?.tender;

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>05 — Matching · Tender #{tenderId}</div>
          <h1 className={styles.pageTitle}>{t?.title ?? (loading ? "Loading…" : "Tender")}</h1>
          <p className={styles.pageSub}>
            {[t?.agency, t?.country, t?.sector].filter(Boolean).join(" · ") || "—"}
            {t?.deadline && ` · deadline ${fmtDate(t.deadline)}`}
            {t?.estimated_value && ` · value ${t.estimated_value}`}
          </p>
        </div>
        <div className={styles.pageActions}>
          <Link href="/admin/matching" className={styles.btnGhost}>← All tenders</Link>
          <Link href="/admin/matching/pipeline" className={styles.btnGhost}>Pipeline</Link>
          {t?.source_url && (
            <a href={t.source_url} target="_blank" rel="noreferrer" className={styles.btnGhost}>Source ↗</a>
          )}
        </div>
      </header>

      {toast && (
        <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>{toast.msg}</div>
      )}

      {t && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Tender summary</h2>
              <p className={styles.panelSub}>
                {t.opportunity_type ?? "RFP"} · {t.source_name ?? "—"}
                {t.reference_id && ` · ref ${t.reference_id}`}
              </p>
            </div>
            {t.has_broken_link && <span className={`${styles.toast} ${styles.toastErr}`} style={{ margin: 0, padding: "4px 10px", fontSize: 11 }}>Broken link flagged</span>}
          </header>
          <div style={{ padding: "12px 22px 22px" }}>
            {t.description && (
              <p style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", marginBottom: 12 }}>
                {t.description}
              </p>
            )}
            {t.eligibility_summary && (
              <p className={styles.sessionSubtle} style={{ marginBottom: 8 }}>
                <strong>Eligibility:</strong> {t.eligibility_summary}
              </p>
            )}
            {t.required_registrations && (
              <p className={styles.sessionSubtle} style={{ marginBottom: 8 }}>
                <strong>Registrations:</strong> {t.required_registrations}
              </p>
            )}
            <p className={styles.sessionSubtle}>
              JV allowed: {t.jv_allowed === false ? "no" : "yes"} ·
              experience: {label(t.experience_level)} ·
              language: {t.submission_language ?? "English"}
            </p>
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>Existing matches ({data?.matches.length ?? 0})</h2>
            <p className={styles.panelSub}>Decisions already logged for this tender. Status updates land in the pipeline view.</p>
          </div>
        </header>
        {(!data || data.matches.length === 0) ? (
          <div className={styles.woEmpty}>No matches yet — log one below.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Reasoning</th>
                  <th>Outcome</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.matches.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className={styles.cellName}>{m.vendor_company ?? `assessment #${m.assessment_id}`}</div>
                      <div className={styles.sessionSubtle}>
                        {m.vendor_email ?? "—"}{m.vendor_tier ? ` · ${m.vendor_tier}` : ""}
                      </div>
                    </td>
                    <td>{label(m.routed_service)}</td>
                    <td>{label(m.status)}</td>
                    <td style={{ maxWidth: 280 }}>
                      <span className={styles.sessionSubtle} title={m.fit_reasoning}>
                        {m.fit_reasoning.length > 120 ? m.fit_reasoning.slice(0, 120) + "…" : m.fit_reasoning}
                      </span>
                    </td>
                    <td className={styles.sessionSubtle}>{m.outcome ?? "—"}</td>
                    <td className={styles.mono}>{relTime(m.updated_at)}</td>
                    <td className={styles.num}>
                      <select
                        value={m.status}
                        onChange={(e) => patchMatchStatus(m.id, e.target.value)}
                        disabled={saving}
                        className={styles.adminSearchInput}
                        style={{ padding: "4px 6px", fontSize: 11 }}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
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
            <h2 className={styles.panelTitle}>Candidate vendors</h2>
            <p className={styles.panelSub}>Search assessments by company, sector, or description. Ordered by readiness score.</p>
          </div>
          {data && <span className={styles.panelMeta}>{data.candidates.length} candidates</span>}
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedQ(q);
            load(q);
          }}
          style={{ display: "flex", gap: 8, padding: "12px 22px 6px" }}
        >
          <input
            className={styles.adminSearchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by company, sector, email, description"
            style={{ flex: 1 }}
          />
          <button type="submit" className={styles.btnPrimary}>Search</button>
          {appliedQ && (
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => { setQ(""); setAppliedQ(""); load(""); }}
            >
              Clear
            </button>
          )}
        </form>

        {loading ? (
          <div className={styles.woEmpty}>Loading candidates…</div>
        ) : !data || data.candidates.length === 0 ? (
          <div className={styles.woEmpty}>No vendors match these filters.</div>
        ) : (
          <div style={{ padding: "8px 22px 22px", display: "grid", gap: 12 }}>
            {data.candidates.map((c) => {
              const isMatched = matchedAssessmentIds.has(c.id) || c.already_matched;
              return (
                <article
                  key={c.id}
                  style={{
                    border: "1px solid var(--color-rule)",
                    padding: 14,
                    background: isMatched ? "var(--color-bg-2, #fafafa)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <div>
                      <div className={styles.cellName}>{c.company_name ?? `assessment #${c.id}`}</div>
                      <div className={styles.sessionSubtle}>
                        {c.email ?? "—"}
                        {c.website && ` · ${c.website}`}
                        {c.readiness_score != null && ` · readiness ${c.readiness_score}`}
                      </div>
                      <div className={styles.sessionSubtle} style={{ marginTop: 4 }}>
                        {label(c.sector)} · {label(c.org_type)} · {chipList(c.countries, 4)}
                      </div>
                      <div className={styles.sessionSubtle} style={{ marginTop: 4 }}>
                        capabilities: {chipList(c.capabilities, 5)}
                      </div>
                      {(c.tier || c.ungm_status || c.contact_name) && (
                        <div className={styles.sessionSubtle} style={{ marginTop: 6 }}>
                          {c.tier && <span style={{ marginRight: 10 }}>tier <strong>{c.tier}</strong></span>}
                          {c.ungm_status && <span style={{ marginRight: 10 }}>UNGM {c.ungm_status}</span>}
                          {c.contact_name && <span>contact {c.contact_name}{c.contact_email ? ` · ${c.contact_email}` : ""}</span>}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => {
                          setOpenTagFor(openTagFor === c.id ? null : c.id);
                          setOpenMatchFor(null);
                        }}
                        style={{ padding: "5px 9px", fontSize: 11 }}
                      >
                        {c.tier || c.ungm_status || c.contact_name ? "Edit tag" : "Tag vendor"}
                      </button>
                      <button
                        type="button"
                        className={isMatched ? styles.btnGhost : styles.btnPrimary}
                        onClick={() => {
                          setOpenMatchFor(openMatchFor === c.id ? null : c.id);
                          setOpenTagFor(null);
                        }}
                        disabled={isMatched}
                        title={isMatched ? "Match already logged — edit it above" : "Log a match decision"}
                        style={{ padding: "5px 11px", fontSize: 11 }}
                      >
                        {isMatched ? "Matched" : "Log match"}
                      </button>
                    </div>
                  </div>

                  {openTagFor === c.id && (
                    <TagForm candidate={c} saving={saving} onSave={(form) => saveVendorProfile(c, form)} onCancel={() => setOpenTagFor(null)} />
                  )}
                  {openMatchFor === c.id && (
                    <MatchForm candidate={c} saving={saving} onSave={(form) => submitMatch(c, form)} onCancel={() => setOpenMatchFor(null)} />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function TagForm({
  candidate,
  saving,
  onSave,
  onCancel,
}: {
  candidate: Candidate;
  saving: boolean;
  onSave: (form: { tier: string; ungm_status: string; contact_name: string; contact_email: string; contact_phone: string; relationship_notes: string }) => void;
  onCancel: () => void;
}) {
  const [tier, setTier] = useState(candidate.tier ?? "");
  const [ungm, setUngm] = useState(candidate.ungm_status ?? "");
  const [name, setName] = useState(candidate.contact_name ?? "");
  const [email, setEmail] = useState(candidate.contact_email ?? "");
  const [phone, setPhone] = useState(candidate.contact_phone ?? "");
  const [notes, setNotes] = useState(candidate.relationship_notes ?? "");

  return (
    <div style={{ borderTop: "1px solid var(--color-rule)", paddingTop: 12, marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
        <select value={tier} onChange={(e) => setTier(e.target.value)} className={styles.adminSearchInput}>
          <option value="">No tier</option>
          {TIERS.map((t) => <option key={t} value={t}>Tier {t}</option>)}
        </select>
        <select value={ungm} onChange={(e) => setUngm(e.target.value)} className={styles.adminSearchInput}>
          <option value="">UNGM unknown</option>
          {UNGM_STATUSES.map((s) => <option key={s} value={s}>UNGM {s}</option>)}
        </select>
        <input className={styles.adminSearchInput} placeholder="Contact name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={styles.adminSearchInput} placeholder="Contact email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={styles.adminSearchInput} placeholder="Contact phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <textarea
        className={styles.adminSearchInput}
        placeholder="Relationship notes (private)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        style={{ width: "100%", marginTop: 8, padding: 8, fontFamily: "inherit" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={saving}
          onClick={() => onSave({
            tier,
            ungm_status: ungm,
            contact_name: name,
            contact_email: email,
            contact_phone: phone,
            relationship_notes: notes,
          })}
        >
          {saving ? "Saving…" : "Save tag"}
        </button>
        <button type="button" className={styles.btnGhost} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function MatchForm({
  candidate,
  saving,
  onSave,
  onCancel,
}: {
  candidate: Candidate;
  saving: boolean;
  onSave: (form: { routed_service: string; status: string; fit_reasoning: string; outcome: string }) => void;
  onCancel: () => void;
}) {
  const [routedService, setRoutedService] = useState<string>(ROUTED_SERVICES[0].value);
  const [status, setStatus] = useState<string>("suggested");
  const [reasoning, setReasoning] = useState("");
  const [outcome, setOutcome] = useState("");
  const minLen = 10;
  const tooShort = reasoning.trim().length < minLen;

  return (
    <div style={{ borderTop: "1px solid var(--color-rule)", paddingTop: 12, marginTop: 12 }}>
      <div className={styles.sessionSubtle} style={{ marginBottom: 6 }}>
        Match <strong>{candidate.company_name ?? `assessment #${candidate.id}`}</strong> to this tender.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
        <select value={routedService} onChange={(e) => setRoutedService(e.target.value)} className={styles.adminSearchInput}>
          {ROUTED_SERVICES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={styles.adminSearchInput}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <textarea
        className={styles.adminSearchInput}
        placeholder={`Why this fits — at least ${minLen} characters (your reasoning is the training signal)`}
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        rows={4}
        style={{ width: "100%", marginTop: 8, padding: 8, fontFamily: "inherit" }}
      />
      <input
        className={styles.adminSearchInput}
        placeholder="Outcome (optional, e.g. 'submitted joint proposal', 'declined — no JV')"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
        style={{ marginTop: 8 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={saving || tooShort}
          onClick={() => onSave({ routed_service: routedService, status, fit_reasoning: reasoning, outcome })}
        >
          {saving ? "Saving…" : "Log match"}
        </button>
        <button type="button" className={styles.btnGhost} onClick={onCancel}>Cancel</button>
        {tooShort && reasoning.length > 0 && (
          <span className={styles.sessionSubtle}>need {minLen - reasoning.trim().length} more chars</span>
        )}
      </div>
    </div>
  );
}
