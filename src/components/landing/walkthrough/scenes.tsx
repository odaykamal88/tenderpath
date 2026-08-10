"use client";

/* Landing walkthrough — the 6 scenes + shared chrome.
 *
 * Typed port of the design prototype's landing-video.jsx scene set. The FULL
 * journey, no portals: Question → Score → Matches → Verdict → Submit → Won.
 * Mirrors the real product (assessment 64, BrightPath, 86% Climate Resilience).
 * Each scene is a pure function of scene-local time `st` (seconds). */

import type { ReactNode } from "react";
import { interpolate, clamp, Easing, type EaseFn } from "./engine";
import { LC, LF } from "../kit";

const mono = LF.mono;
const sans = LF.sans;
const disp = LF.display;

const kf = (t: number, ins: number[], outs: number[], ease: EaseFn | EaseFn[] = Easing.easeInOutCubic) =>
  interpolate(ins, outs, ease)(t);
const gate = (t: number, a: number, b: number, ease: EaseFn = Easing.easeInOutCubic) =>
  ease(clamp((t - a) / (b - a), 0, 1));
const barCol = (v: number) => (v < 50 ? LC.neg : v < 72 ? LC.warn : LC.pos);

/** Scene boundaries (absolute seconds). */
export const S = { q: 0, score: 3.4, match: 9.4, verdict: 13.9, submit: 18.4, won: 23.2, end: 27.4 };

/* ── cursor ─────────────────────────────────────────────────── */
export function Cursor({ t, path, clicks, accent = LC.accent }: { t: number; path: number[][]; clicks: number[]; accent?: string }) {
  if (!path.length) return null;
  const xs = path.map((p) => p[0]);
  const x = kf(t, xs, path.map((p) => p[1]));
  const y = kf(t, xs, path.map((p) => p[2]));
  let pulse = 0;
  let pressed = 0;
  for (const c of clicks) {
    if (t >= c && t < c + 0.5) pulse = Math.max(pulse, 1 - (t - c) / 0.5);
    if (t >= c - 0.06 && t < c + 0.12) pressed = 1;
  }
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: 90, pointerEvents: "none", transform: `scale(${pressed ? 0.85 : 1})`, transformOrigin: "top left" }}>
      {pulse > 0 && <div style={{ position: "absolute", left: 0, top: 0, width: 26, height: 26, marginLeft: -10, marginTop: -10, borderRadius: "50%", border: `2px solid ${accent}`, opacity: pulse * 0.8, transform: `scale(${1 + (1 - pulse) * 1.6})` }} />}
      <svg width="26" height="26" viewBox="0 0 26 26" style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
        <path d="M5 3l15 7.5-6.2 1.8L11 19z" fill="#fff" stroke={LC.ink} strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Caption({ text, op }: { text: string; op: number }) {
  if (op <= 0.01) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 28, display: "flex", justifyContent: "center", zIndex: 95, opacity: op }}>
      <div style={{ background: "rgba(15,22,32,0.92)", color: LC.paper, fontFamily: disp, fontSize: 20, padding: "10px 22px", maxWidth: 760, textAlign: "center", letterSpacing: "-0.01em" }}>{text}</div>
    </div>
  );
}

/* shared browser chrome for product scenes */
function Browser({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: LC.paper }}>
      <div style={{ height: 34, background: "#e7e1d2", borderBottom: `1px solid ${LC.rule}`, display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
        <div style={{ display: "flex", gap: 6 }}>{["#d98b7a", "#dcc079", "#9fc08a"].map((c) => <span key={c} style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />)}</div>
        <div style={{ flex: 1, maxWidth: 300, margin: "0 auto", background: LC.paper, border: `1px solid ${LC.rule}`, borderRadius: 4, height: 20, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, border: `1.2px solid ${LC.pos}`, borderRadius: "50%" }} />
          <span style={{ fontFamily: mono, fontSize: 10, color: LC.mute }}>tenderpath.io</span>
        </div>
      </div>
      <div style={{ position: "absolute", top: 34, left: 0, right: 0, bottom: 0 }}>{children}</div>
    </div>
  );
}

/* workbench sidebar + header frame */
function Workbench({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", background: LC.paper }}>
      <div style={{ width: 184, background: LC.spine, color: LC.paper, flexShrink: 0, paddingTop: 16 }}>
        <div style={{ padding: "0 16px 14px", borderBottom: `1px solid ${LC.spineLine}` }}>
          <span style={{ fontFamily: disp, fontSize: 16, color: LC.white }}>TenderPath</span>
          <span style={{ color: LC.accent2, fontFamily: disp, fontSize: 16 }}> ·</span>
        </div>
        <div style={{ padding: "12px 12px 0" }}>
          <div style={{ background: LC.accent, color: "#fff", fontFamily: mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", padding: "8px 10px", marginBottom: 12 }}>+ Paste a tender</div>
          {([["Overview", title === "Overview"], ["Matched tenders", title === "Matched tenders"], ["Readiness gaps", title === "Readiness gaps"], ["Submissions", title === "Submissions"], ["Document vault", false]] as Array<[string, boolean]>).map(([l, a], i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderLeft: `2px solid ${a ? LC.accent : "transparent"}`, background: a ? LC.spineLine : "transparent", color: a ? LC.white : LC.spineDim, fontFamily: sans, fontSize: 11.5 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: a ? LC.accent : LC.spineDim }} />{l}
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div style={{ height: 46, borderBottom: `1px solid ${LC.rule}`, display: "flex", alignItems: "center", padding: "0 22px" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.16em", textTransform: "uppercase", color: LC.accent }}>Vendor file · 0148 · BrightPath Solutions</div>
            <div style={{ fontFamily: disp, fontSize: 15, color: LC.ink }}>{title}</div>
          </div>
        </div>
        <div style={{ position: "absolute", top: 46, left: 0, right: 0, bottom: 0, overflow: "hidden" }}>{children}</div>
      </div>
    </div>
  );
}

/* ════════ SCENE 1 — THE QUESTION ════════ */
const FEED = ["Climate Resilience Advisory — East Africa", "Off-Grid Solar — 12 Health Facilities", "Digital Skills for Vulnerable Communities", "Vaccine Cold-Chain Equipment Supply", "M&E Framework Design — Sahel", "Translation & Localization LTA", "Road Maintenance — Northern Corridor", "Gender Mainstreaming Audit", "Renewable Mini-Grids — Feasibility", "WASH Programme Support", "Girls' Education — Endline Evaluation", "Humanitarian Logistics & Warehousing", "Climate Risk Screening Tool", "Nutrition Commodities Supply", "Borehole Drilling & Rehabilitation", "ICT Infrastructure Upgrade"];
export function SceneQuestion({ st }: { st: number }) {
  const drift = kf(st, [0, S.score], [0, 220], Easing.linear);
  const count = Math.floor(kf(st, [0.2, 1.6], [0, 2471], Easing.easeOutCubic));
  const qOp = gate(st, 1.4, 2.2);
  const dim = 0.18 + 0.5 * gate(st, 1.3, 2.1);
  return (
    <div style={{ position: "absolute", inset: 0, background: LC.ink, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${-drift}px)`, opacity: 1 - dim * 0.6 }}>
        {Array.from({ length: 26 }).map((_, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 60px", height: 38, borderBottom: "1px solid rgba(255,255,255,0.05)", color: "rgba(246,243,236,0.32)", fontFamily: sans, fontSize: 13 }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: "rgba(200,151,62,0.4)" }}>{String(421 - i).padStart(4, "0")}</span>
            <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{FEED[i % FEED.length]}</span>
            <span style={{ fontFamily: mono, fontSize: 9, color: "rgba(246,243,236,0.22)" }}>{["RFP", "ITB", "RFQ", "LTA", "EOI"][i % 5]}</span>
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 46%, rgba(15,22,32,0.2), rgba(15,22,32,0.92) 72%)" }} />
      <div style={{ position: "absolute", top: 60, left: 0, right: 0, textAlign: "center", opacity: 1 - gate(st, 1.6, 2.3) }}>
        <span style={{ fontFamily: disp, fontSize: 30, color: LC.accent2 }}>{count.toLocaleString()}</span>
        <span style={{ fontFamily: mono, fontSize: 11, color: LC.onDarkMute, letterSpacing: "0.14em", textTransform: "uppercase", marginLeft: 10 }}>open tenders this week</span>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", opacity: qOp, transform: `translateY(${(1 - qOp) * 14}px)` }}>
        <div style={{ fontFamily: disp, fontSize: 52, color: LC.paper, textAlign: "center", lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: 820 }}>
          Which ones can you<br /><span style={{ fontStyle: "italic", color: LC.accent2 }}>actually win?</span>
        </div>
      </div>
    </div>
  );
}

/* ════════ SCENE 2 — THE SCORE ════════ */
const DIMS: Array<[string, number]> = [["Sector fit", 82], ["Geography", 88], ["Compliance", 47], ["Track record", 61], ["Documentation", 58]];
export function SceneScore({ st }: { st: number }) {
  const typed = "brightpath.io".slice(0, Math.floor(kf(st, [0.3, 1.0], [0, 13], Easing.linear)));
  const analyzing = st >= 1.3 && st < 2.7;
  const prog = gate(st, 1.3, 2.6) * 100;
  const revealed = st >= 2.7;
  const score = Math.floor(kf(st, [2.8, 3.9], [0, 64], Easing.easeOutCubic));
  return (
    <Browser>
      <div style={{ position: "absolute", inset: 0, padding: "0 56px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {!revealed && (
          <div style={{ maxWidth: 620, margin: "0 auto", width: "100%", textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: LC.accent, marginBottom: 16 }}>Free readiness assessment</div>
            <div style={{ fontFamily: disp, fontSize: 30, color: LC.ink, marginBottom: 22, letterSpacing: "-0.01em" }}>Start with your website.</div>
            <div style={{ display: "flex", border: `2px solid ${LC.ink}`, background: "#fff", maxWidth: 460, margin: "0 auto" }}>
              <span style={{ padding: "0 4px 0 16px", display: "flex", alignItems: "center", color: LC.faint, fontFamily: mono, fontSize: 15 }}>https://</span>
              <span style={{ flex: 1, textAlign: "left", padding: "15px 6px 15px 0", fontFamily: mono, fontSize: 15, color: LC.ink }}>{typed}<span style={{ opacity: st % 0.8 < 0.4 ? 1 : 0, color: LC.accent }}>|</span></span>
              <span style={{ background: LC.ink, color: LC.paper, padding: "0 22px", display: "flex", alignItems: "center", fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>Read site →</span>
            </div>
            {analyzing && (
              <div style={{ maxWidth: 460, margin: "22px auto 0" }}>
                <div style={{ height: 4, background: LC.paper2, position: "relative" }}><div style={{ position: "absolute", inset: 0, width: `${prog}%`, background: LC.ink }} /></div>
                <div style={{ fontFamily: mono, fontSize: 10, color: LC.mute, marginTop: 8, letterSpacing: "0.06em", textAlign: "left" }}>Reading your site · cross-checking 7 sources…</div>
              </div>
            )}
          </div>
        )}
        {revealed && (
          <div style={{ maxWidth: 880, margin: "0 auto", width: "100%", display: "grid", gridTemplateColumns: "320px 1fr", gap: 52, opacity: gate(st, 2.7, 3.0) }}>
            <div>
              <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: LC.accent, marginBottom: 4 }}>Readiness</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: disp, fontSize: 128, lineHeight: 0.82, letterSpacing: "-0.04em", color: LC.ink }}>{score}</span>
                <span style={{ fontFamily: disp, fontSize: 30, color: LC.faint }}>/100</span>
              </div>
              <div style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: LC.accent, marginTop: 10, opacity: gate(st, 3.9, 4.2) }}>Tier II · Mid-cap eligible</div>
            </div>
            <div style={{ alignSelf: "center" }}>
              <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: LC.mute, marginBottom: 10 }}>By dimension</div>
              {DIMS.map(([l, v], i) => {
                const w = gate(st, 3.6 + i * 0.16, 4.3 + i * 0.16) * v;
                return (
                  <div key={l} style={{ display: "grid", gridTemplateColumns: "130px 1fr 32px", gap: 12, alignItems: "center", padding: "7px 0", borderBottom: `1px dashed ${LC.ruleSoft}` }}>
                    <span style={{ fontFamily: sans, fontSize: 13, color: LC.ink }}>{l}</span>
                    <span style={{ position: "relative", height: 3, background: LC.paper2 }}><span style={{ position: "absolute", inset: 0, width: `${w}%`, background: barCol(v) }} /></span>
                    <span style={{ fontFamily: mono, fontSize: 12, color: LC.ink, textAlign: "right" }}>{Math.round(w)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Browser>
  );
}

/* ════════ SCENE 3 — THE MATCHES ════════ */
const MATCHES: Array<[number, string, string, string, string, string]> = [
  [86, "Climate Resilience Advisory — East Africa", "UNDP", "USD 1.2M", "8 days", LC.pos],
  [78, "Digital Skills for Vulnerable Communities", "EU · DG INTPA", "EUR 850K", "9 days", LC.pos],
  [71, "Off-Grid Solar — 12 Health Facilities", "UNICEF Kenya", "USD 420K", "12 days", LC.ink],
  [64, "Translation & Localization — Framework", "WFP", "Multi-year", "30 days", LC.ink],
  [58, "Gender Mainstreaming Audit", "UN Women", "USD 95K", "19 days", LC.warn],
];
export function SceneMatches({ st }: { st: number }) {
  return (
    <Workbench title="Matched tenders">
      <div style={{ padding: "20px 22px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, opacity: gate(st, 0.1, 0.5) }}>
          <span style={{ fontFamily: disp, fontSize: 40, color: LC.ink, lineHeight: 1 }}>18</span>
          <span style={{ fontFamily: sans, fontSize: 14, color: LC.ink2 }}>live tenders you actually fit —</span>
          <span style={{ fontFamily: mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.accent }}>ranked by fit</span>
        </div>
        <div style={{ border: `1px solid ${LC.rule}`, background: "#fff" }}>
          {MATCHES.map((m, i) => {
            const ap = gate(st, 0.4 + i * 0.28, 0.9 + i * 0.28, Easing.easeOutCubic);
            const hot = i === 0 && st > 2.6;
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 1fr 130px 70px", gap: 14, alignItems: "center", padding: "13px 16px", borderBottom: i < 4 ? `1px solid ${LC.ruleSoft}` : "none", opacity: ap, transform: `translateX(${(1 - ap) * 22}px)`, background: hot ? "#fbf6ea" : "transparent", outline: hot ? `1.5px solid ${LC.accent}` : "none" }}>
                <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: m[5] }}>{m[0]}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontSize: 13.5, color: LC.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m[1]}</div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: LC.mute, marginTop: 2 }}>{m[2]}</div>
                </div>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: LC.ink2 }}>{m[3]}</span>
                <span style={{ fontFamily: mono, fontSize: 11, color: m[4][0] <= "1" ? LC.neg : LC.mute, fontWeight: 600, textAlign: "right" }}>{m[4]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Workbench>
  );
}

/* ════════ SCENE 4 — THE VERDICT ════════ */
export function SceneVerdict({ st }: { st: number }) {
  const pasted = st > 0.4;
  const analyzing = st >= 0.9 && st < 1.9;
  const verdict = st >= 1.9;
  const gauge = gate(st, 1.9, 2.7) * 86;
  const reasons: Array<[string, boolean]> = [["Sector & geography match your profile", true], ["You meet 4 of 5 eligibility requirements", true], ["1 document still needed — fixable in a day", false]];
  return (
    <Workbench title="Bid / no-bid">
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 40px" }}>
        <div style={{ width: 720, background: LC.paper, border: `1px solid ${LC.rule}`, boxShadow: "0 20px 50px rgba(15,22,32,0.16)" }}>
          <div style={{ borderBottom: `1px solid ${LC.rule}`, padding: "12px 18px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.accent }}>Pasted tender</span>
            <span style={{ flex: 1, fontFamily: sans, fontSize: 12.5, color: LC.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: pasted ? 1 : 0 }}>Climate Resilience Advisory — East Africa · UNDP</span>
          </div>
          {analyzing && (
            <div style={{ padding: "40px 18px", textAlign: "center" }}>
              <div style={{ width: 220, height: 4, background: LC.paper2, margin: "0 auto", position: "relative" }}><div style={{ position: "absolute", inset: 0, width: `${gate(st, 0.9, 1.9) * 100}%`, background: LC.ink }} /></div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: LC.mute, marginTop: 12, letterSpacing: "0.06em" }}>Reading requirements · scoring fit…</div>
            </div>
          )}
          {verdict && (
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 0, opacity: gate(st, 1.9, 2.2) }}>
              <div style={{ background: LC.pos, color: "#fff", padding: "26px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transform: `scale(${kf(st, [1.9, 2.4], [0.85, 1], Easing.easeOutBack)})` }}>
                <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.85 }}>Verdict</div>
                <div style={{ fontFamily: disp, fontSize: 60, lineHeight: 1, margin: "6px 0" }}>BID</div>
                <div style={{ fontFamily: mono, fontSize: 12 }}>{Math.round(gauge)}% fit</div>
              </div>
              <div style={{ padding: "20px 22px" }}>
                <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: LC.mute, marginBottom: 12 }}>Why</div>
                {reasons.map(([r, ok], i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "7px 0", opacity: gate(st, 2.3 + i * 0.22, 2.6 + i * 0.22) }}>
                    <span style={{ width: 17, height: 17, borderRadius: "50%", background: ok ? LC.pos : LC.warn, color: "#fff", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{ok ? "✓" : "!"}</span>
                    <span style={{ fontFamily: sans, fontSize: 12.5, color: LC.ink2, lineHeight: 1.4 }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Workbench>
  );
}

/* ════════ SCENE 5 — READY TO SUBMIT ════════ */
const GAPS: Array<[string, string]> = [["Audited financials (3 yr)", "from your vault"], ["ISO 9001 — quality", "cert. on file"], ["Third client reference", "drafted for you"]];
const FIELDS: Array<[string, string]> = [["Legal entity", "BrightPath Solutions Ltd."], ["Proposed fee (USD)", "1,284,500"], ["Lot / region", "East Africa — full scope"], ["Bid validity", "120 days"]];
export function SceneSubmit({ st }: { st: number }) {
  const score = Math.floor(kf(st, [0.6, 2.6], [64, 78], Easing.easeOutCubic));
  const submitting = st >= 3.4 && st < 4.0;
  const submitted = st >= 4.0;
  return (
    <Workbench title="Submissions">
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 30px" }}>
        <div style={{ width: 760, background: LC.paper, boxShadow: "0 22px 56px rgba(15,22,32,0.2)" }}>
          <div style={{ background: LC.ink, color: LC.paper, padding: "13px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", color: LC.accent2 }}>Submission · Climate Resilience Advisory</div>
              <div style={{ fontFamily: disp, fontSize: 16, marginTop: 2 }}>Assembled from your profile</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: disp, fontSize: 24, color: LC.accent2, lineHeight: 1 }}>{score}<span style={{ fontFamily: mono, fontSize: 9, color: LC.onDarkMute }}>/100</span></div>
              <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: LC.onDarkMute }}>Readiness ↑</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: LC.rule }}>
            <div style={{ background: LC.paper, padding: "16px 18px" }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LC.mute, marginBottom: 12 }}>Blockers — closed</div>
              {GAPS.map((g, i) => {
                const on = st >= 0.6 + i * 0.45;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${on ? "#bfe0cc" : LC.rule}`, background: on ? "#f3f8f4" : "#fff", padding: "9px 11px", marginBottom: 8, transition: "all .25s" }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: on ? LC.pos : "#fff", border: `1.5px solid ${on ? LC.pos : LC.rule}`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, flexShrink: 0 }}>{on ? "✓" : ""}</span>
                    <span style={{ flex: 1, fontFamily: sans, fontSize: 11.5, color: LC.ink }}>{g[0]}</span>
                    <span style={{ fontFamily: mono, fontSize: 8.5, color: on ? LC.pos : LC.faint }}>{on ? g[1] : "…"}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ background: LC.paper, padding: "16px 18px" }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: LC.mute, marginBottom: 12 }}>Response pack — ready for review</div>
              {FIELDS.map((f, i) => {
                const on = st >= 1.0 + i * 0.32;
                return (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: LC.faint, marginBottom: 4 }}>{f[0]}</div>
                    <div style={{ border: `1px solid ${on ? "#bfe0cc" : LC.rule}`, background: on ? "#f3f8f4" : "#fff", padding: "8px 11px", fontFamily: sans, fontSize: 12, color: on ? LC.ink : "transparent", display: "flex", alignItems: "center", gap: 8, minHeight: 32, transition: "all .25s" }}>
                      {on && <span style={{ color: LC.pos, fontSize: 11 }}>✓</span>}<span>{on ? f[1] : "…"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${LC.rule}`, background: "#fff", padding: "13px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ flex: 1, fontFamily: mono, fontSize: 9.5, color: submitted ? LC.pos : LC.mute }}>{submitted ? "✓ Submitted — compliant, on time" : submitting ? "Submitting securely…" : "Everything checks out. Ready to submit."}</span>
            <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", background: submitted ? LC.pos : LC.accent, padding: "11px 20px", display: "flex", alignItems: "center", gap: 8 }}>
              {submitting && <span style={{ width: 11, height: 11, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", animation: "lkspin .8s linear infinite" }} />}
              {submitted ? "✓ Submitted" : submitting ? "Submitting" : "Submit →"}
            </span>
          </div>
        </div>
      </div>
    </Workbench>
  );
}

/* ════════ SCENE 6 — WON ════════ */
export function SceneWon({ st }: { st: number }) {
  const stamp = kf(st, [0.2, 0.9], [1.7, 1], Easing.easeOutBack);
  const stampOp = gate(st, 0.2, 0.7);
  const lineOp = gate(st, 1.8, 2.5);
  const ctaOp = gate(st, 2.6, 3.2);
  const awardedGone = gate(st, 1.7, 2.2);
  return (
    <div style={{ position: "absolute", inset: 0, background: LC.ink, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: -60, right: -40, fontFamily: disp, fontSize: 300, color: "rgba(200,151,62,0.06)", lineHeight: 1 }}>§</div>
      <div style={{ position: "absolute", textAlign: "center", opacity: stampOp * (1 - awardedGone), transform: `translateY(${-awardedGone * 40}px)` }}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: LC.accent2 }}>Contract awarded</div>
        <div style={{ border: `2px solid ${LC.accent2}`, color: LC.accent2, fontFamily: disp, fontSize: 50, padding: "8px 28px", margin: "16px 0", transform: `scale(${stamp}) rotate(-3deg)`, letterSpacing: "0.04em" }}>AWARDED</div>
        <div style={{ fontFamily: disp, fontSize: 22, color: LC.paper }}>Climate Resilience Advisory · USD 1.2M</div>
      </div>
      <div style={{ position: "absolute", textAlign: "center", opacity: lineOp, transform: `translateY(${(1 - lineOp) * 16}px)` }}>
        <div style={{ fontFamily: disp, fontSize: 54, color: LC.paper, lineHeight: 1.04, letterSpacing: "-0.02em" }}>
          Stop chasing every tender.<br /><span style={{ fontStyle: "italic", color: LC.accent2 }}>Make the right ones count.</span>
        </div>
        <div style={{ marginTop: 26, opacity: ctaOp, display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "#fff", background: LC.accent, padding: "12px 22px" }}>Get your free score →</span>
          <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: "0.08em", color: LC.onDarkMute }}>tenderpath.io</span>
        </div>
      </div>
    </div>
  );
}

/* ── director table + cursor paths ──────────────────────────── */
export type SceneComp = (props: { st: number }) => ReactNode;
export const SCENES: Array<[number, number, SceneComp, string | null]> = [
  [S.q, S.score, SceneQuestion, null],
  [S.score, S.match, SceneScore, "Paste your website — a readiness score in seconds."],
  [S.match, S.verdict, SceneMatches, "Every live tender you actually fit, ranked."],
  [S.verdict, S.submit, SceneVerdict, "Paste any tender. Get an instant bid / no-bid call."],
  [S.submit, S.won, SceneSubmit, "Close the gaps — then review, approve and submit through the official channel."],
  [S.won, S.end, SceneWon, null],
];
export const SCORE_CURSOR: number[][] = [[0, 760, 250], [0.9, 770, 360], [1.1, 770, 360], [2.0, 760, 250]];
export const VERDICT_CURSOR: number[][] = [[0, 700, 250], [0.5, 640, 360], [0.7, 640, 360], [1.2, 700, 420]];
export const SUBMIT_CURSOR: number[][] = [[2.8, 700, 300], [3.3, 900, 470], [3.5, 900, 470], [4.2, 900, 470]];
export { gate };
