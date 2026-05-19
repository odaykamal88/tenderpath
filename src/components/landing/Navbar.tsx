"use client";

import { useState, useEffect } from "react";

const navLinks = [
  { label: "Challenge", href: "#challenge" },
  { label: "Process", href: "#how-it-works" },
  { label: "Services", href: "#services" },
  { label: "Why us", href: "#why-us" },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    setIsAuthed(Boolean(token));
  }, []);

  // Lock body scroll when sheet is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
    <nav className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-rule">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
        <div className="flex h-14 sm:h-16 items-center justify-between">
          {/* Logo */}
          <a href="/" className="flex items-baseline gap-0">
            <span className="font-serif text-[19px] sm:text-[22px] font-medium tracking-[-0.01em] text-ink">
              Tender<span className="text-accent">·</span>Path
            </span>
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-9">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink transition-colors"
              >
                {link.label}
              </a>
            ))}
            {isAuthed ? (
              <a href="/dashboard" className="bg-ink px-5 py-2 text-[12px] font-medium text-paper hover:bg-accent transition-colors">
                Dashboard →
              </a>
            ) : (
              <>
                <a
                  href="/login"
                  className="font-mono text-[11px] tracking-[0.12em] uppercase text-ink-3 hover:text-ink transition-colors border-b border-rule hover:border-ink pb-0.5"
                >
                  Sign in
                </a>
                <a href="/assessment" className="bg-ink px-5 py-2.5 text-[12px] font-medium text-paper hover:bg-accent transition-colors">
                  Free assessment
                </a>
              </>
            )}
          </div>

          {/* Mobile actions: persistent CTA + hamburger */}
          <div className="md:hidden flex items-center gap-2">
            {!isAuthed && (
              <a
                href="/assessment"
                className="bg-ink px-3.5 py-2 text-[11.5px] font-medium text-paper"
              >
                Assess →
              </a>
            )}
            <button
              className="p-2 -mr-2 text-ink"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

    </nav>

    {/*
      Mobile full-screen sheet — MUST live OUTSIDE the <nav> above.
      The nav has backdrop-blur-sm, and per CSS spec an ancestor with
      backdrop-filter !== none creates a containing block for fixed-positioned
      descendants. If the sheet were inside the nav, its `top-14 bottom-0`
      would resolve against the 56px nav box (height = 0, invisible).
      Hoisting it to a sibling makes it position against the viewport.
    */}
    {mobileOpen && (
      <div className="md:hidden fixed inset-x-0 top-14 bottom-0 bg-paper z-40 flex flex-col overflow-y-auto">
        <div className="px-5 pt-5 pb-7 flex flex-col gap-px">
          {navLinks.map((link, i) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="grid grid-cols-[36px_1fr_auto] items-baseline gap-3 py-4 border-b border-rule"
            >
              <span className="font-mono text-[10px] tracking-[0.16em] text-mute tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-serif text-[24px] leading-none tracking-[-0.01em] text-ink">
                {link.label}
              </span>
              <span className="font-mono text-[14px] text-mute">→</span>
            </a>
          ))}
        </div>

        <div className="mt-auto px-5 pb-8 pt-6 border-t border-rule bg-paper-2/40">
          {isAuthed ? (
            <a
              href="/dashboard"
              className="block bg-ink px-5 py-4 text-[14px] font-medium text-paper text-center"
            >
              Open dashboard →
            </a>
          ) : (
            <div className="flex flex-col gap-3">
              <a
                href="/assessment"
                className="block bg-ink px-5 py-4 text-[14px] font-medium text-paper text-center"
              >
                Get my readiness score →
              </a>
              <a
                href="/login"
                className="block border border-ink px-5 py-3.5 text-[13px] font-medium text-ink text-center"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </a>
            </div>
          )}
          <p className="mt-5 font-mono text-[10px] tracking-[0.1em] uppercase text-mute text-center">
            No card · No login · 5 min
          </p>
        </div>
      </div>
    )}
    </>
  );
}
