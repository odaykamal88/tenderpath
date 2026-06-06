"use client";

import { useState } from "react";

const MONO = "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace";

type Channel = "telegram" | "whatsapp";

interface ConnectResponse {
  telegramUrl?: string;
  whatsappUrl?: string | null;
}

/**
 * "Connect your assistant" card. Mints a one-time link token via
 * /api/dashboard/connect-bot and opens the Telegram/WhatsApp deep link so the
 * bot can bind this chat to the account — after which it greets by name, stops
 * asking for an email, and can push proactive match/deadline alerts.
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
        setError(
          channel === "whatsapp"
            ? "WhatsApp isn't live yet — use Telegram for now."
            : "Couldn't open the link. Please try again."
        );
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Couldn't create a connection link. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  const btnBase =
    "inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-[12.5px] font-medium transition-colors disabled:opacity-50";

  return (
    <section className="mt-8 rounded-md border border-stone-200/70 bg-white">
      <div className="px-6 py-5">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400"
          style={{ fontFamily: MONO }}
        >
          Connect assistant
        </div>
        <h2 className="mt-1 text-[18px] font-medium text-stone-900">Get matches & deadlines on chat</h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-stone-600">
          Link your account to the TenderPath assistant. Once connected it knows it&apos;s you — no email needed —
          pushes new matches and approaching deadlines, and can answer questions about your tenders.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => connect("telegram")}
            disabled={loading !== null}
            className={`${btnBase} bg-[#229ED9] text-white hover:bg-[#1c8cc2]`}
          >
            {loading === "telegram" ? "Opening…" : "Connect Telegram"}
          </button>
          <button
            type="button"
            onClick={() => connect("whatsapp")}
            disabled={loading !== null}
            className={`${btnBase} bg-[#25D366] text-white hover:bg-[#20bd5a]`}
          >
            {loading === "whatsapp" ? "Opening…" : "Connect WhatsApp"}
          </button>
          {error && <span className="text-[12px] text-amber-700">{error}</span>}
        </div>

        <p className="mt-3 text-[11px] text-stone-500" style={{ fontFamily: MONO }}>
          Opens the chat with a one-time link · expires in 30 min
        </p>
      </div>
    </section>
  );
}
