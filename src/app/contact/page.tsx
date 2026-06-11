import Link from "next/link";
import { C, F } from "@/components/workbench/tokens";

export const metadata = {
  title: "Contact — TenderPath",
  description: "Get in touch with the TenderPath team.",
};

export default function ContactPage() {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: F.sans }}>
      {/* Nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(246,243,236,0.9)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 6, textDecoration: "none" }}>
            <span style={{ fontFamily: F.display, fontSize: 20, fontWeight: 500, color: C.ink, letterSpacing: "-0.01em" }}>TenderPath</span>
            <span style={{ color: C.accent, fontFamily: F.display, fontSize: 20 }}>·</span>
          </Link>
          <Link href="/" style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, textDecoration: "none" }}>
            ← Back to home
          </Link>
        </div>
      </nav>

      <div className="legal-body mx-auto max-w-4xl px-6 py-16">
        <div className="mb-12" style={{ borderBottom: `1px solid ${C.ink}`, paddingBottom: 20 }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, marginBottom: 12 }}>
            TenderPath · Support
          </div>
          <h1 style={{ fontFamily: F.display, fontSize: 44, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.02, color: C.ink, margin: 0 }}>Get in touch</h1>
          <p style={{ fontFamily: F.sans, fontSize: 16, color: C.ink2, lineHeight: 1.55, margin: "14px 0 0" }}>
            We&apos;re here to help you navigate UN procurement. Reach out anytime.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact options */}
          <div className="space-y-6">
            {[
              {
                icon: (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                ),
                label: "Email",
                value: "info@tenderpath.me",
                href: "mailto:info@tenderpath.me",
                note: "We respond within 1 business day",
              },
              {
                icon: (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                ),
                label: "Book a Call",
                value: "Free 30-min founder consultation",
                href: "https://calendly.com/oday-kamal-9ya/30min",
                note: "Available Mon–Fri, 9am–5pm GMT",
              },
              {
                icon: (
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                  </svg>
                ),
                label: "Telegram",
                value: "Message us on Telegram",
                href: "https://t.me/Tenderpathbot",
                note: "For quick questions via Telegram",
              },
            ].map((contact) => (
              <a
                key={contact.label}
                href={contact.href}
                className="flex gap-4 p-5 rounded-xl border border-gray-200 hover:border-gray-400 hover:shadow-md transition-all group"
              >
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 group-hover:bg-amber-100 transition-colors">
                  {contact.icon}
                </div>
                <div>
                  <div className="text-sm font-semibold text-gray-900">{contact.label}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{contact.value}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{contact.note}</div>
                </div>
              </a>
            ))}
          </div>

          {/* FAQ shortcut */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 p-6 flex flex-col">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Looking for quick answers?</h3>
            <p className="text-sm text-gray-500 mb-6 flex-1">
              Check our FAQ for answers to the most common questions about TenderPath,
              UN procurement, and getting started.
            </p>
            <Link
              href="/faq"
              className="inline-flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-800 transition-colors"
            >
              Browse the FAQ →
            </Link>
          </div>
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${C.rule}`, padding: "32px 0", textAlign: "center" }}>
        <p style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, margin: 0 }}>
          © {new Date().getFullYear()} TenderPath. All rights reserved. ·{" "}
          <Link href="/" style={{ color: C.mute, textDecoration: "none", borderBottom: `1px solid ${C.rule}`, paddingBottom: 1 }}>Home</Link>
        </p>
      </footer>
    </div>
  );
}
