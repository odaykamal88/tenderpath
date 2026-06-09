"use client";

import { useState } from "react";
import { C, F } from "@/components/workbench/tokens";

type Channel = "telegram" | "whatsapp";

interface ConnectResponse {
  telegramUrl?: string;
  whatsappUrl?: string | null;
}

/**
 * "Connect your assistant" card (dossier-styled). Mints a one-time link token
 * via /api/dashboard/connect-bot and opens the Telegram/WhatsApp deep link so
 * the bot can bind this chat to the account — after which it greets by name,
 * stops asking for an email, and can push proactive match/deadline alerts.
 */
export default function ConnectBot() {
  const [loading, setLoading] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect(channel: Channel) {
    setLoading(channel);
    setError(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const res = await fetch("/api/dashboard/connect-bot", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("link failed");
      const data = (await res.json()) as ConnectResponse;
      const url = channel === "telegram" ? data.telegramUrl : data.whatsappUrl;
      if (!url) {
        setError(channel === "whatsapp" ? "WhatsApp isn't live yet — use Telegram for now." : "Couldn't open the link. Please try again.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Couldn't create a connection link. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  const btn = (bg: string): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 16px",
    background: bg,
    color: C.white,
    border: 0,
    cursor: loading ? "default" : "pointer",
    fontFamily: F.mono,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: loading ? 0.6 : 1,
  });

  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent }}>Connect assistant</div>
      <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: "6px 0 0" }}>Get matches &amp; deadlines on chat</h3>
      <p style={{ fontFamily: F.sans, fontSize: 13, lineHeight: 1.55, color: C.ink2, margin: "8px 0 0", maxWidth: 520 }}>
        Link your account to the TenderPath assistant. Once connected it knows it&apos;s you — no email needed — pushes new matches and approaching deadlines, and answers questions about your tenders.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginTop: 16 }}>
        <button type="button" onClick={() => connect("telegram")} disabled={loading !== null} style={btn("#229ED9")}>
          {loading === "telegram" ? "Opening…" : "Connect Telegram"}
        </button>
        <button type="button" onClick={() => connect("whatsapp")} disabled={loading !== null} style={btn("#25D366")}>
          {loading === "whatsapp" ? "Opening…" : "Connect WhatsApp"}
        </button>
        {error && <span style={{ fontFamily: F.sans, fontSize: 12, color: C.warn }}>{error}</span>}
      </div>
      <p style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 12 }}>Opens the chat with a one-time link · expires in 30 min</p>
    </div>
  );
}
