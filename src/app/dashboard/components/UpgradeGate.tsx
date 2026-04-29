"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

interface Me {
  subscription_status: string | null;
  is_super_admin: boolean;
}

interface UpgradeGateProps {
  children: ReactNode;
  title: string;
  description: string;
}

type AccessState = "loading" | "open" | "trial" | "locked";

export default function UpgradeGate({ children, title, description }: UpgradeGateProps) {
  const [access, setAccess] = useState<AccessState>("loading");

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    if (!token) { setAccess("locked"); return; }

    Promise.all([
      fetch("/api/auth/me", { headers: { authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() as Promise<Me> : null))
        .catch(() => null),
      fetch("/api/dashboard/pipeline", { headers: { authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null),
    ]).then(([user, pipelineBody]) => {
      if (!user) { setAccess("locked"); return; }
      if (user.is_super_admin || user.subscription_status === "active") {
        setAccess("open");
        return;
      }
      const isTrialing = Boolean(pipelineBody?.access?.isTrialing);
      setAccess(isTrialing ? "trial" : "locked");
    }).catch((err) => {
      console.error("[tp:upgrade_gate:access_check_failed]", err);
      setAccess("locked");
    });
  }, []);

  if (access === "loading" || access === "open" || access === "trial") {
    return (
      <>
        {access === "trial" && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm flex items-center justify-between gap-4">
            <span className="text-amber-900">
              You&apos;re on a free trial. Subscribe to keep full access after your trial ends.
            </span>
            <Link
              href="/pay?plan=grants-tenders-matching"
              className="shrink-0 text-sm font-semibold text-amber-700 underline whitespace-nowrap hover:text-amber-900"
            >
              Subscribe — $49/mo
            </Link>
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <div className="relative">
      <div className="pointer-events-none max-h-[640px] select-none overflow-hidden opacity-35 blur-[1px]">
        {children}
      </div>
      <div className="absolute inset-x-0 top-10 z-10 mx-auto max-w-xl rounded-lg border border-amber-200 bg-white/95 p-5 text-center shadow-xl shadow-gray-200/70 backdrop-blur">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
        <div className="mt-4 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link
            href="/pay?plan=grants-tenders-matching"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            Subscribe to unlock
          </Link>
          <Link
            href="/dashboard/services"
            className="rounded-md border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:border-gray-400"
          >
            View service options
          </Link>
        </div>
      </div>
    </div>
  );
}
