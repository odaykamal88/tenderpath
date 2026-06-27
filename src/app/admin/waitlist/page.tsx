"use client";

/* Invite requests — emails captured from the invite-only landing page
 * (waitlist_signups), newest first. Mirrors the admin dossier style. */

import { useEffect, useState, useCallback } from "react";
import styles from "../admin.module.css";

interface Signup {
  id: number;
  email: string;
  source: string | null;
  created_at: string;
}

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function WaitlistPage() {
  const [signups, setSignups] = useState<Signup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/waitlist", { headers: authHeaders() });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setSignups(data.signups ?? []);
      setTotal(Number(data.total) || 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load invite requests");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <header className={styles.pageHeader}>
        <div>
          <div className={styles.eyebrow}>09 — Invites</div>
          <h1 className={styles.pageTitle}>Invite requests</h1>
          <p className={styles.pageSub}>Emails captured from the invite-only landing page.</p>
        </div>
        <div className={styles.pageActions}>
          <button type="button" className={styles.btnGhost} onClick={load}>Refresh</button>
        </div>
      </header>

      {error && <div className={`${styles.toast} ${styles.toastErr}`}>{error}</div>}

      <section className={styles.heroRow} style={{ marginBottom: 24 }}>
        <div className={styles.heroStat}>
          <div className={styles.heroStatLabel}>Total requests</div>
          <div className={styles.heroStatValue}>{total.toLocaleString("en-US")}</div>
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h2 className={styles.panelTitle}>All requests</h2>
          <span className={styles.panelMeta}>{signups ? `${signups.length} shown` : "Loading…"}</span>
        </header>
        {!signups ? (
          <div className={styles.woEmpty}>Loading…</div>
        ) : signups.length === 0 ? (
          <div className={styles.woEmpty}>No invite requests yet.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.dossierTable}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Email</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {signups.map((s) => (
                  <tr key={s.id}>
                    <td className={styles.mono}>{fmtDate(s.created_at)}</td>
                    <td className={styles.mono}>{s.email}</td>
                    <td>{s.source ?? "—"}</td>
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
