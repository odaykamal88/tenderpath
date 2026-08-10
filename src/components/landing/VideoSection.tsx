"use client";

import dynamic from "next/dynamic";
import { LC, LF, SectionTag } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

// The walkthrough is client-only (rAF, localStorage, ResizeObserver) and heavy,
// so it's lazy-loaded — its chunk never lands in the initial bundle or SSR HTML.
// Paused by default; it only animates once the user presses play.
const Walkthrough = dynamic(() => import("./walkthrough/Walkthrough"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: LC.onDarkMute,
        fontFamily: LF.mono,
        fontSize: 12,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      Loading walkthrough…
    </div>
  ),
});

export default function VideoSection() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section id="see" style={{ background: LC.ink, padding: mobile ? "48px 0 54px" : "76px 0 84px" }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ textAlign: "center", marginBottom: mobile ? 26 : 40 }}>
          <div style={{ display: "inline-block" }}>
            <SectionTag n="01" label="See it work" color={LC.paper} />
          </div>
          <h2 style={{ fontFamily: LF.display, fontSize: mobile ? 28 : 40, fontWeight: 400, letterSpacing: "-0.02em", color: LC.paper, margin: "16px 0 0", lineHeight: 1.08 }}>
            Your path to a controlled response —<br />in about a minute.
          </h2>
          <p style={{ fontFamily: LF.sans, fontSize: mobile ? 14.5 : 16, color: LC.onDark, margin: "14px auto 0", maxWidth: 540, lineHeight: 1.6 }}>
            Build the company file, qualify the tenders that matter, and move one decision into a review-ready response workspace.
          </p>
        </div>
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#0a0a0a", border: `1px solid ${LC.darkLine2}`, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.5)" }}>
          <Walkthrough />
        </div>
        <div style={{ textAlign: "center", marginTop: 18, fontFamily: LF.mono, fontSize: 10.5, letterSpacing: "0.06em", color: LC.onDarkMute }}>
          Press play · space to pause · ← → to scrub
        </div>
      </div>
    </section>
  );
}
