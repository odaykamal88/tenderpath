"use client";

/* Workbench app shell — the dark "dossier spine" sidebar + top bar + mobile
 * drawer. Reads everything from the WorkbenchProvider; pages render as children
 * inside the scrolling main column. Preserves the content-area trial banner so
 * the trial cue survives the mobile drawer collapse (per dashboard-architecture). */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, F } from "./tokens";
import { Icon, type IconName } from "./icons";
import { Avatar } from "./ui";
import { useMedia } from "./useMedia";
import { useWorkbench } from "./WorkbenchProvider";

interface NavDef {
  id: string;
  label: string;
  icon: IconName;
  group: "Workbench" | "Readiness" | "Submit";
  href: string;
  paid?: boolean;
}

const NAV: NavDef[] = [
  { id: "overview", label: "Overview", icon: "overview", group: "Workbench", href: "/dashboard" },
  { id: "matches", label: "Matches", icon: "matches", group: "Workbench", href: "/dashboard/matches" },
  { id: "browse", label: "Browse tenders", icon: "browse", group: "Workbench", href: "/dashboard/browse" },
  { id: "gaps", label: "Readiness gaps", icon: "gaps", group: "Readiness", href: "/dashboard/gaps" },
  { id: "proposals", label: "Submissions", icon: "proposals", group: "Submit", href: "/dashboard/proposals", paid: true },
];

const TITLES: { match: string; title: string }[] = [
  { match: "/dashboard/matches", title: "Matched tenders" },
  { match: "/dashboard/browse", title: "Tender database" },
  { match: "/dashboard/gaps", title: "Readiness gaps" },
  { match: "/dashboard/proposals", title: "Submissions" },
  { match: "/dashboard/account", title: "Account & settings" },
  { match: "/dashboard", title: "Overview" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

function Sidebar({ onNavTap }: { onNavTap?: () => void }) {
  const { data, openPaste, openVault, openSubscribe, isClosed } = useWorkbench();
  const pathname = usePathname() ?? "/dashboard";
  const openGaps = data.gaps.filter((g) => g.status === "open" && !isClosed(g.id)).length;
  const badgeFor = (id: string): number | null => {
    if (id === "matches") return data.pipeline.matched || null;
    if (id === "gaps") return openGaps || null;
    return null;
  };
  const groups: NavDef["group"][] = ["Workbench", "Readiness", "Submit"];

  const navLink = (n: NavDef) => {
    const active = isActive(pathname, n.href);
    const badge = badgeFor(n.id);
    return (
      <Link
        key={n.id}
        href={n.href}
        onClick={onNavTap}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "9px 12px",
          width: "100%",
          textDecoration: "none",
          background: active ? C.spineLine : "transparent",
          borderLeft: `2px solid ${active ? C.accent : "transparent"}`,
          color: active ? C.white : C.spineDim,
          fontFamily: F.sans,
          fontSize: 13.5,
          transition: "color .12s",
        }}
      >
        <span style={{ color: active ? C.accent : "inherit", display: "flex" }}>
          <Icon name={n.icon} />
        </span>
        <span style={{ flex: 1 }}>{n.label}</span>
        {n.paid && (
          <span style={{ fontFamily: F.mono, fontSize: 8, letterSpacing: "0.14em", color: active ? C.accent2 : "#5a6472", border: `1px solid ${active ? "#3a4654" : "#28323e"}`, padding: "1px 4px" }}>PAID</span>
        )}
        {badge != null && (
          <span style={{ fontFamily: F.mono, fontSize: 10.5, color: active ? C.white : C.spineDim, fontVariantNumeric: "tabular-nums" }}>{badge}</span>
        )}
      </Link>
    );
  };

  const initial = (data.company.name || data.company.user || "T").trim().charAt(0).toUpperCase();

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: C.spine, color: C.white }}>
      {/* brand */}
      <div style={{ padding: "20px 18px 16px", borderBottom: `1px solid ${C.spineLine}` }}>
        <Link href="/dashboard" onClick={onNavTap} style={{ display: "flex", alignItems: "baseline", gap: 6, textDecoration: "none" }}>
          <span style={{ fontFamily: F.display, fontSize: 21, fontWeight: 500, color: C.white, letterSpacing: "-0.01em" }}>TenderPath</span>
          <span style={{ color: C.accent, fontFamily: F.display, fontSize: 21 }}>·</span>
        </Link>
        <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: C.spineDim, marginTop: 4 }}>The Workbench</div>
      </div>

      {/* paste */}
      <div style={{ padding: "16px 14px 8px" }}>
        <button onClick={() => { openPaste(); onNavTap?.(); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 13px", background: C.accent, color: C.white, border: 0, cursor: "pointer", fontFamily: F.mono, fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          <Icon name="paste" /> <span style={{ flex: 1, textAlign: "left" }}>Paste a tender</span> <span style={{ opacity: 0.7 }}>+</span>
        </button>
        <div style={{ fontFamily: F.mono, fontSize: 9.5, color: C.spineDim, marginTop: 7, lineHeight: 1.5, padding: "0 2px" }}>Drop any tender link or text → instant bid / no-bid call.</div>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
        {groups.map((group) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "#5a6472", padding: "6px 12px 5px" }}>{group}</div>
            {NAV.filter((n) => n.group === group).map(navLink)}
            {group === "Workbench" && (
              <button onClick={() => { openVault(); onNavTap?.(); }} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: 0, borderLeft: "2px solid transparent", color: C.spineDim, fontFamily: F.sans, fontSize: 13.5 }}>
                <span style={{ display: "flex" }}><Icon name="vault" /></span>
                <span style={{ flex: 1 }}>Document vault</span>
                <span style={{ fontFamily: F.mono, fontSize: 10, color: C.spineDim }}>↗</span>
              </button>
            )}
          </div>
        ))}
      </nav>

      {/* trial + user */}
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.spineLine}` }}>
        {(data.access.isTrialing || data.access.locked) && (
          <div style={{ background: C.spineLine, padding: "11px 13px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: F.sans, fontSize: 12, color: C.white, fontWeight: 500, whiteSpace: "nowrap" }}>
                {data.access.locked ? "Trial ended" : `${data.access.trialDaysLeft} day${data.access.trialDaysLeft === 1 ? "" : "s"} left`}
              </span>
            </div>
            <button onClick={() => { openSubscribe(); onNavTap?.(); }} style={{ marginTop: 8, width: "100%", background: C.white, color: C.ink, border: 0, padding: "8px 0", cursor: "pointer", fontFamily: F.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>Subscribe →</button>
          </div>
        )}
        <Link href="/dashboard/account" onClick={onNavTap} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textDecoration: "none", padding: "7px 8px", margin: "0 -8px", background: isActive(pathname, "/dashboard/account") ? C.spineLine : "transparent" }}>
          <Avatar letter={initial} size={26} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.company.user}</div>
            <div style={{ fontFamily: F.mono, fontSize: 9, color: C.spineDim, letterSpacing: "0.06em" }}>ACCOUNT · SETTINGS</div>
          </div>
          <span style={{ color: C.spineDim, flexShrink: 0, display: "flex" }}><Icon name="gear" size={14} /></span>
        </Link>
      </div>
    </div>
  );
}

function Topbar({ mobile, onBurger }: { mobile: boolean; onBurger: () => void }) {
  const { data, openPaste } = useWorkbench();
  const pathname = usePathname() ?? "/dashboard";
  const title = TITLES.find((t) => isActive(pathname, t.match))?.title ?? "Overview";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: mobile ? "12px 18px" : "16px 32px", borderBottom: `1px solid ${C.rule}`, background: C.paper, position: "sticky", top: 0, zIndex: 20 }}>
      {mobile && (
        <button onClick={onBurger} aria-label="Open menu" style={{ background: "transparent", border: `1px solid ${C.rule}`, padding: "7px 9px", cursor: "pointer", display: "flex", color: C.ink }}>
          <Icon name="menu" />
        </button>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: C.accent }}>Vendor file · {data.company.fileNo}</div>
        <div style={{ fontFamily: F.display, fontSize: mobile ? 18 : 20, color: C.ink, letterSpacing: "-0.01em", marginTop: 2 }}>{title}</div>
      </div>
      {!mobile && (
        <Link href="/dashboard/browse" style={{ display: "flex", alignItems: "center", gap: 10, background: C.white, border: `1px solid ${C.rule}`, padding: "8px 12px", width: 230, color: C.mute, textDecoration: "none" }}>
          <Icon name="search" size={14} />
          <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.faint }}>Search tenders, gaps…</span>
        </Link>
      )}
      <button aria-label="Notifications" style={{ position: "relative", background: "transparent", border: `1px solid ${C.rule}`, padding: 8, cursor: "pointer", color: C.ink2, display: "flex" }}>
        <Icon name="bell" size={16} />
        {data.pipeline.dueSoon > 0 && <span style={{ position: "absolute", top: 5, right: 6, width: 6, height: 6, borderRadius: 999, background: C.neg }} />}
      </button>
      {!mobile && (
        <button onClick={() => openPaste()} style={{ background: C.accent, color: C.white, border: 0, padding: "10px 16px", cursor: "pointer", fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
          + Paste a tender
        </button>
      )}
    </div>
  );
}

function TrialBanner() {
  const { data } = useWorkbench();
  const { isTrialing, locked, trialDaysLeft } = data.access;
  if (!isTrialing && !locked) return null;
  const band = locked || trialDaysLeft <= 3 ? "red" : trialDaysLeft <= 7 ? "orange" : "amber";
  const palette =
    band === "red"
      ? { bg: "#fbeceb", border: "#e6c9c9", fg: C.neg }
      : band === "orange"
        ? { bg: "#fbf1e6", border: "#e8d4b8", fg: C.warn }
        : { bg: "#f8f2e2", border: "#e4d9bd", fg: C.accent };
  return (
    <div style={{ padding: "9px 18px", borderBottom: `1px solid ${palette.border}`, background: palette.bg, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: palette.fg, flexShrink: 0 }}>Trial</span>
        <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {locked ? "Trial ended — subscribe to keep dashboard access." : `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} remaining on your free trial.`}
        </span>
      </div>
      <a href="/pay?plan=annual-access" style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: palette.fg, borderBottom: `1px solid ${palette.fg}`, textDecoration: "none", flexShrink: 0 }}>
        {locked ? "Subscribe →" : "Subscribe →"}
      </a>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const mobile = useMedia("(max-width: 1023px)");
  const [drawer, setDrawer] = useState(false);

  return (
    <div style={{ fontFamily: F.sans, color: C.ink, minHeight: "100vh", display: "flex", background: C.paper }}>
      {!mobile && (
        <aside style={{ width: 244, flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>
          <Sidebar />
        </aside>
      )}

      {mobile && drawer && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
          <div onClick={() => setDrawer(false)} style={{ position: "absolute", inset: 0, background: "rgba(15,22,32,0.5)" }} />
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 264, animation: "tpSlideL .22s ease" }}>
            <Sidebar onNavTap={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <main id="tp-main" style={{ flex: 1, minWidth: 0, height: "100vh", overflowY: "auto" }}>
        <Topbar mobile={mobile} onBurger={() => setDrawer(true)} />
        <TrialBanner />
        <div style={{ padding: `${mobile ? 24 : 36}px ${mobile ? 18 : 40}px ${mobile ? 80 : 64}px`, maxWidth: 1180, margin: "0 auto" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
