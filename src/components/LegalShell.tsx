import type { ReactNode } from "react";
import Link from "next/link";
import { C, F } from "@/components/workbench/tokens";

interface Props {
  title: string;
  subtitle?: string;
  lastUpdated?: string;
  children: ReactNode;
}

const FOOTER_LINKS = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Cookie Policy", href: "/cookie-policy" },
  { label: "Disclaimer", href: "/disclaimer" },
  { label: "Security", href: "/security" },
  { label: "Contact", href: "/contact" },
];

export default function LegalShell({ title, subtitle, lastUpdated, children }: Props) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: F.sans }}>
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
          <Link
            href="/"
            style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.mute, textDecoration: "none" }}
          >
            ← Back to home
          </Link>
        </div>
      </nav>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px 72px" }}>
        <header style={{ marginBottom: 36, paddingBottom: 20, borderBottom: `1px solid ${C.ink}` }}>
          <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: C.accent, marginBottom: 12 }}>
            TenderPath · Legal
          </div>
          <h1 style={{ fontFamily: F.display, fontSize: 44, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.02, color: C.ink, margin: 0 }}>
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontFamily: F.sans, fontSize: 16, color: C.ink2, lineHeight: 1.55, margin: "14px 0 0", maxWidth: 620 }}>{subtitle}</p>
          )}
          {lastUpdated && (
            <p style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, margin: "14px 0 0" }}>
              Last updated: {lastUpdated}
            </p>
          )}
        </header>

        <div className="legal-body" style={{ display: "flex", flexDirection: "column", gap: 36, fontSize: 15, lineHeight: 1.7 }}>
          {children}
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${C.rule}`, padding: "32px 0", textAlign: "center" }}>
        <p style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, margin: 0 }}>
          © {new Date().getFullYear()} TenderPath. All rights reserved.
        </p>
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "6px 16px" }}>
          {FOOTER_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: C.mute, textDecoration: "none", borderBottom: `1px solid ${C.rule}`, paddingBottom: 1 }}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
