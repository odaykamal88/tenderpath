"use client";

/* TenderPath landing — shared kit: D2 "dossier" tokens, fonts, primitive atoms.
 *
 * Faithful TSX port of the design handoff's landing-kit.jsx, typed for the real
 * app. Same idiom as the shipped Workbench (src/components/workbench/tokens.ts):
 * inline styles keyed off the LC/LF constants; fonts resolve to the next/font
 * CSS variables set on <html> in app/layout.tsx. The palette is identical to the
 * Workbench's so the marketing surface and the product share one identity.
 *
 * The only behavioural difference from the prototype is routing: CTAs target the
 * real Next.js routes (/assessment, /login) and the AssessPaste box hands the
 * pasted site to the assessment wizard via ?site= (read in app/assessment/page). */

import { useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* ── tokens ─────────────────────────────────────────────────── */
export const LC = {
  ink: "#0f1620", ink2: "#2b3543", paper: "#f6f3ec", paper2: "#ece6d5",
  rule: "#d8d1bf", ruleSoft: "#e4ddcb", mute: "#6b6557", faint: "#8c8676",
  accent: "#9c6b1f", accent2: "#c8973e", pos: "#1f6b3d", warn: "#b3691a",
  neg: "#9c2a2a", blue: "#1c3a5f", white: "#ffffff",
  spine: "#0f1620", spineLine: "#26303d", spineDim: "#7d8794",
  // dark-panel support tones
  onDark: "#cdc6b3", onDarkMute: "#9aa3ad", darkLine: "#28323e", darkLine2: "#3a4654",
} as const;

export const LF = {
  display: "var(--font-fraunces), Georgia, serif",
  sans: "var(--font-inter), system-ui, -apple-system, sans-serif",
  mono: "var(--font-jetbrains), ui-monospace, Menlo, monospace",
} as const;

/* ── atoms ─────────────────────────────────────────────────── */
export function Eyebrow({
  children,
  color,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: LF.mono,
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: color || LC.accent,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

type BtnKind = "primary" | "gold" | "ghost" | "ghostDark";
type BtnSize = "sm" | "md" | "lg";

export function Btn({
  children,
  kind = "primary",
  size = "md",
  href = "#",
  onClick,
  style,
  ...rest
}: {
  children: ReactNode;
  kind?: BtnKind;
  size?: BtnSize;
  href?: string;
  onClick?: () => void;
  style?: CSSProperties;
  [key: string]: unknown;
}) {
  const base: CSSProperties = {
    fontFamily: LF.mono,
    fontSize: size === "lg" ? 13 : size === "sm" ? 11 : 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    border: "1px solid",
    padding: size === "lg" ? "16px 26px" : size === "sm" ? "10px 16px" : "13px 20px",
    transition: "all .16s",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    lineHeight: 1,
    textDecoration: "none",
    whiteSpace: "nowrap",
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary: { background: LC.ink, color: LC.paper, borderColor: LC.ink },
    gold: { background: LC.accent, color: LC.white, borderColor: LC.accent },
    ghost: { background: "transparent", color: LC.ink, borderColor: LC.rule },
    ghostDark: { background: "transparent", color: LC.paper, borderColor: LC.darkLine2 },
  };
  const merged = { ...base, ...kinds[kind], ...style };
  const isInternal = href.startsWith("/");
  if (isInternal) {
    return (
      <Link href={href} onClick={onClick} className="lk-btn" style={merged} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} onClick={onClick} className="lk-btn" style={merged} {...rest}>
      {children}
    </a>
  );
}

export function SectionTag({ n, label, color }: { n: string; label: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ fontFamily: LF.mono, fontSize: 12, letterSpacing: "0.18em", color: LC.accent }}>§{n}</span>
      <span style={{ width: 24, height: 1, background: color || LC.rule }} />
      <span
        style={{
          fontFamily: LF.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: color === LC.paper ? LC.onDarkMute : LC.mute,
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* a section wrapper that centers content with consistent gutters */
export function Container({
  children,
  style,
  max = 1180,
}: {
  children: ReactNode;
  style?: CSSProperties;
  max?: number;
}) {
  return (
    <div className="lk-container" style={{ maxWidth: max, margin: "0 auto", padding: "0 24px", ...style }}>
      {children}
    </div>
  );
}

/* tiny line icon set */
export type IcName =
  | "target" | "compass" | "paste" | "doc" | "check"
  | "bolt" | "shield" | "arrow" | "clock" | "layers";

export function Ic({ name, size = 18, color = "currentColor" }: { name: IcName; size?: number; color?: string }) {
  const p = {
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IcName, ReactNode> = {
    target: (<><circle {...p} cx="9" cy="9" r="6.5" /><circle {...p} cx="9" cy="9" r="3" /><circle cx="9" cy="9" r="1" fill={color} stroke="none" /></>),
    compass: (<><circle {...p} cx="9" cy="9" r="6.5" /><path {...p} d="M11.5 6.5l-1.4 3.6L6.5 11.5l1.4-3.6z" /></>),
    paste: (<><rect {...p} x="4" y="3" width="10" height="12" rx="1" /><path {...p} d="M6.5 6.5h5M6.5 9h5M6.5 11.5h3" /></>),
    doc: (<><path {...p} d="M5 2.5h5l3 3v8.5a.5.5 0 01-.5.5H5a.5.5 0 01-.5-.5v-11A.5.5 0 015 2.5z" /><path {...p} d="M10 2.5V6h3" /><path {...p} d="M6.5 9h5M6.5 11.5h4" /></>),
    check: (<><path {...p} d="M3.5 9.5l3.5 3.5 7.5-8" /></>),
    bolt: (<><path {...p} d="M9.5 2L4 10h4l-1.5 6 5.5-8H8z" /></>),
    shield: (<><path {...p} d="M9 2.5l5 2v4c0 3.5-2.4 5.6-5 6.5-2.6-.9-5-3-5-6.5v-4z" /><path {...p} d="M6.5 8.5l1.8 1.8L11.5 7" /></>),
    arrow: (<><path {...p} d="M3.5 9h11M10 4.5L14.5 9 10 13.5" /></>),
    clock: (<><circle {...p} cx="9" cy="9" r="6.5" /><path {...p} d="M9 5.5V9l2.5 1.5" /></>),
    layers: (<><path {...p} d="M9 2.5l6.5 3.5L9 9.5 2.5 6z" /><path {...p} d="M2.5 9.5L9 13l6.5-3.5" /></>),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" style={{ display: "block", flexShrink: 0 }}>
      {paths[name]}
    </svg>
  );
}

/* ── free-assessment paste box → routes to /assessment?site= ──── */
export function AssessPaste({
  dark = false,
  autoFocus = false,
  note = "Free readiness score in ~60s · no signup, no card",
}: {
  dark?: boolean;
  autoFocus?: boolean;
  note?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState("");
  const go = () => {
    const c = v.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    // The wizard reads ?site= to pre-fill its Step 00 URL and auto-crawl, and
    // ?goal= to pre-select the intent chip. Empty → the wizard's own entry step.
    router.push(c ? `/assessment?site=${encodeURIComponent(c)}&goal=track-tenders` : "/assessment?goal=track-tenders");
  };
  const ink = dark ? LC.paper : LC.ink;
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
      <div
        style={{
          display: "flex",
          border: `2px solid ${dark ? LC.paper : LC.ink}`,
          background: dark ? "rgba(255,255,255,0.05)" : LC.white,
        }}
      >
        <span
          style={{
            padding: "0 4px 0 16px",
            display: "flex",
            alignItems: "center",
            color: dark ? LC.onDarkMute : LC.faint,
            fontFamily: LF.mono,
            fontSize: 14,
          }}
        >
          https://
        </span>
        <input
          autoFocus={autoFocus}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
          placeholder="yourcompany.org"
          spellCheck={false}
          aria-label="Your website"
          style={{
            flex: 1,
            border: 0,
            outline: "none",
            background: "transparent",
            fontFamily: LF.mono,
            fontSize: 15,
            color: ink,
            padding: "15px 6px 15px 0",
            minWidth: 0,
          }}
        />
        <button
          onClick={go}
          className="lk-btn"
          style={{
            background: dark ? LC.accent : LC.ink,
            color: dark ? LC.white : LC.paper,
            border: 0,
            padding: "0 24px",
            fontFamily: LF.mono,
            fontSize: 11.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Score me →
        </button>
      </div>
      <div
        style={{
          fontFamily: LF.mono,
          fontSize: 10.5,
          color: dark ? LC.onDarkMute : LC.mute,
          marginTop: 11,
          letterSpacing: "0.04em",
          textAlign: "center",
        }}
      >
        {note}
      </div>
    </div>
  );
}

/* ── invite-request capture → POST /api/waitlist ──────────────────────────── */
export function InviteCapture({
  dark = false,
  autoFocus = false,
  source = "landing",
  note = "Invite-only for now — we onboard teams in small batches.",
}: {
  dark?: boolean;
  autoFocus?: boolean;
  source?: string;
  note?: string;
}) {
  const [v, setV] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ink = dark ? LC.paper : LC.ink;

  const submit = async () => {
    const email = v.trim();
    if (!EMAIL.test(email)) {
      setErr("Enter a valid email address.");
      setState("error");
      return;
    }
    setState("busy");
    setErr(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, source }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(b.error ?? "Couldn't save your request. Please try again.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setErr("Couldn't reach the server. Please try again.");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
        <div
          style={{
            border: `2px solid ${dark ? LC.paper : LC.ink}`,
            background: dark ? "rgba(255,255,255,0.05)" : LC.white,
            padding: "16px 18px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: LC.pos, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Ic name="check" size={14} color="#fff" />
          </span>
          <span style={{ fontFamily: LF.sans, fontSize: 14.5, color: ink, lineHeight: 1.5 }}>
            You&rsquo;re on the list — we&rsquo;ll email your invite soon.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
      <div
        style={{
          display: "flex",
          border: `2px solid ${dark ? LC.paper : LC.ink}`,
          background: dark ? "rgba(255,255,255,0.05)" : LC.white,
        }}
      >
        <input
          type="email"
          autoFocus={autoFocus}
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            if (state === "error") setState("idle");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="you@company.org"
          spellCheck={false}
          aria-label="Your work email"
          style={{
            flex: 1,
            border: 0,
            outline: "none",
            background: "transparent",
            fontFamily: LF.mono,
            fontSize: 15,
            color: ink,
            padding: "15px 6px 15px 16px",
            minWidth: 0,
          }}
        />
        <button
          onClick={submit}
          disabled={state === "busy"}
          className="lk-btn"
          style={{
            background: dark ? LC.accent : LC.ink,
            color: dark ? LC.white : LC.paper,
            border: 0,
            padding: "0 24px",
            fontFamily: LF.mono,
            fontSize: 11.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            cursor: state === "busy" ? "default" : "pointer",
            whiteSpace: "nowrap",
            opacity: state === "busy" ? 0.6 : 1,
          }}
        >
          {state === "busy" ? "Sending…" : "Request invite →"}
        </button>
      </div>
      <div
        style={{
          fontFamily: LF.mono,
          fontSize: 10.5,
          color: state === "error" ? LC.neg : dark ? LC.onDarkMute : LC.mute,
          marginTop: 11,
          letterSpacing: "0.04em",
          textAlign: "center",
        }}
      >
        {state === "error" && err ? err : note}
      </div>
    </div>
  );
}
