"use client";

/* Landing walkthrough — director + Stage wrapper. Default export so the section
 * can lazy-load it via next/dynamic (ssr:false). Paused by default; the user
 * presses play (or scrubs) inside the "See it work" section. */

import { useTime, Stage, Easing } from "./engine";
import {
  SCENES,
  Cursor,
  Caption,
  S,
  SCORE_CURSOR,
  VERDICT_CURSOR,
  SUBMIT_CURSOR,
  gate,
} from "./scenes";
import { LC } from "../kit";

function Director() {
  const t = useTime();
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: LC.ink }}>
      {SCENES.map(([a, b, Comp, cap], i) => {
        const inOp = gate(t, a, a + 0.4);
        const outOp = i < SCENES.length - 1 ? 1 - gate(t, b - 0.4, b) : 1;
        const op = Math.min(inOp, outOp);
        if (op <= 0.001) return null;
        const st = t - a;
        // subtle ken-burns per scene
        const z = 1 + 0.05 * gate(t, a, b, Easing.linear);
        const capOp = cap ? gate(t, a + 0.5, a + 1.0) * (1 - gate(t, b - 0.8, b - 0.4)) : 0;
        return (
          <div key={i} style={{ position: "absolute", inset: 0, opacity: op, zIndex: 10 + i }}>
            <div style={{ position: "absolute", inset: 0, transform: `scale(${z})`, transformOrigin: "50% 46%" }}>
              <Comp st={st} />
            </div>
            {cap && <Caption text={cap} op={capOp} />}
          </div>
        );
      })}
      {/* cursors layered above their scenes */}
      {t >= S.score && t < S.match && (
        <div style={{ position: "absolute", inset: 0, zIndex: 80 }}>
          <Cursor t={t - S.score} path={SCORE_CURSOR} clicks={[1.05]} />
        </div>
      )}
      {t >= S.verdict && t < S.submit && (
        <div style={{ position: "absolute", inset: 0, zIndex: 80 }}>
          <Cursor t={t - S.verdict} path={VERDICT_CURSOR} clicks={[0.65]} />
        </div>
      )}
      {t >= S.submit && t < S.won && (
        <div style={{ position: "absolute", inset: 0, zIndex: 80 }}>
          <Cursor t={t - S.submit} path={SUBMIT_CURSOR} clicks={[3.4]} />
        </div>
      )}
    </div>
  );
}

export default function Walkthrough() {
  return (
    <Stage width={1280} height={720} duration={S.end} background={LC.ink} persistKey="tp-walkthrough-v4" autoplay={false}>
      <Director />
    </Stage>
  );
}
