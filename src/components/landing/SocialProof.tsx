"use client";

import { LC, LF } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

const AGENCIES = ["UNDP", "UNICEF", "WFP", "UN WOMEN", "WHO", "GIZ", "AfDB", "EU · INTPA"];

/** Round a live count DOWN to a clean floor so the "+" is always honest
 *  ("at least this many"), since the real feed fluctuates between crawls. */
function fmtCount(n: number): string {
  if (n >= 1000) return (Math.floor(n / 100) * 100).toLocaleString("en-US") + "+";
  if (n >= 100) return Math.floor(n / 10) * 10 + "+";
  return String(n);
}

export default function SocialProof({ liveTenderCount }: { liveTenderCount: number | null }) {
  const mobile = useMedia("(max-width: 767px)");

  // First stat is the only numeric platform metric — use the real DB count, or
  // fall back to a non-numeric, still-true statement rather than a made-up figure.
  const firstStat: [string, string] =
    liveTenderCount && liveTenderCount > 0
      ? [fmtCount(liveTenderCount), "live tenders tracked right now"]
      : ["Live", "tender feed with source freshness monitoring"];

  const stats: Array<[string, string]> = [
    firstStat,
    ["30+", "UN agencies + EU & donor feeds"],
    ["Fast", "evidence-based bid/no-bid read"],
    ["Assisted", "pilot delivery, timing confirmed at intake"],
  ];

  return (
    <section style={{ background: LC.white, padding: mobile ? "44px 0" : "64px 0", borderTop: `1px solid ${LC.rule}`, borderBottom: `1px solid ${LC.rule}` }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ textAlign: "center", fontFamily: LF.mono, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: LC.faint }}>
          Built around the agencies that actually publish the work
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: mobile ? "16px 26px" : "20px 44px", marginTop: 22 }}>
          {AGENCIES.map((a) => (
            <span key={a} style={{ fontFamily: LF.display, fontSize: mobile ? 18 : 23, color: LC.ink2, opacity: 0.62, letterSpacing: "0.01em" }}>{a}</span>
          ))}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: 1,
            background: LC.rule,
            border: `1px solid ${LC.rule}`,
            marginTop: 40,
          }}
        >
          {stats.map((s, i) => (
            <div key={i} style={{ background: LC.white, padding: mobile ? "22px 18px" : "26px 22px", textAlign: "center" }}>
              <div style={{ fontFamily: LF.display, fontSize: mobile ? 30 : 38, color: LC.ink, lineHeight: 1 }}>{s[0]}</div>
              <div style={{ fontFamily: LF.mono, fontSize: 9.5, letterSpacing: "0.07em", textTransform: "uppercase", color: LC.mute, marginTop: 9 }}>{s[1]}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
