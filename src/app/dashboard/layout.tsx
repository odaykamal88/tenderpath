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
          TenderPath
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
        {state.isTrialing && state.trialDaysLeft > 0 && (
          <div className="mb-6 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900 flex items-center justify-between">
            <span>
              Free trial: <strong>{state.trialDaysLeft}</strong> day
              {state.trialDaysLeft === 1 ? "" : "s"} remaining.
            </span>
            <Link href="/pricing" className="font-medium underline">
              Subscribe — $49/mo
            </Link>
          </div>
        )}
        {state.locked && (
          <div className="mb-6 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-900">
            Your trial has ended.{" "}
            <Link href="/pricing" className="font-medium underline">
              Subscribe to continue
            </Link>
            .
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
