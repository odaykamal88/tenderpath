"use client";

/* Document Vault drawer (Phase 1).
 *
 * The repository everything reads from. Shows the user's real vault documents
 * (grouped by type, with downloads) and the documents still missing — derived
 * from their open readiness gaps, each deep-linking into the Navigator. The full
 * grouped vault with the completeness meter + in-drawer upload lands with the
 * Phase-2 Vault work; this keeps the Navigator's "open your Vault" link real and
 * routes uploads to the existing vault page. */

import { useEffect, useState } from "react";
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

export function VaultDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { data, token, openNavigator } = useWorkbench();
  const mobile = useMedia("(max-width: 1023px)");
  const [docs, setDocs] = useState<VaultDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard/vault", {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (res.status === 402) {
          setError("Subscribe to access your Document Vault.");
          return;
        }
        if (!res.ok) {
          setError("We couldn't load your Vault.");
          return;
        }
        const body = (await res.json()) as { documents: VaultDoc[] };
        setDocs(body.documents ?? []);
      } catch {
        setError("We couldn't load your Vault.");
      }
    })();
  }, [token]);

  const onFile = docs?.length ?? 0;
  const missingGaps = data.gaps.filter((g) => g.status === "open");
  const total = onFile + missingGaps.length;
  const pct = total > 0 ? Math.round((onFile / total) * 100) : 0;

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
                  {onFile}/{total} · {pct}%
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

        {/* footer */}
        <div style={{ borderTop: `1px solid ${C.rule}`, background: C.white, padding: "14px 22px", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, flex: 1 }}>Files are checksummed &amp; date-stamped on upload</span>
          <Btn kind="ghost" size="sm" onClick={onClose}>Close</Btn>
          <Btn kind="gold" size="sm" onClick={() => { onClose(); router.push("/dashboard/vault"); }}>+ Upload document</Btn>
        </div>
      </div>
    </div>
  );
}
