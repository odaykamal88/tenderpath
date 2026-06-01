"use client";

/**
 * /admin/proposal-health — the proposal pipeline monitor (Phase 2b).
 *
 * One grouped view of pipeline health: did runs complete, are the scores valid
 * and honest (per-run integrity verdicts), are we capturing outcomes and
 * chasing losses, is the score calibrated yet, and how deep is the curation
 * queue. The "agent that monitors everything is running smoothly and in
 * compliance, a valid score".
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";

interface LossPattern {
  criterionId: string;
  count: number;
  agencies: string[];
  samples: string[];
}

interface Health {
  status: "ok" | "degraded";
  generation: { ready: number; needs_remediation: number; failed: number; rubric_stale: number; pending: number; generating: number; total: number };
  integrity: { assessed: number; ok: number; flagged: number; noVerdict: number; byCategory: { incomplete: number; score_validity: number; honest_claim: number; other: number } };
  outcomes: { readyPackages: number; captured: number; captureRatePct: number; byOutcome: Record<string, number> };
  calibration: { totalOutcomes: number; sampleSize: number; aligned: number; optimistic: number; pessimistic: number; optimisticRate: number; alignedRate: number; calibrated: boolean; note: string };
  lossPatterns: LossPattern[];
  curationQueueDepth: number;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "pos" | "neg" | "warn" | "mute" }) {
  const cls = tone === "pos" ? styles.posNum : tone === "neg" ? styles.negNum : tone === "warn" ? styles.warnNum : tone === "mute" ? styles.muteNum : "";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
      <span>{label}</span>
      <span className={`${styles.mono} ${cls}`}>{value}</span>
    </div>
  );
}

export default function ProposalHealthPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/proposal-health", { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData((await res.json()) as Health);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>07 — Health</div>
          <h1 className={styles.pageTitle}>Proposal pipeline health</h1>
          <p className={styles.pageSub}>
            Did runs complete, are the scores valid + honest, are we capturing outcomes (and chasing
            losses), is the score calibrated yet, and how deep is the curation queue.
          </p>
        </div>
        <div className={styles.pageActions}>
          {data && (
            <span className={`${styles.tag} ${data.status === "ok" ? styles.tagPos : styles.tagWarn}`}>
              {data.status === "ok" ? "Healthy" : "Degraded"}
            </span>
          )}
          <button type="button" className={styles.btnGhost} onClick={load}>
            Refresh
          </button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      {loading ? (
        <div className={styles.woEmpty}>Loading health…</div>
      ) : !data ? (
        <div className={styles.woEmpty}>No data.</div>
      ) : (
        <>
          <section className={styles.heroRow}>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Proposals generated</div>
              <div className={styles.heroStatValue}>{data.generation.total}</div>
              <div className={styles.heroStatMeta}>{data.generation.ready} ready</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Integrity flagged</div>
              <div className={styles.heroStatValue}>
                {data.integrity.flagged > 0 ? <span className={styles.warnNum}>{data.integrity.flagged}</span> : 0}
              </div>
              <div className={styles.heroStatMeta}>of {data.integrity.assessed} assessed</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Outcome capture</div>
              <div className={styles.heroStatValue}>{data.outcomes.captureRatePct}%</div>
              <div className={styles.heroStatMeta}>{data.outcomes.captured} of {data.outcomes.readyPackages} delivered</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Curation queue</div>
              <div className={styles.heroStatValue}>{data.curationQueueDepth}</div>
              <div className={styles.heroStatMeta}>
                <Link href="/admin/feedback">pending review →</Link>
              </div>
            </div>
          </section>

          <section className={styles.grid2}>
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitle}>Generation status</div>
              </div>
              <div className={styles.panelBody}>
                <Row label="Ready" value={data.generation.ready} tone="pos" />
                <Row label="Needs remediation" value={data.generation.needs_remediation} tone={data.generation.needs_remediation > 0 ? "warn" : "mute"} />
                <Row label="Rubric stale" value={data.generation.rubric_stale} tone={data.generation.rubric_stale > 0 ? "warn" : "mute"} />
                <Row label="Failed" value={data.generation.failed} tone={data.generation.failed > 0 ? "neg" : "mute"} />
                <Row label="In flight (pending + generating)" value={data.generation.pending + data.generation.generating} tone="mute" />
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitle}>Run integrity (last {data.integrity.assessed + data.integrity.noVerdict})</div>
              </div>
              <div className={styles.panelBody}>
                <Row label="Clean" value={data.integrity.ok} tone="pos" />
                <Row label="Incomplete (silent partial)" value={data.integrity.byCategory.incomplete} tone={data.integrity.byCategory.incomplete > 0 ? "neg" : "mute"} />
                <Row label="Score validity (shaky / indicative)" value={data.integrity.byCategory.score_validity} tone={data.integrity.byCategory.score_validity > 0 ? "warn" : "mute"} />
                <Row label="Honest-claim (overpromise in draft)" value={data.integrity.byCategory.honest_claim} tone={data.integrity.byCategory.honest_claim > 0 ? "neg" : "mute"} />
                <Row label="No verdict (pre-monitor packages)" value={data.integrity.noVerdict} tone="mute" />
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitle}>Outcomes (chase losses)</div>
              </div>
              <div className={styles.panelBody}>
                <Row label="Won" value={data.outcomes.byOutcome.won} tone="pos" />
                <Row label="Shortlisted" value={data.outcomes.byOutcome.shortlisted} tone="pos" />
                <Row label="Lost" value={data.outcomes.byOutcome.lost} tone="neg" />
                <Row label="Disqualified" value={data.outcomes.byOutcome.disqualified} tone="neg" />
                <Row label="Did not submit" value={data.outcomes.byOutcome.withdrawn} tone="mute" />
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitle}>Score calibration (B2)</div>
              </div>
              <div className={styles.panelBody}>
                <Row label="Decided sample" value={data.calibration.sampleSize} tone="mute" />
                <Row label="Aligned" value={`${data.calibration.aligned} (${Math.round(data.calibration.alignedRate * 100)}%)`} tone="pos" />
                <Row label="Optimistic misses" value={`${data.calibration.optimistic} (${Math.round(data.calibration.optimisticRate * 100)}%)`} tone={data.calibration.optimistic > 0 ? "warn" : "mute"} />
                <Row label="Calibrated (B3 gate)" value={data.calibration.calibrated ? "yes" : "not yet"} tone={data.calibration.calibrated ? "pos" : "mute"} />
                <p className={styles.panelSub} style={{ marginTop: 8 }}>{data.calibration.note}</p>
              </div>
            </div>
          </section>

          {data.lossPatterns.length > 0 && (
            <section className={styles.panel} style={{ marginTop: 16 }}>
              <div className={styles.panelHead}>
                <div className={styles.panelTitle}>Systematic weaknesses (Loop 2)</div>
              </div>
              <div className={styles.panelBody}>
                <p className={styles.panelSub} style={{ marginTop: 0, marginBottom: 8 }}>
                  Criteria flagged across multiple drafts. A criterion that recurs is one systematic
                  weakness in rubric extraction or drafting — fix it once and every future draft benefits.
                </p>
                {data.lossPatterns.map((p) => (
                  <div key={p.criterionId} style={{ padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>
                        <b>{p.criterionId}</b>
                        {p.agencies.length > 0 && <span className={styles.mute}> · {p.agencies.join(", ")}</span>}
                      </span>
                      <span className={`${styles.mono} ${p.count >= 3 ? styles.warnNum : styles.muteNum}`}>
                        {p.count} draft{p.count === 1 ? "" : "s"}
                      </span>
                    </div>
                    {p.samples.length > 0 && (
                      <div className={styles.mute} style={{ fontSize: 12, marginTop: 2 }}>
                        {p.samples[0]}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
