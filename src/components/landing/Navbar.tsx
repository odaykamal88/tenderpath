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

  return (
    <nav className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-rule">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo — Tender·Path with mid-dot accent */}
          <a href="/" className="flex items-baseline gap-0">
            <span className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">
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
              <a
                href="/dashboard"
                className="bg-ink px-5 py-2 text-[12px] font-medium text-paper hover:bg-accent transition-colors"
              >
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
                <a
                  href="/assessment"
                  className="bg-ink px-5 py-2.5 text-[12px] font-medium text-paper hover:bg-accent transition-colors"
                >
                  Free assessment
                </a>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 text-ink"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-rule py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block font-mono text-[12px] tracking-[0.08em] uppercase text-ink-2 hover:text-ink py-1"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            {isAuthed ? (
              <a href="/dashboard" className="block bg-ink px-5 py-3 text-[13px] font-medium text-paper text-center">
                Dashboard →
              </a>
            ) : (
              <>
                <a
                  href="/login"
                  className="block border border-ink px-5 py-3 text-[13px] font-medium text-ink text-center"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign in
                </a>
                <a href="/assessment" className="block bg-ink px-5 py-3 text-[13px] font-medium text-paper text-center">
                  Free assessment →
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
