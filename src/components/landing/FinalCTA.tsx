"use client";

import { LC, LF, Eyebrow, AssessPaste } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

export default function FinalCTA() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section style={{ background: LC.ink, padding: mobile ? "60px 0" : "100px 0", position: "relative", overflow: "hidden" }}>
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          fontFamily: LF.display,
          fontSize: 600,
          color: "rgba(200,151,62,0.04)",
          lineHeight: 1,
          pointerEvents: "none",
        }}
      >
        §
      </div>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", position: "relative", textAlign: "center" }}>
        <Eyebrow color={LC.accent2} style={{ display: "inline-block" }}>
          Your free readiness assessment
        </Eyebrow>
        <h2
          style={{
            fontFamily: LF.display,
            fontSize: mobile ? 34 : 58,
            fontWeight: 400,
            letterSpacing: "-0.025em",
            color: LC.paper,
            margin: "18px auto 0",
            maxWidth: 800,
            lineHeight: 1.04,
          }}
        >
          Your next contract is already in the feed.
        </h2>
        <p style={{ fontFamily: LF.sans, fontSize: mobile ? 16 : 18, color: LC.onDark, margin: "18px auto 0", maxWidth: 540, lineHeight: 1.6 }}>
          Paste your website. In about a minute you&rsquo;ll see your readiness score, the live tenders you fit, and the three fixes that matter — then step straight into your Workbench.
        </p>
        <div style={{ marginTop: 32 }}>
          <AssessPaste dark note={`No signup to see your score · free dashboard, no card · Pro free for 30 days`} />
        </div>
      </div>
    </section>
  );
}
