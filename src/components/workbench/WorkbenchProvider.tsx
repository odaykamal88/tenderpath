"use client";

/* WorkbenchProvider — the client core of the redesigned dashboard.
 *
 * Fetches the consolidated /api/dashboard/workbench view model once, exposes it
 * + the cross-cutting actions (open Navigator / Paste / Vault / Subscribe,
 * navigate between routes, mark a gap closed) via context, and hosts the global
 * overlays so any page can trigger them. Live score folds session gap-closes on
 * top of the server score; gap-closes are persisted for real via the existing
 * step-toggle endpoint. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { WorkbenchData, WbAction, WbMatch, WbGap } from "@/lib/workbench/types";
import { C, F } from "./tokens";
import { NavigatorDrawer } from "./overlays/NavigatorDrawer";
import { PasteModal } from "./overlays/PasteModal";
import { VaultDrawer } from "./overlays/VaultDrawer";

const ROUTES: Record<string, string> = {
  overview: "/dashboard",
  matches: "/dashboard/matches",
  browse: "/dashboard/browse",
  gaps: "/dashboard/gaps",
  proposals: "/dashboard/proposals",
  account: "/dashboard/account",
};

interface WorkbenchCtx {
  data: WorkbenchData;
  token: string | null;
  loading: boolean;
  refreshing: boolean;
  liveScore: number;
  sessionGain: number;
  closedGaps: Set<string>;
  isClosed: (gapId: string) => boolean;
  go: (routeId: string) => void;
  runAction: (action: WbAction) => void;
  openNavigator: (gapId: string) => void;
  openPaste: (match?: WbMatch | null) => void;
  openVault: () => void;
  openSubscribe: () => void;
  markGapClosed: (gap: WbGap) => void;
  refresh: () => void;
}

const Ctx = createContext<WorkbenchCtx | null>(null);

export function useWorkbench(): WorkbenchCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkbench must be used within <WorkbenchProvider>");
  return v;
}

function FullScreen({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: C.paper,
        fontFamily: F.mono,
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: C.mute,
      }}
    >
      {children}
    </div>
  );
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  // overlay state
  const [navigatorGapId, setNavigatorGapId] = useState<string | null>(null);
  const [pasteSeed, setPasteSeed] = useState<WbMatch | null | undefined>(undefined); // undefined = closed
  const [vaultOpen, setVaultOpen] = useState(false);

  // session-optimistic closed gaps
  const [closedGaps, setClosedGaps] = useState<Set<string>>(() => new Set());

  const load = useCallback(
    async (initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
        tokenRef.current = token;
        const res = await fetch("/api/dashboard/workbench", {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          cache: "no-store",
        });
        if (res.status === 401) {
          localStorage.removeItem("tp_token");
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          setFatal("We couldn't load your Workbench. Please refresh.");
          return;
        }
        const body = (await res.json()) as WorkbenchData;
        // A still-computing / failed assessment has no renderable Workbench —
        // bounce to the standalone status view the assessment route owns.
        if (body.assessmentStatus === "computing" || body.assessmentStatus === "failed") {
          if (body.reportId) {
            router.replace(`/assessment/${body.reportId}`);
            return;
          }
        }
        setData(body);
        // Seed session closes from persisted acknowledgements so the live score
        // survives reload (union — never drop an optimistic close that's still
        // in flight to the server).
        if (body.acknowledgedGapIds.length > 0) {
          setClosedGaps((prev) => new Set([...prev, ...body.acknowledgedGapIds]));
        }
        setFatal(null);
      } catch {
        setFatal("We couldn't load your Workbench. Please refresh.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const go = useCallback(
    (routeId: string) => {
      router.push(ROUTES[routeId] ?? routeId);
    },
    [router],
  );

  const openNavigator = useCallback((gapId: string) => setNavigatorGapId(gapId), []);
  const openPaste = useCallback((match?: WbMatch | null) => setPasteSeed(match ?? null), []);
  const openVault = useCallback(() => setVaultOpen(true), []);
  const openSubscribe = useCallback(() => {
    // Use the new flat subscription ($49/mo · $324/yr) once its Stripe prices
    // are configured; until then fall back to the existing annual-access flow so
    // the CTA never dead-ends. The pay page handles plan selection + checkout.
    const plan = data?.access.newSubscriptionLive ? "sub-annual" : "annual-access";
    // Navigate in place (was a new tab) so checkout feels like one continuous
    // flow rather than a detached pop-up — part of the 2026-06-19 consolidation.
    window.location.href = `/pay?plan=${plan}`;
  }, [data]);

  const isClosed = useCallback(
    (gapId: string) => {
      if (closedGaps.has(gapId)) return true;
      const g = data?.gaps.find((x) => x.id === gapId);
      return g?.status === "covered";
    },
    [closedGaps, data],
  );

  const markGapClosed = useCallback(
    (gap: WbGap) => {
      setClosedGaps((prev) => {
        const n = new Set(prev);
        n.add(gap.id);
        return n;
      });
      // Persist the closure for real (g{idx}-closed) so it lifts the live score
      // and survives reload. Best-effort — a failed write just means the close
      // reverts on a hard reload; it never blocks the optimistic UI.
      const reportId = data?.reportId;
      if (reportId) {
        void fetch(`/api/assessment/${reportId}/step-toggle`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ stepKey: gap.closeKey, done: true }),
        }).catch((err) => {
          console.warn("[workbench:gap-close:persist_failed]", { closeKey: gap.closeKey, err });
        });
      }
    },
    [data],
  );

  const sessionGain = useMemo(() => {
    if (!data) return 0;
    let g = 0;
    for (const gap of data.gaps) {
      if (gap.status !== "covered" && closedGaps.has(gap.id)) g += gap.impact;
    }
    return g;
  }, [data, closedGaps]);

  const liveScore = Math.min(100, (data?.readiness.score ?? 0) + sessionGain);

  const runAction = useCallback(
    (action: WbAction) => {
      switch (action.kind) {
        case "navigator":
          openNavigator(action.gapId);
          break;
        case "paste":
          openPaste(action.matchId != null ? data?.matches.find((m) => m.id === action.matchId) ?? null : null);
          break;
        case "route":
          go(action.to);
          break;
        case "vault":
          openVault();
          break;
        case "subscribe":
          openSubscribe();
          break;
      }
    },
    [data, go, openNavigator, openPaste, openVault, openSubscribe],
  );

  if (fatal) return <FullScreen>{fatal}</FullScreen>;
  if (loading || !data) return <FullScreen>Loading your Workbench…</FullScreen>;

  const value: WorkbenchCtx = {
    data,
    token: tokenRef.current,
    loading,
    refreshing,
    liveScore,
    sessionGain,
    closedGaps,
    isClosed,
    go,
    runAction,
    openNavigator,
    openPaste,
    openVault,
    openSubscribe,
    markGapClosed,
    refresh: () => void load(false),
  };

  const navigatorGap = navigatorGapId ? data.gaps.find((g) => g.id === navigatorGapId) ?? null : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      {navigatorGap && <NavigatorDrawer gap={navigatorGap} onClose={() => setNavigatorGapId(null)} />}
      {pasteSeed !== undefined && <PasteModal seed={pasteSeed} onClose={() => setPasteSeed(undefined)} />}
      {vaultOpen && <VaultDrawer onClose={() => setVaultOpen(false)} />}
    </Ctx.Provider>
  );
}
