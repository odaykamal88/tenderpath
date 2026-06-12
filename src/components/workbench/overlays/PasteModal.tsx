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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { C, F } from "../tokens";
import { Eyebrow, Btn, fitColor } from "../ui";
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
  const router = useRouter();
  const { data, token, go, openNavigator } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");

  // A seed is "scored" only when it carries a real fit (i.e. it's one of the
  // viewer's matches). A Browse row for a tender we haven't scored for this
  // user arrives with fit 0 — we must not fake a verdict for it, so it takes
  // the same paid-analysis path as free-text.
  const scored = !!seed && seed.fit > 0;
  const seededText = seed
    ? `${seed.title}\n${seed.agency} · ${seed.type}\nSource: ${seed.source} · ${seed.value}`
    : "";
  const [stage, setStage] = useState<"input" | "analysing" | "verdict">("input");
  const [text, setText] = useState(seededText);
  const [file, setFile] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [decided, setDecided] = useState<"bid" | "pass" | null>(null);
  const [analysis, setAnalysis] = useState<PasteVerdict | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
      // Seeded from a match — instant verdict from data we already hold.
      setStage("analysing");
      setTimeout(() => setStage("verdict"), 1300);
      return;
    }
    if (file && !text.trim()) {
      // A file upload needs the paid extraction pipeline — hand off rather than
      // fake a verdict from a filename.
      onClose();
      router.push("/dashboard/services/bid-no-bid");
      return;
    }
    // Free-text / URL — run the real quick verdict.
    setAnalysisError(null);
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
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setAnalysisError(b.error ?? "Couldn't analyse this tender. Please try again.");
        setStage("input");
        return;
      }
      const v = (await res.json()) as PasteVerdict;
      setAnalysis(v);
      setStage("verdict");
    } catch {
      setAnalysisError("Couldn't reach the analysis service. Please try again.");
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
  const recommend = analysis ? analysis.recommend : fit >= 70 && openGaps.length <= 2;
  const asksAnswered = asks.filter((a) => (answers[a.id] || "").trim().length > 4).length;
  const bidTitle = seed?.title ?? analysis?.tender.title ?? "Pasted tender";
  const subType = submissionType(detectSubmissionType(seed?.type ?? analysis?.tender.title));

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
              {stage === "input" ? "Paste a tender" : stage === "analysing" ? "Reading the tender…" : "The verdict"}
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
                  : "Drop a tender link or paste the notice text — we'll read it, check it against your file, and give you an instant bid / no-bid call. Upload a PDF/Word doc and we'll run the full paid analysis."}
            </p>
            {analysisError && (
              <div style={{ marginBottom: 14, borderLeft: `2px solid ${C.neg}`, background: "#fbeceb", padding: "9px 12px", fontFamily: F.sans, fontSize: 12.5, color: C.neg }}>{analysisError}</div>
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
                  {file && !text.trim() ? "Run full analysis →" : "Analyse tender →"}
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

        {/* VERDICT */}
        {stage === "verdict" && (scored || analysis) && (
          <div style={{ padding: "0 0 22px" }}>
            <div style={{ padding: "22px 26px", borderBottom: `1px solid ${C.rule}`, background: C.white, display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontFamily: F.display, fontSize: 54, color: fitColor(fit), lineHeight: 0.9 }}>{fit}</div>
                <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Fit score</div>
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: recommend ? C.pos : C.warn }}>
                  {recommend ? "● Recommended: BID" : "● Recommended: PROCEED WITH CAUTION"}
                </div>
                <p style={{ fontFamily: F.sans, fontSize: 14, lineHeight: 1.55, color: C.ink2, margin: "8px 0 0" }}>
                  {analysis?.summary
                    ? analysis.summary
                    : recommend
                      ? `Strong alignment on sector and track record. ${openGaps.length === 0 ? "Every eligibility item you'd typically need is covered." : `${openGaps.length} open gap${openGaps.length === 1 ? "" : "s"} to close before the deadline.`} We need ${asks.length} inputs from you to complete the picture.`
                      : "Adjacent fit. Winnable with the right partner or once your gaps close, but weigh the effort against your stronger matches."}
                </p>
              </div>
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
                <Btn kind="danger" onClick={onNoBid} style={{ flex: mobile ? "1 1 100%" : "0 0 auto" }}>✕ No-bid · archive</Btn>
                <div style={{ flex: 1 }} />
                <Btn kind="primary" onClick={onBid}>✓ Decide to bid →</Btn>
              </div>
            )}

            {decided === "pass" && (
              <div style={{ margin: "12px 26px 0", padding: "14px 16px", background: C.white, border: `1px solid ${C.rule}` }}>
                <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink }}>
                  Archived as <b>no-bid</b>. We&apos;ll stop surfacing similar low-fit tenders.{" "}
                  <button onClick={onClose} style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink, background: "none", border: 0, borderBottom: `1px solid ${C.ink}`, cursor: "pointer" }}>Done</button>
                </div>
              </div>
            )}

            {decided === "bid" && (
              <UpsellBlock
                price={subType.price}
                code={subType.code}
                asksAnswered={asksAnswered}
                onCommission={() => {
                  onClose();
                  // Deep-link straight into the intake wizard with the detected
                  // format + this opportunity preselected.
                  router.push(`/dashboard/proposals?start=${subType.code}${seed ? `&match=${seed.id}` : ""}`);
                }}
                onPipelineOnly={() => { onClose(); go("matches"); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UpsellBlock({
  price,
  code,
  asksAnswered,
  onCommission,
  onPipelineOnly,
}: {
  price: number;
  code: string;
  asksAnswered: number;
  onCommission: () => void;
  onPipelineOnly: () => void;
}) {
  const children: ReactNode = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: C.accent2 }}>🔒</span>
        <Eyebrow color={C.accent2}>Submissions · paid add-on</Eyebrow>
      </div>
      <div style={{ fontFamily: F.display, fontSize: 23, color: C.paper, lineHeight: 1.1 }}>You&apos;re bidding. Want us to build the submission?</div>
      <p style={{ fontFamily: F.sans, fontSize: 13.5, lineHeight: 1.6, color: "#cdc6b3", margin: "10px 0 0", maxWidth: 480 }}>
        We&apos;ll turn everything above — your file, the {asksAnswered} input{asksAnswered === 1 ? "" : "s"} you gave, and the detected scoring matrix — into a submission-ready {code} package. Billed separately from your subscription.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 18, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: F.display, fontSize: 30, color: C.paper }}>${price}</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#9aa3ad" }}> /submission · under 1 hr</span>
        </div>
        <div style={{ flex: 1 }} />
        <Btn kind="ghost" size="sm" onClick={onPipelineOnly} style={{ color: C.paper, borderColor: "#3a4654" }}>Add to pipeline only</Btn>
        <button onClick={onCommission} style={{ background: C.accent, color: C.white, border: 0, padding: "11px 18px", cursor: "pointer", fontFamily: F.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Start the {code} →
        </button>
      </div>
    </>
  );
  return (
    <div style={{ margin: "14px 26px 0", animation: "tpFade .3s ease" }}>
      <div style={{ background: `linear-gradient(100deg, ${C.ink}, #2a2013)`, color: C.paper, padding: "22px 24px", position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
}
