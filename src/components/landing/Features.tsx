"use client";

import type { ReactNode } from "react";
import { LC, LF, SectionTag, Eyebrow, Ic } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";

/* ── static dossier-styled UI vignettes ─────────────────────── */

function VMatches() {
  const rows: Array<[string, string, number, string]> = [
    ["Climate Resilience Advisory", "UNDP · RFP", 86, LC.pos],
    ["Digital Skills — Lot 2", "EU · Grant", 78, LC.pos],
    ["Off-Grid Solar Systems", "UNICEF · ITB", 71, LC.pos],
    ["Translation LTA", "WFP · Framework", 64, LC.ink],
  ];
  return (
    <div style={{ border: `1px solid ${LC.rule}`, background: LC.white, boxShadow: "0 16px 40px rgba(15,22,32,0.08)" }}>
      {rows.map((m, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", borderBottom: i < 3 ? `1px solid ${LC.ruleSoft}` : 0 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: m[3] }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: LF.sans, fontSize: 13, color: LC.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m[0]}</div>
            <div style={{ fontFamily: LF.mono, fontSize: 9, color: LC.mute, marginTop: 2 }}>{m[1]}</div>
          </div>
          <span style={{ fontFamily: LF.mono, fontSize: 15, fontWeight: 600, color: m[2] >= 75 ? LC.pos : LC.ink }}>{m[2]}</span>
        </div>
      ))}
    </div>
  );
}

function VNavigator() {
  const steps: Array<[string, number]> = [
    ["Create the account", 1],
    ["Confirm company identity", 1],
    ["Add UNSPSC codes", 0],
    ["Attach documents", 0],
  ];
  return (
    <div style={{ background: LC.ink, boxShadow: "0 16px 40px rgba(15,22,32,0.18)" }}>
      <div style={{ padding: "14px 18px", display: "flex", gap: 11, alignItems: "center", borderBottom: `1px solid ${LC.spineLine}` }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: LC.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: LF.display, fontSize: 15 }}>✦</div>
        <div>
          <div style={{ fontFamily: LF.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LC.accent2 }}>Gap Navigator</div>
          <div style={{ fontFamily: LF.display, fontSize: 16, color: LC.paper }}>Register on UNGM</div>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              padding: "9px 11px",
              marginBottom: 7,
              border: `1px solid ${s[1] ? "#2f5a3f" : LC.spineLine}`,
              background: s[1] ? "rgba(31,107,61,0.16)" : "transparent",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: `1.5px solid ${s[1] ? LC.pos : LC.spineDim}`,
                background: s[1] ? LC.pos : "transparent",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
              }}
            >
              {s[1] ? "✓" : ""}
            </span>
            <span style={{ fontFamily: LF.sans, fontSize: 12.5, color: s[1] ? LC.onDark : LC.paper }}>{s[0]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VPaste() {
  const rows: Array<[string, number]> = [
    ["Sector fit", 1],
    ["Geography", 1],
    ["UNGM registration", 0],
    ["Audited financials", 0],
  ];
  return (
    <div style={{ border: `1px solid ${LC.rule}`, background: LC.paper, boxShadow: "0 16px 40px rgba(15,22,32,0.1)" }}>
      <div style={{ background: LC.ink, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ fontFamily: LF.display, fontSize: 34, color: LC.pos, lineHeight: 0.9 }}>86</div>
        <div>
          <div style={{ fontFamily: LF.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.accent2 }}>● Recommended: BID</div>
          <div style={{ fontFamily: LF.sans, fontSize: 12, color: LC.onDark, marginTop: 3 }}>2 compliance gaps to close</div>
        </div>
      </div>
      <div style={{ padding: 14 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderBottom: i < 3 ? `1px solid ${LC.ruleSoft}` : 0,
              background: r[1] ? LC.white : "#fdf6f6",
            }}
          >
            <span style={{ flex: 1, fontFamily: LF.sans, fontSize: 12.5, color: LC.ink }}>{r[0]}</span>
            <span
              style={{
                fontFamily: LF.mono,
                fontSize: 8.5,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                color: r[1] ? LC.pos : LC.neg,
                border: `1px solid ${r[1] ? LC.pos : LC.neg}40`,
                padding: "2px 7px",
              }}
            >
              {r[1] ? "✓ On file" : "! Gap"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VProposal() {
  return (
    <div style={{ border: `1px solid ${LC.rule}`, background: LC.white, boxShadow: "0 16px 40px rgba(15,22,32,0.1)", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 12, right: -34, transform: "rotate(34deg)", background: LC.pos, color: "#fff", fontFamily: LF.mono, fontSize: 8, letterSpacing: "0.1em", padding: "4px 38px" }}>
        COMPLIANCE-MAPPED
      </div>
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${LC.rule}` }}>
        <div style={{ fontFamily: LF.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: LC.accent }}>Proposal · RFP</div>
        <div style={{ fontFamily: LF.display, fontSize: 17, color: LC.ink, marginTop: 4 }}>Climate Resilience Advisory</div>
      </div>
      <div style={{ padding: "14px 20px" }}>
        {["01 · Executive summary", "02 · Technical approach", "03 · Compliance matrix", "04 · Financial proposal"].map((s, i) => (
          <div key={i} style={{ marginBottom: 11 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5 }}>
              <span style={{ color: LC.pos, fontFamily: LF.mono, fontSize: 10 }}>✓</span>
              <span style={{ fontFamily: LF.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: LC.ink2 }}>{s}</span>
            </div>
            {[1, 0.85].map((w, j) => (
              <div key={j} style={{ height: 3, background: LC.paper2, width: `${w * 100}%`, marginBottom: 3, marginLeft: 16 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── feature row ─────────────────────────────────────────────── */

function FeatureRow({
  tag,
  title,
  body,
  points,
  visual,
  flip,
  mobile,
  id,
}: {
  tag: string;
  title: string;
  body: string;
  points: string[];
  visual: ReactNode;
  flip?: boolean;
  mobile: boolean;
  id: string;
}) {
  return (
    <div
      id={id}
      style={{
        display: "grid",
        gridTemplateColumns: mobile ? "1fr" : "1fr 1fr",
        gap: mobile ? 22 : 56,
        alignItems: "center",
        scrollMarginTop: 84,
      }}
    >
      <div style={{ order: flip && !mobile ? 2 : 1 }}>
        <Eyebrow>{tag}</Eyebrow>
        <h3 style={{ fontFamily: LF.display, fontSize: mobile ? 25 : 32, fontWeight: 400, letterSpacing: "-0.02em", color: LC.ink, margin: "12px 0 0", lineHeight: 1.1 }}>{title}</h3>
        <p style={{ fontFamily: LF.sans, fontSize: 15, lineHeight: 1.65, color: LC.ink2, margin: "14px 0 0" }}>{body}</p>
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          {points.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ color: LC.pos, marginTop: 1 }}>
                <Ic name="check" size={16} color={LC.pos} />
              </span>
              <span style={{ fontFamily: LF.sans, fontSize: 14, color: LC.ink2, lineHeight: 1.5 }}>{p}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ order: flip && !mobile ? 1 : 2 }}>{visual}</div>
    </div>
  );
}

export default function Features() {
  const mobile = useMedia("(max-width: 767px)");
  return (
    <section id="features" style={{ background: LC.paper, padding: mobile ? "52px 0" : "90px 0" }}>
      <div className="lk-container" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ textAlign: mobile ? "left" : "center", marginBottom: mobile ? 34 : 60 }}>
          <div style={{ display: "inline-block" }}>
            <SectionTag n="04" label="What's inside" />
          </div>
          <h2 style={{ fontFamily: LF.display, fontSize: mobile ? 28 : 44, fontWeight: 400, letterSpacing: "-0.02em", color: LC.ink, margin: "16px 0 0", lineHeight: 1.06 }}>
            Your whole bid desk, in one place.
          </h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: mobile ? 48 : 76 }}>
          <FeatureRow
            mobile={mobile}
            id="f-matches"
            tag="Matched tenders"
            title="Stop scrolling portals. See only what fits."
            body="One ranked feed of every live UN, EU and donor tender you're genuinely eligible for — scored on sector, geography, track record and compliance, refreshed daily."
            points={["Fit score with the reasoning behind it", "Buckets from 'act now' to 'watchlist'", "Pulls UNGM, EU, AfDB & national portals"]}
            visual={<VMatches />}
          />
          <FeatureRow
            mobile={mobile}
            flip
            id="f-verdict"
            tag="Paste → bid / no-bid"
            title="An honest verdict before you invest a single hour."
            body="Paste a link or drop the PDF. TenderPath reads the requirements, checks them against your file, and gives a clear call — then asks only for what it doesn't already have."
            points={["Fit score + bid / no-bid recommendation", "Compliance ledger: on-file vs. gaps", "Requests just the missing inputs"]}
            visual={<VPaste />}
          />
          <FeatureRow
            mobile={mobile}
            id="f-navigator"
            tag="The Gap Navigator"
            title="Every blocker, closed with your hand held."
            body="UNGM registration, ISO certification, audited financials — the Navigator walks each one step by step, pre-fills what it can, and lifts your readiness score as you go."
            points={["Guided, conversational, pre-filled steps", "Deep-links to the right portals & your vault", "Watch your score and eligibility climb"]}
            visual={<VNavigator />}
          />
          <FeatureRow
            mobile={mobile}
            flip
            id="f-proposal"
            tag="Proposals"
            title="A submission-ready proposal in under an hour."
            body="Turn the brief into a full EOI, RFQ, RFP or ITB response — mapped to the tender's scoring matrix, compliance-checked, ready to submit."
            points={["EOI · RFQ · ITB · RFP, matrix-mapped", "Compliance-mapped, evaluator-ready", "Built from your file and the scoring matrix"]}
            visual={<VProposal />}
          />
        </div>
      </div>
    </section>
  );
}
