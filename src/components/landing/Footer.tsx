"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LC, LF } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

function FLink({ href, children }: { href: string; children: ReactNode }) {
  const style = { fontFamily: LF.sans, fontSize: 13.5, color: LC.ink2, textDecoration: "none" } as const;
  if (href.startsWith("#")) {
    return <a href={href} style={style}>{children}</a>;
  }
  return <Link href={href} style={style}>{children}</Link>;
}

const COLS: Array<[string, Array<[string, string]>]> = [
  ["Product", [
    ["Matched tenders", "#f-matches"],
    ["Bid / no-bid", "#f-verdict"],
    ["Gap Navigator", "#f-navigator"],
    ["Proposals", "#f-proposal"],
  ]],
  ["Company", [
    ["Request invite", "/#top"],
    ["Contact", "/contact"],
  ]],
  ["Resources", [
    ["FAQ", "/faq"],
    ["Security", "/security"],
    ["Privacy", "/privacy"],
  ]],
];

export default function Footer() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <footer style={{ background: LC.paper, borderTop: `1px solid ${LC.rule}`, padding: mobile ? "40px 0 28px" : "56px 0 32px" }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.4fr 1fr 1fr 1fr", gap: mobile ? 28 : 40 }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontFamily: LF.display, fontSize: 22, fontWeight: 500, color: LC.ink }}>TenderPath</span>
              <span style={{ color: LC.accent, fontFamily: LF.display, fontSize: 22 }}>·</span>
            </div>
            <p style={{ fontFamily: LF.sans, fontSize: 13.5, color: LC.mute, margin: "12px 0 0", maxWidth: 280, lineHeight: 1.6 }}>
              The bid desk for UN &amp; donor procurement. Match, qualify, comply, and then win.
            </p>
          </div>
          {COLS.map(([h, items]) => (
            <div key={h}>
              <div style={{ fontFamily: LF.mono, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: LC.faint, marginBottom: 14 }}>{h}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {items.map(([it, href]) => (
                  <FLink key={it} href={href}>{it}</FLink>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 40,
            paddingTop: 20,
            borderTop: `1px solid ${LC.ruleSoft}`,
          }}
        >
          <span style={{ fontFamily: LF.mono, fontSize: 10.5, color: LC.faint, letterSpacing: "0.04em" }}>© 2026 TenderPath · UN procurement intelligence</span>
          <div style={{ display: "flex", gap: 18 }}>
            {([["Terms", "/terms"], ["Privacy", "/privacy"], ["Security", "/security"]] as const).map(([l, href]) => (
              <Link key={l} href={href} style={{ fontFamily: LF.mono, fontSize: 10.5, color: LC.mute, textDecoration: "none", letterSpacing: "0.04em" }}>
                {l}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
