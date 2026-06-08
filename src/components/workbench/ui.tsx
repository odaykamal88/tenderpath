/* Workbench UI atoms + date/fit helpers. Faithful ports of the design
   prototype's shared atoms (tp-data.jsx), typed for the real app. Presentational
   only — safe to use inside any client tree. */
import type { CSSProperties, ReactNode } from "react";
import { C, F } from "./tokens";

/* ── helpers ─────────────────────────────────────────────────── */
const DAY = 86_400_000;

export function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / DAY);
}
export function deadlineLabel(d: string | null | undefined): string {
  const x = daysUntil(d);
  if (x == null) return "No deadline";
  if (x < 0) return "Closed";
  if (x === 0) return "Due today";
  if (x === 1) return "1 day";
  return x + " days";
}
export function shortDate(d: string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "—";
  return x.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
export function isSoon(d: string | null | undefined): boolean {
  const x = daysUntil(d);
  return x != null && x >= 0 && x <= 7;
}
export function fitColor(s: number): string {
  return s >= 75 ? C.pos : s >= 60 ? C.ink : s >= 45 ? C.warn : C.mute;
}
export function sevColor(s: string): string {
  return s === "high" ? C.neg : s === "medium" ? C.warn : C.mute;
}

/* ── atoms ───────────────────────────────────────────────────── */
export function Eyebrow({
  children,
  color = C.mute,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Card({
  children,
  style,
  pad = 0,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
}) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: pad, ...style }}>
      {children}
    </div>
  );
}

type BtnKind = "primary" | "ghost" | "gold" | "danger";
export function Btn({
  children,
  kind = "primary",
  size = "md",
  onClick,
  style,
  full,
  disabled,
  title,
  type = "button",
}: {
  children: ReactNode;
  kind?: BtnKind;
  size?: "sm" | "md";
  onClick?: () => void;
  style?: CSSProperties;
  full?: boolean;
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
}) {
  const base: CSSProperties = {
    fontFamily: F.mono,
    fontSize: size === "sm" ? 10.5 : 11.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: disabled ? "default" : "pointer",
    border: "1px solid",
    padding: size === "sm" ? "7px 12px" : "11px 18px",
    transition: "all .15s",
    width: full ? "100%" : undefined,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    lineHeight: 1.15,
    whiteSpace: "nowrap",
    opacity: disabled ? 0.45 : 1,
    pointerEvents: disabled ? "none" : undefined,
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary: { background: C.ink, color: C.paper, borderColor: C.ink },
    ghost: { background: "transparent", color: C.ink, borderColor: C.rule },
    gold: { background: C.accent, color: C.white, borderColor: C.accent },
    danger: { background: "transparent", color: C.neg, borderColor: "#e6c9c9" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} style={{ ...base, ...kinds[kind], ...style }}>
      {children}
    </button>
  );
}

export function FitBadge({ score, size = 14 }: { score: number; size?: number }) {
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: size,
        fontWeight: 600,
        color: fitColor(score),
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {score > 0 ? score : "—"}
    </span>
  );
}

export function SevDot({ severity, size = 7 }: { severity: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: sevColor(severity),
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function Bar({
  value,
  threshold = 60,
  height = 2,
  track = C.paper2,
}: {
  value: number;
  threshold?: number;
  height?: number;
  track?: string;
}) {
  const col = value < 50 ? C.neg : value < threshold + 15 ? C.warn : C.ink;
  return (
    <span style={{ position: "relative", display: "block", height, background: track }}>
      <span style={{ position: "absolute", inset: 0, width: `${Math.max(0, Math.min(100, value))}%`, background: col }} />
    </span>
  );
}

export function Chip({
  children,
  active,
  onClick,
  color,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: F.mono,
        fontSize: 10,
        letterSpacing: "0.06em",
        padding: "6px 11px",
        border: `1px solid ${active ? C.ink : C.rule}`,
        background: active ? C.ink : "transparent",
        color: active ? C.paper : color || C.ink2,
        cursor: "pointer",
        whiteSpace: "nowrap",
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

export function Tag({ children, color = C.mute }: { children: ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 9.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
        border: `1px solid ${C.ruleSoft}`,
        padding: "2px 6px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function DeadlinePill({ deadline }: { deadline: string | null | undefined }) {
  const soon = isSoon(deadline);
  return (
    <span
      style={{
        fontFamily: F.mono,
        fontSize: 11,
        color: soon ? C.neg : C.mute,
        fontWeight: soon ? 600 : 400,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {deadlineLabel(deadline)}
    </span>
  );
}

export function SectionHead({
  n,
  title,
  count,
  hint,
  action,
}: {
  n?: string;
  title: string;
  count?: number | null;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 20,
        borderBottom: `1px solid ${C.ink}`,
        paddingBottom: 12,
        marginBottom: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, minWidth: 0 }}>
        {n && (
          <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.18em", color: C.accent, flexShrink: 0 }}>
            §{n}
          </span>
        )}
        <h2 style={{ fontFamily: F.display, fontSize: 25, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, margin: 0 }}>
          {title}
        </h2>
        {count != null && (
          <span style={{ fontFamily: F.mono, fontSize: 12, color: C.faint }}>({String(count).padStart(2, "0")})</span>
        )}
      </div>
      {action ? action : hint ? <span style={{ fontFamily: F.sans, fontSize: 12, color: C.mute, flexShrink: 0 }}>{hint}</span> : null}
    </div>
  );
}

export function SectionHeadLite({
  n,
  title,
  count,
  hint,
  action,
}: {
  n: string;
  title: string;
  count?: number | null;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.16em", color: C.accent }}>§{n}</span>
        <h2 style={{ fontFamily: F.mono, fontSize: 13, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: C.ink2, margin: 0 }}>
          {title}
        </h2>
        {count != null && <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>({String(count).padStart(2, "0")})</span>}
      </div>
      {action ? action : hint ? <span style={{ fontFamily: F.sans, fontSize: 12, color: C.mute }}>{hint}</span> : null}
    </div>
  );
}

export function Avatar({ letter, size = 30 }: { letter: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: C.accent,
        color: C.white,
        fontFamily: F.display,
        fontSize: size * 0.46,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {letter}
    </div>
  );
}

/** Underlined mono link-button used throughout the dossier UI. */
export function LinkBtn({ children, onClick, style }: { children: ReactNode; onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: F.mono,
        fontSize: 10.5,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: C.ink,
        background: "none",
        border: 0,
        borderBottom: `1px solid ${C.ink}`,
        cursor: "pointer",
        padding: "0 0 2px",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
