"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "@/app/admin/admin.module.css";
import type { SalesInference, InferenceDisposition } from "@/lib/network/next-steps-llm";
import type { SalesRead } from "@/lib/network/next-steps";

/**
 * On-demand renderer for the LLM "push-to-close vs sunset" inference. Shared by
 * the /admin/crm command center (inline expand) and the per-contact detail page.
 * Fetches POST /api/admin/network-companies/[id]/next-step and shows the read.
 * Honest about provenance: an "AI" vs "heuristic" badge tells the operator
 * whether the reasoning came from the model or the deterministic fallback.
 */

function authHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("tp_token") : null;
  return token ? { authorization: `Bearer ${token}` } : {};
}

const DISPOSITION_LABEL: Record<InferenceDisposition, string> = {
  advance: "Advance",
  hold: "Hold / nurture",
  sunset: "Sunset",
};

function dispositionClass(d: InferenceDisposition): string {
  if (d === "advance") return styles.tagPos;
  if (d === "sunset") return styles.tagNeg;
  return styles.tagWarn;
}

export default function NextStepPanel({
  companyId,
  auto = false,
  onDone,
  onLogged,
}: {
  companyId: number;
  auto?: boolean;
  onDone?: (inference: SalesInference, read: SalesRead) => void;
  onLogged?: () => void;
}) {
  const [inference, setInference] = useState<SalesInference | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logState, setLogState] = useState<"idle" | "saving" | "done">("idle");
  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}/next-step`, {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      setInference(body.inference as SalesInference);
      setLogState("idle");
      onDone?.(body.inference as SalesInference, body.read as SalesRead);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to infer next step");
    } finally {
      setLoading(false);
    }
  }, [companyId, onDone]);

  // Log the recommended move to the contact's activity trail — one click turns
  // the AI read into a recorded next step (reuses the CRM activity endpoint).
  const logMove = useCallback(async () => {
    if (!inference) return;
    setLogState("saving");
    try {
      const res = await fetch(`/api/admin/network-companies/${companyId}/activity`, {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ kind: "note", body: `Next step: ${inference.nextMove}` }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setLogState("done");
      onLogged?.();
    } catch {
      setLogState("idle");
    }
  }, [companyId, inference, onLogged]);

  // Fire once on mount when auto is requested (used by the CRM expand + detail
  // page card). Guarded by a ref so it never re-fires or loops on re-render.
  useEffect(() => {
    if (auto && !startedRef.current) {
      startedRef.current = true;
      void generate();
    }
  }, [auto, generate]);

  if (!inference && !loading && !error) {
    return (
      <button type="button" className={styles.btnPrimary} onClick={generate} style={{ padding: "7px 13px", fontSize: 12 }}>
        Infer next step ↗
      </button>
    );
  }

  if (loading && !inference) {
    return (
      <div className={styles.sessionSubtle} style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <span className={styles.mono}>Reasoning over live tenders + relationship history…</span>
      </div>
    );
  }

  if (error && !inference) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`${styles.toast} ${styles.toastErr}`} style={{ margin: 0, padding: "5px 9px", fontSize: 12 }}>{error}</span>
        <button type="button" className={styles.btnGhost} onClick={generate} style={{ padding: "5px 9px", fontSize: 11 }}>Retry</button>
      </div>
    );
  }

  if (!inference) return null;

  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        padding: "12px 14px",
        border: "1px solid var(--color-rule)",
        borderRadius: 10,
        background: "var(--color-paper-2, rgba(0,0,0,0.015))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className={`${styles.tag} ${dispositionClass(inference.disposition)}`}>{DISPOSITION_LABEL[inference.disposition]}</span>
        <strong style={{ fontSize: 13.5, lineHeight: 1.35, flex: 1, minWidth: 180 }}>{inference.headline}</strong>
        <span
          className={styles.mono}
          title={inference.source === "llm" ? "Reasoned by Claude" : "Deterministic fallback (no model call)"}
          style={{ fontSize: 10, color: "var(--color-mute)", flexShrink: 0 }}
        >
          {inference.source === "llm" ? "AI read" : "heuristic"}
        </span>
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "var(--color-ink-2, inherit)" }}>{inference.reasoning}</p>

      <div style={{ display: "grid", gap: 4 }}>
        <span className={styles.sessionSubtle} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Next move</span>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.5,
            padding: "8px 10px",
            borderLeft: "3px solid var(--color-accent)",
            background: "var(--color-gold-bg, #faf3e3)",
            borderRadius: 4,
          }}
        >
          {inference.nextMove}
        </div>
      </div>

      {inference.closeLevers.length > 0 && (
        <div style={{ display: "grid", gap: 4 }}>
          <span className={styles.sessionSubtle} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            {inference.disposition === "sunset" ? "Signals" : "Levers to close"}
          </span>
          <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
            {inference.closeLevers.map((lever, i) => (
              <li key={i} style={{ fontSize: 12.5, lineHeight: 1.45 }}>{lever}</li>
            ))}
          </ul>
        </div>
      )}

      {inference.sunsetBasis && (
        <div className={styles.sessionSubtle} style={{ fontSize: 12 }}>
          <strong style={{ color: "var(--color-red)" }}>Sunset basis:</strong> {inference.sunsetBasis}
        </div>
      )}

      {inference.watchFor && (
        <div className={styles.sessionSubtle} style={{ fontSize: 12 }}>
          <strong>Watch for:</strong> {inference.watchFor}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={logMove}
          disabled={logState !== "idle"}
          title="Record this next step on the contact's timeline"
          style={{ padding: "5px 11px", fontSize: 11 }}
        >
          {logState === "saving" ? "Logging…" : logState === "done" ? "Logged ✓" : "Log this move"}
        </button>
        <button type="button" className={styles.btnGhost} onClick={generate} disabled={loading} style={{ padding: "5px 9px", fontSize: 11 }}>
          {loading ? "Re-reading…" : "Re-infer ↻"}
        </button>
      </div>
    </div>
  );
}
