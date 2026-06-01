"use client";

/**
 * /admin/feedback — the curation gate's control surface (Phase 1d).
 *
 * The human checkpoint between "captured" and "live": nothing recalibrates the
 * score or changes extraction until an admin PROMOTES it here. Outcome records
 * carry a calibration verdict (did the predicted score match the real result),
 * with `optimistic` highlighted — the dangerous miss the survivorship-bias note
 * says to chase.
 */

import { useCallback, useEffect, useState } from "react";
import styles from "../admin.module.css";

type FeedbackState = "captured" | "promoted" | "rejected";
type FeedbackKind = "outcome" | "loss_reason" | "extraction_correction" | "exemplar";
type Calibration = "aligned" | "optimistic" | "pessimistic" | "n/a" | null;

interface FeedbackRow {
  id: number;
  kind: FeedbackKind;
  state: FeedbackState;
  capturedFrom: string;
  outcome: string | null;
  predictedScore: number | null;
  predictedMax: number | null;
  predictedBand: string | null;
  tenderTitle: string | null;
  agency: string | null;
  detail: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
  calibration: Calibration;
}

interface Stats {
  byState: Record<FeedbackState, number>;
  byKind: Record<FeedbackKind, number>;
  pendingReview: number;
}

interface CalibrationReport {
  totalOutcomes: number;
  sampleSize: number;
  aligned: number;
  optimistic: number;
  pessimistic: number;
  optimisticRate: number;
  alignedRate: number;
  calibrated: boolean;
  note: string;
}

const TABS: { key: FeedbackState | "all"; label: string }[] = [
  { key: "captured", label: "Pending review" },
  { key: "promoted", label: "Promoted" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token
    ? { "content-type": "application/json", authorization: `Bearer ${token}` }
    : { "content-type": "application/json" };
}

function fmtDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function label(value: string): string {
  return value.replace(/_/g, " ");
}
function outcomeTag(outcome: string): string {
  if (outcome === "won" || outcome === "shortlisted") return styles.tagPos;
  if (outcome === "lost" || outcome === "disqualified") return styles.tagNeg;
  return styles.tagMute;
}
function calibrationTag(c: Calibration): string {
  if (c === "aligned") return styles.tagPos;
  if (c === "optimistic") return styles.tagNeg;
  if (c === "pessimistic") return styles.tagWarn;
  return styles.tagMute;
}
function stateTag(s: FeedbackState): string {
  if (s === "promoted") return styles.tagPos;
  if (s === "rejected") return styles.tagMute;
  return styles.tagWarn;
}

export default function FeedbackQueuePage() {
  const [records, setRecords] = useState<FeedbackRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [calibration, setCalibration] = useState<CalibrationReport | null>(null);
  const [tab, setTab] = useState<FeedbackState | "all">("captured");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = tab === "all" ? "" : `?state=${tab}`;
      const res = await fetch(`/api/admin/feedback${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { records: FeedbackRow[]; stats: Stats; calibration: CalibrationReport | null };
      setRecords(body.records ?? []);
      setStats(body.stats ?? null);
      setCalibration(body.calibration ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feedback");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  async function curate(id: number, state: "promoted" | "rejected") {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ id, state }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `${res.status} ${res.statusText}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update record");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>06 — Feedback</div>
          <h1 className={styles.pageTitle}>Curation queue</h1>
          <p className={styles.pageSub}>
            The human gate. Only <b>promoted</b> records feed scoring calibration, extraction, or
            retrieval. Promote what is real signal; reject noise. The model stays frozen — this
            curated store is what compounds.
          </p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnGhost} onClick={load}>
            Refresh
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      {stats && (
        <section className={styles.heroRow}>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Pending review</div>
            <div className={styles.heroStatValue}>{stats.byState.captured}</div>
            <div className={styles.heroStatMeta}>awaiting a human decision</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Promoted</div>
            <div className={styles.heroStatValue}>{stats.byState.promoted}</div>
            <div className={styles.heroStatMeta}>feeding calibration</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Rejected</div>
            <div className={styles.heroStatValue}>{stats.byState.rejected}</div>
            <div className={styles.heroStatMeta}>kept out</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>Score calibration</div>
            <div className={styles.heroStatValue}>
              {calibration && calibration.sampleSize > 0 ? (
                <span className={calibration.calibrated ? styles.posNum : styles.warnNum}>
                  {Math.round(calibration.optimisticRate * 100)}%
                </span>
              ) : (
                "—"
              )}
            </div>
            <div className={styles.heroStatMeta}>
              {calibration
                ? `optimistic misses · ${calibration.sampleSize} outcome${calibration.sampleSize === 1 ? "" : "s"} · ${calibration.calibrated ? "calibrated" : "not yet"}`
                : "no promoted outcomes yet"}
            </div>
          </div>
        </section>
      )}

      {calibration && calibration.totalOutcomes > 0 && (
        <p className={styles.pageSub} style={{ marginTop: -2, marginBottom: 10 }}>
          <b>Calibration (B2):</b> {calibration.note}
        </p>
      )}

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
              {stats && t.key !== "all" && <span className={styles.woTabCount}>{stats.byState[t.key]}</span>}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <div className={styles.woEmpty}>Loading feedback…</div>
      ) : records.length === 0 ? (
        <div className={styles.woEmpty}>Nothing here yet for this filter.</div>
      ) : (
        <section className={styles.woList}>
          {records.map((r) => (
            <article key={r.id} className={styles.woCard}>
              <div className={styles.woCardRail}>
                <div className={styles.woId}>#{r.id}</div>
                <span className={`${styles.tag} ${styles.tagMute}`}>{label(r.kind)}</span>
              </div>

              <div className={styles.woCardMain}>
                <header className={styles.woHead}>
                  <div style={{ minWidth: 0 }}>
                    <h3 className={styles.woTitle}>{r.tenderTitle ?? "(no tender title)"}</h3>
                    <div className={styles.woMeta}>
                      {r.agency ?? "—"} · captured {fmtDate(r.createdAt)} · via {label(r.capturedFrom)}
                    </div>
                  </div>
                  <span className={`${styles.tag} ${stateTag(r.state)}`}>{r.state}</span>
                </header>

                <div className={styles.woQaLine} style={{ flexWrap: "wrap", gap: "8px" }}>
                  {r.outcome && <span className={`${styles.tag} ${outcomeTag(r.outcome)}`}>{label(r.outcome)}</span>}
                  {r.predictedBand && (
                    <span className={styles.mono}>
                      predicted {r.predictedBand}
                      {r.predictedScore != null && r.predictedMax != null
                        ? ` · ${r.predictedScore.toFixed(0)}/${r.predictedMax.toFixed(0)}`
                        : ""}
                    </span>
                  )}
                  {r.calibration && r.calibration !== "n/a" && (
                    <span className={`${styles.tag} ${calibrationTag(r.calibration)}`}>{r.calibration}</span>
                  )}
                </div>

                {r.detail && <p className={styles.woColValue} style={{ marginTop: 8 }}>{r.detail}</p>}

                <div className={styles.woStatusRow} style={{ marginTop: 10, gap: 8 }}>
                  {r.state !== "promoted" && (
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      disabled={savingId === r.id}
                      onClick={() => curate(r.id, "promoted")}
                    >
                      {savingId === r.id ? "…" : "Promote →"}
                    </button>
                  )}
                  {r.state !== "rejected" && (
                    <button
                      type="button"
                      className={styles.btnGhost}
                      disabled={savingId === r.id}
                      onClick={() => curate(r.id, "rejected")}
                    >
                      Reject
                    </button>
                  )}
                  {r.reviewedAt && (
                    <span className={styles.mono} style={{ fontSize: 11, opacity: 0.6 }}>
                      reviewed {fmtDate(r.reviewedAt)}
                    </span>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
