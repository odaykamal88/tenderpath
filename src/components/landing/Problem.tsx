"use client";

import { LC, LF, SectionTag } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

const ITEMS: Array<[string, string, string]> = [
  ["20–40 hrs", "wasted per wrong bid", "Teams pour weeks into proposals they were never eligible to win — wrong tier, wrong geography, missing a single certificate."],
  ["1 in 9", "is the typical win rate", "Most opportunities are noise. Without a fast, honest bid/no-bid call, you chase everything and win almost nothing."],
  ["1 missing doc", "= automatic rejection", "A lapsed registration or an absent audited statement gets you screened out before an evaluator reads a word."],
];

export default function Problem() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section style={{ background: LC.paper, padding: mobile ? "52px 0" : "88px 0" }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <SectionTag n="01" label="Why bidding is broken" />
        <h2
          style={{
            fontFamily: LF.display,
            fontSize: mobile ? 28 : 44,
            fontWeight: 400,
            letterSpacing: "-0.02em",
            color: LC.ink,
            margin: "18px 0 0",
            maxWidth: 760,
            lineHeight: 1.06,
          }}
        >
          The tender exists. The funding is real. So why is winning so brutal?
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: mobile ? "1fr" : "repeat(3, 1fr)",
            gap: 1,
            background: LC.rule,
            border: `1px solid ${LC.rule}`,
            marginTop: 34,
          }}
        >
          {ITEMS.map((it, i) => (
            <div key={i} style={{ background: LC.white, padding: mobile ? "26px 22px" : "30px 26px" }}>
              <div style={{ fontFamily: LF.display, fontSize: mobile ? 38 : 46, color: LC.neg, lineHeight: 0.95 }}>{it[0]}</div>
              <div style={{ fontFamily: LF.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: LC.mute, marginTop: 8 }}>{it[1]}</div>
              <p style={{ fontFamily: LF.sans, fontSize: 14, lineHeight: 1.6, color: LC.ink2, margin: "14px 0 0" }}>{it[2]}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
