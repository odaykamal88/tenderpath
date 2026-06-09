"use client";

/* Topbar notification bell (dossier). Real notices only — derived from the
 * viewer's matched tenders closing within 7 days. Read-state lives in
 * localStorage (per-device, no new table). Each row opens the bid/no-bid Paste
 * flow seeded with that tender. */

import { useEffect, useMemo, useState } from "react";
import { C, F } from "./tokens";
import { Icon } from "./icons";
import { useWorkbench } from "./WorkbenchProvider";
import { daysUntil, isSoon } from "./ui";
import type { WbMatch } from "@/lib/workbench/types";

const SEEN_KEY = "tp_wb_notif_seen";

function readSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistSeen(keys: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-300)));
  } catch {
    /* best-effort */
  }
}

export function WbNotificationBell() {
  const { data, openPaste, go } = useWorkbench();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  const notices = useMemo(
    () =>
      data.matches
        .filter((m) => isSoon(m.deadline))
        .map((m) => ({ key: `${m.id}:${m.deadline ?? ""}`, m, days: daysUntil(m.deadline) ?? 99 }))
        .sort((a, b) => a.days - b.days)
        .slice(0, 8),
    [data.matches],
  );

  const unread = notices.reduce((acc, n) => (seen.has(n.key) ? acc : acc + 1), 0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (notices.length) {
      const next = new Set(seen);
      for (const n of notices) next.add(n.key);
      persistSeen(next);
      setSeen(next);
    }
  };

  const pick = (m: WbMatch) => {
    setOpen(false);
    openPaste(m);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        style={{ position: "relative", background: "transparent", border: `1px solid ${C.rule}`, padding: 8, cursor: "pointer", color: C.ink2, display: "flex" }}
      >
        <Icon name="bell" size={16} />
        {unread > 0 && <span style={{ position: "absolute", top: 5, right: 6, width: 6, height: 6, borderRadius: 999, background: C.neg }} />}
      </button>

      {open && (
        <>
          <button aria-label="Close notifications" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, cursor: "default", background: "transparent", border: 0 }} />
          <div style={{ position: "absolute", right: 0, zIndex: 50, marginTop: 8, width: "min(360px, 92vw)", maxHeight: "70vh", overflowY: "auto", background: C.white, border: `1px solid ${C.rule}`, boxShadow: "0 18px 50px rgba(15,22,32,0.22)" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.rule}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.mute }}>Notifications</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>{notices.length}</span>
            </div>

            {notices.length === 0 ? (
              <div style={{ padding: "28px 16px", textAlign: "center" }}>
                <p style={{ fontFamily: F.sans, fontSize: 12.5, lineHeight: 1.55, color: C.mute, margin: 0 }}>You&apos;re all caught up — nothing closing in the next 7 days.</p>
              </div>
            ) : (
              <>
                <div style={{ padding: "10px 16px 2px", fontFamily: F.mono, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: C.faint }}>Closing soon</div>
                {notices.map((n) => (
                  <button key={n.key} onClick={() => pick(n.m)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", borderBottom: `1px solid ${C.ruleSoft}`, background: "none", border: 0, cursor: "pointer" }}>
                    <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.neg, fontWeight: 600 }}>Closes in {n.days} day{n.days === 1 ? "" : "s"}</span>
                    <div style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, lineHeight: 1.4, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.m.title}</div>
                    {n.m.agency && <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.m.agency}</div>}
                  </button>
                ))}
              </>
            )}

            <button onClick={() => { setOpen(false); go("matches"); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 16px", borderTop: `1px solid ${C.rule}`, background: "none", border: 0, cursor: "pointer", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.ink2 }}>
              View all matches →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
