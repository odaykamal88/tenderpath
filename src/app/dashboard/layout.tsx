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

      // Probe access via pipeline endpoint (returns 402 when trial expired)
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
      <div className="min-h-screen grid place-items-center text-sm text-gray-500">
        Loading dashboard…
      </div>
    );
  }

  if (!state) return null;

  const navItems = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/pipeline", label: "Pipeline" },
    { href: "/dashboard/vault", label: "Document Vault" },
  ];

  return (
    <div className="min-h-screen flex bg-gray-50">
      <aside className="w-64 bg-white border-r border-gray-200 p-6 flex flex-col">
        <Link href="/" className="text-lg font-semibold text-gray-900 mb-8">
          Tender<span className="text-amber-500">Path</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-md text-sm ${
                  active
                    ? "bg-gray-900 text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 pt-4 border-t border-gray-100">
          <a
            href="mailto:hello@tenderpath.co?subject=Support Request"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Help &amp; Support
          </a>
          <a
            href="/faq"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            FAQ
          </a>
        </div>
        <div className="mt-auto pt-6 border-t border-gray-200 text-xs text-gray-500">
          <div className="mb-2 truncate">{state.user.email}</div>
          <button
            onClick={() => {
              localStorage.removeItem("tp_token");
              router.push("/");
            }}
            className="text-gray-700 hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8">
        {(state.isTrialing || state.locked) && (
          <div className={`mb-6 rounded-md px-4 py-3 text-sm flex items-center justify-between gap-4 ${
            state.locked
              ? "bg-red-50 border border-red-200 text-red-900"
              : state.trialDaysLeft <= 3
              ? "bg-orange-50 border border-orange-200 text-orange-900"
              : "bg-amber-50 border border-amber-200 text-amber-900"
          }`}>
            <span>
              {state.locked ? (
                "Your trial has ended. Upgrade to continue accessing your pipeline and vault."
              ) : (
                <>
                  Free trial: <strong>{state.trialDaysLeft}</strong> day{state.trialDaysLeft === 1 ? "" : "s"} remaining.
                  {state.trialDaysLeft <= 3 && " Upgrade now to keep your data."}
                </>
              )}
            </span>
            <Link
              href="/pricing"
              className="flex-shrink-0 font-semibold underline whitespace-nowrap"
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
