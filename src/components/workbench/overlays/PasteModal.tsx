"use client";

/* Paste a tender → bid / no-bid. The cross-cutting decision engine.
 *
 * Two honest paths:
 *  • Seeded from a match row → instant verdict from data we ALREADY hold (the
 *    match's fit, evidence and the user's open gaps). The decision writes are
 *    real: "Decide to bid" promotes the tender in the pipeline; "No-bid" records
 *    not-relevant feedback. The upsell hands off to the paid Submissions lane.
 *  • Free-text / file paste → there is no free analysis engine for an arbitrary
 *    tender yet, so rather than fabricate a verdict we route to the real paid
 *    bid/no-bid analysis (carrying the pasted text for the intake to pick up). */

import { useEffect, useRef, useState } from "react";
import { C, F } from "../tokens";
import { Eyebrow, Btn, daysUntil, fitColor, shortDate } from "../ui";
import { Icon } from "../icons";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { detectSubmissionType, submissionType } from "@/lib/workbench/pricing";
import type { WbMatch } from "@/lib/workbench/types";

type ReqKind = "have" | "gap" | "ask";

function Pill({ kind, resolved }: { kind: ReqKind; resolved?: boolean }) {
  const map: Record<ReqKind, [string, string, string]> = {
    have: ["On file", C.pos, "✓"],
    gap: resolved ? ["Resolved", C.pos, "✓"] : ["Gap", C.neg, "!"],
    ask: resolved ? ["Provided", C.pos, "✓"] : ["Need input", C.warn, "+"],
  };
  const [l, c, icon] = map[kind];
  return (
    <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: c, border: `1px solid ${c}33`, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {icon} {l}
    </span>
  );
}

interface PasteVerdict {
  tender: { title: string; agency: string | null };
  fit: number;
  recommend: boolean;
  summary: string;
  on_file: string[];
  gaps: string[];
  asks: string[];
}

export function PasteModal({ seed, onClose }: { seed: WbMatch | null; onClose: () => void }) {
  const { data, token, go, openNavigator, openSubscribe } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");

  // A seed is "scored" only when it carries a real fit (i.e. it's one of the
  // viewer's matches). A Browse row for a tender we haven't scored for this
  // user arrives with fit 0 — we must not fake a verdict for it, so it takes
  // the same paid-analysis path as free-text.
  const scored = !!seed && seed.fit > 0;
  const seededText = seed
    ? `${seed.title}\n${seed.agency} · ${seed.type}\nSource: ${seed.source} · ${seed.value}`
    : "";
  const [stage, setStage] = useState<"input" | "analysing" | "verdict" | "capped">("input");
  const [text, setText] = useState(seededText);
  const [file, setFile] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState<"bid" | "pass" | null>(null);
  const [analysis, setAnalysis] = useState<PasteVerdict | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [assistedFallback, setAssistedFallback] = useState<{ caseRef: string | null } | null>(null);
  /** Set when the free monthly bid/no-bid allowance is exhausted (402 from the
   *  cap) — drives the "capped" subscribe panel. */
  const [capUsage, setCapUsage] = useState<{ used: number; limit: number; remaining: number } | null>(null);
  /** Real win/loss record from submission outcomes — the calibration line only
   *  speaks when history exists (SPEC §6: never invent a record). */
  const [history, setHistory] = useState<{ wins: number; losses: number; lessonsApplied: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (stage !== "verdict" || history !== null) return;
    let live = true;
    fetch("/api/dashboard/submission-orders", { headers: authHeaders, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { orders?: { outcome?: { state?: string; debrief?: { state?: string } | null } }[] } | null) => {
        if (!live) return;
        const orders = d?.orders ?? [];
        const wins = orders.filter((o) => o.outcome?.state === "won").length;
        const losses = orders.filter((o) => o.outcome?.state === "lost").length;
        const lessonsApplied = orders.some((o) => o.outcome?.debrief?.state === "received");
        setHistory({ wins, losses, lessonsApplied });
      })
      .catch(() => {
        if (live) setHistory({ wins: 0, losses: 0, lessonsApplied: false });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, history]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const authHeaders: HeadersInit = token
    ? { authorization: `Bearer ${token}`, "content-type": "application/json" }
    : { "content-type": "application/json" };

  const analyse = async () => {
    if (scored) {
      // Seeded from a match — instant verdict from data we already hold. Still
      // claim one bid/no-bid credit so the free 3/month cap covers this path too
      // (the free-text path meters via /paste-analyze instead).
      setAnalysisError(null);
      setStage("analysing");
      try {
        const res = await fetch("/api/dashboard/bid-no-bid/consume", { method: "POST", headers: authHeaders });
        if (res.status === 402) {
          const b = (await res.json().catch(() => ({}))) as { usage?: { used: number; limit: number; remaining: number } };
          setCapUsage(b.usage ?? null);
          setStage("capped");
          return;
        }
      } catch {
        // A metering hiccup must never block a verdict the user can already see.
      }
      setTimeout(() => setStage("verdict"), 1300);
      return;
    }
    if (file && !text.trim()) {
      setAnalysisError("Continue to the guided workspace to upload this tender pack privately and complete the assisted review.");
      setAssistedFallback({ caseRef: null });
      return;
    }
    // Free-text / URL — run the real quick verdict (consumes a credit on success).
    setAnalysisError(null);
    setAssistedFallback(null);
    setStage("analysing");
    const t = text.trim();
    const isUrl = /^https?:\/\/\S+$/i.test(t);
    try {
      const res = await fetch("/api/dashboard/paste-analyze", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(isUrl ? { url: t } : { text: t }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { code?: string; case_ref?: string; error?: string; usage?: { used: number; limit: number; remaining: number } };
        if (res.status === 402 && b.code === "BID_NO_BID_LIMIT") {
          setCapUsage(b.usage ?? null);
          setStage("capped");
          return;
        }
        setAnalysisError(b.error ?? "Couldn't analyse this tender. Please try again.");
        if (b.code === "ANALYSIS_UNAVAILABLE") setAssistedFallback({ caseRef: b.case_ref ?? null });
        setStage("input");
        return;
      }
      const v = (await res.json()) as PasteVerdict;
      setAnalysis(v);
      setStage("verdict");
    } catch {
      setAnalysisError("We couldn't reach the automated analysis service. Your tender can still continue through assisted review.");
      setAssistedFallback({ caseRef: null });
      setStage("input");
    }
  };

  const matchGapId = (title: string): string | null => {
    const lt = title.toLowerCase();
    return (
      data.gaps.find((g) => {
        const gt = g.title.toLowerCase();
        return gt.includes(lt) || lt.includes(gt);
      })?.id ?? null
    );
  };

  // Verdict data — from the live analysis (free-text) or held match data (seeded).
  const fit = analysis ? analysis.fit : seed?.fit ?? 0;
  const haves: string[] = analysis ? analysis.on_file : (seed?.sectors ?? []).slice(0, 3).map((s) => `${s} experience`);
  const openGaps: { id: string | null; title: string }[] = analysis
    ? analysis.gaps.map((g) => ({ title: g, id: matchGapId(g) }))
    : data.gaps.filter((g) => g.status === "open").slice(0, 3).map((g) => ({ id: g.id, title: g.title }));
  const asks = analysis
    ? analysis.asks.map((label, i) => ({ id: `a${i}`, label, field: "Add the detail here…" }))
    : [
        { id: "method", label: "Technical methodology note", field: "Briefly, your delivery approach for this scope…" },
        { id: "team", label: "Proposed team / key CVs", field: "Key personnel you'd assign (names or roles)…" },
      ];
  // SPEC §6 verdict tiers — deterministic: fit ≥70 ∧ ≤2 open gaps → BID ·
  // fit ≥55 → CAUTION · else NO-BID ("save the effort" — passing is a win).
  const verdict: "bid" | "caution" | "pass" =
    fit >= 70 && openGaps.length <= 2 ? "bid" : fit >= 55 ? "caution" : "pass";
  const asksAnswered = asks.filter((a) => (answers[a.id] || "").trim().length > 4).length;
  const bidTitle = seed?.title ?? analysis?.tender.title ?? "Pasted tender";
  const subType = submissionType(detectSubmissionType(seed?.type ?? analysis?.tender.title));

  // The honest math (SPEC §6). Effort by format plus the visible qualification
  // gaps. This is a workload estimate and qualification aid, never an award
  // probability.
  const effortDays = { EOI: 1.5, RFQ: 2, ITB: 5, RFP: 6 }[subType.code] ?? 6;
  // Field-size norms by format — a statement about the format, not this tender.
  const typicalField = { EOI: "10–20 typical", RFQ: "8–15 typical", ITB: "6–12 typical", RFP: "5–10 typical" }[subType.code] ?? "5–12 typical";
  // The best alternative an open match offers (no-bid verdicts must name one).
  const seedKey = seed?.id ?? null;
  const bestAlt = data.matches
    .filter((m) => m.id !== seedKey && m.fit > 0 && (!m.deadline || daysUntil(m.deadline) == null || (daysUntil(m.deadline) ?? 0) >= 0))
    .reduce<WbMatch | null>((best, m) => (best == null || m.fit > best.fit ? m : best), null);

  const openGuidedSubmission = (fallbackReason: string | null) => {
    const trimmed = text.trim();
    const sourceUrl = /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : seed?.sourceUrl ?? null;
    const firstLine = trimmed.split("\n").map((line) => line.trim()).find(Boolean);
    const assistedSeed: WbMatch = {
      id: seed?.id ?? -Date.now(),
      tenderId: seed?.tenderId ?? null,
      code: seed?.code ?? "SUPPLIED",
      title: seed?.title ?? analysis?.tender.title ?? firstLine?.slice(0, 180) ?? "Supplier-provided tender",
      agency: seed?.agency ?? analysis?.tender.agency ?? "",
      type: seed?.type ?? subType.code,
      source: seed?.source ?? "Supplier-provided notice",
      deadline: seed?.deadline ?? null,
      value: seed?.value ?? "",
      fit: analysis?.fit ?? seed?.fit ?? 0,
      bucket: seed?.bucket ?? "watchlist",
      why: analysis?.summary ?? seed?.why ?? fallbackReason ?? "Supplier decided to proceed to the guided submission workspace.",
      sectors: seed?.sectors ?? [],
      roster: seed?.roster ?? false,
      caveat: fallbackReason,
      sourceUrl,
    };
    try {
      sessionStorage.setItem("tp_sub_assisted_seed", JSON.stringify(assistedSeed));
    } catch (error) {
      console.warn("[workbench:paste:assisted_seed_failed]", error);
    }
    onClose();
    go(`/dashboard/proposals?start=${subType.code}&assisted=1`);
  };

  const continueAssisted = () => openGuidedSubmission("Automated first read was unavailable; assisted review required.");

  const onBid = () => {
    setDecided("bid");
    // Promote to the active pipeline (best-effort — UI proceeds regardless).
    void fetch("/api/dashboard/pipeline", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        tender_id: seed?.tenderId ?? null,
        tender_title: bidTitle,
        tender_agency: seed?.agency ?? analysis?.tender.agency ?? null,
        tender_deadline: seed?.deadline ?? null,
        tender_value: seed?.value ?? null,
        fit_score: fit,
        stage: "evaluating",
        source_url: seed?.sourceUrl ?? null,
        match_reasons: seed?.why ? [seed.why] : analysis?.summary ? [analysis.summary] : null,
      }),
    }).catch((err) => console.warn("[workbench:paste:pipeline_failed]", err));
  };

  const onNoBid = () => {
    setDecided("pass");
    if (seed?.tenderId) {
      void fetch("/api/dashboard/tender-feedback", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ tender_id: seed.tenderId, status: "not_relevant" }),
      }).catch((err) => console.warn("[workbench:paste:feedback_failed]", err));
    }
  };

  const fixGap = (gapId: string) => {
    onClose();
    openNavigator(gapId);
  };

  const inputReady = text.trim().length > 8 || !!file;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 95, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: mobile ? 0 : "40px 20px", overflowY: "auto" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.6)", animation: "tpFade .2s ease" }} />
      <div style={{ position: "relative", width: 720, maxWidth: "100%", background: C.paper, minHeight: mobile ? "100%" : "auto", boxShadow: "0 30px 80px rgba(15,22,32,0.4)", animation: "tpPop .26s cubic-bezier(.2,.8,.2,1)" }}>
        {/* header */}
        <div style={{ background: C.ink, color: C.paper, padding: "18px 26px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ flex: 1 }}>
            <Eyebrow color={C.accent2}>Bid / no-bid engine</Eyebrow>
            <div style={{ fontFamily: F.display, fontSize: 21, color: C.paper, marginTop: 3 }}>
              {stage === "input" ? "Paste a tender" : stage === "analysing" ? "Reading the tender…" : stage === "capped" ? "Monthly limit reached" : "The verdict"}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: `1px solid #3a4654`, color: C.paper, width: 30, height: 30, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon name="close" size={13} />
          </button>
        </div>

        {/* INPUT */}
        {stage === "input" && (
          <div style={{ padding: 26 }}>
            <p style={{ fontFamily: F.sans, fontSize: 14.5, lineHeight: 1.6, color: C.ink2, margin: "0 0 18px", maxWidth: 560 }}>
              {scored
                ? "We've pre-filled this from your matched tender. Analyse it against your file for an instant bid / no-bid call — we only ask for what we don't already have."
                : seed
                  ? "We've pre-filled this tender. We'll read it, check it against your file, and give you a bid / no-bid call."
                  : "Drop a tender link or paste the notice text for a fast bid / no-bid read. For a PDF or Word pack, continue to the guided workspace to upload it privately and check every requirement."}
            </p>
            {!data.access.bidNoBid.unlimited && (
              <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", borderLeft: `2px solid ${C.accent}`, background: "#faf6ec", padding: "9px 12px" }}>
                <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2 }}>
                  {data.access.bidNoBid.remaining > 0
                    ? <><b>{data.access.bidNoBid.remaining}</b> of {data.access.bidNoBid.limit} free bid/no-bid calls left this month.</>
                    : <>You&apos;ve used all {data.access.bidNoBid.limit} free calls this month.</>}
                </span>
                <button onClick={() => { onClose(); openSubscribe(); }} style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.accent, background: "none", border: 0, borderBottom: `1px solid ${C.accent}`, cursor: "pointer", flexShrink: 0 }}>
                  Go unlimited →
                </button>
              </div>
            )}
            {analysisError && (
              <div role="alert" style={{ marginBottom: 14, borderLeft: `2px solid ${assistedFallback ? C.warn : C.neg}`, background: assistedFallback ? "#faf6ec" : "#fbeceb", padding: "11px 12px", fontFamily: F.sans, fontSize: 12.5, color: assistedFallback ? C.ink2 : C.neg }}>
                <div>{analysisError}</div>
                {assistedFallback && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 9 }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute }}>
                      {assistedFallback.caseRef ? `Case ${assistedFallback.caseRef}` : "Your tender details will carry forward"}
                    </span>
                    <Btn kind="primary" size="sm" onClick={continueAssisted}>Continue with assisted review →</Btn>
                  </div>
                )}
              </div>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Paste tender URL or the full notice text here…\n\ne.g. https://ungm.org/Public/Notice/..."}
              style={{ width: "100%", minHeight: 150, border: `1px solid ${C.rule}`, background: C.white, padding: "14px 16px", fontFamily: F.mono, fontSize: 12.5, lineHeight: 1.6, color: C.ink, resize: "vertical", outline: "none" }}
            />
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} style={{ display: "none" }} />
            {file ? (
              <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 12, background: "#f3f8f4", border: `1px solid #bfe0cc`, padding: "11px 14px" }}>
                <span style={{ color: C.pos, fontSize: 14 }}>✓</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute, marginTop: 2 }}>Ready to extract</div>
                </div>
                <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute, background: "none", border: 0, cursor: "pointer", flexShrink: 0 }}>
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, width: "100%", marginTop: 12, padding: "13px 14px", background: C.white, border: `1px dashed ${C.rule}`, cursor: "pointer", color: C.ink2 }}
              >
                <Icon name="upload" size={15} />
                <span style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>Upload tender PDF / Word — we&apos;ll extract it</span>
              </button>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, flexWrap: "wrap", gap: 12 }}>
              <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute }}>{scored ? "Pre-filled from a matched tender" : seed ? "Pre-filled — we'll run a full analysis" : "Paste a link, drop text, or upload a file"}</span>
              <div style={{ display: "flex", gap: 10 }}>
                <Btn kind="ghost" size="sm" onClick={onClose}>Cancel</Btn>
                <Btn kind="gold" size="sm" onClick={analyse} disabled={!inputReady}>
                  {file && !text.trim() ? "Continue with tender pack →" : "Analyse tender →"}
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ANALYSING */}
        {stage === "analysing" && (
          <div style={{ padding: "60px 26px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: 999, border: `2px solid ${C.paper2}`, borderTopColor: C.accent, animation: "tpSpin .8s linear infinite" }} />
            <div style={{ marginTop: 22, maxWidth: 340, marginInline: "auto" }}>
              {["Reading the requirements & scoring matrix", "Matching against your vendor file", "Detecting gaps & missing inputs"].map((l, i) => (
                <div key={i} style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, padding: "7px 0", animation: `tpFade .4s ease ${i * 0.35}s both`, display: "flex", gap: 9, alignItems: "center", justifyContent: "center" }}>
                  <span style={{ color: C.pos }}>✓</span> {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CAPPED — free monthly bid/no-bid allowance exhausted */}
        {stage === "capped" && (
          <div style={{ padding: "34px 30px", textAlign: "center" }}>
            <div style={{ width: 46, height: 46, margin: "0 auto", borderRadius: 999, background: "#f8f2e2", border: `1px solid #e4d9bd`, display: "grid", placeItems: "center", color: C.accent, fontSize: 20 }}>🔒</div>
            <div style={{ fontFamily: F.display, fontSize: 23, color: C.ink, marginTop: 16 }}>
              You&apos;ve used your {capUsage?.limit ?? data.access.bidNoBid.limit} free calls this month
            </div>
            <p style={{ fontFamily: F.sans, fontSize: 14, color: C.ink2, maxWidth: 430, margin: "10px auto 0", lineHeight: 1.6 }}>
              Free accounts get {capUsage?.limit ?? data.access.bidNoBid.limit} instant bid/no-bid verdicts a month. Subscribe to TenderPath Pro for unlimited verdicts — plus the Document Vault and the Readiness-gap Navigator.
            </p>
            <div style={{ marginTop: 22, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn kind="ghost" size="sm" onClick={onClose}>Maybe later</Btn>
              <button onClick={() => { onClose(); openSubscribe(); }} style={{ background: C.accent, color: C.white, border: 0, padding: "11px 20px", cursor: "pointer", fontFamily: F.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Subscribe — $49/mo →
              </button>
            </div>
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 16 }}>
              Resets on the 1st · {capUsage?.used ?? data.access.bidNoBid.used}/{capUsage?.limit ?? data.access.bidNoBid.limit} used · 30-day trial included
            </div>
          </div>
        )}

        {/* VERDICT */}
        {stage === "verdict" && (scored || analysis) && (
          <div style={{ padding: "0 0 22px" }}>
            <div style={{ padding: "22px 26px", borderBottom: `1px solid ${C.rule}`, background: C.white, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontFamily: F.display, fontSize: 54, color: fitColor(fit), lineHeight: 0.9 }}>{fit}</div>
                <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Fit score</div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: verdict === "bid" ? C.pos : verdict === "caution" ? C.warn : C.neg }}>
                  {verdict === "bid"
                    ? "● Recommended: BID"
                    : verdict === "caution"
                      ? "● Recommended: PROCEED WITH CAUTION"
                      : "● Recommended: NO-BID — save the effort"}
                </div>
                <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.55, color: C.ink2, margin: "8px 0 0" }}>
                  {analysis?.summary
                    ? analysis.summary
                    : verdict === "bid"
                      ? `Strong alignment on sector and track record. ${openGaps.length === 0 ? "Every eligibility item you'd typically need is covered." : `${openGaps.length} open gap${openGaps.length === 1 ? "" : "s"} to close before the deadline.`} We need ${asks.length} inputs from you to complete the picture.`
                      : verdict === "caution"
                        ? "Adjacent fit. Winnable with the right partner or once gaps close, but weigh the effort against your stronger matches — the math below is the real decision."
                        : `The evidence says walk away: low alignment, ${openGaps.length} open gap${openGaps.length === 1 ? "" : "s"}, and a field that likely includes incumbents. Passing costs nothing — bidding costs ≈${effortDays} person-days without enough evidence to justify the work. Spend them on a stronger pursuit.`}
                </p>
              </div>
            </div>

            {/* the honest math (SPEC §6) */}
            <div style={{ padding: "16px 26px 18px", borderBottom: `1px solid ${C.rule}`, background: "#fbf9f3" }}>
              <Eyebrow color={C.accent}>The honest math</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 14, marginTop: 12 }}>
                {([
                  ["Effort to bid", `≈ ${effortDays} person-days`],
                  ["Likely field", `${typicalField} for ${subType.code}s`],
                  ["Open gaps", `${openGaps.length} to resolve`],
                  ["Call", verdict === "bid" ? "Worth the days" : verdict === "caution" ? "Marginal" : "Walk away"],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k}>
                    <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>{k}</div>
                    <div style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 600, color: k === "Call" ? (verdict === "bid" ? C.pos : verdict === "caution" ? C.warn : C.neg) : C.ink, marginTop: 3 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.55, marginTop: 12, borderTop: `1px dashed ${C.ruleSoft}`, paddingTop: 10 }}>
                {history && history.wins + history.losses > 0
                  ? `Recorded outcomes: ${history.wins} win${history.wins === 1 ? "" : "s"}, ${history.losses} loss${history.losses === 1 ? "" : "es"}${history.lessonsApplied ? " · received debrief lessons are applied to future checks" : ""}. This read qualifies the pursuit; it is not an award probability.`
                  : "No outcome record is on file yet. This read qualifies the pursuit from accessible tender and company evidence; it is not an award probability."}
              </div>
              {verdict !== "bid" && bestAlt && (
                <div style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55, marginTop: 8 }}>
                  <b>Where those {effortDays} days work harder:</b> your {bestAlt.fit}-fit {bestAlt.title} match
                  {bestAlt.deadline ? `, closing ${shortDate(bestAlt.deadline)}` : ""}. Passing here isn&apos;t a loss — it&apos;s budget for that one.
                </div>
              )}
            </div>

            <div style={{ padding: "20px 26px" }}>
              <Eyebrow color={C.accent}>Requirements checked · {haves.length + openGaps.length + asks.length}</Eyebrow>
              <div style={{ marginTop: 12, border: `1px solid ${C.rule}`, background: C.white }}>
                {haves.map((h) => (
                  <div key={h} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: `1px solid ${C.ruleSoft}` }}>
                    <span style={{ flex: 1, fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>{h}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, display: mobile ? "none" : "block" }}>On your profile</span>
                    <Pill kind="have" />
                  </div>
                ))}
                {openGaps.map((g) => (
                  <div key={g.title} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 15px", borderBottom: `1px solid ${C.ruleSoft}`, background: "#fdf6f6" }}>
                    <span style={{ flex: 1, fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500 }}>{g.title}</span>
                    {g.id && <button onClick={() => fixGap(g.id as string)} style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink, background: C.white, border: `1px solid ${C.rule}`, padding: "5px 9px", cursor: "pointer" }}>
                      Fix with the Navigator →
                    </button>}
                    <Pill kind="gap" />
                  </div>
                ))}
                {asks.map((r) => {
                  const filled = (answers[r.id] || "").trim().length > 4;
                  return (
                    <div key={r.id} style={{ padding: "13px 15px", borderBottom: `1px solid ${C.ruleSoft}`, background: filled ? "#f3f8f4" : C.paper }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 9 }}>
                        <span style={{ flex: 1, fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500 }}>{r.label}</span>
                        <Pill kind="ask" resolved={filled} />
                      </div>
                      <textarea
                        value={answers[r.id] || ""}
                        onChange={(e) => setAnswers((a) => ({ ...a, [r.id]: e.target.value }))}
                        placeholder={r.field}
                        style={{ width: "100%", minHeight: 54, border: `1px solid ${C.rule}`, background: C.white, padding: "9px 11px", fontFamily: F.sans, fontSize: 13, lineHeight: 1.5, color: C.ink, resize: "vertical", outline: "none" }}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 10 }}>
                {haves.length} on file · {openGaps.length} gap{openGaps.length === 1 ? "" : "s"} · {asksAnswered}/{asks.length} inputs provided
              </div>
            </div>

            {decided !== "bid" && (
              <div style={{ padding: "4px 26px 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Btn kind="danger" onClick={onNoBid} style={{ flex: mobile ? "1 1 100%" : "0 0 auto" }}>
                  {verdict === "pass" ? "✓ Pass — bank the effort" : "✕ No-bid · archive"}
                </Btn>
                <div style={{ flex: 1 }} />
                <Btn kind="primary" onClick={onBid}>✓ Decide to bid →</Btn>
              </div>
            )}

            {decided === "pass" && (
              <div style={{ margin: "12px 26px 0", padding: "14px 16px", background: C.white, border: `1px solid ${C.rule}` }}>
                <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>
                  Archived as <b>no-bid</b> — a smart pass. We log the reason, tune your matches, and the
                  ≈{effortDays} saved days go to your stronger pipeline.{" "}
                  <button onClick={onClose} style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer" }}>Done</button>
                </div>
              </div>
            )}

            {decided === "bid" && (
              <div style={{ margin: "14px 26px 0", animation: "tpFade .3s ease" }}>
                <div style={{ background: `linear-gradient(100deg, ${C.ink}, #2a2013)`, color: C.paper, padding: "22px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ color: C.accent2 }}>✓</span>
                    <Eyebrow color={C.accent2}>Added to your pipeline</Eyebrow>
                  </div>
                  <div style={{ fontFamily: F.display, fontSize: 22, color: C.paper, lineHeight: 1.15 }}>
                    You&apos;re bidding on {bidTitle}.
                  </div>
                  <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: "#cdc6b3", margin: "10px 0 0", maxWidth: 480 }}>
                    It&apos;s now in your active pipeline. Close any open gaps with the Navigator and keep your
                    documents in the Vault so you&apos;re submission-ready before the deadline.
                  </p>
                  <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                    <Btn kind="gold" size="sm" onClick={() => openGuidedSubmission(null)}>
                      Open guided submission →
                    </Btn>
                    <Btn kind="ghost" size="sm" onClick={() => { onClose(); go("matches"); }} style={{ color: C.paper, borderColor: "#3a4654" }}>
                      Go to pipeline →
                    </Btn>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
