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

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const NAV_ICONS: Record<string, string> = {
  "/dashboard":
    "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25",
  "/dashboard/pipeline":
    "M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z",
  "/dashboard/bid-analysis":
    "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  "/dashboard/applications":
    "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
  "/dashboard/services":
    "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z",
  "/dashboard/work-orders":
    "M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z",
  "/dashboard/vault":
    "M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<AccessState | null>(null);
  const [loading, setLoading] = useState(true);

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
      <div className="min-h-screen grid place-items-center text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (!state) return null;

  const navItems = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/pipeline", label: "Pipeline" },
    { href: "/dashboard/bid-analysis", label: "Bid Analysis", requiresPaid: true },
    { href: "/dashboard/applications", label: "Applications", requiresPaid: true },
    { href: "/dashboard/services", label: "Services" },
    { href: "/dashboard/work-orders", label: "Work Orders" },
    { href: "/dashboard/vault", label: "Document Vault", requiresPaid: true },
  ];
  const isPaid = state.user.is_super_admin || state.user.subscription_status === "active";

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-100 p-5 flex flex-col shrink-0">
        <Link href="/" className="flex items-center gap-2 mb-8 group">
          <span className="text-base font-bold text-gray-900 group-hover:text-gray-700 transition-colors">
            Tender<span className="text-amber-500">Path</span>
          </span>
        </Link>

        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname?.startsWith(item.href);
            const previewLocked = item.requiresPaid && !isPaid;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center justify-between gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? "bg-gray-900 text-white"
                    : previewLocked
                    ? "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <NavIcon path={NAV_ICONS[item.href] ?? NAV_ICONS["/dashboard/services"]} />
                  <span className="truncate">{item.label}</span>
                </span>
                {previewLocked && (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-amber-100 text-amber-600 group-hover:bg-amber-200"
                  }`}>
                    Pro
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom utility links */}
        <div className="mt-6 pt-4 border-t border-gray-100 flex flex-col gap-0.5">
          <a
            href="mailto:hello@tenderpath.co?subject=Support Request"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
            </svg>
            <span>Help &amp; Support</span>
          </a>
          <a
            href="/faq"
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            </svg>
            <span>FAQ</span>
          </a>
        </div>

        {/* User footer */}
        <div className="mt-auto pt-4 border-t border-gray-100">
          <div className="px-2.5 mb-1 truncate text-xs text-gray-400">{state.user.email}</div>
          <button
            onClick={() => {
              localStorage.removeItem("tp_token");
              router.push("/");
            }}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors w-full text-left"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 p-7">
        {/* Trial / locked banner */}
        {(state.isTrialing || state.locked) && (
          <div className={`mb-6 rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-4 ${
            state.locked
              ? "bg-red-50 border border-red-200 text-red-900"
              : state.trialDaysLeft <= 3
              ? "bg-orange-50 border border-orange-200 text-orange-900"
              : "bg-amber-50 border border-amber-200 text-amber-900"
          }`}>
            <span>
              {state.locked ? (
                "Your trial has ended. Subscribe to continue accessing your pipeline and vault."
              ) : (
                <>
                  Free trial: <strong>{state.trialDaysLeft}</strong> day{state.trialDaysLeft === 1 ? "" : "s"} remaining.
                  {state.trialDaysLeft <= 3 && " Subscribe now to keep your data."}
                </>
              )}
            </span>
            <Link
              href="/pay?plan=grants-tenders-matching"
              className="shrink-0 font-semibold underline whitespace-nowrap"
            >
              {state.locked ? "Subscribe to unlock" : "Subscribe — $49/mo"}
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
