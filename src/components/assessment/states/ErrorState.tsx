"use client";

import type { CSSProperties } from "react";
import { C, F } from "@/components/workbench/tokens";
import { Eyebrow } from "@/components/workbench/ui";

export function ErrorState({
  errorId,
  title = "We couldn't compute your score.",
  body,
  retryHref,
}: {
  errorId: string;
  title?: string;
  body: string;
  retryHref: string;
}) {
  const action = (bg: string, color: string, border: string): CSSProperties => ({
    fontFamily: F.mono,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    padding: "11px 20px",
    textDecoration: "none",
    background: bg,
    color,
    border: `1px solid ${border}`,
    display: "inline-flex",
    alignItems: "center",
  });

  return (
    <div
      role="alert"
      style={{ maxWidth: 620, margin: "0 auto", padding: "72px 24px", color: C.ink, background: C.paper, minHeight: "100vh", boxSizing: "border-box" }}
    >
      <Eyebrow color={C.neg}>Error</Eyebrow>
      <h2 style={{ fontFamily: F.display, fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.05, color: C.ink, margin: "12px 0 10px" }}>
        {title}
      </h2>
      <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, lineHeight: 1.55, marginBottom: 22 }}>{body}</p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: F.mono, fontSize: 10.5, color: C.faint, marginBottom: 24 }}>
        <span style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}>error_id</span>
        <code style={{ color: C.ink2 }}>{errorId}</code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(errorId)}
          style={{ background: "none", border: `1px solid ${C.rule}`, cursor: "pointer", color: C.mute, fontFamily: F.mono, fontSize: 10, padding: "3px 8px" }}
        >
          Copy
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <a href={retryHref} style={action(C.ink, C.paper, C.ink)}>
          Try again
        </a>
        <a href="mailto:support@tenderpath.me" style={action("transparent", C.ink, C.rule)}>
          Email support
        </a>
      </div>
    </div>
  );
}
