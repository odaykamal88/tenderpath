"use client";

/**
 * NotificationBell — §5b in-app notification surface.
 *
 * The product's recurring value (new matches, approaching deadlines) was only
 * surfaced by the weekly digest email. This brings it in-app. Every row maps to
 * a REAL matched-pipeline item — there are no synthetic notifications:
 *   - "Closing soon"   ← tender_deadline within 7 days (active-stage items)
 *   - "Newly posted"   ← tender_created_at within 10 days (matched-stage items)
 *
 * Items are passed down from the dashboard layout's existing /api/dashboard/
 * pipeline fetch, so the bell adds no extra request. Read-state lives in
 * localStorage (per-device) — deliberately no new table/column, keeping this
 * off the manual-migration path.
 */

import { useEffect, useMemo, useState } from "react";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

export interface NotifPipelineItem {
  tender_id?: number | null;
  tender_title?: string | null;
  tender_agency?: string | null;
  tender_deadline?: string | null;
  fit_score?: number | null;
  stage?: string | null;
  source_url?: string | null;
  tender_created_at?: string | null;
}

interface Notif {
  key: string;
  kind: "deadline" | "new";
  title: string;
  agency: string;
  meta: string;
  href: string;
  sortTs: number;
}

const SEEN_KEY = "tp_notif_seen";
const ACTIVE_STAGES = new Set(["matched", "evaluating", "preparing"]);
const DAY = 86_400_000;

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
  if (typeof window === "undefined") return;
  try {
    // Cap to avoid unbounded growth as tenders churn.
    localStorage.setItem(SEEN_KEY, JSON.stringify([...keys].slice(-300)));
  } catch {
    /* quota / private mode — read-state is best-effort */
  }
}

function deriveNotifs(items: NotifPipelineItem[], now: number): Notif[] {
  const out: Notif[] = [];
  for (const it of items) {
    const title = (it.tender_title || "").trim();
    if (!title) continue;
    const stage = (it.stage || "").toLowerCase();
    if (!ACTIVE_STAGES.has(stage)) continue;

    const idPart = it.tender_id ?? title;
    const agency = (it.tender_agency || "").trim();
    const href = it.source_url || "/dashboard/pipeline";

    // Closing soon — straight from the real deadline.
    if (it.tender_deadline) {
      const dl = new Date(it.tender_deadline).getTime();
      if (!Number.isNaN(dl) && dl > now && dl - now <= 7 * DAY) {
        const days = Math.max(1, Math.ceil((dl - now) / DAY));
        out.push({
          key: `deadline:${idPart}`,
          kind: "deadline",
          title,
          agency,
          meta: `Closes in ${days} day${days === 1 ? "" : "s"}`,
          href,
          sortTs: dl,
        });
      }
    }

    // Newly posted — only for still-matched items, from the crawl timestamp.
    if (stage === "matched" && it.tender_created_at) {
      const cr = new Date(it.tender_created_at).getTime();
      if (!Number.isNaN(cr) && now - cr >= 0 && now - cr <= 10 * DAY) {
        const fit = typeof it.fit_score === "number" ? `${it.fit_score}% fit` : "new match";
        out.push({
          key: `new:${idPart}`,
          kind: "new",
          title,
          agency,
          meta: `Newly posted · ${fit}`,
          href,
          sortTs: cr,
        });
      }
    }
  }
  return out;
}

function NotifRow({ n }: { n: Notif }) {
  const external = n.href.startsWith("http");
  return (
    <a
      href={n.href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="block px-4 py-3 border-b border-stone-100 hover:bg-stone-50 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`text-[8.5px] font-semibold uppercase tracking-[0.16em] shrink-0 ${
            n.kind === "deadline" ? "text-orange-600" : "text-stone-500"
          }`}
          style={{ fontFamily: MONO }}
        >
          {n.meta}
        </span>
      </div>
      <p className="text-[13px] text-stone-900 leading-snug mt-1 line-clamp-2">{n.title}</p>
      {n.agency && <p className="text-[11px] text-stone-500 mt-0.5">{n.agency}</p>}
    </a>
  );
}

export default function NotificationBell({
  items,
  align = "right",
}: {
  items: NotifPipelineItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  // Lazy init from localStorage — no setState-in-effect.
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());
  // Clock snapshot taken OUTSIDE render — Date.now() is impure and the purity
  // lint rule forbids calling it during render. Re-snapshot when items change
  // so relative "closes in N days" reflects the latest data load.
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [items]);

  const notifs = useMemo(() => (now === 0 ? [] : deriveNotifs(items || [], now)), [items, now]);
  const deadlineNotifs = useMemo(
    () => notifs.filter((n) => n.kind === "deadline").sort((a, b) => a.sortTs - b.sortTs).slice(0, 6),
    [notifs]
  );
  const newNotifs = useMemo(
    () => notifs.filter((n) => n.kind === "new").sort((a, b) => b.sortTs - a.sortTs).slice(0, 6),
    [notifs]
  );
  const unread = notifs.reduce((acc, n) => (seen.has(n.key) ? acc : acc + 1), 0);

  // Esc to close (event-driven; not a state-sync effect).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Mark everything currently shown as seen.
    if (notifs.length) {
      const next = new Set(seen);
      for (const n of notifs) next.add(n.key);
      persistSeen(next);
      setSeen(next);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        className="relative p-2 text-stone-600 hover:text-stone-900 transition-colors"
      >
        <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9a6 6 0 00-12 0v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-orange-500 text-white text-[9px] font-semibold flex items-center justify-center tabular-nums"
            style={{ fontFamily: MONO }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* backdrop — closes on outside click */}
          <button
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            className={`absolute ${align === "left" ? "left-0" : "right-0"} z-50 mt-2 w-[min(360px,92vw)] max-h-[70vh] overflow-y-auto rounded-md border border-stone-200 bg-white shadow-xl`}
          >
            <div className="px-4 py-3 border-b border-stone-200 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500" style={{ fontFamily: MONO }}>
                Notifications
              </span>
              <span className="text-[10px] tabular-nums text-stone-400" style={{ fontFamily: MONO }}>
                {notifs.length}
              </span>
            </div>

            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[12.5px] text-stone-500 leading-relaxed">
                  You&apos;re all caught up — no approaching deadlines or new matches right now.
                </p>
              </div>
            ) : (
              <>
                {deadlineNotifs.length > 0 && (
                  <div>
                    <p className="px-4 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-400" style={{ fontFamily: MONO }}>
                      Closing soon
                    </p>
                    {deadlineNotifs.map((n) => <NotifRow key={n.key} n={n} />)}
                  </div>
                )}
                {newNotifs.length > 0 && (
                  <div>
                    <p className="px-4 pt-3 pb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-400" style={{ fontFamily: MONO }}>
                      Newly posted
                    </p>
                    {newNotifs.map((n) => <NotifRow key={n.key} n={n} />)}
                  </div>
                )}
              </>
            )}

            <a
              href="/dashboard/pipeline"
              className="block px-4 py-3 border-t border-stone-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-600 hover:text-stone-900 transition-colors"
              style={{ fontFamily: MONO }}
              onClick={() => setOpen(false)}
            >
              View all in pipeline →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
