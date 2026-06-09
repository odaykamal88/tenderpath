/* Workbench line icons — 16px, 1.5px stroke, round caps/joins. Ported from the
   design prototype so the visual weight matches the handoff exactly. */
import type { CSSProperties } from "react";

export type IconName =
  | "overview"
  | "matches"
  | "browse"
  | "gaps"
  | "proposals"
  | "paste"
  | "search"
  | "bell"
  | "vault"
  | "gear"
  | "upload"
  | "external"
  | "check"
  | "chevron"
  | "close"
  | "menu";

const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <path {...P} d="M2.5 7L8 2.5 13.5 7" />
      <path {...P} d="M3.6 6v7.5h8.8V6" />
    </>
  ),
  matches: (
    <>
      <circle {...P} cx="6.5" cy="6.5" r="3.2" />
      <path {...P} d="M9 9l4.5 4.5" />
      <path {...P} d="M5 6.5h3M6.5 5v3" />
    </>
  ),
  browse: (
    <>
      <path {...P} d="M2.5 4h11M2.5 8h11M2.5 12h11" />
      <circle cx="4.5" cy="4" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  gaps: (
    <>
      <path {...P} d="M8 2.2l5.5 9.6H2.5z" />
      <path {...P} d="M8 6.5v2.4M8 10.6v.1" />
    </>
  ),
  proposals: (
    <>
      <path {...P} d="M4 2.5h5l3 3v8H4z" />
      <path {...P} d="M9 2.5V6h3" />
      <path {...P} d="M6 8.5h4M6 10.5h4" />
    </>
  ),
  paste: (
    <>
      <rect {...P} x="3" y="2.5" width="10" height="11" rx="1" />
      <path {...P} d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </>
  ),
  search: (
    <>
      <circle {...P} cx="7" cy="7" r="4" />
      <path {...P} d="M10 10l3.5 3.5" />
    </>
  ),
  bell: (
    <>
      <path {...P} d="M5 6.5a3 3 0 016 0c0 3 1.2 4 1.2 4H3.8S5 9.5 5 6.5z" />
      <path {...P} d="M6.8 13a1.4 1.4 0 002.4 0" />
    </>
  ),
  vault: (
    <>
      <rect {...P} x="2.5" y="3" width="11" height="10" rx="1" />
      <path {...P} d="M2.5 6h11M6 3v3" />
    </>
  ),
  gear: (
    <>
      <circle {...P} cx="8" cy="8" r="2" />
      <path {...P} d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  upload: (
    <>
      <path {...P} d="M8 10.5V3M8 3L5 6M8 3l3 3" />
      <path {...P} d="M3 10v2.5h10V10" />
    </>
  ),
  external: <path {...P} d="M6 3h7v7M13 3L6.5 9.5M11 9v4H3V5h4" />,
  check: <path {...P} d="M3 8.5l3 3 7-7.5" />,
  chevron: <path {...P} d="M4 6l4 4 4-4" />,
  close: <path {...P} d="M4 4l8 8M12 4l-8 8" />,
  menu: <path {...P} d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
};

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ display: "block", flexShrink: 0, ...style }}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
