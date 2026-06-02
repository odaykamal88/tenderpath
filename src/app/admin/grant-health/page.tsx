"use client";

/**
 * /admin/grant-health — the grant-source monitor.
 *
 * The grants pipeline's blind spot, fixed: per-source open counts, future-vs-stale
 * split, last-refresh freshness, and field quality — so a source silently decaying
 * to zero or going stale is visible, not invisible (the Grants.gov failure mode).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";

type Health = "ok" | "stale" | "all_past" | "empty" | "missing";

interface SourceRow {
  source: string;
  open: number;
  futureOpen: number;
  staleOpen: number;
  refreshedRecently: number;
  lastRefresh: string | null;
  qualityPct: { richDesc: number; themes: number; eligibility: number; sourceUrl: number };
  health: Health;
  flags: string[];
}

interface Data {
  status: "ok" | "degraded";
  generatedAt: string;
  totals: { sources: number; open: number; futureOpen: number; staleOpen: number };
  alwaysOn: string[];
  sources: SourceRow[];
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function healthMeta(h: Health): { label: string; color: string } {
  switch (h) {
    case "ok": return { label: "Healthy", color: "#16a34a" };
    case "stale": return { label: "Stale", color: "#dc2626" };
    case "all_past": return { label: "All past deadline", color: "#dc2626" };
    case "missing": return { label: "Missing", color: "#dc2626" };
    case "empty": return { label: "Empty", color: "#d97706" };
  }
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ background: color, color: "#fff", borderRadius: 999, fontSize: 11, fontWeight: 600, lineHeight: 1, padding: "4px 9px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export default function GrantHealthPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/grant-health", { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData((await res.json()) as Data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load grant health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const healthy = data?.sources.filter((s) => s.health === "ok").length ?? 0;
  const problems = data?.sources.filter((s) => s.health === "stale" || s.health === "all_past" || s.health === "missing").length ?? 0;
  const lastRefresh = data?.sources.reduce<string | null>((acc, s) => (s.lastRefresh && (!acc || s.lastRefresh > acc) ? s.lastRefresh : acc), null) ?? null;

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>09 — Grant Health</div>
          <h1 className={styles.pageTitle}>Grant-source health</h1>
          <p className={styles.pageSub}>
            Per-source open counts, future-vs-stale split, last-refresh freshness, and field quality —
            so a source silently decaying to zero or going stale is visible, not invisible.
          </p>
        </div>
        <div className={styles.pageActions}>
          {data && (
            <span className={`${styles.tag} ${data.status === "ok" ? styles.tagPos : styles.tagWarn}`}>
              {data.status === "ok" ? "Healthy" : "Degraded"}
            </span>
          )}
          <button type="button" className={styles.btnGhost} onClick={load}>Refresh</button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      {loading ? (
        <div className={styles.woEmpty}>Loading grant health…</div>
      ) : !data ? (
        <div className={styles.woEmpty}>No data.</div>
      ) : (
        <>
          <section className={styles.heroRow}>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Open grants</div>
              <div className={styles.heroStatValue}>{data.totals.open}</div>
              <div className={styles.heroStatMeta}>{data.totals.futureOpen} with a future deadline</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Sources healthy</div>
              <div className={styles.heroStatValue}>{healthy}<span className={styles.mute} style={{ fontSize: 16 }}> / {data.totals.sources}</span></div>
              <div className={styles.heroStatMeta}>producing fresh, future-dated rows</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Needs attention</div>
              <div className={styles.heroStatValue}>
                {problems > 0 ? <span className={styles.negNum}>{problems}</span> : 0}
              </div>
              <div className={styles.heroStatMeta}>stale / all-past / missing</div>
            </div>
            <div className={styles.heroStat}>
              <div className={styles.heroStatLabel}>Last refresh</div>
              <div className={styles.heroStatValue} style={{ fontSize: 22 }}>{relTime(lastRefresh)}</div>
              <div className={styles.heroStatMeta}>most recent grants cron write</div>
            </div>
          </section>

          {data.totals.staleOpen > 0 && (
            <div className={`${styles.toast} ${styles.toastErr}`} style={{ marginBottom: 12 }}>
              {data.totals.staleOpen} open grant{data.totals.staleOpen === 1 ? "" : "s"} are past their deadline but still marked open — the grants cron expiry may not be running.
            </div>
          )}

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div className={styles.panelTitle}>Sources</div>
            </div>
            <div className={styles.panelBody}>
              {data.sources.map((s) => {
                const meta = healthMeta(s.health);
                return (
                  <div key={s.source} style={{ padding: "10px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{s.source}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`${styles.mono} ${styles.mute}`} style={{ fontSize: 12 }}>
                          {s.open} open · {s.futureOpen} future · refreshed {relTime(s.lastRefresh)}
                        </span>
                        <Pill color={meta.color}>{meta.label}</Pill>
                      </span>
                    </div>
                    <div className={`${styles.mono} ${styles.mute}`} style={{ fontSize: 11, marginTop: 4 }}>
                      quality — desc {s.qualityPct.richDesc}% · themes {s.qualityPct.themes}% · eligibility {s.qualityPct.eligibility}% · url {s.qualityPct.sourceUrl}%
                    </div>
                    {s.flags.length > 0 && (
                      <div style={{ fontSize: 12, marginTop: 4, color: s.health === "ok" || s.health === "empty" ? "#92929c" : "#dc2626" }}>
                        {s.flags.join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className={styles.panelSub} style={{ marginTop: 8 }}>
              Always-on sources ({data.alwaysOn.join(", ")}) should never be empty. IFAD and the per-funder MENA rows can
              legitimately be zero between posting cycles. Trigger a refresh with{" "}
              <Link href="/admin/source-health">the tender source view</Link> nearby for the crawl side.
            </p>
          </section>
        </>
      )}
    </>
  );
}
