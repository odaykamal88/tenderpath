"use client";

/* Gap Navigator — the conversational, step-by-step drawer that walks a user
 * through closing a readiness gap. Steps reveal in turn; each can carry a
 * pre-filled copy block, an external link or a Vault deep-link, and the UNGM
 * levels table. "Mark gap closed" persists progress (via the provider) and
 * folds the gap's impact into the live score. Content comes from the real
 * Navigator script built server-side from the company profile + assessment. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { Icon } from "../icons";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { WbGap } from "@/lib/workbench/types";

function Bubble({ children, delay }: { children: ReactNode; delay: number }) {
  return <div style={{ animation: `tpFade .4s ease ${delay}s both` }}>{children}</div>;
}

export function NavigatorDrawer({ gap, onClose }: { gap: WbGap; onClose: () => void }) {
  const { markGapClosed, openVault, isClosed } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const cp = gap.copilot;
  const total = cp.steps.length;
  const [active, setActive] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(() => new Set());
  const [closedNow, setClosedNow] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closed = closedNow || isClosed(gap.id);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active, checked]);

  const toggleStep = (i: number) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      if (n.has(i) && i === active && active < total) setActive(active + 1);
      return n;
    });
  const allDone = checked.size >= total;

  const onMarkClosed = () => {
    markGapClosed(gap);
    setClosedNow(true);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.55)", animation: "tpFade .2s ease" }} />
      <div
        style={{
          position: "relative",
          width: mobile ? "100%" : 480,
          maxWidth: "100%",
          background: C.paper,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 60px rgba(15,22,32,0.3)",
          animation: "tpSlideR .26s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        {/* header */}
        <div style={{ background: C.ink, color: C.paper, padding: "18px 22px", display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: C.accent, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: F.display, fontSize: 17 }}>
            ✦
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent2 }}>Gap Navigator</div>
            <div style={{ fontFamily: F.display, fontSize: 19, color: C.paper, marginTop: 3, lineHeight: 1.15 }}>{gap.title}</div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: "#9aa3ad", marginTop: 5 }}>{cp.est}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: `1px solid #3a4654`, color: C.paper, width: 30, height: 30, cursor: "pointer", flexShrink: 0, display: "grid", placeItems: "center" }}>
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* progress */}
        {total > 0 && (
          <div style={{ padding: "11px 22px", borderBottom: `1px solid ${C.rule}`, background: C.white, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 3, background: C.paper2 }}>
              <div style={{ height: 3, background: C.pos, width: `${(checked.size / total) * 100}%`, transition: "width .3s" }} />
            </div>
            <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, fontVariantNumeric: "tabular-nums" }}>
              {checked.size}/{total} done
            </span>
          </div>
        )}

        {/* conversation */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "22px 22px 8px" }}>
          <Bubble delay={0.05}>
            <div style={{ display: "flex", gap: 11, marginBottom: 20 }}>
              <div style={{ width: 26, height: 26, borderRadius: 999, background: C.ink, color: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontFamily: F.display }}>✦</div>
              <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "14px 16px", flex: 1 }}>
                <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: C.ink2, margin: 0 }}>{cp.intro}</p>
              </div>
            </div>
          </Bubble>

          {cp.steps.map((s, i) => {
            const isChecked = checked.has(i);
            if (i > active) return null;
            return (
              <Bubble key={i} delay={0.08}>
                <div style={{ marginBottom: 16, marginLeft: 37, border: `1px solid ${isChecked ? "#bfe0cc" : C.rule}`, background: isChecked ? "#f3f8f4" : C.white, padding: "14px 16px", transition: "all .2s" }}>
                  <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                    <button
                      onClick={() => toggleStep(i)}
                      aria-label={`Step ${i + 1}`}
                      style={{ width: 20, height: 20, borderRadius: 999, border: `1.5px solid ${isChecked ? C.pos : C.rule}`, background: isChecked ? C.pos : C.white, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer", fontSize: 11, marginTop: 1 }}
                    >
                      {isChecked ? "✓" : ""}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent }}>Step {i + 1}</span>
                      <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.ink, fontWeight: 500, marginTop: 4, textDecoration: isChecked ? "line-through" : "none", textDecorationColor: C.faint }}>{s.t}</div>
                      {s.detail && <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.6, color: C.ink2, margin: "7px 0 0" }}>{s.detail}</p>}

                      {s.levels && (
                        <div style={{ marginTop: 12, border: `1px solid ${C.rule}` }}>
                          {s.levels.map((lv, li) => (
                            <div key={li} style={{ display: "grid", gridTemplateColumns: "62px 1fr", gap: 10, padding: "9px 11px", borderBottom: li < s.levels!.length - 1 ? `1px solid ${C.ruleSoft}` : "0", background: li === 0 ? "#f3f8f4" : C.white }}>
                              <div>
                                <div style={{ fontFamily: F.mono, fontSize: 11, fontWeight: 600, color: li === 0 ? C.pos : C.ink }}>{lv[0]}</div>
                                {li === 0 && <div style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: C.pos, marginTop: 2 }}>Start here</div>}
                              </div>
                              <div>
                                <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.accent, letterSpacing: "0.02em" }}>{lv[1]}</div>
                                <div style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, marginTop: 3, lineHeight: 1.45 }}>{lv[2]}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {s.copy && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11, background: C.paper, border: `1px solid ${C.rule}`, padding: "9px 11px" }}>
                          <code style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.copy}</code>
                          <button
                            onClick={(e) => {
                              const value = s.copy as string;
                              if (navigator.clipboard) void navigator.clipboard.writeText(value);
                              const b = e.currentTarget;
                              b.textContent = "Copied";
                              setTimeout(() => (b.textContent = "Copy"), 1200);
                            }}
                            style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: C.white, border: `1px solid ${C.rule}`, padding: "5px 9px", cursor: "pointer", flexShrink: 0 }}
                          >
                            Copy
                          </button>
                        </div>
                      )}

                      {s.link && (
                        <button
                          onClick={() => {
                            if (s.link === "vault") openVault();
                            else {
                              const url = s.link!.startsWith("http") ? s.link! : "https://" + s.link!;
                              window.open(url, "_blank", "noopener,noreferrer");
                            }
                          }}
                          title={s.link === "vault" ? "Open your document Vault" : "Opens " + s.link + " in a new tab"}
                          style={{ marginTop: 11, fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.blue, background: "none", border: `1px solid ${C.rule}`, padding: "7px 11px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 7 }}
                        >
                          {s.link === "vault" ? "↗ Open your Vault" : "↗ " + s.link}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </Bubble>
            );
          })}

          {allDone && total > 0 && !closed && (
            <Bubble delay={0.05}>
              <div style={{ marginLeft: 37, marginBottom: 16, background: C.ink, color: C.paper, padding: "16px 18px" }}>
                <div style={{ fontFamily: F.sans, fontSize: 14, color: C.paper, lineHeight: 1.5 }}>
                  That&apos;s every step. Mark this gap closed{gap.impact > 0 ? <> and I&apos;ll fold <b style={{ color: C.accent2 }}>+{gap.impact} points</b> into your live readiness</> : ""} and re-scan your matches.
                </div>
              </div>
            </Bubble>
          )}
        </div>

        {/* footer */}
        <div style={{ borderTop: `1px solid ${C.rule}`, background: C.white, padding: "14px 22px", display: "flex", gap: 10, alignItems: "center" }}>
          {closed ? (
            <div style={{ flex: 1, fontFamily: F.sans, fontSize: 13, color: C.pos, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>✓</span> Gap marked closed — upload the evidence to your Vault to lock the score gain.
            </div>
          ) : (
            <>
              <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, flex: 1 }}>
                {total > 0 ? (allDone ? "Ready to close" : `${total - checked.size} step${total - checked.size === 1 ? "" : "s"} remaining`) : "Reviewed"}
              </span>
              <Btn kind="ghost" size="sm" onClick={onClose}>
                Later
              </Btn>
              <Btn kind={allDone || total === 0 ? "gold" : "primary"} size="sm" onClick={onMarkClosed}>
                Mark gap closed →
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
