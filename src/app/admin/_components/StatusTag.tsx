import styles from "../admin.module.css";

const TAG_CLASS: Record<string, string> = {
  healthy: styles.tagPos,
  success: styles.tagPos,
  completed: styles.tagPos,
  delivered: styles.tagPos,
  degraded: styles.tagWarn,
  running: styles.tagWarn,
  in_progress: styles.tagWarn,
  waiting_on_client: styles.tagWarn,
  new: styles.tagNew,
  down: styles.tagNeg,
  failed: styles.tagNeg,
  error: styles.tagNeg,
  critical: styles.tagNeg,
  canceled: styles.tagNeg,
  never_run: styles.tagMute,
  unconfigured: styles.tagMute,
  unreachable: styles.tagNeg,
  disabled: styles.tagMute,
};

const DOT_COLOR: Record<string, string> = {
  healthy: "var(--color-green)",
  success: "var(--color-green)",
  completed: "var(--color-green)",
  delivered: "var(--color-green)",
  degraded: "var(--color-warn, #c8973e)",
  running: "var(--color-warn, #c8973e)",
  in_progress: "var(--color-warn, #c8973e)",
  waiting_on_client: "var(--color-warn, #c8973e)",
  new: "var(--color-accent)",
  down: "var(--color-red)",
  failed: "var(--color-red)",
  error: "var(--color-red)",
  critical: "var(--color-red)",
  canceled: "var(--color-red)",
  never_run: "var(--color-mute, #8a8377)",
  unconfigured: "var(--color-mute, #8a8377)",
  unreachable: "var(--color-red)",
  disabled: "var(--color-mute, #8a8377)",
};

export function StatusDot({ status }: { status: string }) {
  const color = DOT_COLOR[status?.toLowerCase()] ?? "var(--color-mute, #8a8377)";
  return <span className={styles.statusDot} style={{ background: color }} />;
}

export function StatusTag({ status }: { status: string }) {
  const cls = TAG_CLASS[status?.toLowerCase()] ?? styles.tagMute;
  return (
    <span className={`${styles.tag} ${cls}`}>
      <StatusDot status={status} />
      {status?.replace(/_/g, " ")}
    </span>
  );
}

export function Sparkbar({ pct, tone = "pos" }: { pct: number; tone?: "pos" | "warn" | "neg" }) {
  const color =
    tone === "neg"  ? "var(--color-red)" :
    tone === "warn" ? "var(--color-accent)" :
                      "var(--color-green)";
  return (
    <div className={styles.sparkbar}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}
