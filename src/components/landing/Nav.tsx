"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LC, LF, Btn } from "./kit";
import { useMedia } from "@/components/workbench/useMedia";
import type { LandingViewer } from "./types";

export default function Nav({ viewer }: { viewer: LandingViewer }) {
  const mobile = useMedia("(max-width: 767px)");
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    fn();
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const links: Array<[string, string]> = [
    ["How it works", "#how"],
    ["Features", "#features"],
  ];

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        background: scrolled ? "rgba(246,243,236,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(10px)" : "none",
        borderBottom: `1px solid ${scrolled ? LC.rule : "transparent"}`,
        transition: "all .2s",
      }}
    >
      <div
        className="lk-container"
        style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", height: 64, gap: 20 }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "baseline", gap: 5, textDecoration: "none" }}>
          <span style={{ fontFamily: LF.display, fontSize: 21, fontWeight: 500, color: LC.ink, letterSpacing: "-0.01em" }}>TenderPath</span>
          <span style={{ color: LC.accent, fontFamily: LF.display, fontSize: 21 }}>·</span>
        </Link>

        {!mobile && (
          <nav style={{ display: "flex", gap: 26, marginLeft: 18 }}>
            {links.map(([l, h]) => (
              <a key={h} href={h} className="lk-navlink" style={{ fontFamily: LF.sans, fontSize: 14, color: LC.ink2, textDecoration: "none" }}>
                {l}
              </a>
            ))}
          </nav>
        )}

        <div style={{ flex: 1 }} />

        {!mobile ? (
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {viewer ? (
              <Btn kind="gold" size="sm" href="/dashboard">
                Open dashboard
              </Btn>
            ) : (
              <>
                <Link
                  href="/login"
                  style={{ fontFamily: LF.mono, fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase", color: LC.ink, textDecoration: "none", whiteSpace: "nowrap" }}
                >
                  Sign in
                </Link>
                <Btn kind="gold" size="sm" href="#top">
                  Request invite
                </Btn>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setOpen(!open)}
            aria-label="Menu"
            style={{ background: "transparent", border: `1px solid ${LC.rule}`, padding: "8px 10px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 3.5 }}
          >
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 18, height: 1.5, background: LC.ink, display: "block" }} />
            ))}
          </button>
        )}
      </div>

      {mobile && open && (
        <div style={{ background: LC.paper, borderBottom: `1px solid ${LC.rule}`, padding: "10px 24px 18px" }}>
          {links.map(([l, h]) => (
            <a
              key={h}
              href={h}
              onClick={() => setOpen(false)}
              style={{ display: "block", fontFamily: LF.sans, fontSize: 16, color: LC.ink, textDecoration: "none", padding: "11px 0", borderBottom: `1px solid ${LC.ruleSoft}` }}
            >
              {l}
            </a>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {viewer ? (
              <Btn kind="gold" size="sm" href="/dashboard" style={{ flex: 1 }}>
                Open dashboard
              </Btn>
            ) : (
              <>
                <Btn kind="ghost" size="sm" href="/login" style={{ flex: 1 }}>
                  Sign in
                </Btn>
                <Btn kind="gold" size="sm" href="#top" onClick={() => setOpen(false)} style={{ flex: 1 }}>
                  Request invite
                </Btn>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
