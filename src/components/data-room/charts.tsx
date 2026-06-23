"use client";

/**
 * Investor data room — lightweight, dependency-free SVG charts.
 *
 * Hand-rolled (no chart lib) to match the existing Sparkbar approach and keep
 * the bundle lean. All charts use a fixed internal viewBox and scale to 100%
 * width; colors come from the global design tokens. Time-series charts expose
 * an interactive hover tooltip so any monthly point reports its exact value.
 */

import { useRef, useState, type PointerEvent } from "react";

export interface Point {
  month: string; // YYYY-MM
  value: number;
}

const W = 720;
const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(m: string): string {
  return MONTHS[Number(m.split("-")[1])] ?? "";
}
function monthLabelFull(m: string): string {
  const [y, mm] = m.split("-");
  return `${MONTHS[Number(mm)] ?? ""} ${y}`;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** Exclusive prefix sums: [a,b,c] -> [0,a,a+b]. Pure helper (not render scope). */
function prefixSums(values: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const v of values) {
    out.push(acc);
    acc += v;
  }
  return out;
}

// ── Floating tooltip (HTML overlay, crisp at any chart scale) ────────────────
function Tip({ x, y, label, value }: { x: number; y: number; label: string; value: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, calc(-100% - 10px))",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        background: "var(--color-ink)",
        color: "var(--color-paper)",
        borderRadius: 7,
        padding: "6px 10px",
        boxShadow: "0 6px 18px -6px rgba(20,16,10,0.5)",
        zIndex: 6,
      }}
    >
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: "0.08em", opacity: 0.7, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-serif)", fontSize: 16, lineHeight: 1.1, marginTop: 1 }}>{value}</div>
    </div>
  );
}

type HoverState = { i: number; x: number; y: number } | null;

// ── Cumulative area + line ──────────────────────────────────────────────────
export function AreaLine({
  points,
  gradientId,
  height = 200,
  format = (n: number) => String(n),
  tipFormat,
}: {
  points: Point[];
  gradientId: string;
  height?: number;
  format?: (n: number) => string;
  tipFormat?: (n: number) => string;
}) {
  const H = height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const fmtTip = tipFormat ?? format;

  const padL = 6, padR = 6, padT = 14, padB = 22;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = points.length;
  const xAt = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - (v / max) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${xAt(n - 1).toFixed(1)} ${padT + innerH} L ${xAt(0).toFixed(1)} ${padT + innerH} Z`;
  const last = points[n - 1];

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    const i = clamp(Math.round(((vbx - padL) / innerW) * (n - 1)), 0, n - 1);
    setHover({
      i,
      x: clamp((xAt(i) / W) * rect.width, 48, rect.width - 48),
      y: (yAt(points[i].value) / H) * rect.height,
    });
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto" }} role="img">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line key={g} x1={padL} x2={W - padR} y1={padT + innerH - g * innerH} y2={padT + innerH - g * innerH}
            stroke="var(--color-rule)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {hover && (
          <>
            <line x1={xAt(hover.i)} x2={xAt(hover.i)} y1={padT} y2={padT + innerH} stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={xAt(hover.i)} cy={yAt(points[hover.i].value)} r="5" fill="var(--color-accent)" stroke="var(--color-paper-3)" strokeWidth="2" />
          </>
        )}
        {last && !hover && <circle cx={xAt(n - 1)} cy={yAt(last.value)} r="3.5" fill="var(--color-accent)" />}
        <text x={padL} y={padT - 3} fontSize="11" fill="var(--color-ink-3)" fontFamily="var(--font-mono)">{format(max)}</text>
      </svg>
      {hover && <Tip x={hover.x} y={hover.y} label={monthLabelFull(points[hover.i].month)} value={fmtTip(points[hover.i].value)} />}
    </div>
  );
}

// ── Vertical bars ───────────────────────────────────────────────────────────
export function Bars({
  points,
  height = 200,
  format = (n: number) => String(n),
  tipFormat,
}: {
  points: Point[];
  height?: number;
  format?: (n: number) => string;
  tipFormat?: (n: number) => string;
}) {
  const H = height;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const fmtTip = tipFormat ?? format;

  const padT = 18, padB = 22;
  const innerH = H - padT - padB;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const n = points.length;
  const slot = W / n;
  const bw = Math.min(34, slot * 0.62);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const i = clamp(Math.floor(((e.clientX - rect.left) / rect.width) * n), 0, n - 1);
    const h = (points[i].value / max) * innerH;
    setHover({
      i,
      x: clamp(((i * slot + slot / 2) / W) * rect.width, 48, rect.width - 48),
      y: ((padT + innerH - h) / H) * rect.height,
    });
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", height: "auto" }} role="img">
        {[0.5, 1].map((g) => (
          <line key={g} x1={0} x2={W} y1={padT + innerH - g * innerH} y2={padT + innerH - g * innerH}
            stroke="var(--color-rule)" strokeWidth="1" strokeDasharray="2 4" opacity="0.6" />
        ))}
        <text x={2} y={padT - 5} fontSize="11" fill="var(--color-ink-3)" fontFamily="var(--font-mono)">{format(max)}</text>
        {points.map((p, i) => {
          const h = (p.value / max) * innerH;
          const cx = i * slot + slot / 2;
          const isLast = i === n - 1;
          const active = hover?.i === i;
          return (
            <g key={p.month}>
              <rect
                x={cx - bw / 2}
                y={padT + innerH - h}
                width={bw}
                height={Math.max(0, h)}
                rx="2"
                fill={isLast ? "var(--color-accent)" : "var(--color-accent-2)"}
                opacity={active ? 1 : isLast ? 1 : 0.5}
              />
              {(i % 2 === 0 || isLast) && (
                <text x={cx} y={H - 7} fontSize="10" textAnchor="middle" fill="var(--color-ink-3)" fontFamily="var(--font-mono)">
                  {monthLabel(p.month)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && <Tip x={hover.x} y={hover.y} label={monthLabelFull(points[hover.i].month)} value={fmtTip(points[hover.i].value)} />}
    </div>
  );
}

// ── Donut ───────────────────────────────────────────────────────────────────
export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function Donut({
  segments,
  centerLabel,
  centerSub,
  format = (n: number) => String(n),
}: {
  segments: Segment[];
  centerLabel: string;
  centerSub?: string;
  format?: (n: number) => string;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  const dashes = segments.map((seg) => (seg.value / total) * C);
  const offsets = prefixSums(dashes);
  const active = hi != null ? segments[hi] : null;

  return (
    <svg viewBox="0 0 140 140" width="140" height="140" role="img" style={{ flexShrink: 0 }}>
      <g transform="rotate(-90 70 70)">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-paper-2)" strokeWidth="18" />
        {segments.map((seg, i) => (
          <circle
            key={i}
            cx="70"
            cy="70"
            r={R}
            fill="none"
            stroke={seg.color}
            strokeWidth={hi === i ? 22 : 18}
            strokeDasharray={`${dashes[i]} ${C - dashes[i]}`}
            strokeDashoffset={-offsets[i]}
            opacity={hi == null || hi === i ? 1 : 0.4}
            style={{ cursor: "pointer", transition: "stroke-width 120ms ease, opacity 120ms ease" }}
            onPointerEnter={() => setHi(i)}
            onPointerLeave={() => setHi(null)}
          />
        ))}
      </g>
      <text x="70" y="66" textAnchor="middle" fontSize={active ? 18 : 22} fontFamily="var(--font-serif)" fill="var(--color-ink)">
        {active ? format(active.value) : centerLabel}
      </text>
      <text x="70" y="84" textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--color-ink-3)" letterSpacing="0.06em">
        {(active ? `${Math.round((active.value / total) * 100)}%` : (centerSub ?? "")).toUpperCase()}
      </text>
    </svg>
  );
}

// ── Activation funnel (horizontal) ──────────────────────────────────────────
export function Funnel({ steps }: { steps: Array<{ label: string; count: number }> }) {
  const top = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const pctOfTop = Math.round((s.count / top) * 100);
        const prev = steps[i - 1]?.count;
        const stepConv = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null;
        return (
          <div key={s.label} title={`${s.label}: ${s.count.toLocaleString("en-US")}${stepConv != null ? ` · ${stepConv}% of previous step` : ""} · ${pctOfTop}% of top`}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>{s.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {s.count.toLocaleString("en-US")}
                {stepConv != null && <span style={{ color: "var(--color-ink-3)", fontSize: 10.5 }}> · {stepConv}%</span>}
              </span>
            </div>
            <div style={{ height: 14, background: "var(--color-paper-2)", borderRadius: 3, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.max(2, pctOfTop)}%`,
                  height: "100%",
                  background: i === 0 ? "var(--color-accent)" : "var(--color-accent-2)",
                  opacity: i === 0 ? 1 : 0.85 - i * 0.08,
                  borderRadius: 3,
                  transition: "width 500ms ease",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Horizontal proportion bars (revenue mix / subs) ─────────────────────────
export function ProportionBars({
  rows,
  format,
}: {
  rows: Array<{ label: string; value: number; sub?: string; color: string }>;
  format: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${format(r.value)}${r.sub ? ` ${r.sub}` : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>{r.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5 }}>
              {format(r.value)}
              {r.sub && <span style={{ color: "var(--color-ink-3)", fontSize: 10.5 }}> · {r.sub}</span>}
            </span>
          </div>
          <div style={{ height: 10, background: "var(--color-paper-2)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, height: "100%", background: r.color, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
