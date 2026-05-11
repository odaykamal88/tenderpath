import type { ReportData } from "../ReportDocument";
import styles from "./pdf.module.css";

export function ScorecardPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>03 · Scorecard by dimension</span>
      <h2 className={styles.h2}>Five weighted dimensions. Compliance is the lever.</h2>
      {data.dimensions.map((d, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{d.label}</span>
            <span className={styles.dimValue}>{d.value}</span>
          </div>
          <div className={styles.dimBar}>
            <span style={{ width: `${d.value}%`, background: d.value < 60 ? "var(--tp2-neg)" : "var(--tp2-ink)" }} />
            <span className={styles.dimPeer} style={{ left: `${d.peer}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function GapsPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>04 · Compliance gaps</span>
      <h2 className={styles.h2}>Close these gaps to unlock the next tier.</h2>
      {data.gaps.map((g, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{g.title}</span>
            <span className={styles.dimValue}>+{g.lift}</span>
          </div>
          <div className={styles.fixWhy}>{g.unlock}</div>
        </div>
      ))}
    </section>
  );
}

export function TendersPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>05 · Matched tenders</span>
      <h2 className={styles.h2}>Your best opportunities, ranked by fit.</h2>
      {data.tenders.map((t, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{t.title}</span>
            <span className={styles.dimValue}>{t.fit}</span>
          </div>
          <div className={styles.fixMeta}>{t.value} · due {t.due}</div>
        </div>
      ))}
    </section>
  );
}

export function GrantsPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>06 · Matched grants</span>
      <h2 className={styles.h2}>Grant opportunities aligned to your profile.</h2>
      {data.grants.map((g, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{g.title}</span>
            <span className={styles.dimValue}>{g.value}</span>
          </div>
          <div className={styles.fixMeta}>{g.status} · due {g.due}</div>
        </div>
      ))}
    </section>
  );
}

export function NextPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>07 · 90-day plan</span>
      <h2 className={styles.h2}>A sequenced plan to lift your score.</h2>
      {data.plan.map((p, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{p.task}</span>
            <span className={styles.dimValue}>Day {p.startDay}–{p.endDay}</span>
          </div>
          <div className={styles.fixMeta}>{p.owner}</div>
        </div>
      ))}
    </section>
  );
}

export function AppendixPage({ data }: { data: ReportData }) {
  return (
    <section className={`tp2-pdf-page ${styles.page}`}>
      <span className={styles.eyebrow}>08 · Sources &amp; citations</span>
      <h2 className={styles.h2}>Evidence behind your score.</h2>
      {data.citations.map((c, i) => (
        <div key={i} className={styles.dimRow}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{c.title}</span>
            <span className={styles.fixMeta}>{c.scope}</span>
          </div>
          <div className={styles.fixWhy}>{c.url}</div>
        </div>
      ))}
    </section>
  );
}
