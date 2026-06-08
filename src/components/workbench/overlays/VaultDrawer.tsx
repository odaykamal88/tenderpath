"use client";

/* Document Vault drawer.
 *
 * The repository everything reads from. Shows the user's real vault documents
 * (grouped by type, with downloads + completeness meter) and the documents
 * still missing — derived from their open readiness gaps, each deep-linking
 * into the Navigator. Supports real in-drawer upload: file → /vault/upload
 * (blob + extract) → /vault (register), then refetches the list and refreshes
 * the workbench so an upload that covers a gap lifts the live score. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import { Icon } from "../icons";
import { useMedia } from "../useMedia";
import { useWorkbench } from "../WorkbenchProvider";

interface VaultDoc {
  id: number;
  name: string;
  type: string;
  expiry_date: string | null;
  created_at: string;
  download_url: string;
}

const TYPE_LABEL: Record<string, string> = {
  certification: "Registration & certifications",
  financial: "Financials",
  cv: "Team & CVs",
  past_performance: "Past performance",
  other: "Other documents",
};

const UPLOAD_TYPES: [string, string][] = [
  ["certification", "Registration / certification"],
  ["financial", "Financial statement"],
  ["cv", "Team / CV"],
  ["past_performance", "Past performance / reference"],
  ["other", "Other document"],
];

export function VaultDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data, token, openNavigator, refresh } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState("other");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Pure fetch (no setState) so callers can set state inside their own async
  // closures — keeps the effect free of the set-state-in-effect cascade rule.
  const loadDocs = useCallback(async (): Promise<{ docs?: VaultDoc[]; error?: string }> => {
    try {
      const res = await fetch("/api/dashboard/vault", {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      if (res.status === 402) return { error: "Subscribe to access your Document Vault." };
      if (!res.ok) return { error: "We couldn't load your Vault." };
      const body = (await res.json()) as { documents: VaultDoc[] };
      return { docs: body.documents ?? [] };
    } catch {
      return { error: "We couldn't load your Vault." };
    }
  }, [token]);

  useEffect(() => {
    (async () => {
      const r = await loadDocs();
      if (r.error) setError(r.error);
      else {
        setDocs(r.docs ?? []);
        setError(null);
      }
    })();
  }, [loadDocs]);

  const doUpload = async () => {
    if (!pending) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const fd = new FormData();
      fd.append("file", pending);
      const up = await fetch("/api/dashboard/vault/upload", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const upBody = (await up.json().catch(() => ({}))) as { upload_id?: number; error?: string };
      if (!up.ok || upBody.upload_id == null) {
        setUploadErr(upBody.error ?? "Upload failed.");
        setUploading(false);
        return;
      }
      const reg = await fetch("/api/dashboard/vault", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: pending.name, type: uploadType, upload_id: upBody.upload_id }),
      });
      if (!reg.ok) {
        const rb = (await reg.json().catch(() => ({}))) as { error?: string };
        setUploadErr(rb.error ?? "Couldn't save to your Vault.");
        setUploading(false);
        return;
      }
      // Success — clear, reload the list, and refresh the workbench so a doc
      // that covers a gap lifts the live score + clears the missing row.
      setPending(null);
      setUploadType("other");
      if (fileRef.current) fileRef.current.value = "";
      const r = await loadDocs();
      if (!r.error) setDocs(r.docs ?? []);
      refresh();
    } catch {
      setUploadErr("Upload failed. Please try again.");
    }
    setUploading(false);
  };

  const onFileCount = docs?.length ?? 0;
  const missingGaps = data.gaps.filter((g) => g.status === "open");
  const total = onFileCount + missingGaps.length;
  const pct = total > 0 ? Math.round((onFileCount / total) * 100) : 0;

  const grouped = new Map<string, VaultDoc[]>();
  for (const d of docs ?? []) {
    const arr = grouped.get(d.type) ?? [];
    arr.push(d);
    grouped.set(d.type, arr);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 92, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.55)", animation: "tpFade .2s ease" }} />
      <div style={{ position: "relative", width: mobile ? "100%" : 460, maxWidth: "100%", background: C.paper, height: "100%", display: "flex", flexDirection: "column", boxShadow: "-20px 0 60px rgba(15,22,32,0.3)", animation: "tpSlideR .26s cubic-bezier(.2,.8,.2,1)" }}>
        {/* header */}
        <div style={{ background: C.ink, color: C.paper, padding: "18px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: C.accent, color: C.white, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="vault" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent2 }}>Document Vault</div>
              <div style={{ fontFamily: F.display, fontSize: 21, color: C.paper, marginTop: 3 }}>Your verified document store</div>
              <div style={{ fontFamily: F.mono, fontSize: 10, color: "#9aa3ad", marginTop: 5 }}>Everything TenderPath attaches to a bid lives here</div>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: `1px solid #3a4654`, color: C.paper, width: 30, height: 30, cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="close" size={13} />
            </button>
          </div>
          {docs && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9aa3ad" }}>Completeness</span>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.accent2 }}>
                  {onFileCount}/{total} · {pct}%
                </span>
              </div>
              <div style={{ height: 4, background: C.spineLine }}>
                <div style={{ height: 4, background: C.accent2, width: `${pct}%`, transition: "width .3s" }} />
              </div>
            </div>
          )}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {error && <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink2 }}>{error}</div>}
          {!error && !docs && <div style={{ fontFamily: F.mono, fontSize: 11, color: C.mute, textTransform: "uppercase", letterSpacing: "0.08em" }}>Loading…</div>}

          {docs && missingGaps.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, marginBottom: 10 }}>
                <span style={{ color: C.neg }}>●</span> {missingGaps.length} item{missingGaps.length === 1 ? "" : "s"} missing — closing these unblocks matches and lifts your score.
              </div>
              {missingGaps.map((g) => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 11, border: `1px solid ${C.rule}`, background: C.white, padding: "11px 13px", marginBottom: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${C.neg}`, color: C.neg, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 12 }}>!</span>
                  <span style={{ flex: 1, fontFamily: F.sans, fontSize: 13.5, color: C.ink, fontWeight: 500 }}>{g.title}</span>
                  <button onClick={() => { onClose(); openNavigator(g.id); }} style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.ink, background: C.white, border: `1px solid ${C.rule}`, padding: "5px 9px", cursor: "pointer", flexShrink: 0 }}>
                    Fix →
                  </button>
                </div>
              ))}
            </div>
          )}

          {docs && [...grouped.entries()].map(([type, list]) => (
            <div key={type} style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, marginBottom: 8 }}>{TYPE_LABEL[type] ?? type}</div>
              {list.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 11, border: `1px solid ${C.rule}`, background: C.white, padding: "11px 13px", marginBottom: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 999, border: `1px solid ${C.pos}`, color: C.pos, display: "grid", placeItems: "center", flexShrink: 0, fontSize: 12 }}>✓</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                    <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.mute, marginTop: 2 }}>
                      On file{d.expiry_date ? ` · expires ${new Date(d.expiry_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : ""}
                    </div>
                  </div>
                  <a href={d.download_url} target="_blank" rel="noreferrer" aria-label="Download" style={{ color: C.ink2, flexShrink: 0, display: "grid", placeItems: "center", width: 26, height: 26, border: `1px solid ${C.rule}` }}>↓</a>
                </div>
              ))}
            </div>
          ))}

          {docs && docs.length === 0 && missingGaps.length === 0 && (
            <div style={{ fontFamily: F.sans, fontSize: 13.5, color: C.ink2 }}>No documents on file yet. Upload your registration, financials and references so we can attach them to bids automatically.</div>
          )}
        </div>

        {/* footer / upload */}
        <div style={{ borderTop: `1px solid ${C.rule}`, background: C.white, padding: "14px 22px" }}>
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp" onChange={(e) => { setPending(e.target.files?.[0] ?? null); setUploadErr(null); }} style={{ display: "none" }} />
          {pending ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ color: C.accent }}><Icon name="upload" size={15} /></span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: F.sans, fontSize: 13, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pending.name}</span>
                <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} style={{ fontFamily: F.sans, fontSize: 12, color: C.ink, border: `1px solid ${C.rule}`, background: C.white, padding: "5px 6px", outline: "none" }}>
                  {UPLOAD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {uploadErr && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.neg, marginBottom: 8 }}>{uploadErr}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Btn kind="ghost" size="sm" onClick={() => { setPending(null); setUploadErr(null); if (fileRef.current) fileRef.current.value = ""; }} disabled={uploading}>Cancel</Btn>
                <Btn kind="gold" size="sm" onClick={doUpload} disabled={uploading}>{uploading ? "Uploading…" : "Upload →"}</Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, flex: 1 }}>Files are checksummed &amp; date-stamped on upload</span>
              <Btn kind="ghost" size="sm" onClick={() => router.push("/dashboard/vault")}>Open full Vault</Btn>
              <Btn kind="gold" size="sm" onClick={() => fileRef.current?.click()}>+ Upload</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
