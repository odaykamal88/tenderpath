"use client";

import { useState, useEffect } from "react";

const navLinks = [
  { label: "The Challenge", href: "#challenge" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Services", href: "#services" },
  { label: "Why Us", href: "#why-us" },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
    setIsAuthed(Boolean(token));
  }, []);

  return (
    <nav className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <a href="#" className="flex items-center gap-1">
            <span className="text-xl font-semibold text-navy">
              Tender<span className="text-gold">Path</span>
            </span>
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-gray-600 hover:text-navy transition-colors"
              >
                {link.label}
              </a>
            ))}
            {isAuthed ? (
              <a
                href="/dashboard"
                className="rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
              >
                Dashboard →
              </a>
            ) : (
              <>
                <a
                  href="/login"
                  className="text-sm text-gray-600 hover:text-navy transition-colors"
                >
                  Log in
                </a>
                <a
                  href="/assessment"
                  className="rounded-md bg-gold px-5 py-2 text-sm font-medium text-white hover:bg-gold-dark transition-colors"
                >
                  Free Assessment
                </a>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden p-2 text-navy"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {mobileOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 py-4 space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block text-sm text-gray-600 hover:text-navy"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            {isAuthed ? (
              <a
                href="/dashboard"
                className="block rounded-md bg-gray-900 px-5 py-2 text-sm font-medium text-white text-center hover:bg-gray-700"
              >
                Dashboard →
              </a>
            ) : (
              <>
                <a
                  href="/login"
                  className="block text-sm text-gray-600 hover:text-navy"
                  onClick={() => setMobileOpen(false)}
                >
                  Log in
                </a>
                <a
                  href="/assessment"
                  className="block rounded-md bg-gold px-5 py-2 text-sm font-medium text-white text-center hover:bg-gold-dark"
                >
                  Free Assessment
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
