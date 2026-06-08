"use client";

/* Shared Account atoms: titled Block with edit/save actions, labelled Field
 * (read or inline-edit), and a ChipEditor with type-ahead suggestions. */

import { useState, type ReactNode } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";

export function Block({
  title,
  editing,
  onEdit,
  onCancel,
  onSave,
  saving,
  note,
  children,
}: {
  title: string;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}`, padding: "20px 22px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: note ? 8 : 16 }}>
        <h3 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 400, color: C.ink, margin: 0 }}>{title}</h3>
        {onEdit && (
          <div style={{ display: "flex", gap: 8 }}>
            {editing ? (
              <>
                <Btn kind="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
                <Btn kind="primary" size="sm" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
              </>
            ) : (
              <Btn kind="ghost" size="sm" onClick={onEdit}>Edit</Btn>
            )}
          </div>
        )}
      </div>
      {note && <div style={{ fontFamily: F.sans, fontSize: 12, color: C.mute, marginBottom: 16, display: "flex", gap: 7, alignItems: "baseline" }}>{note}</div>}
      {children}
    </div>
  );
}

export function Field({
  label,
  value,
  editing,
  onChange,
  placeholder,
  textarea,
  badge,
  readOnly,
}: {
  label: string;
  value: string;
  editing?: boolean;
  onChange?: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  badge?: string;
  readOnly?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.faint }}>{label}</span>
        {badge && <span style={{ fontFamily: F.mono, fontSize: 8, color: C.accent }}>● {badge}</span>}
      </div>
      {editing && !readOnly ? (
        textarea ? (
          <textarea value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} style={{ width: "100%", minHeight: 70, marginTop: 5, border: `1px solid ${C.rule}`, background: C.white, padding: "8px 10px", fontFamily: F.sans, fontSize: 13.5, color: C.ink, resize: "vertical", outline: "none" }} />
        ) : (
          <input value={value} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder} style={{ width: "100%", marginTop: 5, border: `1px solid ${C.rule}`, background: C.white, padding: "8px 10px", fontFamily: F.sans, fontSize: 13.5, color: C.ink, outline: "none" }} />
        )
      ) : (
        <div style={{ fontFamily: F.sans, fontSize: 13.5, color: value ? C.ink : C.faint, marginTop: 5, lineHeight: 1.5 }}>{value || "—"}</div>
      )}
    </div>
  );
}

export function ChipEditor({
  chips,
  editing,
  onChange,
  suggestions = [],
  placeholder = "Add…",
}: {
  chips: string[];
  editing?: boolean;
  onChange: (chips: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const add = (v: string) => {
    const val = v.trim();
    if (val && !chips.some((c) => c.toLowerCase() === val.toLowerCase())) onChange([...chips, val]);
    setInput("");
  };
  const matches =
    input.trim().length > 0
      ? suggestions.filter((s) => s.toLowerCase().includes(input.toLowerCase()) && !chips.includes(s)).slice(0, 6)
      : [];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {chips.map((c) => (
          <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: F.mono, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: C.ink2, border: `1px solid ${C.rule}`, padding: "3px 7px" }}>
            {c}
            {editing && (
              <button onClick={() => onChange(chips.filter((x) => x !== c))} aria-label={`Remove ${c}`} style={{ background: "none", border: 0, color: C.faint, cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}>×</button>
            )}
          </span>
        ))}
        {chips.length === 0 && !editing && <span style={{ fontFamily: F.sans, fontSize: 13, color: C.faint }}>—</span>}
      </div>
      {editing && (
        <div style={{ position: "relative", marginTop: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(input); } }}
            placeholder={placeholder}
            style={{ width: "100%", border: `1px solid ${C.rule}`, background: C.white, padding: "7px 10px", fontFamily: F.sans, fontSize: 13, color: C.ink, outline: "none" }}
          />
          {matches.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.white, border: `1px solid ${C.rule}`, zIndex: 5, maxHeight: 180, overflowY: "auto" }}>
              {matches.map((m) => (
                <button key={m} onClick={() => add(m)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: 0, borderBottom: `1px solid ${C.ruleSoft}`, cursor: "pointer", fontFamily: F.sans, fontSize: 13, color: C.ink }}>{m}</button>
              ))}
              {input.trim() && !suggestions.some((s) => s.toLowerCase() === input.trim().toLowerCase()) && (
                <button onClick={() => add(input)} style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", background: C.paper, border: 0, cursor: "pointer", fontFamily: F.mono, fontSize: 11, color: C.accent }}>+ Add &ldquo;{input.trim()}&rdquo;</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
