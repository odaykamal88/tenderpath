"use client";

/* 03B — Submission fulfillment. EOI · RFQ · ITB · RFP orders, live from the
 * vendor dashboard: advance the stage here and the client's timeline updates
 * on their next poll. KPIs: new intakes (paid — drafting not started) · in
 * production · with client · SLA at risk (60-min draft promise). Notes posted
 * here land on the client's activity log labeled "TenderPath". */

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../admin.module.css";
import type { SubmissionOrder, SubmissionStage } from "@/lib/submissions/types";
import { ADMIN_QA_CHECKLIST } from "@/lib/submissions/flows";
import { OPS_ACTIONS, OPS_WAITING, STAGE_META } from "@/lib/submissions/stages";

interface AdminOrder extends SubmissionOrder {
  userEmail: string | null;
}

interface QueuePayload {
  orders: AdminOrder[];
  counts: Record<string, number>;
  kpis: { newIntakes: number; inProduction: number; withClient: number; slaAtRisk: number };
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

const TABS: { key: string; label: string; stages: SubmissionStage[] | null }[] = [
  { key: "all", label: "All", stages: null },
  ...(["intake", "drafting", "qa", "revisions", "review", "final", "submitted"] as SubmissionStage[]).map(
    (s) => ({ key: s, label: STAGE_META[s].admin, stages: [s] as SubmissionStage[] }),
  ),
];

function money(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function ago(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function shortDate(d: string | null): string {
  if (!d) return "—";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** SLA chip for paid orders still in production-entry stages. `now` comes from
 *  the page's ticking clock so the countdown stays live and render stays pure.
 *  An SLA more than 3× overdue is an ancient timestamp — the chip is hidden
 *  rather than shouting about a long-settled order (prototype sqMinsLeft). */
function slaMinsLeft(order: AdminOrder, now: number): number | null {
  if (!now || !order.paidAt || !order.slaMins) return null;
  const left = Math.round(order.slaMins - (now - new Date(order.paidAt).getTime()) / 60_000);
  if (left < -(order.slaMins * 3)) return null;
  return left;
}

function SlaChip({ order, now }: { order: AdminOrder; now: number }) {
  if (!["intake", "drafting"].includes(order.stage)) return null;
  const left = slaMinsLeft(order, now);
  if (left == null) return null;
  const cls = left <= 0 ? styles.tagNeg : left < 15 ? styles.tagWarn : styles.tagPos;
  return (
    <span className={`${styles.tag} ${cls}`}>
      {left > 0 ? `SLA ${left}m left` : `SLA over by ${-left}m`}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  color: "var(--color-ink)",
  background: "var(--color-paper-3)",
  border: "1px solid var(--color-rule)",
  padding: "8px 10px",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  background: "var(--color-ink)",
  color: "var(--color-paper)",
  border: "1px solid var(--color-ink)",
  padding: "8px 14px",
  cursor: "pointer",
};

const btnGhostStyle: React.CSSProperties = {
  ...btnStyle,
  background: "transparent",
  color: "var(--color-ink)",
  borderColor: "var(--color-rule)",
};

function StageActions({
  order,
  busy,
  act,
}: {
  order: AdminOrder;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  const [pct, setPct] = useState(order.pct);
  const [note, setNote] = useState(order.stageNote ?? "");
  const [outcomeState, setOutcomeState] = useState<"won" | "lost" | "shortlisted" | null>(null);
  const [scoresText, setScoresText] = useState("");
  const [lessonsText, setLessonsText] = useState("");
  const opsAction = OPS_ACTIONS[order.stage];

  if (order.stage === "review" || order.stage === "final") {
    return (
      <p className={styles.mute} style={{ fontSize: 13, margin: 0 }}>
        {OPS_WAITING[order.stage]}
      </p>
    );
  }

  if (order.stage === "submitted") {
    const oc = order.outcome;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <p className={styles.mute} style={{ fontSize: 13, margin: 0 }}>
          {OPS_WAITING.submitted} {oc.state !== "pending" && (
            <strong style={{ color: oc.state === "lost" ? "var(--color-red)" : "var(--color-green)" }}>
              Outcome: {oc.state === "lost" ? "not selected" : oc.state}
              {oc.decidedAt ? ` · ${shortDate(oc.decidedAt)}` : ""}
            </strong>
          )}
        </p>
        {oc.state === "pending" && !outcomeState && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["shortlisted", "won", "lost"] as const).map((s) => (
              <button key={s} type="button" style={btnGhostStyle} disabled={busy} onClick={() => setOutcomeState(s)}>
                Record: {s === "lost" ? "not selected" : s}
              </button>
            ))}
          </div>
        )}
        {oc.state === "pending" && outcomeState && (
          <div style={{ display: "grid", gap: 8 }}>
            <textarea
              value={scoresText}
              onChange={(e) => setScoresText(e.target.value)}
              rows={3}
              placeholder={"Score lines, one per row — Label: value\ne.g. Technical score: 66.5 / 100 — 3.5 below the 70.0 threshold\nField: 7 proposals received · 3 passed technical"}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                style={btnStyle}
                disabled={busy}
                onClick={() => {
                  const scores = scoresText
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const idx = l.indexOf(":");
                      return idx > 0 ? ([l.slice(0, idx).trim(), l.slice(idx + 1).trim()] as [string, string]) : ([l, ""] as [string, string]);
                    });
                  act({ action: "record_outcome", state: outcomeState, scores });
                  setOutcomeState(null);
                  setScoresText("");
                }}
              >
                Record {outcomeState}
              </button>
              <button type="button" style={btnGhostStyle} onClick={() => setOutcomeState(null)}>Cancel</button>
            </div>
          </div>
        )}
        {oc.state === "lost" && oc.debrief?.state === "requested" && (
          <div style={{ display: "grid", gap: 8 }}>
            <div className={styles.eyebrow}>Debrief requested by the client — record the lessons</div>
            <textarea
              value={lessonsText}
              onChange={(e) => setLessonsText(e.target.value)}
              rows={3}
              placeholder={"One lesson per line — each should end with what changed in the system."}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <button
              type="button"
              style={btnStyle}
              disabled={busy || !lessonsText.trim()}
              onClick={() => {
                act({ action: "record_debrief", lessons: lessonsText.split("\n").map((l) => l.trim()).filter(Boolean) });
                setLessonsText("");
              }}
            >
              Record debrief lessons
            </button>
          </div>
        )}
      </div>
    );
  }

  // intake / drafting / qa / revisions — production stages.
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {order.stage === "revisions" && order.revisionNotes && (
        <div style={{ borderLeft: "2px solid var(--color-warn)", paddingLeft: 10, fontSize: 13, color: "var(--color-ink-2)", lineHeight: 1.5 }}>
          Client&apos;s notes (round {order.round}): “{order.revisionNotes}”
        </div>
      )}
      {(order.stage === "drafting" || order.stage === "revisions") && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min={0}
            max={99}
            value={pct}
            onChange={(e) => setPct(Number(e.target.value))}
            style={{ ...inputStyle, width: 72 }}
          />
          <span className={styles.mute} style={{ fontSize: 12 }}>% drafted</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Status line the client sees, e.g. Technical section · methodology drafted, workplan in progress"
            style={{ ...inputStyle, flex: 1, minWidth: 220 }}
          />
          <button
            type="button"
            style={btnGhostStyle}
            disabled={busy}
            onClick={() => act({ action: "set_progress", pct, stageNote: note.trim() || null })}
          >
            Save
          </button>
        </div>
      )}
      {order.stage === "qa" && (
        <ul style={{ margin: "0 0 4px", padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
          {ADMIN_QA_CHECKLIST.map((q) => (
            <li key={q} style={{ fontSize: 11.5, color: "var(--color-ink-2)", display: "flex", gap: 7 }}>
              <span style={{ color: "var(--color-green)" }}>✓</span>
              {q}
            </li>
          ))}
        </ul>
      )}
      {opsAction && (
        <div>
          <button type="button" style={btnStyle} disabled={busy} onClick={() => act({ action: "advance", to: opsAction.next })}>
            {opsAction.label}
          </button>
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  busy,
  now,
  act,
}: {
  order: AdminOrder;
  busy: boolean;
  now: number;
  act: (id: number, body: Record<string, unknown>) => void;
}) {
  const [noteText, setNoteText] = useState("");
  const [amdOpen, setAmdOpen] = useState(false);
  const [amdSummary, setAmdSummary] = useState("");
  const [amdAction, setAmdAction] = useState("");
  const [amdDue, setAmdDue] = useState("");
  const [qnaAnswers, setQnaAnswers] = useState<Record<number, string>>({});
  const meta = STAGE_META[order.stage];
  const openQna = order.qna.map((q, i) => ({ ...q, i })).filter((q) => !q.a);
  const openBlockers = order.blockers.filter((b) => b.state === "requested" || b.state === "open");
  // Prototype stage colors: submitted = pos, with-client = warn, in production = accent.
  const dot =
    order.stage === "submitted"
      ? "var(--color-green)"
      : order.stage === "review" || order.stage === "final"
        ? "var(--color-warn)"
        : "var(--color-accent)";

  return (
    <article className={styles.woCard}>
      <div className={styles.woCardRail}>
        <span style={{ width: 9, height: 9, borderRadius: 999, background: dot, display: "inline-block" }} />
        <div className={styles.woId} style={{ writingMode: "vertical-rl", marginTop: 10 }}>{order.ref}</div>
      </div>
      <div className={styles.woCardMain}>
        <header className={styles.woHead}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.eyebrow}>{order.type} · Proposal submission</div>
            <h3 className={styles.woTitle}>{order.tender}</h3>
            <div className={styles.woMeta}>
              {[
                order.agency,
                order.due ? `due ${shortDate(order.due)}` : null,
                order.fit ? `fit ${order.fit}%` : null,
                `intake ${order.completeness}%`,
                order.userEmail,
                `updated ${ago(order.updatedAt)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <SlaChip order={order} now={now} />
              {order.round > 0 && <span className={`${styles.tag} ${styles.tagMute}`}>round {order.round}</span>}
              {openBlockers.map((b) => (
                <span key={b.id} className={`${styles.tag} ${b.state === "open" ? styles.tagNeg : styles.tagWarn}`}>
                  {b.label} · {b.state}
                  {b.state === "requested" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(order.id, { action: "resolve_blocker", blockerId: b.id })}
                      style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", color: "inherit", textDecoration: "underline", padding: 0 }}
                    >
                      arrived → resolve
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div className={styles.woMoney}>{money(order.priceCents)}</div>
            <div className={styles.mute} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>paid</div>
          </div>
        </header>

        <div className={styles.woGrid}>
          <div>
            <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Intake summary</div>
            <div style={{ background: "var(--color-paper-2)", border: "1px solid var(--color-rule)", padding: "10px 12px", display: "grid", gap: 6 }}>
              {order.intake.slice(0, 6).map(([k, v], i) => (
                <div key={`${k}-${i}`} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--color-ink)" }}>{k}:</strong>{" "}
                  <span style={{ color: "var(--color-ink-2)" }}>{v}</span>
                </div>
              ))}
              {order.intake.length === 0 && <span className={styles.mute} style={{ fontSize: 12 }}>No intake summary.</span>}
            </div>
            {openQna.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Open Q&A — answer + draft-impact verdict</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {openQna.map((q) => (
                    <div key={q.i} style={{ border: "1px dashed var(--color-rule)", padding: "8px 10px" }}>
                      <div style={{ fontSize: 12.5, color: "var(--color-ink)", lineHeight: 1.5 }}>{q.q}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <input
                          value={qnaAnswers[q.i] ?? ""}
                          onChange={(e) => setQnaAnswers((m) => ({ ...m, [q.i]: e.target.value }))}
                          placeholder="Answer — end with the impact, e.g. '… Your draft already cites county letters — no change needed.'"
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                          type="button"
                          style={btnGhostStyle}
                          disabled={busy || !(qnaAnswers[q.i] ?? "").trim()}
                          onClick={() => {
                            act(order.id, { action: "answer_qna", index: q.i, a: (qnaAnswers[q.i] ?? "").trim() });
                            setQnaAnswers((m) => ({ ...m, [q.i]: "" }));
                          }}
                        >
                          Post
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Stage — {meta.admin}</div>
            <StageActions order={order} busy={busy} act={(body) => act(order.id, body)} />

            <div style={{ marginTop: 14 }}>
              <div className={styles.eyebrow} style={{ marginBottom: 6 }}>Post a note to the client&apos;s timeline</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="e.g. Need the signed CV for the third expert by 16:00…"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  type="button"
                  style={btnGhostStyle}
                  disabled={busy || !noteText.trim()}
                  onClick={() => {
                    act(order.id, { action: "post_note", note: noteText.trim() });
                    setNoteText("");
                  }}
                >
                  Post
                </button>
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setAmdOpen((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-ink-3)", padding: 0 }}
              >
                {amdOpen ? "− Cancel amendment" : "+ Record an agency amendment"}
              </button>
              {amdOpen && (
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  <input value={amdSummary} onChange={(e) => setAmdSummary(e.target.value)} placeholder="What changed — e.g. Deadline extended 08 → 12 May · TOR §4.2 adds a deliverable" style={inputStyle} />
                  <input value={amdAction} onChange={(e) => setAmdAction(e.target.value)} placeholder="What we did — e.g. Workplan rebased; methodology updated. Nothing needed from the client." style={inputStyle} />
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="date" value={amdDue} onChange={(e) => setAmdDue(e.target.value)} style={{ ...inputStyle, width: 170 }} />
                    <span className={styles.mute} style={{ fontSize: 11.5 }}>new deadline (only if it moved)</span>
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      style={btnStyle}
                      disabled={busy || !amdSummary.trim() || !amdAction.trim()}
                      onClick={() => {
                        act(order.id, { action: "add_amendment", summary: amdSummary.trim(), actionTaken: amdAction.trim(), due: amdDue || null });
                        setAmdSummary(""); setAmdAction(""); setAmdDue(""); setAmdOpen(false);
                      }}
                    >
                      Record
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function AdminSubmissionsPage() {
  const [data, setData] = useState<QueuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // Clock sync for the live SLA countdowns — the wall clock is the external
    // system being subscribed to; the initial set avoids a blank chip until
    // the first 30s tick.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/admin/submission-orders", { headers: authHeaders(), cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the queue");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (id: number, body: Record<string, unknown>) => {
      setBusyId(id);
      try {
        const res = await fetch(`/api/admin/submission-orders/${id}`, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error ?? `${res.status} ${res.statusText}`);
        setData((prev) =>
          prev
            ? { ...prev, orders: prev.orders.map((o) => (o.id === id ? { ...o, ...payload.order } : o)) }
            : prev,
        );
        load(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
        load(true);
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const orders = useMemo(() => {
    const all = data?.orders ?? [];
    const stages = TABS.find((t) => t.key === tab)?.stages;
    return stages ? all.filter((o) => stages.includes(o.stage)) : all;
  }, [data, tab]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>03B — Submissions</div>
          <h1 className={styles.pageTitle}>Submission fulfillment</h1>
          <p className={styles.pageSub}>
            EOI · RFQ · ITB · RFP orders, live from the vendor dashboard. Advance the stage here and the
            client&apos;s timeline updates instantly.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnGhost} onClick={() => load()}>Refresh</button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.heroRow}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>New intakes</div>
          <div className={styles.heroStatValue}>{data?.kpis.newIntakes ?? "—"}</div>
          <div className={styles.heroStatMeta}>paid — drafting not started</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>In production</div>
          <div className={styles.heroStatValue}>{data?.kpis.inProduction ?? "—"}</div>
          <div className={styles.heroStatMeta}>drafting · QA · revisions</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>With client</div>
          <div className={styles.heroStatValue}>{data?.kpis.withClient ?? "—"}</div>
          <div className={styles.heroStatMeta}>review or final-mile</div>
        </div>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>SLA at risk</div>
          <div className={styles.heroStatValue}>{data?.kpis.slaAtRisk ?? "—"}</div>
          <div className={styles.heroStatMeta}>60-min draft promise</div>
        </div>
      </section>

      <section className={styles.woControls}>
        <div className={styles.woTabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`${styles.woTab} ${tab === t.key ? styles.woTabActive : ""}`}
            >
              <span>{t.label}</span>
              <span className={styles.woTabCount}>{data?.counts[t.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <span className={`${styles.tag} ${styles.tagMute}`}>Live-synced with the vendor dashboard</span>
      </section>

      {loading ? (
        <div className={styles.woEmpty}>Loading the queue…</div>
      ) : orders.length === 0 ? (
        <div className={styles.woEmpty}>
          Nothing in “{TABS.find((t) => t.key === tab)?.label ?? tab}” — orders land here the moment a
          vendor places one from the dashboard&apos;s Submissions page.
        </div>
      ) : (
        <section className={styles.woList}>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} busy={busyId === o.id} now={now} act={act} />
          ))}
        </section>
      )}
    </>
  );
}
