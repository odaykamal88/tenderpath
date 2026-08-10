"use client";

/* Readiness gaps — the register of every blocker with severity, score impact,
 * effort, and a "Fix" that opens the Navigator drawer. The dark banner shows
 * the live score and where closing everything would take it. */

import { C, F } from "../tokens";
import { Eyebrow, Card, Btn, SevDot, SectionHead } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { WbGap } from "@/lib/workbench/types";

function GapRow({ g, closed }: { g: WbGap; closed: boolean }) {
  const { openNavigator } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  return (
    <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 130px 174px", gap: mobile ? 14 : 18, alignItems: "center", padding: mobile ? "18px 18px" : "20px 22px", borderBottom: `1px solid ${C.ruleSoft}`, background: closed ? C.paper : C.white, opacity: closed ? 0.78 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {closed ? <span style={{ color: C.pos, fontSize: 14 }}>✓</span> : <SevDot severity={g.severity} size={8} />}
          <span style={{ fontFamily: F.sans, fontSize: 15.5, color: C.ink, fontWeight: 500, textDecoration: closed ? "line-through" : "none", textDecorationColor: C.faint }}>{g.title}</span>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.55, color: C.mute, margin: "8px 0 0", paddingLeft: mobile ? 0 : 24, maxWidth: 560 }}>{g.why}</p>
      </div>
      <div style={{ display: mobile ? "flex" : "block", gap: 18, alignItems: "center", paddingLeft: mobile ? 24 : 0 }}>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Score impact</div>
          <div style={{ fontFamily: F.mono, fontSize: 14, color: closed ? C.pos : C.ink, marginTop: 3 }}>
            {closed ? "+0" : "+" + g.impact}
            <span style={{ fontSize: 11, color: C.faint }}> pts</span>
          </div>
        </div>
        <div style={{ marginTop: mobile ? 0 : 8 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Effort</div>
          <div style={{ fontFamily: F.mono, fontSize: 12, color: C.ink2, marginTop: 3 }}>{g.eta}</div>
        </div>
      </div>
      <div style={{ textAlign: mobile ? "left" : "right", paddingLeft: mobile ? 24 : 0 }}>
        {closed ? (
          <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.pos }}>Covered</span>
        ) : (
          <Btn kind={g.severity === "high" ? "primary" : "ghost"} size="sm" onClick={() => openNavigator(g.id)}>{g.fixLabel} →</Btn>
        )}
      </div>
    </div>
  );
}

/** Pro-lock shown to free accounts on the Readiness-gaps page: the projection
 *  banner above still shows the score they'd gain (funnel), but the Navigator
 *  fix workflow is gated behind the subscription. */
function GapsProLock({ open, potential, onSubscribe }: { open: number; potential: number; onSubscribe: () => void }) {
  return (
    <Card pad={0} style={{ overflow: "hidden" }}>
      <div style={{ background: C.ink, color: C.paper, padding: "24px 26px" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 12 }}>
          <span style={{ color: C.accent2 }}>🔒</span>
          <Eyebrow color={C.accent2}>Pro feature</Eyebrow>
        </div>
        <div style={{ fontFamily: F.display, fontSize: 23, color: C.paper, lineHeight: 1.15 }}>
          Close your {open} {open === 1 ? "gap" : "gaps"} with the Navigator
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: "#cdc6b3", margin: "10px 0 0", maxWidth: 460 }}>
          The Gap Navigator walks you through each blocker step by step{potential > 0 ? <> — worth <b style={{ color: C.accent2 }}>+{potential} points</b> to your readiness</> : ""}. Unlock it with TenderPath Pro, alongside the Document Vault and unlimited bid/no-bid.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20, flexWrap: "wrap" }}>
          <button onClick={onSubscribe} style={{ background: C.accent, color: C.white, border: 0, padding: "12px 20px", cursor: "pointer", fontFamily: F.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Subscribe — $49/mo →
          </button>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#9aa3ad" }}>30-day trial · cancel anytime</span>
        </div>
      </div>
    </Card>
  );
}

export function GapsPage() {
  const { data, liveScore, openNavigator, openPaste, openSubscribe, isClosed, go } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const gaps = data.gaps;
  const open = gaps.filter((g) => g.status === "open" && !isClosed(g.id));
  const high = open.filter((g) => g.severity === "high").length;
  const potential = open.reduce((a, g) => a + g.impact, 0);
  const projected = Math.min(100, liveScore + potential);

  if (gaps.length === 0) {
    if (!data.hasAssessment) {
      const failed = data.assessmentStatus === "failed";
      return (
        <div>
          <SectionHead n="04" title="Readiness gaps" count={0} hint="Evidence-backed blockers and next actions" />
          <Card pad={24}>
            <Eyebrow color={failed ? C.neg : C.accent}>{failed ? "Assessment needs attention" : "Not evaluated yet"}</Eyebrow>
            <h2 style={{ fontFamily: F.display, fontSize: 24, fontWeight: 400, color: C.ink, margin: "8px 0 6px" }}>
              {failed ? "We could not finish your company assessment." : "Build your company file to identify real readiness gaps."}
            </h2>
            <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: C.mute, margin: "0 0 18px", maxWidth: 620 }}>
              {failed
                ? "No readiness conclusion has been made. Retry with stronger company evidence, or keep moving by evaluating a tender directly."
                : "TenderPath will only call a gap covered after it has evidence from your assessment or Vault. You can also start tender-first and score a live opportunity now."}
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn kind="primary" size="sm" onClick={() => go("/assessment/wizard")}>{failed ? "Retry assessment" : "Build company file"} →</Btn>
              <Btn kind="ghost" size="sm" onClick={() => openPaste()}>Start with a tender →</Btn>
            </div>
          </Card>
        </div>
      );
    }
    return (
      <div>
        <SectionHead n="04" title="Readiness gaps" count={0} hint="Close these to lift your score & unlock matches" />
        <Card pad={24}>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: C.pos, margin: 0 }}>Your completed assessment found no open gaps. Keep your Vault current as new tenders demand fresh documents.</p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHead n="04" title="Readiness gaps" count={open.length} hint="Close these to lift your score & unlock matches" />

      {/* projection banner */}
      <div style={{ background: C.ink, color: C.paper, padding: mobile ? "22px 22px" : "26px 30px", marginBottom: 28, display: "grid", gridTemplateColumns: mobile ? "1fr" : "auto 1fr auto", gap: mobile ? 18 : 32, alignItems: "center" }}>
        <div>
          <Eyebrow color={C.accent2}>Live readiness</Eyebrow>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <span style={{ fontFamily: F.display, fontSize: 52, lineHeight: 0.9, color: C.paper }}>{liveScore}</span>
            <span style={{ fontFamily: F.mono, fontSize: 12, color: "#9aa3ad" }}>→ {projected}</span>
          </div>
        </div>
        <div style={{ borderLeft: mobile ? "none" : `1px solid #28323e`, paddingLeft: mobile ? 0 : 32 }}>
          <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: "#cdc6b3", margin: 0, maxWidth: 480 }}>
            {high > 0 ? (
              <>
                You have <b style={{ color: C.paper }}>{high} critical {high === 1 ? "blocker" : "blockers"}</b>. Clearing every open gap would add <b style={{ color: C.accent2 }}>+{potential} points</b>. The Navigator does the heavy lifting on each.
              </>
            ) : (
              <>No critical blockers left. The remaining items are polish that strengthen technical scoring — worth closing as you have time.</>
            )}
          </p>
        </div>
        {high > 0 && !mobile && data.access.pro && (
          <button onClick={() => openNavigator(open[0].id)} style={{ background: C.accent, color: C.white, border: 0, padding: "13px 20px", cursor: "pointer", fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
            Fix top gap →
          </button>
        )}
      </div>

      {/* register — Pro unlocks the Navigator fix workflow */}
      {data.access.pro ? (
        <>
          <Card style={{ overflow: "hidden" }}>
            {gaps.map((g) => <GapRow key={g.id} g={g} closed={isClosed(g.id) || g.status === "covered"} />)}
          </Card>

          <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 16 }}>
            Gaps are detected from your assessment and re-checked whenever you upload to the Vault or a new tender demands something you don&apos;t have on file.
          </p>
        </>
      ) : (
        <GapsProLock open={open.length} potential={potential} onSubscribe={openSubscribe} />
      )}
    </div>
  );
}
