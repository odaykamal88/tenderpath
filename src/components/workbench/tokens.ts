/* Workbench "D2 dossier" design tokens.
 *
 * The redesign uses inline styles keyed off these constants (the same idiom as
 * the rest of the dashboard, which already writes `style={{ fontFamily: SERIF }}`).
 * Sharp corners everywhere; the only radius is 999px on dots/avatars/pills.
 * Fonts resolve to the next/font CSS variables set on <html> in app/layout.tsx. */

export const C = {
  ink: "#0f1620",
  ink2: "#2b3543",
  paper: "#f6f3ec",
  paper2: "#ece6d5",
  rule: "#d8d1bf",
  ruleSoft: "#e4ddcb",
  mute: "#6b6557",
  faint: "#8c8676",
  accent: "#9c6b1f",
  accent2: "#c8973e",
  pos: "#1f6b3d",
  warn: "#b3691a",
  neg: "#9c2a2a",
  blue: "#1c3a5f",
  white: "#ffffff",
  spine: "#0f1620",
  spineLine: "#26303d",
  spineDim: "#7d8794",
} as const;

export const F = {
  display: "var(--font-fraunces), Georgia, serif",
  sans: "var(--font-inter), system-ui, -apple-system, sans-serif",
  mono: "var(--font-jetbrains), ui-monospace, Menlo, monospace",
} as const;
