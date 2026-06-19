"use client";

/* Matches — every tender the company fits, ranked, with the evidence and a
 * recommended next action per tender. Expandable rows; the left CTA always
 * opens the bid/no-bid Paste flow seeded with the tender, the right CTA defers
 * to the best action that ISN'T bid/no-bid so the two never duplicate. */

import { useState } from "react";
import { C, F } from "../tokens";
import { Eyebrow, Card, Btn, FitBadge, Tag, DeadlinePill, SectionHead, Chip, shortDate, daysUntil, isSoon } from "../ui";
import { bucketMeta } from "../buckets";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { BucketKey, WbMatch } from "@/lib/workbench/types";

function nextStep(m: WbMatch): { step: string; detail: string; route: string } {
  let detail: string;
  if (isSoon(m.deadline)) detail = "Deadline's close — make the bid / no-bid call now, then move on the next step.";
  else if (m.fit >= 75) detail = "Strong fit — move from shortlist to submission.";
  else if (m.roster) detail = "UN agency opportunity — verify roster / LTA registration first.";
  else detail = "Review the match evidence before investing proposal time.";

  let step: string;
  let route: string;
  if (m.fit >= 75) {
    step = "Start a proposal package";
    route = "proposals";
  } else if (m.roster) {
    step = "Check roster / LTA path";
    route = "proposals";
  } else {
    step = "Qualify the fit";
    route = "browse";
  }
  return { step, detail, route };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>{label}</div>
      <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, marginTop: 4, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Row({ m, open, onToggle }: { m: WbMatch; open: boolean; onToggle: () => void }) {
  const { go, openPaste } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const [label, color] = bucketMeta(m.bucket);
  const { step, detail, route } = nextStep(m);
  return (
    <div style={{ borderBottom: `1px solid ${C.ruleSoft}` }}>
      <button
        onClick={onToggle}
        style={{ display: "grid", gridTemplateColumns: mobile ? "8px 1fr auto" : "8px 70px 1fr 120px 48px 76px 16px", gap: mobile ? 12 : 14, alignItems: "center", width: "100%", textAlign: "left", padding: mobile ? "14px 16px" : "15px 20px", background: open ? C.paper : "transparent", border: 0, cursor: "pointer" }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 999, background: color }} />
        {!mobile && <span title={m.code} style={{ fontFamily: F.mono, fontSize: 10.5, color: C.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{m.code}</span>}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: F.sans, fontSize: 14.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{m.agency}</span>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color, flexShrink: 0, whiteSpace: "nowrap" }}>· {label}</span>
          </span>
        </span>
        {!mobile && <span style={{ fontFamily: F.mono, fontSize: 11.5, color: C.ink2, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{m.value}</span>}
        <span style={{ textAlign: "right" }}><FitBadge score={m.fit} /></span>
        {!mobile && <span style={{ textAlign: "right" }}><DeadlinePill deadline={m.deadline} /></span>}
        {!mobile && <span style={{ color: C.faint, fontSize: 13, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s", textAlign: "center" }}>⌄</span>}
      </button>

      {open && (
        <div style={{ padding: mobile ? "4px 16px 22px" : "8px 20px 24px 42px", background: C.paper, borderTop: `1px solid ${C.ruleSoft}` }}>
          <div style={{ maxWidth: 720, marginBottom: 16 }}>
            <Eyebrow>Why this matched</Eyebrow>
            <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.6, color: C.ink2, margin: "8px 0 0" }}>{m.why}</p>
            {m.sectors.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                {m.sectors.map((s) => <Tag key={s}>{s}</Tag>)}
              </div>
            )}
            {m.caveat && <p style={{ fontFamily: F.sans, fontSize: 12, color: C.warn, fontStyle: "italic", marginTop: 10 }}>Caveat — {m.caveat}</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "14px 28px", padding: "16px 0", borderTop: `1px solid ${C.rule}`, borderBottom: `1px solid ${C.rule}` }}>
            <Stat label="Type" value={m.type} />
            <Stat label="Source" value={m.source} />
            <Stat label="Closes" value={m.deadline ? `${shortDate(m.deadline)} · ${daysUntil(m.deadline)}d` : "—"} />
            <Stat label="Est. value" value={m.value} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
            <div style={{ minWidth: 220, flex: 1 }}>
              <Eyebrow color={C.accent}>Recommended next step</Eyebrow>
              <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, marginTop: 5 }}>{detail}</div>
            </div>
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
              <Btn kind="ghost" size="sm" onClick={() => openPaste(m)}>Bid / no-bid</Btn>
              <Btn kind="primary" size="sm" onClick={() => go(route)}>{step} →</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function MatchesPage() {
  const { data, openPaste } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const matches = data.matches;
  const [filter, setFilter] = useState<"all" | BucketKey>("all");
  const [openId, setOpenId] = useState<number | null>(matches[0]?.id ?? null);

  const buckets: ("all" | BucketKey)[] = ["all", "act_now", "strong_fit", "strategic", "adjacent", "watchlist"];
  const rows = filter === "all" ? matches : matches.filter((m) => m.bucket === filter);
  const count = (b: "all" | BucketKey) => (b === "all" ? matches.length : matches.filter((m) => m.bucket === b).length);
  const avgFit = matches.length ? Math.round(matches.reduce((a, m) => a + m.fit, 0) / matches.length) : 0;

  if (matches.length === 0) {
    return (
      <div>
        <SectionHead n="02" title="Matched tenders" count={0} hint="Ranked by fit · refreshed daily" />
        <Card pad={24}>
          <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, margin: 0 }}>
            No matched tenders yet. They appear here once your assessment runs and the daily sync finds opportunities that fit your profile.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <SectionHead n="02" title="Matched tenders" count={data.pipeline.matched} hint="Ranked by fit · refreshed daily" />

      {/* intro strip */}
      <div style={{ display: "flex", gap: 1, background: C.rule, border: `1px solid ${C.rule}`, marginBottom: 24, flexWrap: mobile ? "wrap" : "nowrap" }}>
        {([["Total matches", String(data.pipeline.matched)], ["Strong fit ≥70%", String(data.pipeline.strong)], ["Closing this week", String(data.pipeline.dueSoon)], ["Avg fit", `${avgFit}%`]] as [string, string][]).map(([l, v]) => (
          <div key={l} style={{ flex: mobile ? "1 1 45%" : 1, background: C.white, padding: "14px 18px" }}>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>{l}</div>
            <div style={{ fontFamily: F.display, fontSize: 28, color: C.ink, marginTop: 4, lineHeight: 1 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* bucket filters */}
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16, overflowX: "auto" }}>
        {buckets.map((b) => (
          <Chip key={b} active={filter === b} onClick={() => setFilter(b)}>
            {b === "all" ? "All" : bucketMeta(b)[0]} · {count(b)}
          </Chip>
        ))}
      </div>

      <Card style={{ overflow: "hidden" }}>
        {rows.map((m) => (
          <Row key={m.id} m={m} open={openId === m.id} onToggle={() => setOpenId(openId === m.id ? null : m.id)} />
        ))}
        {rows.length === 0 && <div style={{ padding: "18px 20px", fontFamily: F.sans, fontSize: 13, color: C.mute }}>No tenders in this bucket.</div>}
      </Card>

      <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, marginTop: 16, textAlign: "center" }}>
        Don&apos;t see one you&apos;re tracking?{" "}
        <button onClick={() => openPaste()} style={{ color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}>Paste a tender</button>{" "}
        to score it instantly.
      </p>
    </div>
  );
}
