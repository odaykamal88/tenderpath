"use client";

/* The intake wizard (faithful port of the prototype's sub-wizard.jsx, guided
 * layout). Schema-driven from FLOWS[type]; the right rail shows the live
 * audit; the last step is Review & pay.
 *
 * Language rules (SPEC §3, load-bearing): the verb is "start" / "pay & start
 * drafting" — never "commission". Autosave persists the whole intake per
 * format server-side ("✓ draft saved" beside the ✕); the draft clears on
 * payment. Production deviation: payment executes on the proven /pay surface
 * (card / USDT / wire / free credit), not inline.
 *
 * At hydrate, profile-derived prefills and vault auto-attaches are
 * MATERIALIZED into the draft so the server-side audit (the authoritative
 * gate) sees exactly what the user sees. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, F } from "../tokens";
import { Bar, Btn, deadlineLabel, FitBadge, SevDot, shortDate } from "../ui";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";
import { CheckoutCard, type CheckoutContext } from "@/components/checkout/CheckoutCard";
import type { WbMatch } from "@/lib/workbench/types";
import type { DocResolution, SubmissionCode, WizardDraftState } from "@/lib/submissions/types";
import { EMPTY_DRAFT } from "@/lib/submissions/types";
import { flowFor, FLOW_GUARANTEE, type FlowBlock, type FlowStep, type SubmissionFlow } from "@/lib/submissions/flows";
import { docSpec } from "@/lib/submissions/docs-catalog";
import { auditDraft, PAY_GATE_PCT, type AuditResult } from "@/lib/submissions/audit";
import {
  commission,
  listVaultDocs,
  loadDraft,
  loadProfilePrefill,
  saveDraft,
  type VaultDocRow,
} from "./api";
import {
  ConformityBlock,
  CriteriaBlock,
  DeclarationsBlock,
  DocsBlock,
  EnvelopeBlock,
  FieldsBlock,
  LinesBlock,
  matchVaultDoc,
  PickRefsBlock,
} from "./wizardBlocks";

const RAIL_BREAK = "(max-width: 1279px)";
const MOBILE = "(max-width: 1023px)";

interface SubWizardProps {
  type: SubmissionCode;
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

/** Profile-derived prefill values per field key (k → value). */
function profilePrefillMap(
  flow: SubmissionFlow,
  profile: { description: string | null; countryFocus: string | null; businessName: string | null },
): Record<string, string> {
  const resolve = (preFrom?: string): string | null => {
    if (preFrom === "profile_description") return profile.description;
    if (preFrom === "country_focus") return profile.countryFocus;
    if (preFrom === "business_name") return profile.businessName;
    return null;
  };
  const map: Record<string, string> = {};
  for (const step of flow.steps) {
    for (const b of step.blocks ?? []) {
      if (b.kind === "fields" || b.kind === "envelope") {
        for (const f of b.fields) {
          const v = resolve(f.preFrom);
          if (v) map[f.k] = v;
        }
      }
      if (b.kind === "criteria") {
        for (const k of b.items) {
          const v = resolve(k.preFrom);
          if (v) map[k.id] = v;
        }
      }
    }
  }
  return map;
}

/** Vault auto-attach: one DocResolution per matched, unresolved doc row. */
function vaultAutoAttach(flow: SubmissionFlow, draft: WizardDraftState, vaultDocs: VaultDocRow[]): DocResolution[] {
  const out: DocResolution[] = [];
  for (const step of flow.steps) {
    for (const b of step.blocks ?? []) {
      if (b.kind !== "docs") continue;
      for (const key of b.docs) {
        if (draft.docs.some((d) => d.docId === key)) continue;
        const spec = docSpec(key);
        if (!spec) continue;
        const match = matchVaultDoc(spec, vaultDocs);
        if (match) out.push({ docId: key, state: "attached", vaultDocumentId: match.id });
      }
    }
  }
  return out;
}

/* ── Step 1: the opportunity ───────────────────────────────────────────── */

function TenderStep({
  flow,
  draft,
  patch,
  matches,
  onPaste,
}: {
  flow: SubmissionFlow;
  draft: WizardDraftState;
  patch: (p: Partial<WizardDraftState>) => void;
  matches: WbMatch[];
  onPaste: () => void;
}) {
  const [manual, setManual] = useState(false);
  const t = draft.tender;
  const setT = (p: Partial<NonNullable<WizardDraftState["tender"]>>) =>
    patch({ tender: { title: "", ...(t ?? {}), ...p } });
  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 13.5, color: C.ink,
    background: C.white, border: `1px solid ${C.rule}`, padding: "10px 12px", outline: "none", borderRadius: 0,
  };
  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink2, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 560 }}>
        {flow.blurb} Pick the tender this {flow.code} responds to — requirements, deadlines and forms are
        pulled straight from its notice.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {matches.slice(0, 10).map((m) => {
          const on = Boolean(t && ((m.tenderId && t.tenderId === m.tenderId) || t.title === m.title));
          return (
            <button
              key={m.id}
              onClick={() => { patch({ tender: tenderFromMatch(m) }); setManual(false); }}
              style={{ textAlign: "left", cursor: "pointer", background: C.white, border: `1px solid ${on ? C.ink : C.rule}`, boxShadow: on ? `inset 0 0 0 1px ${C.ink}` : "none", padding: "16px 18px", display: "flex", gap: 14, alignItems: "center" }}
            >
              <span style={{ width: 16, height: 16, borderRadius: 999, border: `1.5px solid ${on ? C.ink : C.rule}`, background: on ? C.ink : "transparent", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {on && <span style={{ width: 5, height: 5, borderRadius: 999, background: C.paper }} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontFamily: F.sans, fontSize: 14, fontWeight: 500, color: C.ink, display: "block", lineHeight: 1.4 }}>{m.title}</span>
                <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, display: "block", marginTop: 4 }}>
                  {[m.agency, m.source, m.deadline ? `due ${shortDate(m.deadline)}` : null, m.value].filter(Boolean).join(" · ")}
                </span>
              </span>
              <FitBadge score={m.fit} />
            </button>
          );
        })}
        {(manual || matches.length === 0 || t?.title) && (
          <div style={{ border: `1px solid ${t?.title && !matches.some((m) => m.tenderId && m.tenderId === t.tenderId) ? C.ink : C.rule}`, background: C.white, padding: "16px 18px", display: "grid", gap: 12 }}>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>
              {matches.length ? "Or enter the notice details by hand" : "Enter the notice details"}
            </div>
            <div>
              <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>
                Tender title <span style={{ color: C.neg }}>*</span>
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
      </div>
      <div style={{ marginTop: 14, padding: "13px 16px", border: `1px dashed ${C.rule}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>
          Responding to something else? Paste the notice and we&apos;ll parse the requirements.
        </span>
        <span style={{ display: "flex", gap: 14 }}>
          {!manual && matches.length > 0 && !t?.title && (
            <button onClick={() => setManual(true)} style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px" }}>
              Enter by hand
            </button>
          )}
          <button onClick={onPaste} style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Paste a tender ↗
          </button>
        </span>
      </div>
    </div>
  );
}

/* ── Review & pay ──────────────────────────────────────────────────────── */

function ReviewStep({
  flow,
  draft,
  a,
  paying,
  payError,
  onPay,
  freeEligible,
  committed,
}: {
  flow: SubmissionFlow;
  draft: WizardDraftState;
  a: AuditResult;
  paying: boolean;
  payError: string | null;
  onPay: () => void;
  freeEligible: boolean;
  /** Non-null once the order is commissioned — switches the CTA to the inline
   *  embedded checkout. */
  committed: CheckoutContext | null;
}) {
  const tender = draft.tender;
  const canGo = a.canPay;
  const rows: [string, string][] = [
    ["Format", `${flow.code} — ${flow.name}`],
    ["Tender", tender?.title || "— pick one in step 1"],
    ["Agency · portal", tender ? [tender.agency, tender.portal].filter(Boolean).join(" · ") || "—" : "—"],
    ["Deadline", tender?.due ? `${shortDate(tender.due)} (${deadlineLabel(tender.due)})` : "—"],
    ["Intake completeness", `${a.pct}% · ${a.need - a.have} item(s) open`],
    [
      "Elimination risks",
      a.blockers.length === 0
        ? "None detected"
        : a.blockers.map((b) => `${b.label.split("—")[0].trim()} (${b.state})`).join(" · "),
    ],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
        {rows.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", gap: 16, padding: "10px 16px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
            <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint, width: 150, flexShrink: 0, paddingTop: 2 }}>{k}</span>
            <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>{v}</span>
          </div>
        ))}
      </div>

      {a.open.length > 0 && (
        <div style={{ border: "1px solid #e6c9c9", background: "#fdf6f6", padding: "13px 16px", display: "flex", gap: 10 }}>
          <SevDot severity="high" />
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.neg, lineHeight: 1.55 }}>
            <b>{a.open.length} elimination risk{a.open.length > 1 ? "s" : ""} unresolved.</b> Resolve or
            acknowledge each one before paying — we won&apos;t draft a submission we know will be thrown out.
          </div>
        </div>
      )}

      {/* payment */}
      <div style={{ border: `1px solid ${C.ink}`, background: C.ink, color: C.paper, padding: "20px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent2 }}>
              Start this submission
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "8px 0 4px" }}>
              <span style={{ fontFamily: F.display, fontSize: 38, lineHeight: 1, color: C.paper }}>${flow.price}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10.5, color: "#7d8794" }}>one-time · {flow.sla.toLowerCase()}</span>
            </div>
            {freeEligible && (
              <div style={{ fontFamily: F.sans, fontSize: 12, color: "#9fd0ae", margin: "4px 0 0" }}>
                First submission · on us — your trial credit is applied automatically at checkout.
              </div>
            )}
            <div style={{ fontFamily: F.sans, fontSize: 12, color: "#aab3bf", lineHeight: 1.55, maxWidth: 420, marginTop: 6 }}>
              Includes drafting, the compliance QA gate, unlimited revisions until you approve, and final
              files in {tender?.portal || "the agency"}&apos;s required format. Pay now — drafting starts immediately.
            </div>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 12, maxWidth: 420 }}>
              <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: C.ink, background: C.accent2, padding: "2px 7px", flexShrink: 0, marginTop: 1 }}>
                Guarantee
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 11.5, color: "#cdc6b3", lineHeight: 1.5 }}>{FLOW_GUARANTEE}</span>
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 10.5, color: "#7d8794", lineHeight: 1.5, marginTop: 10, maxWidth: 420 }}>
              By paying you agree to the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#aab3bf" }}>Service Terms</a> and{" "}
              <a href="/terms#refunds" target="_blank" rel="noopener noreferrer" style={{ color: "#aab3bf" }}>refund policy</a>.
              A receipt is emailed on payment and available on every order.
            </div>
            {payError && <div style={{ fontFamily: F.sans, fontSize: 12.5, color: "#e8b9b9", marginTop: 10 }}>{payError}</div>}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            {committed ? (
              <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.accent2, maxWidth: 220 }}>
                Enter payment below ↓
              </div>
            ) : (
              <>
                <Btn kind="gold" onClick={onPay} style={{ opacity: canGo && !paying ? 1 : 0.45, pointerEvents: canGo && !paying ? "auto" : "none" }}>
                  {paying ? "Processing…" : `Pay $${flow.price} & start drafting →`}
                </Btn>
                {!canGo && (
                  <div style={{ fontFamily: F.mono, fontSize: 9, color: "#7d8794", marginTop: 8, maxWidth: 220, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {!a.tenderChosen
                      ? "Pick a tender first"
                      : a.open.length
                        ? "Resolve or acknowledge risks above"
                        : "Complete at least 80% of the intake"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {committed && (
        <div style={{ border: `1px solid ${C.rule}`, background: C.white, padding: "18px 20px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, marginBottom: 12 }}>
            Secure payment{freeEligible ? " · first submission free" : ""}
          </div>
          <CheckoutCard autoStart plan="proposal-draft" context={committed} freeEligible={freeEligible} />
          <div style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, lineHeight: 1.5, marginTop: 10 }}>
            Prefer USDT or bank transfer?{" "}
            <a href={`/pay?plan=proposal-draft&submission_type=${committed.submissionType ?? ""}&work_order_id=${committed.workOrderId ?? ""}&submission_order_id=${committed.submissionOrderId ?? ""}`} style={{ color: C.ink, borderBottom: `1px solid ${C.ink}`, textDecoration: "none" }}>
              Open the full checkout →
            </a>
          </div>
        </div>
      )}
      {a.pct < 100 && a.open.length === 0 && a.pct >= PAY_GATE_PCT && (
        <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.5 }}>
          You can pay at {a.pct}% — we&apos;ll prompt you for the remaining {a.need - a.have} item(s) during
          drafting rather than hold things up.
        </div>
      )}
    </div>
  );
}

/* ── The wizard shell ──────────────────────────────────────────────────── */

export function SubWizard({ type, seedMatch, onClose }: SubWizardProps) {
  const { data, openVault, openPaste } = useWorkbench();
  const flow = useMemo(() => flowFor(type), [type]);
  const narrowRail = useMedia(RAIL_BREAK);
  const mobile = useMedia(MOBILE);

  const [draft, setDraft] = useState<WizardDraftState>({ ...EMPTY_DRAFT });
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState(0);
  const [vaultDocs, setVaultDocs] = useState<VaultDocRow[]>([]);
  const [prefills, setPrefills] = useState<Record<string, string>>({});
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // Once commissioned, the order + billing work order exist; we mount the
  // shared embedded checkout inline (no hop to /pay).
  const [committed, setCommitted] = useState<CheckoutContext | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Hydrate: server draft → seed match → vault auto-attach + profile prefills,
  // materialized into the draft so the server audit sees the same numbers.
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
      const pmap = profilePrefillMap(flow, pf);
      for (const [k, v] of Object.entries(pmap)) {
        if (merged.fields[k] == null) merged.fields = { ...merged.fields, [k]: v };
      }
      const attaches = vaultAutoAttach(flow, merged, docs);
      if (attaches.length) merged.docs = [...merged.docs, ...attaches];
      setPrefills(pmap);
      setVaultDocs(docs);
      setDraft(merged);
      setStep(Math.min(merged.step ?? 0, flow.steps.length - 1));
      setSaved(Boolean(Object.keys(stored ?? {}).length));
      setHydrated(true);
    })();
    return () => {
      live = false;
    };
  }, [type, seedMatch, flow]);

  const patch = useCallback((p: Partial<WizardDraftState>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  }, []);

  // Debounced server autosave — the per-type draft, resumed on reopen.
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

  const a = useMemo(() => auditDraft(flow, draft), [flow, draft]);

  // Per-step completeness for the rail ticks (prototype stepDone()).
  const stepDone = useCallback(
    (st: FlowStep): boolean | null => {
      if (st.kind === "tender" || st.kind === "review") return null;
      const mini = { ...flow, steps: [st] };
      return auditDraft(mini, draft).pct === 100;
    },
    [flow, draft],
  );

  const goto = useCallback(
    (i: number) => {
      setStep(Math.max(0, Math.min(flow.steps.length - 1, i)));
      setSaved(false);
      bodyRef.current?.scrollTo({ top: 0 });
    },
    [flow.steps.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const startPay = useCallback(async () => {
    setPaying(true);
    setPayError(null);
    try {
      await saveDraft(type, { ...draft, step }).catch(() => {});
      const res = await commission(type, draft);
      // Mount the shared embedded checkout inline rather than redirecting to
      // /pay — the order + billing work order now exist, so checkout has
      // everything it needs (the wizard's ≥80% gate is authoritative, so
      // readiness self-serves for submission orders).
      setCommitted({
        tender: draft.tender?.title ?? null,
        agency: draft.tender?.agency ?? null,
        pipelineItemId: draft.tender?.pipelineItemId != null ? String(draft.tender.pipelineItemId) : null,
        workOrderId: String(res.work_order_id),
        submissionType: type,
        submissionOrderId: String(res.order.id),
      });
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Could not start checkout — try again.");
      setPaying(false);
    }
  }, [type, draft, step]);

  const renderBlock = (block: FlowBlock, stepId: string, i: number) => {
    switch (block.kind) {
      case "fields":
        return <FieldsBlock key={i} fields={block.fields} draft={draft} patch={patch} prefills={prefills} />;
      case "lines":
        return <LinesBlock key={i} block={block} draft={draft} patch={patch} mobile={mobile} />;
      case "conformity":
        return <ConformityBlock key={i} block={block} draft={draft} patch={patch} />;
      case "criteria":
        return <CriteriaBlock key={i} block={block} draft={draft} patch={patch} prefills={prefills} />;
      case "docs":
        return <DocsBlock key={i} block={block} draft={draft} patch={patch} vaultDocs={vaultDocs} onUpload={openVault} />;
      case "declarations":
        return <DeclarationsBlock key={i} items={block.items} stepId={stepId} draft={draft} patch={patch} />;
      case "pickrefs":
        return <PickRefsBlock key={i} block={block} draft={draft} patch={patch} vaultDocs={vaultDocs} />;
      case "envelope":
        return <EnvelopeBlock key={i} block={block} draft={draft} patch={patch} prefills={prefills} />;
      default:
        return null;
    }
  };

  const current = flow.steps[step];
  const isLast = step === flow.steps.length - 1;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column", background: C.paper }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: mobile ? "12px 16px" : "14px 28px", borderBottom: `1px solid ${C.rule}`, background: C.white, flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.accent }}>
            New submission · ${flow.price}
          </div>
          <div style={{ fontFamily: F.display, fontSize: mobile ? 17 : 20, color: C.ink, letterSpacing: "-0.01em", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {flow.code} — {flow.name}
            {draft.tender?.title ? <span style={{ color: C.mute }}> · {draft.tender.title}</span> : ""}
          </div>
        </div>
        {mobile && (
          <span style={{ fontFamily: F.mono, fontSize: 11, color: a.pct === 100 ? C.pos : C.ink2, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
            {a.pct}%
          </span>
        )}
        {saved && (
          <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.pos, flexShrink: 0 }}>
            ✓ draft saved
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Close — progress is saved automatically"
          title="Progress saves automatically — close and resume any time"
          style={{ background: "transparent", border: `1px solid ${C.rule}`, width: 34, height: 34, cursor: "pointer", fontFamily: F.mono, fontSize: 14, color: C.ink2, flexShrink: 0, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* step rail */}
        {!mobile && (
          <div style={{ width: 218, flexShrink: 0, borderRight: `1px solid ${C.rule}`, padding: "26px 0", overflowY: "auto" }}>
            {flow.steps.map((st, i) => {
              const done = stepDone(st);
              const active = i === step;
              return (
                <button
                  key={st.id}
                  onClick={() => goto(i)}
                  style={{ display: "flex", gap: 12, alignItems: "flex-start", width: "100%", textAlign: "left", padding: "11px 20px", background: active ? C.white : "transparent", border: 0, borderLeft: `2px solid ${active ? C.accent : "transparent"}`, cursor: "pointer" }}
                >
                  <span style={{ fontFamily: F.mono, fontSize: 10, color: done ? C.pos : active ? C.accent : C.faint, marginTop: 2, width: 18, flexShrink: 0 }}>
                    {done ? "✓" : String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: active ? 600 : 400, color: active ? C.ink : C.ink2, display: "block" }}>{st.title}</span>
                    {st.est && <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}>{st.est}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* body */}
        <div ref={bodyRef} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: mobile ? "20px 16px 110px" : "30px 36px 120px" }}>
          <div style={{ maxWidth: 660, margin: "0 auto" }}>
            {mobile && (
              <div style={{ display: "flex", gap: 6, marginBottom: 18, overflowX: "auto", paddingBottom: 4 }}>
                {flow.steps.map((st, i) => (
                  <button key={st.id} onClick={() => goto(i)} style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", padding: "6px 11px", border: `1px solid ${i === step ? C.ink : C.rule}`, background: i === step ? C.ink : "transparent", color: i === step ? C.paper : C.ink2, cursor: "pointer", whiteSpace: "nowrap", textTransform: "uppercase" }}>
                    {i + 1}. {st.title}
                  </button>
                ))}
              </div>
            )}
            <section>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, borderBottom: `1px solid ${C.ink}`, paddingBottom: 10, marginBottom: 18 }}>
                <span style={{ fontFamily: F.mono, fontSize: 11, letterSpacing: "0.18em", color: C.accent }}>§{step + 1}</span>
                <h2 style={{ fontFamily: F.display, fontSize: 23, fontWeight: 400, letterSpacing: "-0.02em", color: C.ink, margin: 0, flex: 1 }}>{current.title}</h2>
                {current.est && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>{current.est}</span>}
              </div>
              {current.intro && (
                <p style={{ fontFamily: F.sans, fontSize: 12.5, color: C.mute, lineHeight: 1.6, margin: "0 0 18px", maxWidth: 560 }}>{current.intro}</p>
              )}
              {!hydrated ? (
                <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, padding: "30px 0" }}>Loading your draft…</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                  {current.kind === "tender" ? (
                    <TenderStep flow={flow} draft={draft} patch={patch} matches={data?.matches ?? []} onPaste={() => openPaste()} />
                  ) : current.kind === "review" ? (
                    <ReviewStep
                      flow={flow}
                      draft={draft}
                      a={a}
                      paying={paying}
                      payError={payError}
                      onPay={startPay}
                      freeEligible={Boolean(data?.access.freeSubmissionEligible)}
                      committed={committed}
                    />
                  ) : (
                    (current.blocks ?? []).map((b, i) => renderBlock(b, current.id, i))
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* readiness rail */}
        {!narrowRail && (
          <div style={{ width: 248, flexShrink: 0, borderLeft: `1px solid ${C.rule}`, padding: "26px 22px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", background: C.paper }}>
            <div>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.accent }}>
                Submission readiness
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                <span style={{ fontFamily: F.display, fontSize: 46, lineHeight: 0.9, color: a.pct === 100 ? C.pos : a.pct >= 60 ? C.ink : C.warn }}>{a.pct}</span>
                <span style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>% complete</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <Bar value={a.pct} height={3} />
              </div>
              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 8, lineHeight: 1.5 }}>
                {a.pct === 100
                  ? "Everything the drafting team needs. Start when ready."
                  : `${a.need - a.have} input${a.need - a.have === 1 ? "" : "s"} remaining across the flow.`}
              </div>
            </div>

            {a.blockers.length > 0 && (
              <div>
                <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.neg }}>
                  Elimination risks
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 9 }}>
                  {a.blockers.map((b) => (
                    <div key={b.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <SevDot severity={b.state === "resolved" ? "low" : b.sev} />
                      <div style={{ fontFamily: F.sans, fontSize: 11, lineHeight: 1.45, color: b.state === "open" ? C.ink2 : C.faint, textDecoration: b.state === "resolved" ? "line-through" : "none" }}>
                        {b.label}
                        {b.state === "acknowledged" && (
                          <span style={{ fontFamily: F.mono, fontSize: 9, color: C.warn, display: "block", marginTop: 2 }}>ACKNOWLEDGED — PROCEEDING AT RISK</span>
                        )}
                        {b.state === "requested" && (
                          <span style={{ fontFamily: F.mono, fontSize: 9, color: C.warn, display: "block", marginTop: 2 }}>REQUEST SENT — WE CHASE & ATTACH</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.mute }}>
                What you&apos;ll receive
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 9 }}>
                {flow.deliverables.map((d) => (
                  <div key={d.name} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.4 }}>{d.name}</span>
                    <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint, flexShrink: 0 }}>{d.fmt}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.accent, marginTop: 10 }}>{flow.sla} · agency-ready format</div>
            </div>

            <div style={{ marginTop: "auto", borderTop: `1px solid ${C.ruleSoft}`, paddingTop: 14 }}>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>
                Auto-eliminators we guard against
              </div>
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5 }}>
                {flow.eliminators.map((e) => (
                  <li key={e} style={{ fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.4, display: "flex", gap: 7 }}>
                    <span style={{ color: C.accent2 }}>—</span>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* footer nav */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${C.rule}`, background: C.white, padding: mobile ? "12px 16px" : "14px 28px", display: "flex", alignItems: "center", gap: 14 }}>
        <Btn kind="ghost" onClick={() => goto(step - 1)} style={{ visibility: step === 0 ? "hidden" : "visible" }}>
          ← Back
        </Btn>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, maxWidth: 280 }}>
            <Bar value={a.pct} height={3} />
          </div>
          {!mobile && (
            <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.mute, fontVariantNumeric: "tabular-nums" }}>{a.pct}% ready</span>
          )}
        </div>
        {!isLast ? (
          <Btn
            kind="primary"
            onClick={() => goto(step + 1)}
            style={{ opacity: step === 0 && !draft.tender?.title ? 0.45 : 1, pointerEvents: step === 0 && !draft.tender?.title ? "none" : "auto" }}
          >
            Continue →
          </Btn>
        ) : (
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Pay & start above ↑
          </span>
        )}
      </div>
    </div>
  );
}
