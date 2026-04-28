import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  lastUpdated?: string;
  children: ReactNode;
}

export default function LegalShell({ title, subtitle, lastUpdated, children }: Props) {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-6 flex h-14 items-center justify-between">
          <a href="/" className="text-lg font-semibold text-gray-900">
            Tender<span className="text-amber-500">Path</span>
          </a>
          <a href="/" className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            ← Back to home
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="mb-10">
          <h1 className="font-serif text-4xl font-bold text-gray-900 mb-3">{title}</h1>
          {subtitle && <p className="text-gray-500 text-lg">{subtitle}</p>}
          {lastUpdated && (
            <p className="text-sm text-gray-400 mt-3">Last updated: {lastUpdated}</p>
          )}
        </div>

        <div className="space-y-10 text-gray-700 leading-relaxed">
          {children}
        </div>
      </div>

      <footer className="border-t border-gray-100 py-8 text-center">
        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} TenderPath. All rights reserved.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-400">
          {[
            { label: "Privacy Policy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
            { label: "Cookie Policy", href: "/cookie-policy" },
            { label: "Disclaimer", href: "/disclaimer" },
            { label: "Security", href: "/security" },
            { label: "Contact", href: "/contact" },
          ].map((l) => (
            <a key={l.href} href={l.href} className="underline hover:text-gray-600 transition-colors">
              {l.label}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
