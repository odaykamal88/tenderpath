/**
 * Investor data room — lightweight, dependency-free SVG charts.
 *
 * Hand-rolled (no chart lib) to match the existing Sparkbar approach and keep
 * the bundle lean. All charts use a fixed internal viewBox and scale to 100%
 * width; colors come from the global design tokens.
 */

export interface Point {
  month: string; // YYYY-MM
  value: number;
}

const W = 720;

function monthLabel(m: string): string {
  const [, mm] = m.split("-");
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(mm)
  ] ?? "";
}

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

// ── Cumulative area + line ──────────────────────────────────────────────────
export function AreaLine({
  points,
  gradientId,
  height = 200,
  format = (n: number) => String(n),
}: {
  points: Point[];
  gradientId: string;
  height?: number;
  format?: (n: number) => string;
}) {
  const H = height;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 22;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${padT + innerH} L ${x(0).toFixed(1)} ${padT + innerH} Z`;
  const last = points[points.length - 1];

  return (
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
      {last && <circle cx={x(points.length - 1)} cy={y(last.value)} r="3.5" fill="var(--color-accent)" />}
      <text x={padL} y={padT - 3} fontSize="11" fill="var(--color-ink-3)" fontFamily="var(--font-mono)">{format(max)}</text>
    </svg>
  );
}

// ── Vertical bars ───────────────────────────────────────────────────────────
export function Bars({
  points,
  height = 200,
  format = (n: number) => String(n),
}: {
  points: Point[];
  height?: number;
  format?: (n: number) => string;
}) {
  const H = height;
  const padT = 18;
  const padB = 22;
  const innerH = H - padT - padB;
  const max = niceMax(Math.max(1, ...points.map((p) => p.value)));
  const n = points.length;
  const slot = W / n;
  const bw = Math.min(34, slot * 0.62);

  return (
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
        return (
          <g key={p.month}>
            <title>{`${monthLabel(p.month)} ${p.month.split("-")[0]} · ${format(p.value)}`}</title>
            <rect
              x={cx - bw / 2}
              y={padT + innerH - h}
              width={bw}
              height={Math.max(0, h)}
              rx="2"
              fill={isLast ? "var(--color-accent)" : "var(--color-accent-2)"}
              opacity={isLast ? 1 : 0.5}
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
  );
}

// ── Donut ───────────────────────────────────────────────────────────────────
export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function Donut({ segments, centerLabel, centerSub }: { segments: Segment[]; centerLabel: string; centerSub?: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 54;
  const C = 2 * Math.PI * R;
  const dashes = segments.map((seg) => (seg.value / total) * C);
  const offsets = prefixSums(dashes);
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
            strokeWidth="18"
            strokeDasharray={`${dashes[i]} ${C - dashes[i]}`}
            strokeDashoffset={-offsets[i]}
          />
        ))}
      </g>
      <text x="70" y="66" textAnchor="middle" fontSize="22" fontFamily="var(--font-serif)" fill="var(--color-ink)">{centerLabel}</text>
      {centerSub && (
        <text x="70" y="84" textAnchor="middle" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--color-ink-3)" letterSpacing="0.08em">{centerSub.toUpperCase()}</text>
      )}
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
          <div key={s.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, color: "var(--color-ink-2)" }}>{s.label}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {s.count.toLocaleString("en-US")}
                {stepConv != null && (
                  <span style={{ color: "var(--color-ink-3)", fontSize: 10.5 }}> · {stepConv}%</span>
                )}
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
        <div key={r.label}>
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
