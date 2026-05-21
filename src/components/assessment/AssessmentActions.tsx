"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./AssessmentChrome.module.css";

type Status = "idle" | "sending" | "sent" | "error";

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
    <>
      <span className={styles.actionButtons}>
        <a
          href={`/api/report?id=${reportId}`}
          target="_blank"
          rel="noopener"
        >
          PDF ↓
        </a>
        <button
          type="button"
          onClick={sendEmail}
          disabled={status === "sending"}
          aria-live="polite"
          title={message ?? "Email this report to your registered address"}
        >
          {emailLabel}
        </button>
        <Link href="/assessment">Run again →</Link>
      </span>
      {message && status !== "idle" && (
        <span
          className={styles.actionToast}
          role="status"
          data-state={status}
        >
          {message}
        </span>
      )}
    </>
  );
}
