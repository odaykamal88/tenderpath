"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

interface Me {
  id: number;
  email: string;
  name: string | null;
  subscription_status: string | null;
  is_super_admin: boolean;
}

interface AccessState {
  user: Me;
  trialDaysLeft: number;
  isTrialing: boolean;
  locked: boolean;
}

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";
const SERIF = "'Fraunces', 'Times New Roman', serif";

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="h-[15px] w-[15px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const NAV_ICONS: Record<string, string> = {
  "/dashboard":
    "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
  "/dashboard/pipeline":
    "M3 7.5h18M3 12h18M3 16.5h18M3 4.5A1.5 1.5 0 014.5 3h15A1.5 1.5 0 0121 4.5v15a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 19.5v-15z",
  "/dashboard/services":
    "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z",
  "/dashboard/vault":
    "M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z",
  "/dashboard/settings":
    "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  "/dashboard/work-orders":
    "M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z",
  help:
    "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z",
  faq:
    "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
  signout:
    "M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75",
  menu: "M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5",
  close: "M6 18L18 6M6 6l12 12",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // null = use the default (open when on a services route OR for non-paid users
  // so the upsell menu stays visible); true/false = user has explicitly toggled.
  const [servicesOpen, setServicesOpen] = useState<boolean | null>(null);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) {
      router.replace("/login?next=" + encodeURIComponent(pathname || "/dashboard"));
      return;
    }

    (async () => {
      const res = await fetch("/api/auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        localStorage.removeItem("tp_token");
        router.replace("/login");
        return;
      }
      const user: Me = await res.json();

      const probe = await fetch("/api/dashboard/pipeline", {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = probe.ok ? await probe.json() : null;
      const access = body?.access;

      setState({
        user,
        trialDaysLeft: access?.trialDaysLeft ?? 0,
        isTrialing: access?.isTrialing ?? false,
        locked: probe.status === 402,
      });
      setLoading(false);
    })();
  }, [router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-[13px] text-stone-400" style={{ fontFamily: MONO }}>
        Loading…
      </div>
    );
  }

  if (!state) return null;

  const isPaid = state.user.is_super_admin || state.user.subscription_status === "active";
  // /dashboard/bid-analysis and /dashboard/applications still exist as routes
  // (linked from work-orders / email flows) but are no longer surfaced in the
  // sidebar — the Services dropdown points directly at the service intake
  // pages now.
  const servicesActive = (pathname ?? "").startsWith("/dashboard/services");
  // Default-open when on a services route OR when the user is non-paid (keeps the
  // upsell menu in peripheral vision). Once the user toggles, their choice wins.
  const servicesDefaultOpen = servicesActive || !isPaid;
  const servicesExpanded = servicesOpen === null ? servicesDefaultOpen : servicesOpen;

  // PR-I (2026-05-23): "Work orders" is now a top-level Workbench item under
  // Overview, per user request. The bottom-bar "Billing & orders" link still
  // points at the same route for the footer cluster (settings / help) but the
  // Workbench placement is the primary entry point — that's where users
  // actually look for "did my paid service finish yet".
  const workbench = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/work-orders", label: "Work orders" },
  ];
  const tools = [
    { href: "/dashboard/vault", label: "Document vault", requiresPaid: true },
    { href: "/dashboard/settings", label: "Settings" },
  ];

  // Active page label for the mobile top bar. Services dropdown still matches
  // any /dashboard/services/* path so the breadcrumb stays accurate when the
  // user is on an intake page.
  const allItems = [
    ...workbench,
    { href: "/dashboard/services", label: "Services", matchPaths: ["/dashboard/services"] },
    ...tools,
  ];
  const activeItem =
    allItems.find((it) => {
      if (it.href === "/dashboard") return pathname === "/dashboard";
      const match = "matchPaths" in it ? it.matchPaths : undefined;
      return (match ?? [it.href]).some((p: string) => pathname?.startsWith(p));
    }) ?? null;

  const renderNavItem = (item: { href: string; label: string; matchPaths?: string[]; requiresPaid?: boolean }) => {
    const active =
      item.href === "/dashboard"
        ? pathname === "/dashboard"
        : (item.matchPaths ?? [item.href]).some((p) => pathname?.startsWith(p));
    const previewLocked = item.requiresPaid && !isPaid;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`group relative flex items-center justify-between gap-2.5 rounded-sm pl-3 pr-2.5 py-2 lg:py-1.5 text-[14px] lg:text-[13px] transition-colors ${
          active
            ? "bg-stone-900 text-white"
            : previewLocked
            ? "text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
        }`}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <NavIcon path={NAV_ICONS[item.href] ?? NAV_ICONS["/dashboard/services"]} />
          <span className="truncate">{item.label}</span>
        </span>
        {previewLocked && (
          <span
            className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.18em] ${
              active
                ? "bg-white/15 text-white"
                : "border border-amber-300 text-amber-700 group-hover:border-amber-500"
            }`}
            style={{ fontFamily: MONO }}
          >
            Pro
          </span>
        )}
      </Link>
    );
  };

  // PR-M (2026-05-23): trial visualization scaled for the 30-day window.
  // Color bands map to remaining-days buckets so a 30-day signup sees an
  // amber pill all month long, an orange pill on days 23-27, and a red
  // pill on the final 3 days. After expiry the locked-red banner takes
  // over. Links point at /pay?plan=annual-access (regular $99/year) —
  // founder $49 offer surfaces elsewhere per product direction.
  const trialColorBand =
    state.locked ? "red" :
    state.trialDaysLeft <= 3 ? "red" :
    state.trialDaysLeft <= 7 ? "orange" :
    "amber";

  // Compact trial pill
  const trialPill = (state.isTrialing || state.locked) && (
    <Link
      href="/pay?plan=annual-access"
      target="_blank"
      rel="noreferrer"
      className={`block rounded-sm border p-3 transition-colors ${
        trialColorBand === "red"
          ? "border-red-300 bg-red-50/60 hover:bg-red-50"
          : trialColorBand === "orange"
          ? "border-orange-300 bg-orange-50/60 hover:bg-orange-50"
          : "border-amber-300 bg-amber-50/60 hover:bg-amber-50"
      }`}
    >
      {state.locked ? (
        <>
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-red-700" style={{ fontFamily: MONO }}>
            Trial · ended
          </div>
          <div className="mt-1 text-[18px] leading-tight font-medium text-red-900" style={{ fontFamily: SERIF }}>
            Subscribe to continue
          </div>
          <div className="mt-1 text-[10.5px] tracking-wider uppercase text-red-700/80" style={{ fontFamily: MONO }}>
            $99 / yr →
          </div>
        </>
      ) : (
        <>
          <div
            className={`text-[9px] font-semibold uppercase tracking-[0.18em] ${
              trialColorBand === "red" ? "text-red-700"
              : trialColorBand === "orange" ? "text-orange-700"
              : "text-amber-800"
            }`}
            style={{ fontFamily: MONO }}
          >
            Trial
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[28px] leading-none font-medium text-stone-900 tabular-nums" style={{ fontFamily: SERIF }}>
              {state.trialDaysLeft}
            </span>
            <span className="text-[11px] text-stone-600">
              day{state.trialDaysLeft === 1 ? "" : "s"} left
            </span>
          </div>
          <div
            className={`mt-1.5 text-[10.5px] tracking-wider uppercase ${
              trialColorBand === "red" ? "text-red-700 group-hover:text-red-900"
              : trialColorBand === "orange" ? "text-orange-700 group-hover:text-orange-900"
              : "text-amber-800 group-hover:text-amber-900"
            }`}
            style={{ fontFamily: MONO }}
          >
            Subscribe · $99/yr →
          </div>
        </>
      )}
    </Link>
  );

  // Compact trial badge for mobile top bar — single line
  const trialBadge = (state.isTrialing || state.locked) ? (
    <Link
      href="/pay?plan=annual-access"
      target="_blank"
      rel="noreferrer"
      className={`hidden xs:flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
        trialColorBand === "red" ? "border-red-300 bg-red-50/60 text-red-700"
          : trialColorBand === "orange" ? "border-orange-300 bg-orange-50/60 text-orange-700"
          : "border-amber-300 bg-amber-50/60 text-amber-700"
      }`}
      style={{ fontFamily: MONO }}
    >
      {state.locked ? (
        <span>Locked</span>
      ) : (
        <>
          <span className="text-[13px] font-medium tabular-nums" style={{ fontFamily: SERIF }}>
            {state.trialDaysLeft}d
          </span>
          <span>trial</span>
        </>
      )}
    </Link>
  ) : null;

  // Sidebar contents — shared between desktop aside and mobile drawer
  const sidebarBody = (
    <>
      {/* Logo */}
      <Link href="/" className="flex items-baseline gap-1 mb-1.5 px-1 group">
        <span
          className="text-[24px] leading-none font-medium text-stone-900 group-hover:text-stone-700 transition-colors tracking-tight"
          style={{ fontFamily: SERIF }}
        >
          Tender<span className="text-orange-500">·</span>Path
        </span>
      </Link>
      <div
        className="px-1 mb-6 lg:mb-7 text-[9px] font-semibold uppercase tracking-[0.22em] text-stone-400"
        style={{ fontFamily: MONO }}
      >
        The vendor workbench
      </div>

      {/* Workbench */}
      <div className="mb-1">
        <div className="px-1 mb-2 flex items-baseline justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-stone-400" style={{ fontFamily: MONO }}>
            Workbench
          </span>
          <span className="text-[9px] tabular-nums text-stone-300" style={{ fontFamily: MONO }}>
            01
          </span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {workbench.map(renderNavItem)}
        </nav>
      </div>

      {/* Tools */}
      <div className="mt-5">
        <div className="px-1 mb-2 flex items-baseline justify-between">
          <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-stone-400" style={{ fontFamily: MONO }}>
            Tools
          </span>
          <span className="text-[9px] tabular-nums text-stone-300" style={{ fontFamily: MONO }}>
            02
          </span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {/* Services — disclosure-only parent (no navigation); the dropdown
              is the entry point. Three service intake pages live under
              /dashboard/services/{slug}. */}
          <div>
            <button
              type="button"
              onClick={() => setServicesOpen(!servicesExpanded)}
              aria-expanded={servicesExpanded}
              aria-controls="services-submenu"
              className={`group relative flex w-full items-center gap-2.5 rounded-sm pl-3 pr-2.5 py-2 lg:py-1.5 text-[14px] lg:text-[13px] text-left transition-colors ${
                servicesActive
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
              }`}
            >
              <NavIcon path={NAV_ICONS["/dashboard/services"]} />
              <span className="flex-1 truncate">Services</span>
              <svg
                className={`h-3 w-3 shrink-0 transition-transform ${servicesExpanded ? "rotate-90" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {servicesExpanded && (
              <div
                id="services-submenu"
                className="mt-0.5 ml-8 flex flex-col border-l border-stone-200/70 pl-2.5"
              >
                <Link
                  href="/dashboard/services/bid-no-bid"
                  className={`block rounded-sm px-2 py-2.5 lg:py-2 text-[13px] lg:text-[12.5px] transition-colors ${
                    pathname?.startsWith("/dashboard/services/bid-no-bid")
                      ? "text-stone-900 font-medium"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  Bid / No Bid
                </Link>
                <Link
                  href="/dashboard/services/proposal"
                  className={`block rounded-sm px-2 py-2.5 lg:py-2 text-[13px] lg:text-[12.5px] transition-colors ${
                    pathname?.startsWith("/dashboard/services/proposal")
                      ? "text-stone-900 font-medium"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  Proposal submission
                </Link>
                <Link
                  href="/dashboard/services/lta-roster"
                  className={`block rounded-sm px-2 py-2.5 lg:py-2 text-[13px] lg:text-[12.5px] transition-colors ${
                    pathname?.startsWith("/dashboard/services/lta-roster")
                      ? "text-stone-900 font-medium"
                      : "text-stone-500 hover:text-stone-900"
                  }`}
                >
                  Fast Track LTA Roster
                </Link>
              </div>
            )}
          </div>
          {tools.map(renderNavItem)}
        </nav>
      </div>

      <div className="flex-1" />

      {trialPill && <div className="mt-6 mb-3">{trialPill}</div>}

      <div className="border-t border-stone-200/70 pt-3 flex flex-col gap-0.5">
        {/* PR-I (2026-05-23): "Billing & orders" lived here previously but is
            now surfaced as a top-level Workbench item ("Work orders") next to
            Overview, where users actually look for paid-service status. Keep
            the support + FAQ entries here so the footer cluster stays useful. */}
        <a
          href="mailto:info@tenderpath.me?subject=Support Request"
          className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 lg:py-1.5 rounded-sm text-[13px] lg:text-[12.5px] text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors"
        >
          <NavIcon path={NAV_ICONS.help} />
          <span>Help &amp; support</span>
        </a>
        <a
          href="/faq"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 lg:py-1.5 rounded-sm text-[13px] lg:text-[12.5px] text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors"
        >
          <NavIcon path={NAV_ICONS.faq} />
          <span>FAQ</span>
        </a>
      </div>

      <div className="mt-3 pt-3 border-t border-stone-200/70">
        <div
          className="px-1 mb-1.5 truncate text-[10.5px] text-stone-400"
          style={{ fontFamily: MONO }}
          title={state.user.email}
        >
          {state.user.email}
        </div>
        <button
          onClick={() => {
            localStorage.removeItem("tp_token");
            router.push("/");
          }}
          className="flex items-center gap-2.5 pl-3 pr-2.5 py-2 lg:py-1.5 rounded-sm text-[13px] lg:text-[12.5px] text-stone-500 hover:bg-stone-100 hover:text-stone-800 transition-colors w-full text-left"
        >
          <NavIcon path={NAV_ICONS.signout} />
          <span>Sign out</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex bg-stone-50">
      {/* Mobile top bar — sticky */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-b border-stone-200/70 h-14 px-4 flex items-center justify-between gap-3">
        <Link href="/dashboard" className="flex items-baseline gap-2 min-w-0">
          <span
            className="text-[18px] leading-none font-medium text-stone-900 tracking-tight shrink-0"
            style={{ fontFamily: SERIF }}
          >
            Tender<span className="text-orange-500">·</span>Path
          </span>
          {activeItem && (
            <>
              <span className="text-stone-300 text-[13px] shrink-0" style={{ fontFamily: SERIF }}>
                /
              </span>
              <span
                className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500 truncate"
                style={{ fontFamily: MONO }}
              >
                {activeItem.label}
              </span>
            </>
          )}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          {trialBadge}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="p-2 -mr-2 text-stone-700 hover:text-stone-900"
          >
            <NavIcon path={NAV_ICONS.menu} />
          </button>
        </div>
      </header>

      {/* Mobile drawer + scrim */}
      {drawerOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside
            className="lg:hidden fixed top-0 bottom-0 right-0 z-50 w-[300px] max-w-[85vw] bg-white border-l border-stone-200/70 px-4 py-4 flex flex-col overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-stone-200/70">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-400"
                style={{ fontFamily: MONO }}
              >
                Menu
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="p-1.5 -mr-1.5 text-stone-500 hover:text-stone-900"
              >
                <NavIcon path={NAV_ICONS.close} />
              </button>
            </div>
            {sidebarBody}
          </aside>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-stone-200/70 px-4 py-5 flex-col shrink-0">
        {sidebarBody}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 pt-14 lg:pt-0 [--tabbar-sticky-top:56px] lg:[--tabbar-sticky-top:0px]">
        {children}
      </main>
    </div>
  );
}
