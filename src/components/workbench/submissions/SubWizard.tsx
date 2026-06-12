"use client";

/* The intake wizard (prototype: sub-wizard.jsx). Schema-driven from
 * TPSUB-equivalent FLOWS[type] — steps render blocks, the right rail shows the
 * live audit, and the last step is Review & pay.
 *
 * Language rules (SPEC §3, load-bearing): the verb is "start" / "pay & start
 * drafting" — never "commission". Last step: "Review & pay". The guarantee
 * line sits at the pay button. Autosave persists the whole intake server-side
 * per format ("✓ draft saved" beside the ✕); the draft clears on payment. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, F } from "../tokens";
import { Btn, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import type { WbMatch } from "@/lib/workbench/types";
import type { SubmissionCode, WizardDraftState } from "@/lib/submissions/types";
import { EMPTY_DRAFT } from "@/lib/submissions/types";
import { flowFor, FLOW_GUARANTEE, type FlowBlock } from "@/lib/submissions/flows";
import { auditDraft, PAY_GATE_PCT } from "@/lib/submissions/audit";
import {
  commission,
  listVaultDocs,
  loadDraft,
  loadProfilePrefill,
  saveDraft,
  type ProfilePrefill,
  type VaultDocRow,
} from "./api";
import {
  ConformityBlock,
  DeclarationsBlock,
  DocsBlock,
  EnvelopeBlock,
  FieldsBlock,
  LinesBlock,
  PickrefsBlock,
} from "./wizardBlocks";

const RAIL_BREAK = "(max-width: 1279px)";
const MOBILE = "(max-width: 1023px)";

interface SubWizardProps {
  type: SubmissionCode;
  /** Preselect the opportunity from a workbench match. */
  seedMatch?: WbMatch | null;
  onClose: () => void;
}

function tenderFromMatch(m: WbMatch): NonNullable<WizardDraftState["tender"]> {
  return {
    title: m.title,
    agency: m.agency || null,
    source: m.source || null,
    portal: null,
    due: m.deadline,
    value: m.value || null,
    fit: m.fit || null,
    tenderId: m.tenderId,
    pipelineItemId: null,
  };
}

/* ── Step 1: the opportunity ───────────────────────────────────────────── */

function TenderStep({
  draft,
  patch,
  matches,
}: {
  draft: WizardDraftState;
  patch: (p: Partial<WizardDraftState>) => void;
  matches: WbMatch[];
}) {
  const [manual, setManual] = useState(false);
  const t = draft.tender;
  const pick = (m: WbMatch) => {
    patch({ tender: tenderFromMatch(m) });
    setManual(false);
  };
  const setT = (p: Partial<NonNullable<WizardDraftState["tender"]>>) =>
    patch({ tender: { title: "", ...(t ?? {}), ...p } });

  const inputStyle: React.CSSProperties = {
    width: "100%", fontFamily: F.sans, fontSize: 13.5, color: C.ink, background: C.white,
    border: `1px solid ${C.rule}`, padding: "10px 12px", outline: "none", borderRadius: 0,
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {t?.title ? (
        <div style={{ background: C.white, border: `1px solid ${C.ink}`, padding: "16px 18px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.pos, marginBottom: 8 }}>
            ✓ Opportunity selected
          </div>
          <div style={{ fontFamily: F.sans, fontSize: 15.5, fontWeight: 600, color: C.ink }}>{t.title}</div>
          <div style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, marginTop: 6 }}>
            {[t.agency, t.due ? `due ${shortDate(t.due)}` : null, t.fit ? `fit ${t.fit}%` : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
          <button
            onClick={() => patch({ tender: null })}
            style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.faint, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 10 }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          {matches.length > 0 && !manual && (
            <div>
              <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 8 }}>
                From your matches
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {matches.slice(0, 12).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: C.white, border: `1px solid ${C.rule}`, padding: "11px 14px", cursor: "pointer" }}
                  >
                    <span style={{ fontFamily: F.mono, fontSize: 12, fontWeight: 600, color: m.fit >= 70 ? C.pos : C.ink, width: 28, flexShrink: 0 }}>
                      {m.fit || "—"}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title}</span>
                      <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute }}>
                        {[m.agency, m.deadline ? `due ${shortDate(m.deadline)}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span style={{ fontFamily: F.mono, fontSize: 10, color: C.accent }}>Select →</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => setManual(true)}
            style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px", justifySelf: "start" }}
          >
            {matches.length > 0 ? "Or enter the notice details by hand" : "Enter the notice details"}
          </button>
          {(manual || matches.length === 0) && (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>
                  Tender title <span style={{ color: C.neg }}>•</span>
                </div>
                <input value={t?.title ?? ""} placeholder="Exactly as the notice names it" onChange={(e) => setT({ title: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>Issuing agency</div>
                  <input value={t?.agency ?? ""} placeholder="e.g. UNICEF Kenya Country Office" onChange={(e) => setT({ agency: e.target.value })} style={inputStyle} />
                </div>
                <div>
                  <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>Deadline</div>
                  <input type="date" value={t?.due ?? ""} onChange={(e) => setT({ due: e.target.value || null })} style={inputStyle} />
                </div>
              </div>
              <div>
                <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>Submission portal / channel</div>
                <input value={t?.portal ?? ""} placeholder="e.g. UNGM e-submission · email in the notice" onChange={(e) => setT({ portal: e.target.value || null })} style={inputStyle} />
              </div>
            </div>
          )}
        </>
      )}
      <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.faint, lineHeight: 1.55 }}>
        Deadlines run on the agency&apos;s local time zone — not yours. We flag the difference in the final pack.
      </div>
    </div>
  );
}

/* ── Review & pay step ─────────────────────────────────────────────────── */

function ReviewStep({
  type,
  draft,
  audit,
  paying,
  payError,
  onPay,
  freeEligible,
}: {
  type: SubmissionCode;
  draft: WizardDraftState;
  audit: ReturnType<typeof auditDraft>;
  paying: boolean;
  payError: string | null;
  onPay: () => void;
  freeEligible: boolean;
}) {
  const flow = flowFor(type);
  const t = draft.tender;
  const rows: [string, string][] = [
    ["Format", `${flow.code} — ${flow.name}`],
    ["Tender", t?.title ?? "—"],
    ["Agency · portal", [t?.agency, t?.portal].filter(Boolean).join(" · ") || "—"],
    ["Deadline", t?.due ? `${shortDate(t.due)}` : "—"],
    ["Intake completeness", `${audit.pct}% · ${audit.remaining.length} item(s) open`],
    [
      "Elimination risks",
      audit.blockers.length === 0
        ? "None detected"
        : audit.blockers.map((b) => `${b.label} (${b.state})`).join(" · "),
    ],
  ];
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", gap: 16, padding: "12px 16px", borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none" }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, width: 160, flexShrink: 0, paddingTop: 2 }}>{k}</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{v}</span>
          </div>
        ))}
      </div>

      {audit.openBlockers.length > 0 && (
        <div style={{ border: "1px solid #dcb8b8", background: "#fdf8f8", padding: "13px 16px" }}>
          <span style={{ fontFamily: F.sans, fontSize: 13, color: C.neg, lineHeight: 1.55 }}>
            <strong style={{ fontWeight: 600 }}>
              {audit.openBlockers.length} elimination risk{audit.openBlockers.length === 1 ? "" : "s"} unresolved.
            </strong>{" "}
            Resolve or acknowledge each one before paying — we won&apos;t draft a submission we know will be
            thrown out.
          </span>
        </div>
      )}

      <div style={{ background: C.spine, padding: "26px 28px", color: C.paper }}>
        <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: C.accent2, marginBottom: 12 }}>
          Start this submission
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: F.display, fontSize: 40, lineHeight: 1 }}>${flow.price}</span>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: "#7d8794" }}>one-time · draft in under 1 hour</span>
        </div>
        {freeEligible && (
          <div style={{ fontFamily: F.sans, fontSize: 12, color: "#9fd0ae", marginTop: 8 }}>
            First submission · on us — your trial credit is applied automatically at checkout.
          </div>
        )}
        <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.6, color: "#aab3bf", margin: "12px 0 0", maxWidth: 520 }}>
          {flow.payIncludes}
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 14, maxWidth: 520 }}>
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", background: C.accent, color: C.white, padding: "2px 7px", flexShrink: 0, marginTop: 2 }}>
            Guarantee
          </span>
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.paper, lineHeight: 1.55 }}>{FLOW_GUARANTEE}</span>
        </div>
        <p style={{ fontFamily: F.sans, fontSize: 11, color: "#7d8794", margin: "14px 0 0", lineHeight: 1.6, maxWidth: 520 }}>
          By paying you agree to the{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#aab3bf" }}>Service Terms</a> and{" "}
          <a href="/terms#refunds" target="_blank" rel="noopener noreferrer" style={{ color: "#aab3bf" }}>refund policy</a>.
          A receipt is emailed on payment and available on every order.
        </p>
        {payError && (
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: "#e8b9b9", marginTop: 12 }}>{payError}</div>
        )}
        <button
          onClick={onPay}
          disabled={!audit.canPay || paying}
          style={{
            fontFamily: F.mono, fontSize: 11.5, letterSpacing: "0.12em", textTransform: "uppercase",
            background: audit.canPay ? C.accent : "#3a4250", color: audit.canPay ? C.white : "#7d8794",
            border: "none", padding: "14px 26px", cursor: audit.canPay && !paying ? "pointer" : "default",
            marginTop: 18, display: "inline-flex", alignItems: "center", gap: 10,
          }}
        >
          {paying ? "Preparing checkout…" : `Pay $${flow.price} & start drafting →`}
        </button>
        {!audit.canPay && (
          <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#7d8794", marginTop: 10 }}>
            {audit.openBlockers.length > 0
              ? "Resolve or acknowledge risks above"
              : !audit.tenderChosen
                ? "Choose the opportunity first"
                : `Reach ${PAY_GATE_PCT}% completeness to start`}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── The wizard shell ──────────────────────────────────────────────────── */

export function SubWizard({ type, seedMatch, onClose }: SubWizardProps) {
  const { data, openVault } = useWorkbench();
  const flow = useMemo(() => flowFor(type), [type]);
  const narrowRail = useMedia(RAIL_BREAK);
  const mobile = useMedia(MOBILE);

  const [draft, setDraft] = useState<WizardDraftState>({ ...EMPTY_DRAFT });
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(true);
  const [step, setStep] = useState(0);
  const [vaultDocs, setVaultDocs] = useState<VaultDocRow[]>([]);
  const [prefill, setPrefill] = useState<ProfilePrefill>({ businessName: null, description: null, countryFocus: null });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Hydrate: server draft → seed match (if none saved) → vault + profile.
  useEffect(() => {
    let live = true;
    (async () => {
      const [{ draft: stored }, docs, pf] = await Promise.all([
        loadDraft(type).catch(() => ({ draft: {} as Partial<WizardDraftState> })),
        listVaultDocs(),
        loadProfilePrefill(),
      ]);
      if (!live) return;
      const merged: WizardDraftState = { ...EMPTY_DRAFT, ...stored };
      if (!merged.tender?.title && seedMatch) merged.tender = tenderFromMatch(seedMatch);
      setDraft(merged);
      setStep(Math.min(merged.step ?? 0, flow.steps.length - 1));
      setVaultDocs(docs);
      setPrefill(pf);
      setHydrated(true);
    })();
    return () => {
      live = false;
    };
  }, [type, seedMatch, flow.steps.length]);

  const patch = useCallback((p: Partial<WizardDraftState>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  }, []);

  // Debounced server autosave (the prototype's per-type draft, server-side).
  useEffect(() => {
    if (!hydrated || saved) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDraft(type, { ...draft, step })
        .then(() => setSaved(true))
        .catch(() => {});
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, step, hydrated, saved, type]);

  const audit = useMemo(() => auditDraft(flow, draft), [flow, draft]);

  const prefills: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of flow.steps) {
      for (const b of s.blocks) {
        if (b.kind === "fields" || b.kind === "envelope") {
          for (const f of b.fields) {
            if (f.preFrom === "profile_description" && prefill.description) map[f.k] = prefill.description;
            if (f.preFrom === "country_focus" && prefill.countryFocus) map[f.k] = prefill.countryFocus;
            if (f.preFrom === "business_name" && prefill.businessName) map[f.k] = prefill.businessName;
          }
        }
      }
    }
    return map;
  }, [flow, prefill]);

  const goto = useCallback((i: number) => {
    setStep(Math.max(0, Math.min(flow.steps.length - 1, i)));
    setSaved(false);
    contentRef.current?.scrollTo({ top: 0 });
  }, [flow.steps.length]);

  const startPay = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    try {
      // Persist the freshest draft before handing off to /pay.
      await saveDraft(type, { ...draft, step }).catch(() => {});
      const res = await commission(type, draft);
      window.location.href = res.pay_url;
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not start checkout — try again.");
      setPaying(false);
    }
  }, [type, draft, step]);

  const renderBlock = (block: FlowBlock, i: number) => {
    switch (block.kind) {
      case "tender":
        return <TenderStep key={i} draft={draft} patch={patch} matches={data?.matches ?? []} />;
      case "fields":
        return <FieldsBlock key={i} fields={block.fields} draft={draft} patch={patch} prefills={prefills} />;
      case "lines":
        return <LinesBlock key={i} block={block} draft={draft} patch={patch} lowestPrice={type !== "RFP"} />;
      case "conformity":
        return <ConformityBlock key={i} block={block} draft={draft} patch={patch} />;
      case "docs":
        return <DocsBlock key={i} docIds={block.docs} draft={draft} patch={patch} vaultDocs={vaultDocs} onUpload={openVault} />;
      case "declarations":
        return <DeclarationsBlock key={i} items={block.items} draft={draft} patch={patch} />;
      case "pickrefs":
        return <PickrefsBlock key={i} block={block} draft={draft} patch={patch} vaultDocs={vaultDocs} />;
      case "envelope":
        return <EnvelopeBlock key={i} block={block} draft={draft} patch={patch} prefills={prefills} />;
      case "review":
        return (
          <ReviewStep
            key={i}
            type={type}
            draft={draft}
            audit={audit}
            paying={paying}
            payError={payError}
            onPay={startPay}
            freeEligible={Boolean(data?.access.freeSubmissionEligible)}
          />
        );
      default:
        return null;
    }
  };

  const current = flow.steps[step];
  const isLast = step === flow.steps.length - 1;
  const stepDone = (i: number) => audit.remaining.every((r) => r.step !== i);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, background: C.paper, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: mobile ? "12px 16px" : "14px 28px", borderBottom: `1px solid ${C.rule}`, background: C.paper, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent }}>
            New submission · ${flow.price}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.display, fontSize: mobile ? 17 : 21, color: C.ink, letterSpacing: "-0.01em" }}>
              {flow.code} — {flow.name}
            </span>
            {draft.tender?.title && (
              <span style={{ fontFamily: F.display, fontSize: mobile ? 14 : 17, color: C.mute, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: mobile ? 180 : 420 }}>
                · {draft.tender.title}
              </span>
            )}
          </div>
        </div>
        <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: saved ? C.pos : C.faint, flexShrink: 0 }}>
          {saved ? "✓ draft saved" : "saving…"}
        </span>
        <button
          onClick={onClose}
          title="Close — your draft is saved"
          style={{ width: 34, height: 34, border: `1px solid ${C.rule}`, background: C.white, color: C.ink, fontSize: 16, cursor: "pointer", flexShrink: 0 }}
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* Step rail */}
        {!mobile && (
          <div style={{ width: 218, borderRight: `1px solid ${C.rule}`, padding: "22px 0", flexShrink: 0, overflowY: "auto" }}>
            {flow.steps.map((s, i) => {
              const active = i === step;
              const done = i < step || (i !== step && stepDone(i) && i < flow.steps.length - 1);
              return (
                <button
                  key={s.title}
                  onClick={() => goto(i)}
                  style={{
                    display: "flex", gap: 12, width: "100%", textAlign: "left", padding: "12px 20px",
                    background: active ? C.white : "transparent",
                    border: "none",
                    borderLeft: `2px solid ${active ? C.accent : "transparent"}`,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: done ? C.pos : active ? C.accent : C.faint, width: 18, flexShrink: 0, paddingTop: 2 }}>
                    {done ? "✓" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: active ? 600 : 400, color: active ? C.ink : C.ink2, display: "block" }}>
                      {s.title}
                    </span>
                    {s.est && <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}>{s.est}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div ref={contentRef} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: mobile ? "20px 16px 40px" : "30px 36px 60px" }}>
          <div style={{ maxWidth: 680, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, borderBottom: `2px solid ${C.ink}`, paddingBottom: 10, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <span style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.14em", color: C.accent }}>§{step + 1}</span>
                <h2 style={{ fontFamily: F.display, fontSize: mobile ? 21 : 25, fontWeight: 400, color: C.ink, margin: 0, letterSpacing: "-0.02em" }}>
                  {current.title}
                </h2>
              </div>
              {current.est && <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.faint, flexShrink: 0 }}>{current.est}</span>}
            </div>
            <div style={{ display: "grid", gap: 26 }}>
              {!hydrated ? (
                <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, padding: "30px 0" }}>Loading your draft…</div>
              ) : (
                current.blocks.map(renderBlock)
              )}
            </div>
          </div>
        </div>

        {/* Right rail */}
        {!narrowRail && (
          <div style={{ width: 252, borderLeft: `1px solid ${C.rule}`, padding: "24px 22px", flexShrink: 0, overflowY: "auto" }}>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent }}>
              Submission readiness
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 8 }}>
              <span style={{ fontFamily: F.display, fontSize: 46, lineHeight: 1, color: C.ink }}>{audit.pct}</span>
              <span style={{ fontFamily: F.mono, fontSize: 11, color: C.mute }}>%</span>
            </div>
            <div style={{ height: 3, background: C.paper2, margin: "10px 0 6px" }}>
              <div style={{ height: 3, width: `${audit.pct}%`, background: audit.pct >= PAY_GATE_PCT ? C.pos : C.accent }} />
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, lineHeight: 1.5 }}>
              {audit.remaining.length === 0
                ? "Every input is in."
                : `${audit.remaining.length} input${audit.remaining.length === 1 ? "" : "s"} remaining across the flow.`}
            </div>

            {audit.blockers.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.neg, marginBottom: 8 }}>
                  Elimination risks
                </div>
                {audit.blockers.map((b) => (
                  <div key={b.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: b.state === "open" ? C.neg : C.warn, flexShrink: 0, marginTop: 5 }} />
                    <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.45 }}>
                      {b.label}
                      {b.note ? <span style={{ color: C.faint }}> — {b.note}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 22 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.mute, marginBottom: 8 }}>
                What you&apos;ll receive
              </div>
              {flow.deliverables.map((d) => (
                <div key={d.name} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
                  <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.4 }}>{d.name}</span>
                  <span style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint, flexShrink: 0, paddingTop: 2 }}>{d.fmt}</span>
                </div>
              ))}
              <div style={{ fontFamily: F.mono, fontSize: 9, color: C.accent, marginTop: 10, lineHeight: 1.6 }}>
                Draft in under 1 hour · agency-ready format
              </div>
            </div>

            <div style={{ marginTop: 22, borderTop: `1px solid ${C.ruleSoft}`, paddingTop: 16 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.mute, marginBottom: 8 }}>
                Auto-eliminators we guard against
              </div>
              {flow.eliminators.map((e) => (
                <div key={e} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>—</span>
                  <span style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, lineHeight: 1.45 }}>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: mobile ? "10px 16px" : "12px 28px", borderTop: `1px solid ${C.rule}`, background: C.paper, flexShrink: 0 }}>
        <Btn kind="ghost" size="sm" onClick={() => (step === 0 ? onClose() : goto(step - 1))}>
          ← {step === 0 ? "Close" : "Back"}
        </Btn>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, maxWidth: 260, height: 3, background: C.paper2 }}>
            <div style={{ height: 3, width: `${audit.pct}%`, background: C.accent }} />
          </div>
          <span style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute, whiteSpace: "nowrap" }}>{audit.pct}% ready</span>
        </div>
        {isLast ? (
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>
            Pay & start above ↑
          </span>
        ) : (
          <Btn kind="primary" size="sm" onClick={() => goto(step + 1)}>
            Continue →
          </Btn>
        )}
      </div>
    </div>
  );
}
