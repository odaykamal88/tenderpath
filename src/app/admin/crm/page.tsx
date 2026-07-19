"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import NextStepPanel from "@/components/admin/NextStepPanel";
import {
  readSalesState,
  summarizePortfolio,
  PIPELINE_STAGE_LABELS,
  type SalesSignalInput,
  type SalesRead,
  type SalesUrgency,
} from "@/lib/network/next-steps";

interface PulseCompany extends SalesSignalInput {
  detected_industry: string | null;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}
function jsonHeaders(): HeadersInit {
  return { ...authHeaders(), "content-type": "application/json" };
}

const STAGE_LABELS = PIPELINE_STAGE_LABELS;
// Full stage vocabulary for inline editing (funnel order + terminal outcomes).
const EDIT_STAGES = ["lead", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
// Stages you "advance" through with the → shortcut (terminal outcomes excluded).
const ADVANCE_ORDER = ["lead", "contacted", "replied", "meeting", "proposal", "won"] as const;
const LOG_KINDS = ["note", "call", "email", "meeting", "linkedin"] as const;
const LOG_KIND_LABELS: Record<string, string> = {
  note: "Note", call: "Call", email: "Email", meeting: "Meeting", linkedin: "LinkedIn",
};
const EMPTY_ADD = { name: "", website: "", countries: "", contact_name: "", contact_email: "", services_text: "" };
// Active pipeline stages shown in the funnel (won/lost are outcomes, shown apart).
const FUNNEL_STAGES = ["lead", "contacted", "replied", "meeting", "proposal"] as const;

function stageChipClass(stage: string): string {
  if (stage === "won") return styles.tagPos;
  if (stage === "lost") return styles.tagNeg;
  if (stage === "proposal" || stage === "meeting") return styles.tagNew;
  if (stage === "replied" || stage === "contacted") return styles.tagWarn;
  return styles.tagMute;
}

const URGENCY_META: Record<SalesUrgency, { label: string; color: string }> = {
  now: { label: "Now", color: "var(--color-accent)" },
  soon: { label: "Soon", color: "#8e6a23" },
  later: { label: "Later", color: "var(--color-mute, #8a857c)" },
  paused: { label: "Paused", color: "var(--color-mute, #8a857c)" },
};

function dispositionChipClass(d: SalesRead["disposition"]): string {
  if (d === "advance") return styles.tagPos;
  if (d === "sunset") return styles.tagNeg;
  return styles.tagWarn;
}
const DISPOSITION_LABEL: Record<SalesRead["disposition"], string> = {
  advance: "Advance",
  nurture: "Nurture",
  sunset: "Sunset",
};

export default function AdminCrmPage() {
  const [companies, setCompanies] = useState<PulseCompany[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showSunset, setShowSunset] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [logFor, setLogFor] = useState<number | null>(null);
  const [logKind, setLogKind] = useState("note");
  const [logBody, setLogBody] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_ADD });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/crm/pulse", { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = await res.json();
      setCompanies(body.companies as PulseCompany[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load CRM pulse");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function patchLocal(id: number, changes: Partial<PulseCompany>) {
    setCompanies((cs) => (cs ? cs.map((c) => (c.id === id ? { ...c, ...changes } : c)) : cs));
  }

  // Move a deal's pipeline stage — optimistic + background PATCH (reuses the
  // network-companies endpoint, which also logs the stage change server-side).
  async function setStage(companyId: number, stage: string) {
    const prev = companies?.find((c) => c.id === companyId)?.pipeline_stage;
    if (stage === prev) return;
    patchLocal(companyId, { pipeline_stage: stage, last_activity_at: new Date().toISOString() });
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}`, {
        method: "PATCH", headers: jsonHeaders(), body: JSON.stringify({ pipeline_stage: stage }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
      setToast({ ok: true, msg: `Moved to ${STAGE_LABELS[stage] ?? stage}.` });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to move stage" });
      await load();
    }
  }

  function advance(companyId: number, current: string) {
    const i = ADVANCE_ORDER.indexOf(current as typeof ADVANCE_ORDER[number]);
    if (i < 0 || i >= ADVANCE_ORDER.length - 1) {
      setToast({ ok: true, msg: current === "won" ? "Already won." : "At the last stage — set Won or Lost." });
      return;
    }
    setStage(companyId, ADVANCE_ORDER[i + 1]);
  }

  function sunsetDeal(companyId: number, name: string) {
    if (typeof window !== "undefined" && !window.confirm(`Mark "${name}" as Lost? It moves to the sunset outcome.`)) return;
    setStage(companyId, "lost");
  }

  // Log a quick interaction against a deal without leaving the CRM.
  async function logTouch(companyId: number) {
    const body = logBody.trim();
    if (!body) return;
    setBusyId(companyId);
    setToast(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}/activity`, {
        method: "POST", headers: jsonHeaders(), body: JSON.stringify({ kind: logKind, body }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`);
      patchLocal(companyId, { last_activity_at: new Date().toISOString() });
      setLogFor(null); setLogBody("");
      setToast({ ok: true, msg: `Logged ${LOG_KIND_LABELS[logKind] ?? logKind}.` });
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to log" });
    } finally {
      setBusyId(null);
    }
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) { setToast({ ok: false, msg: "Company name is required." }); return; }
    if (!addForm.website.trim() && !addForm.services_text.trim()) {
      setToast({ ok: false, msg: "Add a website or a short service description so we can profile + match it." });
      return;
    }
    setAdding(true); setToast(null);
    try {
      const res = await fetch("/api/admin/network-companies", {
        method: "POST", headers: jsonHeaders(),
        body: JSON.stringify({
          name: addForm.name, website: addForm.website || null, countries: addForm.countries,
          contact_name: addForm.contact_name || null, contact_email: addForm.contact_email || null,
          services_text: addForm.services_text || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      const n = body.match?.newMatches ?? 0;
      setToast({ ok: true, msg: `Added ${body.company?.name ?? "prospect"} — ${n} match${n === 1 ? "" : "es"} found.` });
      setAddForm({ ...EMPTY_ADD }); setShowAdd(false);
      await load();
    } catch (err) {
      setToast({ ok: false, msg: err instanceof Error ? err.message : "Failed to add prospect" });
    } finally {
      setAdding(false);
    }
  }

  // Deterministic read per company — computed client-side, instantly, no LLM.
  const reads = useMemo(() => {
    if (!companies) return new Map<number, SalesRead>();
    const m = new Map<number, SalesRead>();
    for (const c of companies) m.set(c.id, readSalesState(c));
    return m;
  }, [companies]);

  const pulse = useMemo(() => {
    if (!companies) return null;
    const readArr = companies.map((c) => reads.get(c.id)!);
    return summarizePortfolio(companies, readArr);
  }, [companies, reads]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (stageFilter !== "all" && (c.pipeline_stage ?? "lead") !== stageFilter) return false;
      if (q) {
        const hay = [c.name, c.detected_industry].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [companies, search, stageFilter]);

  // The priority queue: active, non-sunset, non-paused deals, hottest first.
  const queue = useMemo(() => {
    return filtered
      .map((c) => ({ c, r: reads.get(c.id)! }))
      .filter(({ r }) => r.disposition !== "sunset" && r.urgency !== "paused")
      .sort((a, b) => {
        if (b.r.urgencyScore !== a.r.urgencyScore) return b.r.urgencyScore - a.r.urgencyScore;
        const ad = a.r.daysToNearestDeadline ?? 9999;
        const bd = b.r.daysToNearestDeadline ?? 9999;
        return ad - bd;
      });
  }, [filtered, reads]);

  const sunsetLane = useMemo(() => {
    return filtered
      .map((c) => ({ c, r: reads.get(c.id)! }))
      .filter(({ r }) => r.disposition === "sunset")
      // Most stale first (largest days-since-touch at the top of the prune list).
      .sort((a, b) => (b.r.daysSinceTouch ?? 0) - (a.r.daysSinceTouch ?? 0));
  }, [filtered, reads]);

  const quietCount = useMemo(
    () => filtered.filter((c) => {
      const r = reads.get(c.id)!;
      return r.disposition !== "sunset" && r.urgency === "paused";
    }).length,
    [filtered, reads],
  );

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Compact inline action bar shared by the queue + sunset cards: infer read,
  // change stage, advance a step, log a touch, or sunset — all without leaving.
  function dealActions(c: PulseCompany, isOpen: boolean, readLabel = "Infer next step ↗") {
    const stage = c.pipeline_stage ?? "lead";
    const disabled = busyId === c.id;
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className={isOpen ? styles.btnGhost : styles.btnPrimary} onClick={() => toggleExpand(c.id)} style={{ padding: "6px 12px", fontSize: 12 }}>
            {isOpen ? "Hide read" : readLabel}
          </button>
          <select
            value={stage}
            onChange={(e) => setStage(c.id, e.target.value)}
            disabled={disabled}
            aria-label={`Pipeline stage for ${c.name}`}
            className={styles.adminSearchInput}
            style={{ padding: "5px 7px", fontSize: 11 }}
          >
            {EDIT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          {stage !== "won" && stage !== "lost" && (
            <button type="button" className={styles.btnGhost} onClick={() => advance(c.id, stage)} disabled={disabled} style={{ padding: "5px 9px", fontSize: 11 }}>Advance →</button>
          )}
          <button type="button" className={styles.btnGhost} onClick={() => { setLogFor((f) => (f === c.id ? null : c.id)); setLogBody(""); }} disabled={disabled} style={{ padding: "5px 9px", fontSize: 11 }}>
            {logFor === c.id ? "Cancel" : "＋ Log touch"}
          </button>
          {stage !== "lost" && (
            <button type="button" className={styles.btnGhost} onClick={() => sunsetDeal(c.id, c.name)} disabled={disabled} style={{ padding: "5px 9px", fontSize: 11, color: "var(--color-red)" }}>Sunset</button>
          )}
        </div>
        {logFor === c.id && (
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
            <select value={logKind} onChange={(e) => setLogKind(e.target.value)} className={styles.adminSearchInput} style={{ padding: "6px 8px", fontSize: 12 }} aria-label="Interaction type">
              {LOG_KINDS.map((k) => <option key={k} value={k}>{LOG_KIND_LABELS[k]}</option>)}
            </select>
            <input
              className={styles.adminSearchInput}
              value={logBody}
              onChange={(e) => setLogBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") logTouch(c.id); }}
              placeholder="What happened? (e.g. Sent intro email with briefing link)"
              style={{ flex: 1, minWidth: 220, padding: "6px 8px", fontSize: 12 }}
            />
            <button type="button" className={styles.btnPrimary} onClick={() => logTouch(c.id)} disabled={disabled || !logBody.trim()} style={{ padding: "6px 12px", fontSize: 12 }}>
              {disabled ? "Logging…" : "Log"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const funnelMax = pulse ? Math.max(1, ...pulse.funnel.filter((f) => FUNNEL_STAGES.includes(f.stage as typeof FUNNEL_STAGES[number])).map((f) => f.count)) : 1;
  const wonCount = pulse?.funnel.find((f) => f.stage === "won")?.count ?? 0;
  const lostCount = pulse?.funnel.find((f) => f.stage === "lost")?.count ?? 0;

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>10 — Sales CRM</div>
          <h1 className={styles.pageTitle}>Sales command</h1>
          <p className={styles.pageSub}>
            Founder-led sales, one screen. Every prospect is read against its live TenderPath matches and
            relationship history to answer the only two questions that matter: <em>what moves this closer to
            closing</em>, or <em>should we let it go</em>. Reasoning is on-demand per deal.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnPrimary} onClick={() => setShowAdd((s) => !s)}>
            {showAdd ? "Close" : "Add prospect"}
          </button>
          <Link href="/admin/network" className={styles.btnGhost}>Contacts →</Link>
          <button type="button" className={styles.btnGhost} onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}
      {toast && <div className={`${styles.toast} ${toast.ok ? styles.toastOk : styles.toastErr}`}>{toast.msg}</div>}

      {showAdd && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Add a prospect</h2>
              <p className={styles.panelSub}>Drops straight into the pipeline. We crawl the site + your notes to build a match profile, then score it against open tenders.</p>
            </div>
          </header>
          <form onSubmit={submitAdd} style={{ padding: "14px 22px 22px", display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
              <input className={styles.adminSearchInput} placeholder="Company name *" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Website (https://…)" value={addForm.website} onChange={(e) => setAddForm({ ...addForm, website: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Countries they deliver in (comma-separated)" value={addForm.countries} onChange={(e) => setAddForm({ ...addForm, countries: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Contact name" value={addForm.contact_name} onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })} />
              <input className={styles.adminSearchInput} placeholder="Contact email" value={addForm.contact_email} onChange={(e) => setAddForm({ ...addForm, contact_email: e.target.value })} />
            </div>
            <textarea className={styles.adminSearchInput} placeholder="What do they supply / do? (the richer, the better the matching)" value={addForm.services_text} onChange={(e) => setAddForm({ ...addForm, services_text: e.target.value })} rows={2} style={{ width: "100%", padding: 8, fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button type="submit" className={styles.btnPrimary} disabled={adding}>{adding ? "Building profile…" : "Add & match"}</button>
              <span className={styles.sessionSubtle} style={{ fontSize: 12 }}>Building the profile crawls the site + runs AI — a few seconds.</span>
            </div>
          </form>
        </section>
      )}

      {pulse && (
        <section className={styles.heroRow}>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Active deals</div>
            <div className={styles.heroStatValue}>{pulse.totalActive}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Needs your move</div>
            <div className={styles.heroStatValue} style={{ color: pulse.needsMove > 0 ? "var(--color-accent)" : undefined }}>{pulse.needsMove}</div>
            <div className={styles.heroStatMeta}>urgency: now</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Advancing</div>
            <div className={styles.heroStatValue}>{pulse.advancing}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Deadlines ≤7d</div>
            <div className={styles.heroStatValue}>{pulse.deadlinesThisWeek}</div>
            <div className={styles.heroStatMeta}>live tenders on active deals</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Sunset candidates</div>
            <div className={styles.heroStatValue} style={{ color: pulse.sunsetCandidates > 0 ? "var(--color-red)" : undefined }}>{pulse.sunsetCandidates}</div>
          </div>
        </section>
      )}

      {pulse && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Pipeline</h2>
              <p className={styles.panelSub}>Where active deals sit right now. Outcomes shown to the right.</p>
            </div>
          </header>
          <div style={{ padding: "16px 22px 22px", display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            {FUNNEL_STAGES.map((stage) => {
              const count = pulse.funnel.find((f) => f.stage === stage)?.count ?? 0;
              const h = 12 + Math.round((count / funnelMax) * 72);
              return (
                <button
                  key={stage}
                  type="button"
                  onClick={() => setStageFilter((s) => (s === stage ? "all" : stage))}
                  title={`Filter to ${STAGE_LABELS[stage]}`}
                  style={{
                    flex: "1 1 90px", minWidth: 78, background: "none", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 0,
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 600, color: stageFilter === stage ? "var(--color-accent)" : "var(--color-ink)" }}>{count}</span>
                  <div
                    style={{
                      width: "100%", height: h, borderRadius: "5px 5px 0 0",
                      background: stageFilter === stage ? "var(--color-accent)" : "var(--color-paper-3, #e7e3d8)",
                      border: "1px solid var(--color-rule)", borderBottom: "none",
                      transition: "height .2s ease",
                    }}
                  />
                  <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>{STAGE_LABELS[stage]}</span>
                </button>
              );
            })}
            <div style={{ width: 1, alignSelf: "stretch", background: "var(--color-rule)", margin: "0 4px" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-green)" }}>{wonCount}</div>
                <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>Won</span>
              </div>
              <div style={{ textAlign: "center", minWidth: 60 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--color-mute, #8a857c)" }}>{lostCount}</div>
                <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>Lost</span>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>What needs you {queue.length > 0 && <span className={styles.sessionSubtle}>({queue.length})</span>}</h2>
            <p className={styles.panelSub}>Prioritised by urgency. Open a deal for the AI read on how to close it — or whether to drop it.</p>
          </div>
          {companies && companies.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className={styles.adminSearchInput}
                placeholder="Search company / industry…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: "6px 10px", minWidth: 180 }}
              />
              <select className={styles.adminSearchInput} value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} style={{ padding: "6px 8px", fontSize: 12 }}>
                <option value="all">All stages</option>
                {Object.entries(STAGE_LABELS).map(([s, l]) => <option key={s} value={s}>{l}</option>)}
              </select>
            </div>
          )}
        </header>

        {loading ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : !companies || companies.length === 0 ? (
          <div className={styles.woEmpty}>
            No prospects yet — add or import contacts in <Link href="/admin/network" className={styles.tableLink}>Network</Link>.
          </div>
        ) : queue.length === 0 ? (
          <div className={styles.woEmpty}>
            Nothing needs a move right now{quietCount > 0 ? ` · ${quietCount} quiet` : ""}
            {sunsetLane.length > 0 ? ` · ${sunsetLane.length} sunset candidate${sunsetLane.length === 1 ? "" : "s"} below` : ""}.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 22px 18px" }}>
            {queue.map(({ c, r }) => {
              const isOpen = expanded.has(c.id);
              const u = URGENCY_META[r.urgency];
              return (
                <div key={c.id} style={{ border: "1px solid var(--color-rule)", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: u.color, marginTop: 6, flexShrink: 0 }} title={`Urgency: ${u.label}`} />
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <Link href={`/admin/network/${c.id}`} className={styles.tableLink} style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</Link>
                        <span className={`${styles.tag} ${stageChipClass(c.pipeline_stage ?? "lead")}`} style={{ fontSize: 10 }}>{STAGE_LABELS[c.pipeline_stage ?? "lead"] ?? c.pipeline_stage}</span>
                        <span className={`${styles.tag} ${dispositionChipClass(r.disposition)}`} style={{ fontSize: 10 }}>{DISPOSITION_LABEL[r.disposition]}</span>
                        {c.detected_industry && <span className={styles.sessionSubtle} style={{ fontSize: 11 }}>{c.detected_industry}</span>}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 5 }}>{r.recommendedAction}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0, fontSize: 11 }}>
                      <div style={{ color: u.color, fontWeight: 600 }}>{u.label}</div>
                      <div className={styles.sessionSubtle}>
                        {r.daysToNearestDeadline != null && r.daysToNearestDeadline >= 0
                          ? `closes ${r.daysToNearestDeadline}d`
                          : c.match_count > 0 ? "live matches" : "no live tender"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {r.signals.filter((s) => s.weight > 0).slice(0, 4).map((s) => (
                      <span key={s.code} className={`${styles.tag} ${styles.tagMute}`} style={{ fontSize: 10 }}>{s.label}</span>
                    ))}
                    <span className={styles.sessionSubtle} style={{ fontSize: 11, marginLeft: "auto" }}>
                      {c.top_score > 0 ? `fit ${c.top_score}` : "no fit"}
                      {c.fresh_count > 0 ? ` · ${c.fresh_count} fresh` : ""}
                      {r.daysSinceTouch != null ? ` · touched ${r.daysSinceTouch}d ago` : ""}
                    </span>
                  </div>

                  {dealActions(c, isOpen)}
                  {isOpen && <NextStepPanel companyId={c.id} auto onLogged={() => patchLocal(c.id, { last_activity_at: new Date().toISOString() })} />}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {sunsetLane.length > 0 && (
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Sunset candidates ({sunsetLane.length})</h2>
              <p className={styles.panelSub}>The engine sees more decay than opportunity here. Prune to protect your hours — or open one to double-check.</p>
            </div>
            <button type="button" className={styles.btnGhost} onClick={() => setShowSunset((s) => !s)} style={{ padding: "5px 11px", fontSize: 12 }}>
              {showSunset ? "Collapse" : "Review"}
            </button>
          </header>
          {showSunset && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 22px 18px" }}>
              {sunsetLane.map(({ c, r }) => {
                const isOpen = expanded.has(c.id);
                return (
                  <div key={c.id} style={{ border: "1px solid var(--color-rule)", borderRadius: 10, padding: "10px 14px", display: "grid", gap: 6, opacity: 0.9 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Link href={`/admin/network/${c.id}`} className={styles.tableLink} style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</Link>
                      <span className={`${styles.tag} ${stageChipClass(c.pipeline_stage ?? "lead")}`} style={{ fontSize: 10 }}>{STAGE_LABELS[c.pipeline_stage ?? "lead"] ?? c.pipeline_stage}</span>
                      <span className={styles.sessionSubtle} style={{ fontSize: 11, marginLeft: "auto" }}>
                        {r.daysSinceTouch != null ? `touched ${r.daysSinceTouch}d ago` : ""}{c.match_count === 0 ? " · no live tender" : ""}
                      </span>
                    </div>
                    <div className={styles.sessionSubtle} style={{ fontSize: 12.5 }}>{r.recommendedAction}</div>
                    {dealActions(c, isOpen, "Second opinion ↗")}
                    {isOpen && <NextStepPanel companyId={c.id} auto onLogged={() => patchLocal(c.id, { last_activity_at: new Date().toISOString() })} />}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}
