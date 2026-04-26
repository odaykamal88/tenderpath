"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

interface Me {
  id: number;
  email: string;
  name: string | null;
  is_super_admin: boolean;
}

const NAV = [
  {
    href: "/admin",
    label: "Overview",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/admin/work-orders",
    label: "Work Orders",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z" />
      </svg>
    ),
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) {
      router.replace("/login?next=/admin");
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
      const me: Me = await res.json();
      if (!me.is_super_admin) {
        router.replace("/dashboard");
        return;
      }
      setUser(me);
      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-sm text-slate-500">
        Verifying admin access…
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen flex bg-slate-950 text-slate-200">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r border-white/5 flex flex-col p-5">
        {/* Brand */}
        <div className="mb-8">
          <Link href="/" className="text-base font-semibold text-white">
            Tender<span className="text-amber-400">Path</span>
          </Link>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-500/15 border border-violet-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-400">
            Admin Console
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? "bg-violet-500/20 text-violet-300 font-medium"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Divider — user dashboard link */}
        <div className="mt-4 pt-4 border-t border-white/5">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            User Dashboard
          </Link>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-4 border-t border-white/5">
          <div className="px-3 text-xs text-slate-500 truncate mb-2">{user.email}</div>
          <button
            onClick={() => {
              localStorage.removeItem("tp_token");
              router.push("/");
            }}
            className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
