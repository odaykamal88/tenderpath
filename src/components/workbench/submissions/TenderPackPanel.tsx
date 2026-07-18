"use client";

import { useMemo, useRef, useState } from "react";
import type { WizardDraftState } from "@/lib/submissions/types";
import { TENDER_DOCUMENT_ROLES, type TenderPackDocument, type TenderPackState } from "@/lib/tender-workspace/types";
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
  onChange,
}: {
  tender: TenderDraft;
  pack: TenderPackState;
  onChange: (pack: TenderPackState) => void;
}) {
  const mobile = useMedia("(max-width: 767px)");
  const inputRef = useRef<HTMLInputElement>(null);
  const portal = useMemo(() => resolveSubmissionPortal(tender.agency), [tender.agency]);
  const [importing, setImporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const portalUrl = tender.portalUrl || portal.signInUrl || portal.registrationUrl;
  const portalName = tender.portal || portal.portalName;
  const portalCta = portal.signInUrl ? "Open supplier portal" : "Open official supplier instructions";

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
        } catch {
          failed.push(file.name);
        }
      }
      const documents = mergeDocuments(pack.documents, completed);
      onChange({
        status: tenderPackStatus(documents, true),
        documents,
        checkedAt: new Date().toISOString(),
        note: failed.length ? `${failed.length} file(s) did not finish processing. Try them again.` : pack.note ?? null,
      });
      if (failed.length) setError(`Could not process: ${failed.join(", ")}`);
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
      ? "Pack saved; some files need a visual check"
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
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: pack.status === "ready" ? C.pos : C.warn, border: `1px solid ${pack.status === "ready" ? C.pos : C.rule}`, background: C.white, padding: "4px 7px" }}>{statusCopy}</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", borderBottom: `1px solid ${C.rule}` }}>
        <div style={{ padding: "15px 17px", borderRight: mobile ? 0 : `1px solid ${C.rule}`, borderBottom: mobile ? `1px solid ${C.rule}` : 0 }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Official notice</div>
          <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5, marginTop: 6 }}>Use the source notice as the authority for deadlines and instructions.</div>
          {tender.sourceUrl ? (
            <a href={tender.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", fontFamily: F.mono, fontSize: 10, color: C.ink, marginTop: 10, textDecoration: "none", borderBottom: `1px solid ${C.ink}` }}>Open official notice</a>
          ) : (
            <div style={{ fontFamily: F.mono, fontSize: 10, color: C.warn, marginTop: 10 }}>No verified source link on record</div>
          )}
        </div>
        <div style={{ padding: "15px 17px" }}>
          <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.faint }}>Submission route</div>
          <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, fontWeight: 600, marginTop: 6 }}>{portalName}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 9 }}>
            <a href={portalUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: F.mono, fontSize: 10, color: C.accent, textDecoration: "none", borderBottom: `1px solid ${C.accent}` }}>{portalCta}</a>
            {(tender.portalGuideUrl || portal.guideUrl) && <a href={tender.portalGuideUrl || portal.guideUrl} target="_blank" rel="noopener noreferrer" style={{ fontFamily: F.mono, fontSize: 10, color: C.ink2, textDecoration: "none", borderBottom: `1px solid ${C.rule}` }}>Official guide</a>}
          </div>
        </div>
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
