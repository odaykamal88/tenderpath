"use client";

import Link from "next/link";
import { LC, LF, AssessPaste } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";
import type { LandingViewer } from "./types";

export default function Hero({ viewer }: { viewer: LandingViewer }) {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section id="top" style={{ position: "relative", overflow: "hidden", background: LC.paper }}>
      {/* faint masthead glyph */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -90,
          right: -40,
          fontFamily: LF.display,
          fontSize: 460,
          lineHeight: 1,
          color: "rgba(156,107,31,0.05)",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        §
      </div>
      <div
        className="lk-container"
        style={{ maxWidth: 1180, margin: "0 auto", position: "relative", padding: mobile ? "44px 24px 40px" : "78px 24px 70px", textAlign: "center" }}
      >
        {viewer ? (
          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              border: `1px solid ${LC.rule}`,
              background: LC.white,
              padding: "7px 14px",
              marginBottom: 26,
              textDecoration: "none",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: LC.accent }} />
            <span style={{ fontFamily: LF.mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.mute }}>
              Welcome back · {viewer.companyName}
            </span>
          </Link>
        ) : (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              border: `1px solid ${LC.rule}`,
              background: LC.white,
              padding: "7px 14px",
              marginBottom: 26,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: LC.pos }} />
            <span style={{ fontFamily: LF.mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.mute }}>
              UN &amp; donor procurement, decoded
            </span>
          </div>
        )}

        <h1
          style={{
            fontFamily: LF.display,
            fontSize: mobile ? 38 : 68,
            fontWeight: 400,
            letterSpacing: "-0.025em",
            lineHeight: 1.02,
            color: LC.ink,
            margin: "0 auto",
            maxWidth: 920,
          }}
        >
          Stop chasing tenders.
          <br />
          <span style={{ fontStyle: "italic", color: LC.accent }}>Start winning them.</span>
        </h1>

        <p
          style={{
            fontFamily: LF.sans,
            fontSize: mobile ? 16 : 19,
            lineHeight: 1.6,
            color: LC.ink2,
            margin: "22px auto 0",
            maxWidth: 600,
          }}
        >
          Paste any UN or donor tender and TenderPath tells you—instantly—whether to bid, exactly what compliance you&rsquo;re missing, and then helps you close every gap and submit a winning proposal.
        </p>

        <div style={{ marginTop: 34 }}>
          <AssessPaste />
        </div>

        <div style={{ marginTop: 18, display: "flex", gap: 22, justifyContent: "center", flexWrap: "wrap" }}>
          {viewer && (
            <Link
              href="/dashboard"
              className="lk-navlink"
              style={{ fontFamily: LF.mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.accent, textDecoration: "none", borderBottom: `1px solid ${LC.accent}`, paddingBottom: 3 }}
            >
              Open your dashboard →
            </Link>
          )}
          <a
            href="#see"
            className="lk-navlink"
            style={{ fontFamily: LF.mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.ink2, textDecoration: "none", borderBottom: `1px solid ${LC.rule}`, paddingBottom: 3 }}
          >
            Watch it work →
          </a>
        </div>

        <div
          style={{
            display: "flex",
            gap: mobile ? 18 : 34,
            justifyContent: "center",
            flexWrap: "wrap",
            marginTop: 34,
            fontFamily: LF.mono,
            fontSize: 11,
            letterSpacing: "0.04em",
            color: LC.faint,
          }}
        >
          <span>No card required</span>
          <span style={{ color: LC.rule }}>·</span>
          <span>Bid/no-bid in &lt; 1 min</span>
          <span style={{ color: LC.rule }}>·</span>
          <span>30+ UN agencies, EU, AfDB feeds</span>
        </div>
      </div>
    </section>
  );
}
