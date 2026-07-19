"use client";

import { useMemo, useState } from "react";
import type { WizardDraftState } from "@/lib/submissions/types";
import {
  buildTenderRequirementsView,
  mergeTenderRequirementProgress,
  normalizeTenderRequirements,
  updateTenderRequirement,
} from "@/lib/tender-workspace/requirements";
import {
  TENDER_REQUIREMENT_CATEGORIES,
  TENDER_REQUIREMENT_STATUSES,
  type TenderPackState,
  type TenderRequirementCategory,
  type TenderRequirementSeverity,
  type TenderRequirementStatus,
  type TenderRequirementsState,
} from "@/lib/tender-workspace/types";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useMedia } from "../useMedia";
import { generateTenderRequirements } from "./api";

type TenderDraft = NonNullable<WizardDraftState["tender"]>;

const CATEGORY_LABELS: Record<TenderRequirementCategory, string> = {
  administrative: "Administrative gates",
  technical: "Technical response",
  financial: "Financial response",
  submission: "Submission mechanics",
};

const STATUS_LABELS: Record<TenderRequirementStatus, string> = {
  open: "Open",
  ready: "Ready",
  needs_review: "Needs review",
  not_applicable: "Not applicable",
};

function severityColor(severity: TenderRequirementSeverity): string {
  if (severity === "BLOCK") return C.neg;
  if (severity === "HIGH") return C.warn;
  if (severity === "MED") return C.ink2;
  return C.faint;
}

export function TenderRequirementsPanel({
  tender,
  pack,
  requirements,
  onChange,
}: {
  tender: TenderDraft;
  pack: TenderPackState;
  requirements: TenderRequirementsState;
  onChange: (requirements: TenderRequirementsState) => void;
}) {
  const mobile = useMedia("(max-width: 767px)");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = useMemo(
    () => normalizeTenderRequirements(requirements, pack),
    [requirements, pack],
  );
  const view = useMemo(
    () => buildTenderRequirementsView(pack, normalized),
    [pack, normalized],
  );
  const readableDocuments = pack.documents.filter((document) => document.extractionStatus === "extracted").length;
  const pct = view.total ? Math.round((view.complete / view.total) * 100) : 0;

  async function buildMap() {
    setGenerating(true);
    setError(null);
    try {
      const response = await generateTenderRequirements(tender, pack);
      onChange(mergeTenderRequirementProgress(normalized, response.requirements, pack));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the compliance map.");
    } finally {
      setGenerating(false);
    }
  }

  function patchRequirement(
    id: string,
    patch: { status?: TenderRequirementStatus; ownerNote?: string | null },
  ) {
    onChange(updateTenderRequirement(normalized, pack, id, patch));
  }

  return (
    <div style={{ border: `1px solid ${C.rule}`, background: C.paper, marginTop: 14 }}>
      <div style={{ padding: "15px 17px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent }}>Tender-specific compliance map</div>
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.55, marginTop: 5 }}>
            Read the private pack for published gates, response requirements, and submission mechanics—each tied to its source.
          </div>
        </div>
        <Btn
          kind={view.total ? "ghost" : "primary"}
          size="sm"
          onClick={() => void buildMap()}
          style={{ opacity: generating || !readableDocuments ? 0.55 : 1, pointerEvents: generating || !readableDocuments ? "none" : "auto" }}
        >
          {generating ? "Reading tender pack…" : view.total ? "Refresh compliance map" : "Build compliance map"}
        </Btn>
      </div>

      <div style={{ padding: "15px 17px" }}>
        {!readableDocuments && (
          <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, lineHeight: 1.5 }}>
            Upload a readable solicitation, TOR, guideline, or amendment first. The map only uses text TenderPath can actually access.
          </div>
        )}
        {error && <div role="alert" style={{ fontFamily: F.sans, fontSize: 11.5, color: C.neg, lineHeight: 1.5 }}>{error}</div>}

        {view.total > 0 && (
          <>
            {view.isStale && (
              <div role="status" style={{ border: `1px solid ${C.warn}`, background: C.white, padding: "10px 12px", fontFamily: F.sans, fontSize: 11.5, color: C.warn, lineHeight: 1.5, marginBottom: 12 }}>
                The tender pack changed after this map was built. Refresh it before relying on these requirements.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0,1fr) auto", gap: 12, alignItems: "center", padding: "11px 12px", background: C.white, border: `1px solid ${C.rule}` }}>
              <div>
                <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>Next best action</div>
                <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, lineHeight: 1.45, marginTop: 4 }}>{view.nextAction}</div>
              </div>
              <div style={{ minWidth: mobile ? 0 : 168 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontFamily: F.mono, fontSize: 9, color: C.mute, marginBottom: 5 }}>
                  <span>{view.complete}/{view.total} accounted for</span>
                  <span>{pct}%</span>
                </div>
                <div role="progressbar" aria-label="Tender requirement readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 4, background: C.ruleSoft }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: view.openBlocks ? C.neg : C.pos }} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: view.openBlocks ? C.neg : C.pos, border: `1px solid ${view.openBlocks ? C.neg : C.rule}`, background: C.white, padding: "3px 6px" }}>{view.openBlocks} open blocker{view.openBlocks === 1 ? "" : "s"}</span>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, border: `1px solid ${C.rule}`, background: C.white, padding: "3px 6px" }}>{readableDocuments}/{pack.documents.length} files readable</span>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, border: `1px solid ${C.rule}`, background: C.white, padding: "3px 6px" }}>{normalized.generationStatus}</span>
            </div>

            {normalized.note && (
              <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.warn, lineHeight: 1.45, marginTop: 10 }}>{normalized.note}</div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 14 }}>
              {TENDER_REQUIREMENT_CATEGORIES.map((category) => {
                const items = normalized.items.filter((item) => item.category === category);
                if (!items.length) return null;
                return (
                  <section key={category} aria-labelledby={`requirements-${category}`} style={{ borderTop: `1px solid ${C.rule}` }}>
                    <div id={`requirements-${category}`} style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint, padding: "11px 0 7px" }}>
                      {CATEGORY_LABELS[category]} · {items.length}
                    </div>
                    {items.map((item) => (
                      <div key={item.id} style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0,1fr) 150px", gap: 10, padding: "11px 0", borderTop: `1px solid ${C.ruleSoft}` }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                            <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.08em", color: severityColor(item.severity), border: `1px solid ${severityColor(item.severity)}`, padding: "2px 5px", flexShrink: 0 }}>{item.severity}</span>
                            <div>
                              <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{item.title}</div>
                              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, lineHeight: 1.5, marginTop: 3 }}>{item.action}</div>
                            </div>
                          </div>
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ fontFamily: F.mono, fontSize: 9, color: C.accent, cursor: "pointer" }}>Source evidence & note</summary>
                            <div style={{ borderLeft: `2px solid ${C.rule}`, paddingLeft: 10, marginTop: 7 }}>
                              <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.mute, lineHeight: 1.5 }}>&ldquo;{item.evidence}&rdquo;</div>
                              <div style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint, lineHeight: 1.45, marginTop: 5 }}>Source: {item.sourceDocumentName}{item.sourceSection ? ` · ${item.sourceSection}` : ""} · {item.confidence} confidence</div>
                              <input
                                aria-label={`Owner note for ${item.title}`}
                                disabled={view.isStale}
                                value={item.ownerNote ?? ""}
                                placeholder="Owner, proof, or caveat…"
                                onChange={(event) => patchRequirement(item.id, { ownerNote: event.target.value })}
                                style={{ width: "100%", boxSizing: "border-box", fontFamily: F.sans, fontSize: 11, color: C.ink, background: C.white, border: `1px solid ${C.rule}`, padding: "7px 8px", outline: "none", borderRadius: 0, marginTop: 8 }}
                              />
                            </div>
                          </details>
                        </div>
                        <select
                          aria-label={`Status for ${item.title}`}
                          disabled={view.isStale}
                          value={item.status}
                          onChange={(event) => patchRequirement(item.id, { status: event.target.value as TenderRequirementStatus })}
                          style={{ alignSelf: "start", fontFamily: F.sans, fontSize: 11.5, color: item.status === "open" && item.severity === "BLOCK" ? C.neg : C.ink2, background: C.white, border: `1px solid ${C.rule}`, padding: "7px 8px", borderRadius: 0 }}
                        >
                          {TENDER_REQUIREMENT_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                        </select>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          </>
        )}

        <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: view.total ? 12 : 8 }}>
          This runs only when you ask. Private tender text is sent to TenderPath&apos;s configured AI processor to extract source-backed requirements; no supplier-portal credentials are included. Confirm every blocker against the live notice before submission.
        </div>
      </div>
    </div>
  );
}
