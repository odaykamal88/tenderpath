"use client";

import { useEffect, useMemo, useState } from "react";
import { C, F } from "@/components/workbench/tokens";
import { useMedia } from "@/components/workbench/useMedia";
import { Eyebrow } from "@/components/workbench/ui";
import type { WizardData } from "@/app/assessment/WizardSteps";

const STEPS = [
  "Reading your profile",
  "Confirming sectors & services",
  "Cross-checking UNGM eligibility",
  "Scanning live tenders — UN, EU, donor",
  "Matching to your capabilities",
  "Surfacing grant windows",
  "Scoring readiness",
];

const ORG_LABEL: Record<string, string> = {
  company: "Company / SME",
  ngo: "NGO / Non-profit",
  "sole-trader": "Sole trader",
  government: "Government entity",
};

function ungmStatus(v: string): { text: string; flag: boolean } {
  if (v === "yes") return { text: "Registered", flag: false };
  if (v === "in-progress") return { text: "In progress", flag: false };
  if (v === "no") return { text: "Not registered — flagged", flag: true };
  return { text: "Unconfirmed", flag: false };
}

/**
 * Presentational analysis beat. Animates a step list + reveals findings drawn
 * from what the user actually entered/we crawled (no fabricated values). The
 * parent owns real completion — it polls the pipeline and navigates to the
 * report — so this never claims 100%; it creeps to ~92% and holds.
 */
export function AnalyzingScreen({ site, wizard }: { site: string; wizard: WizardData }) {
  const mobile = useMedia("(max-width: 860px)");
  const reduce =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [active, setActive] = useState(reduce ? STEPS.length - 1 : 0);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const step = setInterval(() => setActive((a) => Math.min(a + 1, STEPS.length - 1)), 1600);
    const clock = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      clearInterval(step);
      clearInterval(clock);
    };
  }, [reduce]);

  const pct = Math.min(94, 6 + Math.round((active / (STEPS.length - 1)) * 86));
  const ungm = ungmStatus(wizard.unRegistered);

  const findings: [string, string, boolean][] = useMemo(() => {
    const out: [string, string, boolean][] = [];
    if (wizard.sectors.length) out.push(["Sectors", wizard.sectors.join(" · "), false]);
    if (wizard.operatingCountries.length) out.push(["Geography", wizard.operatingCountries.join(" · "), false]);
    if (wizard.orgType) out.push(["Organization", ORG_LABEL[wizard.orgType] ?? wizard.orgType, false]);
    if (wizard.submissionLanguage) out.push(["Submission language", wizard.submissionLanguage, false]);
    if (wizard.unRegistered) out.push(["UNGM status", ungm.text, ungm.flag]);
    out.push(["Score", "Computing…", false]);
    return out;
  }, [wizard, ungm.text, ungm.flag]);

  const findShown = Math.min(findings.length, active + 1);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  const label = site ? `Reading ${site}` : "Analyzing your profile";

  return (
    <div style={{ paddingTop: mobile ? 34 : 64 }}>
      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1.15fr 0.85fr", gap: mobile ? 30 : 56 }}>
        <div>
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: C.accent,
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 9,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: 999, background: C.accent, display: "inline-block", animation: "tpBlink 1s infinite", flexShrink: 0 }} />
            <span style={{ whiteSpace: "nowrap" }}>
              {label} · {mm}:{ss}
            </span>
          </div>
          <h2
            style={{
              fontFamily: F.display,
              fontSize: mobile ? 32 : 44,
              fontWeight: 400,
              color: C.ink,
              letterSpacing: "-0.02em",
              lineHeight: 1.03,
              margin: "0 0 22px",
            }}
          >
            Reading your profile.
            <br />
            Cross-checking live sources.
          </h2>

          {/* progress */}
          <div style={{ position: "relative", height: 5, background: C.paper2, marginBottom: 8 }}>
            <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: C.ink, transition: "width .5s cubic-bezier(.4,0,.2,1)" }} />
          </div>
          <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, letterSpacing: "0.08em", marginBottom: 26 }}>
            {pct}% · hang tight, this can take up to a minute
          </div>

          {/* steps */}
          <div>
            {STEPS.map((step, i) => {
              const status = i < active ? "done" : i === active ? "running" : "queued";
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "18px 1fr 84px",
                    gap: 12,
                    padding: "11px 0",
                    borderBottom: `1px dashed ${C.ruleSoft}`,
                    alignItems: "center",
                    fontSize: 13.5,
                  }}
                >
                  <span style={{ color: status === "done" ? C.pos : status === "running" ? C.accent : C.faint, fontSize: 13 }}>
                    {status === "done" ? "✓" : status === "running" ? (
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: C.accent, animation: "tpBlink 1s infinite" }} />
                    ) : (
                      "○"
                    )}
                  </span>
                  <span style={{ fontFamily: F.sans, color: status === "queued" ? C.faint : C.ink, transition: "color .3s" }}>{step}</span>
                  <span
                    style={{
                      fontFamily: F.mono,
                      fontSize: 9,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: status === "running" ? C.accent : C.faint,
                      textAlign: "right",
                    }}
                  >
                    {status}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* live findings — from what the user told us + what we read */}
        <aside style={{ borderLeft: mobile ? "none" : `1px solid ${C.rule}`, paddingLeft: mobile ? 0 : 32 }}>
          <Eyebrow style={{ marginBottom: 14 }}>What we have so far</Eyebrow>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {findings.slice(0, findShown).map(([k, v, flag], i) => (
              <li key={i} style={{ padding: "11px 0", borderBottom: i < findings.length - 1 ? `1px solid ${C.ruleSoft}` : "none", animation: "tpFade .25s ease" }}>
                <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, letterSpacing: "0.12em", textTransform: "uppercase" }}>{k}</div>
                <div style={{ fontFamily: F.sans, fontSize: 13.5, color: flag ? C.neg : C.ink, marginTop: 3 }}>{v}</div>
              </li>
            ))}
          </ul>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, marginTop: 14, letterSpacing: "0.05em" }}>↻ Live — updates as we read.</div>
        </aside>
      </div>
    </div>
  );
}
