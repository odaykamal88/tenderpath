"use client";

import { useState, type ReactNode } from "react";
import { C, F } from "@/components/workbench/tokens";

/* Floating support launcher. Restyled into the D2 dossier system (sharp panel,
 * ink header, mono captions) so it's consistent with the redesigned landing +
 * Workbench. Global — mounted in app/layout.tsx on every page. */

interface Channel {
  icon: ReactNode;
  label: string;
  sub: string;
  href: string;
}

const CHANNELS: Channel[] = [
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    label: "Email support",
    sub: "info@tenderpath.me",
    href: "mailto:info@tenderpath.me",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    label: "Book a free call",
    sub: "30-min founder consultation",
    href: "https://calendly.com/oday-kamal-9ya/30min",
  },
  {
    icon: (
      <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    label: "Browse FAQ",
    sub: "Quick answers",
    href: "/faq",
  },
  {
    icon: (
      <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
    label: "Telegram",
    sub: "Message us on Telegram",
    href: "https://t.me/Tenderpathbot",
  },
];

export default function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [btnHover, setBtnHover] = useState(false);

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
      {open && (
        <div style={{ width: 300, background: C.paper, border: `1px solid ${C.rule}`, boxShadow: "0 24px 60px rgba(15,22,32,0.22)", overflow: "hidden", animation: "tpPop .16s ease-out" }}>
          <div style={{ background: C.ink, padding: "14px 16px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ fontFamily: F.display, fontSize: 16, color: C.white }}>TenderPath support</div>
              <div style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.04em", color: C.spineDim, marginTop: 2 }}>We typically reply within 1 business day</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close support"
              style={{ background: "transparent", border: 0, color: C.spineDim, cursor: "pointer", padding: 2, display: "flex", lineHeight: 0 }}
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div style={{ padding: 10 }}>
            {CHANNELS.map((item, i) => (
              <a
                key={item.label}
                href={item.href}
                target={item.href.startsWith("http") ? "_blank" : undefined}
                rel={item.href.startsWith("http") ? "noreferrer" : undefined}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 10px", textDecoration: "none", background: hovered === i ? C.paper2 : "transparent", transition: "background .14s" }}
              >
                <div style={{ width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f4ecdb", color: C.accent, border: `1px solid ${C.ruleSoft}` }}>
                  {item.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: C.ink }}>{item.label}</div>
                  <div style={{ fontFamily: F.mono, fontSize: 10, color: C.mute, marginTop: 1 }}>{item.sub}</div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setBtnHover(true)}
        onMouseLeave={() => setBtnHover(false)}
        aria-label={open ? "Close support" : "Open support"}
        style={{ width: 54, height: 54, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: btnHover || open ? C.accent : C.ink, color: C.paper, border: 0, cursor: "pointer", boxShadow: "0 12px 30px rgba(15,22,32,0.28)", transition: "background .16s" }}
      >
        {open ? (
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
      </button>
    </div>
  );
}
