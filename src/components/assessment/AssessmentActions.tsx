"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { C, F } from "@/components/workbench/tokens";

type Status = "idle" | "sending" | "sent" | "error";

const linkStyle: CSSProperties = {
  fontFamily: F.mono,
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: C.mute,
  background: "none",
  border: 0,
  borderBottom: `1px solid ${C.rule}`,
  cursor: "pointer",
  padding: "0 0 2px",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

export function AssessmentActions({ reportId }: { reportId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function sendEmail() {
    if (status === "sending") return;
    setStatus("sending");
    setMessage(null);

    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
      const headers: HeadersInit = token ? { authorization: `Bearer ${token}` } : {};
      const res = await fetch(`/api/assessment/${reportId}/resend-email`, {
        method: "POST",
        headers,
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; email?: string; error?: string };
      if (!res.ok || !data.ok) {
        setStatus("error");
        setMessage(data.error ?? `Could not resend (${res.status})`);
        return;
      }
      setStatus("sent");
      setMessage(data.email ? `Sent to ${data.email}` : "Sent");
      setTimeout(() => {
        setStatus("idle");
        setMessage(null);
      }, 4000);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  const emailLabel =
    status === "sending" ? "Sending…"
    : status === "sent" ? "Sent ✓"
    : status === "error" ? "Retry email ↗"
    : "Email ↗";

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
      <a href={`/api/report?id=${reportId}`} target="_blank" rel="noopener" style={linkStyle}>
        PDF ↓
      </a>
      <button
        type="button"
        onClick={sendEmail}
        disabled={status === "sending"}
        aria-live="polite"
        title={message ?? "Email this report to your registered address"}
        style={{ ...linkStyle, opacity: status === "sending" ? 0.5 : 1 }}
      >
        {emailLabel}
      </button>
      <Link href="/assessment" style={linkStyle}>
        Run again →
      </Link>
      {message && status !== "idle" && (
        <span
          role="status"
          style={{
            fontFamily: F.mono,
            fontSize: 9.5,
            color: status === "error" ? C.neg : C.pos,
            letterSpacing: "0.04em",
          }}
        >
          {message}
        </span>
      )}
    </span>
  );
}
