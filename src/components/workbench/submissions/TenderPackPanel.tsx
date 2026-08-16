"use client";

import { useMemo, useRef, useState } from "react";
import type { WizardDraftState } from "@/lib/submissions/types";
import {
  buildPortalCompanionView,
  safeExternalHttpUrl,
  togglePortalConfirmation,
} from "@/lib/tender-workspace/companion";
import {
  TENDER_DOCUMENT_ROLES,
  type PortalCompanionState,
  type PortalConfirmationId,
  type TenderPackDocument,
  type TenderPackState,
} from "@/lib/tender-workspace/types";
import { tenderPackStatus } from "@/lib/tender-workspace/documents";
import { uploadTenderPackFile } from "@/lib/vault/client-upload";
import { resolveSubmissionPortal } from "@/lib/tenders/submission-portals";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { useMedia } from "../useMedia";
import { importTenderPack } from "./api";

type TenderDraft = NonNullable<WizardDraftState["tender"]>;

const ROLE_LABELS: Record<TenderPackDocument["role"], string> = {
  guidelines: "Guidelines",
  tor: "Terms of reference",
  solicitation: "Solicitation",
  amendment: "Amendment / corrigendum",
  qa: "Q&A / clarification",
  info_session: "Information session",
  annex: "Annex / form",
  supporting: "Supporting document",
};

function mergeDocuments(current: TenderPackDocument[], incoming: TenderPackDocument[]): TenderPackDocument[] {
  const byId = new Map(current.map((doc) => [doc.vaultDocumentId, doc]));
  for (const doc of incoming) byId.set(doc.vaultDocumentId, doc);
  return [...byId.values()];
}

export function TenderPackPanel({
  tender,
  pack,
  companion,
  onChange,
  onCompanionChange,
}: {
  tender: TenderDraft;
  pack: TenderPackState;
  companion: PortalCompanionState;
  onChange: (pack: TenderPackState) => void;
  onCompanionChange: (companion: PortalCompanionState) => void;
}) {
  const mobile = useMedia("(max-width: 767px)");
  const inputRef = useRef<HTMLInputElement>(null);
  const portal = useMemo(() => resolveSubmissionPortal(tender.agency), [tender.agency]);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portalUrl = safeExternalHttpUrl(
    tender.portalOverride
      ? tender.portalUrl
      : tender.portalUrl || portal.signInUrl || portal.registrationUrl,
  ) ?? "";
  const officialNoticeUrl = safeExternalHttpUrl(tender.sourceUrl);
  const portalName = tender.portal || portal.portalName;
  const portalGuideUrl = tender.portalOverride
    ? safeExternalHttpUrl(tender.portalGuideUrl)
    : safeExternalHttpUrl(tender.portalGuideUrl || portal.guideUrl);
  const portalSteps = tender.portalOverride ? [] : portal.steps;
  const companionView = useMemo(
    () => buildPortalCompanionView(tender, pack, companion),
    [tender, pack, companion],
  );

  function openPortalBeside() {
    setError(null);
    if (!portalUrl) {
      setError("This notice does not include a portal URL. Use the submission channel named in the official notice.");
      return;
    }
    const width = Math.min(900, Math.max(620, Math.round(window.screen.availWidth * 0.48)));
    const height = Math.max(620, window.screen.availHeight - 72);
    const positionedScreen = window.screen as Screen & { availLeft?: number; availTop?: number };
    const left = (positionedScreen.availLeft ?? 0) + Math.max(0, window.screen.availWidth - width);
    const top = (positionedScreen.availTop ?? 0) + 36;
    const opened = window.open(
      portalUrl,
      "tenderpath_supplier_portal",
      `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!opened) {
      setError("The portal window was blocked. Allow pop-ups for TenderPath, or use the direct portal link below.");
      return;
    }
    try {
      opened.opener = null;
      opened.focus();
    } catch {
      // Cross-origin portal controls can block focus/opener writes. The portal
      // is still open and no workflow state depends on those browser hints.
    }
    const now = new Date().toISOString();
    onCompanionChange({ ...companion, portalOpenedAt: now, updatedAt: now });
  }

  function confirm(id: PortalConfirmationId, done: boolean) {
    onCompanionChange(togglePortalConfirmation(companion, id, done));
  }

  async function importPublicPack() {
    if (!tender.tenderId) return;
    setImporting(true);
    setError(null);
    try {
      const imported = await importTenderPack(tender.tenderId);
      onChange({
        status: imported.status,
        documents: mergeDocuments(pack.documents, imported.documents),
        checkedAt: imported.checkedAt ?? new Date().toISOString(),
        note: imported.note ?? null,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tender pack import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    const completed: TenderPackDocument[] = [];
    const failed: string[] = [];
    try {
      for (const [index, file] of Array.from(files).entries()) {
        try {
          const doc = await uploadTenderPackFile(
            file,
            { tenderId: tender.tenderId, tenderTitle: tender.title },
            (value) => setProgress(Math.round(((index + value / 100) / files.length) * 100)),
          );
          completed.push(doc);
        } catch (cause) {
          // The tender pack is the single biggest input to drafting quality, so
          // a failed upload must never be a bare filename. Keep the real reason
          // for the user AND in the console — a swallowed error here left a
          // paid submission with an empty pack and no way to diagnose it.
          const reason = cause instanceof Error ? cause.message : String(cause);
          console.error("[tp:tender-pack:upload_failed]", {
            file: file.name,
            sizeBytes: file.size,
            mimeType: file.type || "(none)",
            tenderId: tender.tenderId ?? null,
            reason,
          });
          failed.push(`${file.name} — ${reason}`);
        }
      }
      const documents = mergeDocuments(pack.documents, completed);
      onChange({
        status: tenderPackStatus(documents, true),
        documents,
        checkedAt: new Date().toISOString(),
        note: failed.length ? `${failed.length} file(s) did not finish processing. Try them again.` : pack.note ?? null,
      });
      if (failed.length) setError(`Could not process: ${failed.join(" · ")}`);
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function changeRole(vaultDocumentId: number, role: TenderPackDocument["role"]) {
    onChange({
      ...pack,
      documents: pack.documents.map((doc) => doc.vaultDocumentId === vaultDocumentId ? { ...doc, role } : doc),
    });
  }

  const statusCopy = pack.status === "ready"
    ? `${pack.documents.length} private document${pack.documents.length === 1 ? "" : "s"} ready`
    : pack.status === "partial"
      ? `${pack.documents.filter((doc) => doc.extractionStatus === "extracted").length}/${pack.documents.length} files readable — fix the rest`
      : pack.status === "needs_upload"
        ? "Portal download needed"
        : "Not checked yet";

  return (
    <div style={{ border: `1px solid ${C.ink}`, background: C.paper, marginTop: 18 }}>
      <div style={{ padding: "15px 17px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent }}>Private tender workspace</div>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, lineHeight: 1.5, marginTop: 5 }}>Notice, submission route, and solicitation pack in one place.</div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: companionView.complete === companionView.total ? C.pos : C.warn, border: `1px solid ${companionView.complete === companionView.total ? C.pos : C.rule}`, background: C.white, padding: "4px 7px" }}>{companionView.complete}/{companionView.total} portal checks</span>
          <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: pack.status === "ready" ? C.pos : C.warn, border: `1px solid ${pack.status === "ready" ? C.pos : C.rule}`, background: C.white, padding: "4px 7px" }}>{statusCopy}</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ padding: "15px 17px", borderRight: mobile ? 0 : `1px solid ${C.rule}`, borderBottom: mobile ? `1px solid ${C.rule}` : 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Official notice</div>
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5, marginTop: 6 }}>Use the source notice as the authority for deadlines and instructions.</div>
          {officialNoticeUrl ? (
            <a href={officialNoticeUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", fontFamily: F.mono, fontSize: 10, color: C.ink, marginTop: 10, textDecoration: "none", borderBottom: `1px solid ${C.ink}` }}>Open official notice</a>
          ) : (
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.warn, marginTop: 10 }}>No verified source link on record</div>
          )}
        </div>
        <div style={{ padding: "15px 17px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Submission route</div>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, fontWeight: 600, marginTop: 6 }}>{portalName}</div>
          {companionView.firstTimeRisk !== "none" && (
            <div style={{ fontFamily: F.sans, fontSize: 11, color: companionView.firstTimeRisk === "very-tight" ? C.neg : C.warn, lineHeight: 1.45, marginTop: 6 }}>
              {companionView.firstTimeRisk === "very-tight" ? "Registration window is very tight" : "Registration window may be tight"}
              {companionView.daysUntilDeadline != null ? ` · ${companionView.daysUntilDeadline} day${companionView.daysUntilDeadline === 1 ? "" : "s"} left` : ""}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            {portalUrl ? (
              <>
                <Btn kind="primary" size="sm" onClick={openPortalBeside}>Open portal beside TenderPath</Btn>
                <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: F.mono, fontSize: 9.5, color: C.accent, textDecoration: "none", borderBottom: `1px solid ${C.accent}` }}>Direct portal link</a>
              </>
            ) : (
              <span style={{ fontFamily: F.sans, fontSize: 11, color: C.warn }}>Follow the channel named in the official notice.</span>
            )}
            {portalGuideUrl && <a href={portalGuideUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: F.mono, fontSize: 10, color: C.ink2, textDecoration: "none", borderBottom: `1px solid ${C.rule}` }}>Official guide</a>}
          </div>
          {companion.portalOpenedAt && <div style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint, marginTop: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>Portal opened from this workspace</div>}
        </div>
      </div>

      <div style={{ padding: "15px 17px", borderBottom: `1px solid ${C.rule}`, background: C.white }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent }}>Portal hand-off checklist</div>
            <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5, marginTop: 5 }}>Derived evidence plus your confirmations—never invented progress.</div>
          </div>
          <span style={{ fontFamily: F.display, fontSize: 25, lineHeight: 1, color: companionView.pct === 100 ? C.pos : C.ink }}>{companionView.pct}%</span>
        </div>
        <div role="progressbar" aria-label="Portal hand-off readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={companionView.pct} style={{ height: 3, background: C.rule, marginTop: 11 }}>
          <div style={{ height: "100%", width: `${companionView.pct}%`, background: companionView.pct === 100 ? C.pos : C.accent, transition: "width 160ms ease" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)", gap: mobile ? 0 : "0 22px", marginTop: 12 }}>
          {companionView.items.map((item) => (
            <label key={item.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 0", borderBottom: `1px solid ${C.ruleSoft}`, cursor: item.confirmationId ? "pointer" : "default" }}>
              <input
                type="checkbox"
                checked={item.complete}
                disabled={!item.confirmationId}
                onChange={(event) => item.confirmationId && confirm(item.confirmationId, event.target.checked)}
                style={{ width: 15, height: 15, margin: "1px 0 0", accentColor: C.pos, flexShrink: 0 }}
              />
              <span>
                <span style={{ display: "block", fontFamily: F.sans, fontSize: 11.8, fontWeight: 600, color: item.complete ? C.ink : C.ink2, lineHeight: 1.35 }}>{item.label}</span>
                <span style={{ display: "block", fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.4, marginTop: 2 }}>{item.detail}</span>
              </span>
            </label>
          ))}
        </div>

        <div style={{ marginTop: 13, padding: "12px 13px", border: `1px solid ${companionView.nextAction.kind === "ready" ? C.pos : C.rule}`, background: companionView.nextAction.kind === "ready" ? "#f3f8f4" : C.paper, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, maxWidth: 520 }}>
            <div style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.12em", textTransform: "uppercase", color: companionView.nextAction.kind === "ready" ? C.pos : C.warn }}>Next best action</div>
            <div style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginTop: 4 }}>{companionView.nextAction.title}</div>
            <div style={{ fontFamily: F.sans, fontSize: 10.8, color: C.mute, lineHeight: 1.45, marginTop: 3 }}>{companionView.nextAction.detail}</div>
          </div>
          {companionView.nextAction.kind === "portal" && portalUrl && <Btn kind="primary" size="sm" onClick={openPortalBeside}>Open portal</Btn>}
          {companionView.nextAction.kind === "pack" && (
            tender.tenderId && tender.sourceUrl
              ? <Btn kind="primary" size="sm" onClick={importPublicPack} style={{ opacity: importing ? 0.55 : 1, pointerEvents: importing ? "none" : "auto" }}>{importing ? "Checking source…" : "Import public pack"}</Btn>
              : <Btn kind="primary" size="sm" onClick={() => inputRef.current?.click()}>Upload files</Btn>
          )}
        </div>

        {portalSteps.length > 0 ? (
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontFamily: F.mono, fontSize: 9.5, color: C.ink2, cursor: "pointer", letterSpacing: "0.08em", textTransform: "uppercase" }}>Show verified portal steps</summary>
            <ol style={{ margin: "10px 0 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 7 }}>
              {portalSteps.map((step) => <li key={step} style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, lineHeight: 1.5, paddingLeft: 3 }}>{step}</li>)}
            </ol>
            <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.45, marginTop: 9 }}>{portal.note}</div>
          </details>
        ) : (
          <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.45, marginTop: 12 }}>Notice-specific route recorded. The official notice remains authoritative.</div>
        )}
      </div>

      <div style={{ padding: "15px 17px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ maxWidth: 410 }}>
            <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: C.ink }}>Bring in the solicitation pack</div>
            <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, lineHeight: 1.5, marginTop: 4 }}>We import public attachments when the notice exposes them. If the portal requires login, download there and upload here.</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tender.tenderId && tender.sourceUrl && <Btn kind="ghost" size="sm" onClick={importPublicPack} style={{ opacity: importing ? 0.55 : 1, pointerEvents: importing ? "none" : "auto" }}>{importing ? "Checking source…" : "Import public pack"}</Btn>}
            <Btn kind="primary" size="sm" onClick={() => inputRef.current?.click()} style={{ opacity: uploading ? 0.55 : 1, pointerEvents: uploading ? "none" : "auto" }}>{uploading ? `Uploading${progress != null ? ` ${progress}%` : "…"}` : "Upload portal files"}</Btn>
            <input ref={inputRef} type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/jpeg,image/png,image/webp" onChange={(event) => void uploadFiles(event.target.files)} style={{ display: "none" }} />
          </div>
        </div>

        {pack.note && <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, lineHeight: 1.5, marginTop: 11, padding: "9px 11px", background: C.white, border: `1px solid ${C.rule}` }}>{pack.note}</div>}
        {error && <div role="alert" style={{ fontFamily: F.sans, fontSize: 11.5, color: C.neg, lineHeight: 1.5, marginTop: 11 }}>{error}</div>}

        {pack.documents.length > 0 && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.rule}` }}>
            {pack.documents.map((doc) => (
              <div key={doc.vaultDocumentId} style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "minmax(0,1fr) 170px auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.ruleSoft}` }}>
                <a href={doc.downloadUrl} target="_blank" rel="noopener noreferrer" style={{ minWidth: 0, fontFamily: F.sans, fontSize: 12.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "none" }}>{doc.name}</a>
                <select aria-label={`Document role for ${doc.name}`} value={doc.role} onChange={(event) => changeRole(doc.vaultDocumentId, event.target.value as TenderPackDocument["role"])} style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, background: C.white, border: `1px solid ${C.rule}`, padding: "6px 8px", borderRadius: 0 }}>
                  {TENDER_DOCUMENT_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                </select>
                <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: doc.extractionStatus === "extracted" ? C.pos : C.warn, whiteSpace: "nowrap" }}>{doc.source === "source_import" ? "Imported" : "Uploaded"} · {doc.extractionStatus}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontFamily: F.sans, fontSize: 10.5, color: C.faint, lineHeight: 1.5, marginTop: 12 }}>TenderPath never asks for or stores your supplier-portal password. Files are private to your account and served through owner-authorized download routes.</div>
      </div>
    </div>
  );
}
