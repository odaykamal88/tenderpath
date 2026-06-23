"use client";

import { useCallback, useEffect, useState, type ReactNode, type FormEvent } from "react";
import styles from "./data-room.module.css";
import { AreaLine, Bars, Donut, Funnel, ProportionBars } from "@/components/data-room/charts";
import type { DataRoomMetrics, KpiDelta } from "@/lib/data-room/metrics";

// ── formatting ──────────────────────────────────────────────────────────────
const fmtNum = (n: number) => Number(n).toLocaleString("en-US");
const fmtUsd = (n: number) => "$" + Number(n).toLocaleString("en-US");
function fmtUsdK(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return "$" + (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return "$" + n;
}

const SEGMENT_COLORS = [
  "var(--color-accent)",
  "var(--color-gold-light)",
  "var(--color-green)",
  "var(--color-ink-2)",
  "var(--color-gold-dark)",
  "var(--color-red)",
];

function bearerHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

// ── small presentational pieces ─────────────────────────────────────────────
function DeltaBadge({ d }: { d: KpiDelta }) {
  if (d.deltaPct === null) {
    return d.value > 0 ? (
      <span className={`${styles.delta} ${styles.deltaNew}`}>NEW</span>
    ) : (
      <span className={`${styles.delta} ${styles.deltaFlat}`}>—</span>
    );
  }
  const up = d.deltaPct > 0;
  const down = d.deltaPct < 0;
  return (
    <span className={`${styles.delta} ${up ? styles.deltaUp : down ? styles.deltaDown : styles.deltaFlat}`}>
      {up ? "▲" : down ? "▼" : "●"} {Math.abs(d.deltaPct)}%
    </span>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub?: ReactNode; accent?: boolean }) {
  return (
    <div className={`${styles.kpiCard} ${accent ? styles.accent : ""}`}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {sub && <div className={styles.kpiSub}>{sub}</div>}
    </div>
  );
}

function MomentumCell({ label, d, money }: { label: string; d: KpiDelta; money?: boolean }) {
  return (
    <div className={styles.momentumCell}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.momentumValue}>{money ? fmtUsd(d.value) : fmtNum(d.value)}</div>
      <div style={{ marginTop: 4 }}>
        <DeltaBadge d={d} /> <span style={{ color: "var(--color-ink-3)", fontSize: 10.5 }}>vs prior 30d</span>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────
export default function DataRoomPage() {
  const [metrics, setMetrics] = useState<DataRoomMetrics | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/data-room/metrics", { headers: bearerHeaders(), cache: "no-store" });
      if (res.status === 401) {
        setLocked(true);
        setMetrics(null);
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setMetrics(await res.json());
      setLocked(false);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/data-room/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword("");
        await loadMetrics();
      } else {
        const data = await res.json().catch(() => ({}));
        setErr(data.error || "Incorrect password");
      }
    } catch {
      setErr("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const lock = async () => {
    await fetch("/api/data-room/logout", { method: "POST" }).catch(() => {});
    setMetrics(null);
    setLocked(true);
  };

  // ── Gate ──────────────────────────────────────────────────────────────────
  if (locked || (!metrics && !loading)) {
    return (
      <div className={styles.page}>
        <div className={styles.gate}>
          <div className={styles.gateCard}>
            <div className={styles.gateBrand}>Tender<b>Path</b></div>
            <div className={styles.gateEyebrow}>Investor Data Room</div>
            <div className={styles.gateTitle}>Private access</div>
            <p className={styles.gateSub}>Enter the access password to view live company metrics.</p>
            <form className={styles.gateForm} onSubmit={submit}>
              <input
                className={styles.input}
                type="password"
                placeholder="Access password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                aria-label="Access password"
              />
              <div className={styles.gateErr}>{err}</div>
              <button type="submit" className={styles.btnPrimary} disabled={submitting || !password}>
                {submitting ? "Verifying…" : "Enter data room"}
              </button>
            </form>
            <div className={styles.gateFoot}>
              Confidential. The figures inside are drawn live from production and intended for
              prospective investors under NDA.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading || !metrics) {
    return (
      <div className={styles.page}>
        <div className={styles.room}>
          <div className={styles.skeleton} style={{ height: 64, marginBottom: 28 }} />
          <div className={styles.kpiRow}>
            {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skeleton} style={{ height: 92 }} />)}
          </div>
          <div className={styles.skeleton} style={{ height: 240, marginTop: 28 }} />
          {loadError && <p className={styles.empty} style={{ color: "var(--color-red)" }}>{loadError}</p>}
        </div>
      </div>
    );
  }

  const m = metrics;
  const h = m.headline;

  // Revenue mix → top 5 + Other, with colors
  const mixTop = m.revenueMix.slice(0, 5);
  const mixOther = m.revenueMix.slice(5).reduce((s, r) => s + r.amountUsd, 0);
  const mixSegments = [
    ...mixTop.map((r, i) => ({ label: r.label, value: r.amountUsd, color: SEGMENT_COLORS[i] })),
    ...(mixOther > 0 ? [{ label: "Other", value: mixOther, color: SEGMENT_COLORS[5] }] : []),
  ];

  const generated = new Date(m.generatedAt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={styles.page}>
      <div className={styles.room}>
        {/* Masthead */}
        <header className={styles.masthead}>
          <div>
            <div className={styles.eyebrow}>Investor Data Room</div>
            <h1 className={styles.title}>TenderPath — by the numbers</h1>
            <p className={styles.subtitle}>Procurement intelligence for the development &amp; humanitarian sector.</p>
          </div>
          <div className={styles.mastheadRight}>
            <span className={styles.confidential}>● Confidential · Live</span>
            <span className={`${styles.panelMeta}`}>Updated {generated}</span>
            <button type="button" className={styles.btnGhost} onClick={lock}>Lock ↗</button>
          </div>
        </header>

        {/* Headline KPIs */}
        <div className={styles.kpiRow}>
          <Kpi label="Total users" value={fmtNum(h.totalUsers)} sub={h.newUsersThisMonth > 0 ? <><b>+{fmtNum(h.newUsersThisMonth)}</b> this month</> : "since launch"} />
          <Kpi label="Assessments run" value={fmtNum(h.totalAssessments)} sub={h.avgReadiness != null ? `avg readiness ${h.avgReadiness}/100` : "company fit scans"} />
          <Kpi label="Active paid subs" value={fmtNum(h.activeSubscriptions)} sub={`${fmtUsd(h.mrrUsd)}/mo recurring`} />
          <Kpi label="Revenue collected" value={fmtUsd(h.revenueUsd)} sub="realized to date" accent />
        </div>
        <div className={styles.kpiRow} style={{ marginTop: 14 }}>
          <Kpi label="Est. ARR" value={fmtUsd(h.arrUsd)} sub="MRR × 12" accent />
          <Kpi label="Paying customers" value={fmtNum(h.payingCustomers)} sub="distinct buyers" />
          <Kpi label="Paid orders" value={fmtNum(h.paidOrders)} sub="services delivered" />
          <Kpi label="Submissions" value={fmtNum(h.submissions)} sub="bids prepared" />
        </div>

        {/* Momentum */}
        <div className={styles.sectionLabel}>Momentum · last 30 days</div>
        <div className={styles.momentum}>
          <MomentumCell label="New users" d={m.momentum.newUsers} />
          <MomentumCell label="Assessments" d={m.momentum.assessments} />
          <MomentumCell label="Revenue" d={m.momentum.revenueUsd} money />
          <MomentumCell label="Paid orders" d={m.momentum.paidOrders} />
        </div>

        {/* Growth */}
        <div className={styles.sectionLabel}>Growth</div>
        <div className={styles.grid2}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>User growth</h2>
              <span className={styles.panelMeta}>cumulative · 12 mo</span>
            </div>
            <div className={styles.chartWrap}>
              <AreaLine points={m.series.userCumulative} gradientId="g-users" format={fmtNum} />
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Revenue / month</h2>
              <span className={styles.panelMeta}>realized · 12 mo</span>
            </div>
            <div className={styles.chartWrap}>
              <Bars points={m.series.revenueUsd} format={fmtUsdK} tipFormat={fmtUsd} />
            </div>
          </section>
        </div>

        <div className={styles.grid2} style={{ marginTop: 16 }}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Assessments / month</h2>
              <span className={styles.panelMeta}>{fmtNum(h.totalAssessments)} all-time</span>
            </div>
            <div className={styles.chartWrap}>
              <Bars points={m.series.assessments} format={fmtNum} />
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Unique visitors / month</h2>
              <span className={styles.panelMeta}>{fmtNum(m.traffic.trackedVisitors)} tracked · {fmtNum(m.traffic.demoSessions)} demo</span>
            </div>
            <div className={styles.chartWrap}>
              <Bars points={m.series.visitors} format={fmtNum} />
            </div>
          </section>
        </div>

        {/* Activation funnel */}
        <div className={styles.sectionLabel}>Activation funnel · all-time</div>
        <section className={styles.panel}>
          {m.funnel.every((s) => s.count === 0) ? (
            <div className={styles.empty}>Funnel telemetry will populate as users move through the product.</div>
          ) : (
            <Funnel steps={m.funnel} />
          )}
        </section>

        {/* Revenue mix + subscriptions */}
        <div className={styles.sectionLabel}>Revenue &amp; subscriptions</div>
        <div className={styles.grid2}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>{mixSegments.length === 0 ? "Product offerings" : "Revenue mix"}</h2>
              <span className={styles.panelMeta}>{mixSegments.length === 0 ? "pre-revenue" : "by product"}</span>
            </div>
            {mixSegments.length === 0 ? (
              <div>
                <p className={styles.offerIntro}>
                  Subscription plus per-bid services — live and ready to sell. No product sales yet, so revenue is $0.
                </p>
                <div className={styles.offerList}>
                  {m.offerings.map((o) => (
                    <div key={o.key} className={styles.offerRow}>
                      <div style={{ minWidth: 0 }}>
                        <div className={styles.offerName}>{o.label}</div>
                        <div className={styles.offerNote}>{o.note}</div>
                      </div>
                      <div className={styles.offerPrice}>{o.price}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.donutRow}>
                <Donut segments={mixSegments} centerLabel={fmtUsdK(h.revenueUsd)} centerSub="total" format={fmtUsd} />
                <div className={styles.legend}>
                  {mixSegments.map((s) => (
                    <div key={s.label} className={styles.legendItem}>
                      <span className={styles.legendDot} style={{ background: s.color }} />
                      <span className={styles.legendLabel}>{s.label}</span>
                      <span className={styles.legendVal}>{fmtUsd(s.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.panelTitle}>Active subscriptions</h2>
              <span className={styles.panelMeta}>{fmtNum(h.activeSubscriptions)} seats · {fmtUsd(h.mrrUsd)}/mo</span>
            </div>
            {m.subscriptionsByTier.length === 0 ? (
              <div className={styles.empty}>No active subscriptions yet.</div>
            ) : (
              <ProportionBars
                rows={m.subscriptionsByTier.map((t, i) => ({
                  label: t.label,
                  value: t.count,
                  sub: "seats",
                  color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                }))}
                format={fmtNum}
              />
            )}
          </section>
        </div>

        {/* Supply / inventory */}
        <div className={styles.sectionLabel}>Live opportunity inventory</div>
        <div className={styles.supplyRow}>
          <div className={styles.supplyCard}>
            <div className={styles.kpiLabel}>Open tenders</div>
            <div className={styles.supplyValue}>{fmtNum(h.openTenders)}</div>
          </div>
          <div className={styles.supplyCard}>
            <div className={styles.kpiLabel}>Open grants</div>
            <div className={styles.supplyValue}>{fmtNum(h.openGrants)}</div>
          </div>
          <div className={styles.supplyCard}>
            <div className={styles.kpiLabel}>Sources integrated</div>
            <div className={styles.supplyValue}>{fmtNum(h.sources)}</div>
          </div>
          <div className={styles.supplyCard}>
            <div className={styles.kpiLabel}>Network pipeline</div>
            <div className={styles.supplyValue}>{fmtNum(h.networkCompanies)}</div>
          </div>
        </div>

        {/* Provenance */}
        <footer className={styles.foot}>
          <b>How these numbers are computed</b>
          <ul className={styles.footList}>
            {m.provenance.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </footer>
      </div>
    </div>
  );
}
