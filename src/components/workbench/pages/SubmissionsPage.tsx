"use client";

/* Submissions — the paid, per-submission lane. Shows the user's real in-progress
 * work orders and the published per-format rate card. "Skin in the game — we only
 * get paid when you decide to bid." Billed separately from the subscription. */

import { useRouter } from "next/navigation";
import { C, F } from "../tokens";
import { Card, Btn, SectionHead, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { SUBMISSION_TYPES } from "@/lib/workbench/pricing";
import type { WbSubmission } from "@/lib/workbench/types";

const STATUS_META: Record<string, { label: string; bg: string; pct: number }> = {
  drafting: { label: "Drafting", bg: C.warn, pct: 55 },
  review: { label: "Your review", bg: C.blue, pct: 85 },
  submitted: { label: "Delivered", bg: C.pos, pct: 100 },
};

function OrderCard({ s }: { s: WbSubmission }) {
  const router = useRouter();
  const mobile = useMedia("(max-width: 1023px)");
  const meta = STATUS_META[s.status] ?? STATUS_META.drafting;
  return (
    <Card style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr auto", gap: mobile ? 14 : 24, padding: "18px 20px", alignItems: "center" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.white, background: meta.bg, padding: "3px 8px" }}>{meta.label}</span>
          <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute }}>{s.type} · #{s.id}</span>
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 15.5, color: C.ink, fontWeight: 500, marginTop: 8 }}>{s.tender}</div>
        <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 4 }}>
          {[s.due ? `due ${shortDate(s.due)}` : null, s.updated ? `updated ${s.updated}` : null].filter(Boolean).join(" · ") || s.stage}
        </div>
        <div style={{ height: 3, background: C.paper2, marginTop: 12, maxWidth: 320 }}>
          <div style={{ height: 3, background: meta.bg, width: `${meta.pct}%` }} />
        </div>
        <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 7 }}>{s.stage}</div>
      </div>
      <div style={{ textAlign: mobile ? "left" : "right" }}>
        <Btn kind={s.status === "review" ? "gold" : "ghost"} size="sm" onClick={() => router.push(s.href)}>
          {s.status === "review" ? "Review draft →" : "Open →"}
        </Btn>
      </div>
    </Card>
  );
}

export function SubmissionsPage() {
  const router = useRouter();
  const { data, openPaste } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const orders = data.submissions.filter((s) => s.status !== "submitted");

  return (
    <div>
      {orders.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <SectionHead n="05" title="In progress" count={orders.length} hint="Skin in the game — billed only when you decide to bid" />
          <div style={{ display: "grid", gap: 14 }}>
            {orders.map((s) => <OrderCard key={s.id} s={s} />)}
          </div>
        </div>
      )}

      <div>
        <SectionHead title="Commission a new proposal" hint="Per submission · separate from your subscription" />
        {data.access.freeSubmissionEligible && (
          <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", marginBottom: 14, borderLeft: `3px solid ${C.pos}`, background: "#f3f8f4", flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.white, background: C.pos, padding: "3px 8px" }}>On us</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, flex: 1, minWidth: 220 }}>
              <strong style={{ fontWeight: 600 }}>Your first proposal submission is free</strong> while you&apos;re on trial — the credit is applied automatically at checkout, any format below.
            </span>
          </Card>
        )}
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 14 }}>
          {SUBMISSION_TYPES.map((t) => (
            <Card key={t.code} style={{ display: "flex", flexDirection: "column", padding: "18px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontFamily: F.display, fontSize: 26, color: C.ink }}>{t.code}</span>
                <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, border: `1px solid ${C.ruleSoft}`, padding: "2px 6px" }}>{t.complexity}</span>
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, fontWeight: 600, marginTop: 10 }}>{t.name}</div>
              <p style={{ fontFamily: F.sans, fontSize: 12.5, lineHeight: 1.5, color: C.mute, margin: "6px 0 0", flex: 1 }}>{t.desc}</p>
              <div style={{ marginTop: 14 }}>
                <span style={{ fontFamily: F.display, fontSize: 24, color: C.ink }}>${t.price}</span>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}> /submission</span>
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute, marginTop: 3 }}>{t.turnaround} turnaround</div>
              <div style={{ marginTop: 14 }}>
                <Btn kind="primary" size="sm" full onClick={() => router.push(`/dashboard/services/proposal?type=${t.code}`)}>Start →</Btn>
              </div>
            </Card>
          ))}
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 11.5, color: C.faint, marginTop: 12 }}>
          Final price is confirmed at checkout based on the submission format.
        </p>

        <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "18px 20px", marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <div style={{ fontFamily: F.sans, fontSize: 14.5, color: C.ink, fontWeight: 500 }}>Not sure which format?</div>
            <div style={{ fontFamily: F.sans, fontSize: 13, color: C.mute, marginTop: 4 }}>Paste the tender and we&apos;ll detect the type, price it, and request only the inputs it scores on.</div>
          </div>
          <Btn kind="gold" size="sm" onClick={() => openPaste()}>Paste a tender to begin →</Btn>
        </Card>
      </div>
    </div>
  );
}
