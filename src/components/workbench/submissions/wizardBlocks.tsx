"use client";

/* Block renderers for the intake wizard (prototype: sub-fields.jsx). Each
 * FlowBlock kind gets one renderer; the wizard stays schema-driven — adding a
 * fifth format touches flows.ts, not this file.
 *
 * Honesty rules carried from the handoff:
 *   · pre-filled values wear a tag until edited, and degrade to plain inputs
 *     when the profile/vault is empty (empty-vault first-run);
 *   · the benchmark bar renders ONLY when a real band exists;
 *   · doc rows never fabricate third-party paper — draft / request / guided /
 *     upload / acknowledge are the only paths. */

import { useState } from "react";
import { C, F } from "../tokens";
import type {
  ConformityRow,
  DocResolution,
  PricedLine,
  ReferenceEntry,
  WizardDraftState,
} from "@/lib/submissions/types";
import type { FlowBlock, FlowDeclaration, FlowField } from "@/lib/submissions/flows";
import { docSpec, type DocSpec } from "@/lib/submissions/docs-catalog";
import type { VaultDocRow } from "./api";

export type Patch = (p: Partial<WizardDraftState>) => void;

/* ── shared input styling ──────────────────────────────────────────────── */

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: F.sans,
  fontSize: 13.5,
  color: C.ink,
  background: C.white,
  border: `1px solid ${C.rule}`,
  padding: "10px 12px",
  outline: "none",
  borderRadius: 0,
};

function FieldLabel({ field, edited }: { field: FlowField; edited: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
        {field.label}
        {field.required && <span style={{ color: C.neg, marginLeft: 3 }}>•</span>}
      </span>
      {!edited && (field.pre || field.preFrom) && (
        <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent, border: `1px solid ${C.accent2}`, padding: "1px 6px" }}>
          Pre-filled
        </span>
      )}
    </div>
  );
}

export function FieldsBlock({
  fields,
  draft,
  patch,
  prefills,
}: {
  fields: FlowField[];
  draft: WizardDraftState;
  patch: Patch;
  prefills: Record<string, string>;
}) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {fields.map((f) => {
        const stored = draft.fields[f.k];
        const prefill = f.pre ?? prefills[f.k] ?? "";
        const value = stored ?? prefill;
        const edited = stored !== undefined && stored !== prefill;
        const set = (v: string) => patch({ fields: { ...draft.fields, [f.k]: v } });
        return (
          <div key={f.k}>
            <FieldLabel field={f} edited={edited} />
            {f.type === "textarea" ? (
              <textarea
                value={value}
                placeholder={f.placeholder}
                onChange={(e) => set(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.55 }}
              />
            ) : f.type === "select" ? (
              <select value={value} onChange={(e) => set(e.target.value)} style={{ ...inputStyle, appearance: "auto" }}>
                {!value && <option value="">Choose…</option>}
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "date" ? "date" : "text"}
                value={value}
                placeholder={f.placeholder}
                onChange={(e) => set(e.target.value)}
                style={inputStyle}
              />
            )}
            {f.help && (
              <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>
                {f.help}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── priced lines + benchmark ──────────────────────────────────────────── */

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function linesSum(lines: PricedLine[]): number {
  return lines.reduce((s, l) => s + (l.unitPrice ?? 0) * (l.qty || 0), 0);
}

function BenchmarkBar({
  bench,
  total,
  lowestPrice,
}: {
  bench: { low: number; high: number; note: string };
  total: number;
  lowestPrice: boolean;
}) {
  if (total <= 0) return null;
  const span = Math.max(bench.high * 1.35, total * 1.05);
  const pct = (v: number) => `${Math.min(99, (v / span) * 100)}%`;
  const status = total < bench.low ? "UNDERSHOOTING" : total > bench.high ? "OVERSHOOTING" : "COMPETITIVE";
  const copy =
    status === "UNDERSHOOTING"
      ? lowestPrice
        ? "Below the typical winning range — risks rejection as “abnormally low” and margin pain. Make sure every cost is in."
        : "Below the typical winning range — evaluators may read it as under-resourced. Make sure every cost is in."
      : status === "OVERSHOOTING"
        ? lowestPrice
          ? "Above the typical winning range — in lowest-price evaluation this likely loses. Trim, or check whether you're over-delivering the spec."
          : "Above the typical winning range — justify the premium against the scoring matrix, or trim."
        : "Inside the typical winning band for this scope.";
  const color = status === "COMPETITIVE" ? C.pos : status === "OVERSHOOTING" ? C.neg : C.warn;
  return (
    <div style={{ borderTop: `1px solid ${C.ruleSoft}`, paddingTop: 12, marginTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>
          Price benchmark
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.1em", color }}>{status}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: C.paper2, margin: "10px 0 4px" }}>
        <div style={{ position: "absolute", left: pct(bench.low), width: `calc(${pct(bench.high)} - ${pct(bench.low)})`, top: 0, bottom: 0, background: "#d8e4d6" }} />
        <div style={{ position: "absolute", left: pct(total), top: -3, width: 3, height: 12, background: color }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.mono, fontSize: 9.5, color: C.faint }}>
        <span>{money(bench.low)}</span>
        <span>{money(bench.high)}</span>
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55, margin: "8px 0 0" }}>
        {copy} {bench.note ? <span style={{ color: C.mute }}>({bench.note})</span> : null}
      </p>
    </div>
  );
}

let lineSeq = 0;
function newLine(): PricedLine {
  lineSeq += 1;
  return { id: `l${Date.now().toString(36)}${lineSeq}`, desc: "", specRef: null, qty: 1, unit: "ea", unitPrice: null };
}

export function LinesBlock({
  block,
  draft,
  patch,
  lowestPrice,
}: {
  block: Extract<FlowBlock, { kind: "lines" }>;
  draft: WizardDraftState;
  patch: Patch;
  lowestPrice: boolean;
}) {
  const lines = draft.lines;
  const total = linesSum(lines);
  const setLine = (id: string, p: Partial<PricedLine>) =>
    patch({ lines: lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });

  const cell: React.CSSProperties = { ...inputStyle, padding: "7px 8px", fontSize: 12.5 };
  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, lineHeight: 1.6, margin: "0 0 14px" }}>{block.intro}</p>
      <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px 110px 100px 28px", gap: 8, padding: "8px 12px", background: C.paper2, borderBottom: `1px solid ${C.rule}` }}>
          {["Line item", "Qty", "Unit", `Unit price (${draft.currency})`, "Line total", ""].map((h, i) => (
            <span key={i} style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, textAlign: i >= 3 && i <= 4 ? "right" : "left" }}>{h}</span>
          ))}
        </div>
        {lines.length === 0 && (
          <div style={{ padding: "18px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>
            Add the line items from the schedule — copy them straight from the notice.
          </div>
        )}
        {lines.map((l) => (
          <div key={l.id} style={{ display: "grid", gridTemplateColumns: "1fr 64px 64px 110px 100px 28px", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.ruleSoft}`, alignItems: "center" }}>
            <div>
              <input value={l.desc} placeholder="Item description" onChange={(e) => setLine(l.id, { desc: e.target.value })} style={cell} />
              <input
                value={l.specRef ?? ""}
                placeholder="Spec ref (optional, e.g. §2.1)"
                onChange={(e) => setLine(l.id, { specRef: e.target.value || null })}
                style={{ ...cell, border: "none", padding: "4px 8px 0", fontFamily: F.mono, fontSize: 10, color: C.faint, background: "transparent" }}
              />
            </div>
            <input value={String(l.qty)} inputMode="numeric" onChange={(e) => setLine(l.id, { qty: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) })} style={{ ...cell, textAlign: "right" }} />
            <input value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} style={cell} />
            <input
              value={l.unitPrice == null ? "" : String(l.unitPrice)}
              placeholder="—"
              inputMode="decimal"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d.]/g, "");
                setLine(l.id, { unitPrice: raw === "" ? null : Number(raw) });
              }}
              style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
            />
            <span style={{ fontFamily: F.mono, fontSize: 12.5, color: C.ink, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {l.unitPrice != null ? money(l.unitPrice * (l.qty || 0)) : "—"}
            </span>
            <button
              onClick={() => patch({ lines: lines.filter((x) => x.id !== l.id) })}
              title="Remove line"
              style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0 }}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
          <button
            onClick={() => patch({ lines: [...lines, newLine()] })}
            style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px" }}
          >
            + Add line
          </button>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>
              {block.totalLabel} · {draft.currency}
            </span>
            <span style={{ fontFamily: F.display, fontSize: 26, color: C.ink, fontVariantNumeric: "tabular-nums" }}>
              {money(total)}
            </span>
          </div>
        </div>
        {block.bench && (
          <div style={{ padding: "0 14px 14px" }}>
            <BenchmarkBar bench={block.bench} total={total} lowestPrice={lowestPrice} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute }}>Currency</span>
        <select
          value={draft.currency}
          onChange={(e) => patch({ currency: e.target.value })}
          style={{ ...inputStyle, width: 120, padding: "6px 8px", fontSize: 12 }}
        >
          {["USD", "EUR", "GBP", "KES", "ETB", "EGP", "XOF", "Other"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute }}>
          Quote in the currency the notice names — a wrong-currency offer is a rejection.
        </span>
      </div>
    </div>
  );
}

/* ── conformity matrix ─────────────────────────────────────────────────── */

let confSeq = 0;
function newConfRow(requirement = ""): ConformityRow {
  confSeq += 1;
  return { id: `c${Date.now().toString(36)}${confSeq}`, requirement, response: "", deviation: null };
}

export function seedConformityRows(requirements: string[]): ConformityRow[] {
  return requirements.filter(Boolean).slice(0, 40).map((r) => newConfRow(r));
}

export function ConformityBlock({
  block,
  draft,
  patch,
}: {
  block: Extract<FlowBlock, { kind: "conformity" }>;
  draft: WizardDraftState;
  patch: Patch;
}) {
  const rows = draft.conformity;
  const setRow = (id: string, p: Partial<ConformityRow>) =>
    patch({ conformity: rows.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  return (
    <div>
      <p style={{ fontFamily: F.sans, fontSize: 13, color: C.ink2, lineHeight: 1.6, margin: "0 0 14px" }}>{block.intro}</p>
      <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 170px 28px", gap: 8, padding: "8px 12px", background: C.paper2, borderBottom: `1px solid ${C.rule}` }}>
          {["Requirement / specification", "Response", ""].map((h, i) => (
            <span key={i} style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute }}>{h}</span>
          ))}
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "18px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>
            Add the key specifications from the notice — one row each.
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 170px 28px", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${C.ruleSoft}`, alignItems: "start" }}>
            <textarea
              value={r.requirement}
              placeholder="e.g. Battery storage ≥ 20 kWh, LiFePO₄ chemistry"
              onChange={(e) => setRow(r.id, { requirement: e.target.value })}
              rows={2}
              style={{ ...inputStyle, padding: "7px 8px", fontSize: 12.5, resize: "vertical", lineHeight: 1.45 }}
            />
            <div style={{ display: "grid", gap: 6 }}>
              <select
                value={r.response}
                onChange={(e) => setRow(r.id, { response: e.target.value as ConformityRow["response"] })}
                style={{ ...inputStyle, padding: "7px 8px", fontSize: 12 }}
              >
                <option value="">Respond…</option>
                <option value="comply">Comply</option>
                <option value="deviate">Deviation — declare it</option>
              </select>
              {r.response === "deviate" && (
                <textarea
                  value={r.deviation ?? ""}
                  placeholder="What you offer instead, and why it's equivalent"
                  onChange={(e) => setRow(r.id, { deviation: e.target.value })}
                  rows={2}
                  style={{ ...inputStyle, padding: "7px 8px", fontSize: 12, borderColor: C.warn, resize: "vertical" }}
                />
              )}
            </div>
            <button
              onClick={() => patch({ conformity: rows.filter((x) => x.id !== r.id) })}
              title="Remove row"
              style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14, padding: "8px 0 0" }}
            >
              ×
            </button>
          </div>
        ))}
        <div style={{ padding: "12px 14px" }}>
          <button
            onClick={() => patch({ conformity: [...rows, newConfRow()] })}
            style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px" }}
          >
            + Add specification
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── declarations ──────────────────────────────────────────────────────── */

export function DeclarationsBlock({
  items,
  draft,
  patch,
}: {
  items: FlowDeclaration[];
  draft: WizardDraftState;
  patch: Patch;
}) {
  const toggle = (id: string) => {
    const has = draft.declarations.includes(id);
    patch({ declarations: has ? draft.declarations.filter((d) => d !== id) : [...draft.declarations, id] });
  };
  return (
    <div style={{ background: C.white, border: `1px solid ${C.rule}` }}>
      {items.map((d, i) => {
        const on = draft.declarations.includes(d.id);
        return (
          <button
            key={d.id}
            onClick={() => toggle(d.id)}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              width: "100%",
              textAlign: "left",
              padding: "13px 14px",
              background: "transparent",
              border: "none",
              borderTop: i > 0 ? `1px solid ${C.ruleSoft}` : "none",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                border: `1.5px solid ${on ? C.ink : C.rule}`,
                background: on ? C.ink : "transparent",
                color: C.paper,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              {on ? "✓" : ""}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, color: C.ink, display: "block" }}>{d.label}</span>
              {d.note && (
                <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, display: "block", marginTop: 3, lineHeight: 1.5 }}>
                  {d.note}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── references picker ─────────────────────────────────────────────────── */

let refSeq = 0;

export function PickrefsBlock({
  block,
  draft,
  patch,
  vaultDocs,
}: {
  block: Extract<FlowBlock, { kind: "pickrefs" }>;
  draft: WizardDraftState;
  patch: Patch;
  vaultDocs: VaultDocRow[];
}) {
  const [typed, setTyped] = useState("");
  const candidates = vaultDocs.filter(
    (d) => d.type === "past_performance" && !draft.refs.some((r) => r.vaultDocumentId === d.id),
  );
  const add = (entry: ReferenceEntry) => patch({ refs: [...draft.refs, entry] });
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink }}>
          {block.label} <span style={{ color: C.neg }}>•</span>
        </span>
        <span style={{ fontFamily: F.mono, fontSize: 10, color: draft.refs.length >= block.min ? C.pos : C.mute }}>
          {Math.min(draft.refs.length, block.min)}/{block.min} minimum
        </span>
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, margin: "0 0 10px", lineHeight: 1.5 }}>{block.help}</p>
      {draft.refs.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
          {draft.refs.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, background: C.white, border: `1px solid ${C.rule}`, padding: "8px 12px" }}>
              <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: r.src === "vault" ? C.pos : C.mute, border: `1px solid ${C.ruleSoft}`, padding: "1px 6px", flexShrink: 0 }}>
                {r.src === "vault" ? "On file" : "Typed"}
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink, flex: 1, minWidth: 0 }}>{r.label}</span>
              <button onClick={() => patch({ refs: draft.refs.filter((x) => x.id !== r.id) })} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {candidates.slice(0, 6).map((d) => (
            <button
              key={d.id}
              onClick={() => { refSeq += 1; add({ id: `rv${d.id}-${refSeq}`, label: d.name, src: "vault", vaultDocumentId: d.id }); }}
              style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.04em", color: C.ink2, background: "transparent", border: `1px dashed ${C.rule}`, padding: "6px 10px", cursor: "pointer" }}
            >
              + {d.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={typed}
          placeholder="Client — scope, year, value (e.g. UNDP Kenya — M&E services, 2024, $120k)"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && typed.trim()) {
              refSeq += 1;
              add({ id: `rt${Date.now().toString(36)}-${refSeq}`, label: typed.trim(), src: "typed" });
              setTyped("");
            }
          }}
          style={inputStyle}
        />
        <button
          onClick={() => {
            if (!typed.trim()) return;
            refSeq += 1;
            add({ id: `rt${Date.now().toString(36)}-${refSeq}`, label: typed.trim(), src: "typed" });
            setTyped("");
          }}
          style={{ fontFamily: F.mono, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", background: C.ink, color: C.paper, border: `1px solid ${C.ink}`, padding: "0 16px", cursor: "pointer" }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ── required documents (the missing-document triage) ──────────────────── */

function docStateChip(state: DocResolution["state"] | "missing", vaultName?: string | null) {
  const map: Record<string, { label: string; color: string; border: string }> = {
    missing: { label: "Missing", color: C.neg, border: "#e6c9c9" },
    attached: { label: vaultName ? `On file — ${vaultName}` : "Attached", color: C.pos, border: "#cfdfd2" },
    drafted: { label: "We draft — for signature", color: C.pos, border: "#cfdfd2" },
    requested: { label: "Requested — attached on arrival", color: C.warn, border: "#e8d9bd" },
    acknowledged: { label: "Proceeding at risk — flagged in draft", color: C.warn, border: "#e8d9bd" },
    guided: { label: "Registration in progress", color: C.warn, border: "#e8d9bd" },
  };
  const m = map[state] ?? map.missing;
  return (
    <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", color: m.color, border: `1px solid ${m.border}`, padding: "2px 7px", whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

function matchVaultDoc(spec: DocSpec, vaultDocs: VaultDocRow[]): VaultDocRow | null {
  const byType = vaultDocs.find((d) => spec.vaultTypes.includes(d.type) && (!spec.nameHint || spec.nameHint.test(d.name)));
  if (byType) return byType;
  if (spec.nameHint) return vaultDocs.find((d) => spec.nameHint!.test(d.name)) ?? null;
  return null;
}

const REGISTRATION_URLS: Record<string, string> = {
  ungm_registration: "https://www.ungm.org/Account/Registration",
};

export function DocsBlock({
  docIds,
  draft,
  patch,
  vaultDocs,
  onUpload,
}: {
  docIds: string[];
  draft: WizardDraftState;
  patch: Patch;
  vaultDocs: VaultDocRow[];
  onUpload: () => void;
}) {
  const resolutionFor = (docId: string): DocResolution =>
    draft.docs.find((d) => d.docId === docId) ?? { docId, state: "missing" };
  const setResolution = (docId: string, p: Partial<DocResolution>) => {
    const others = draft.docs.filter((d) => d.docId !== docId);
    patch({ docs: [...others, { ...resolutionFor(docId), ...p }] });
  };

  const actionBtn: React.CSSProperties = {
    fontFamily: F.mono,
    fontSize: 9,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: "transparent",
    border: `1px solid ${C.rule}`,
    color: C.ink,
    padding: "5px 9px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {docIds.map((docId) => {
        const spec = docSpec(docId);
        if (!spec) return null;
        const res = resolutionFor(docId);
        const vaultMatch = matchVaultDoc(spec, vaultDocs);
        const attachedName = res.vaultDocumentId
          ? vaultDocs.find((d) => d.id === res.vaultDocumentId)?.name ?? null
          : null;
        const unresolved = res.state === "missing" || res.state === "guided";
        return (
          <div key={docId} style={{ background: C.white, border: `1px solid ${unresolved && spec.sev === "high" ? "#e6c9c9" : C.rule}`, padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: C.ink, flex: 1, minWidth: 180 }}>
                {spec.label}
              </span>
              {docStateChip(res.state, attachedName)}
            </div>
            <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 4, lineHeight: 1.5 }}>{spec.why}</div>
            {unresolved && (
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
                {vaultMatch && (
                  <button style={{ ...actionBtn, borderColor: C.pos, color: C.pos }} onClick={() => setResolution(docId, { state: "attached", vaultDocumentId: vaultMatch.id })}>
                    ✓ Attach from vault — {vaultMatch.name.slice(0, 26)}
                  </button>
                )}
                <button style={actionBtn} onClick={onUpload}>Upload</button>
                {spec.gen?.mode === "draft" && (
                  <button style={{ ...actionBtn, background: C.ink, color: C.paper, borderColor: C.ink }} onClick={() => setResolution(docId, { state: "drafted" })}>
                    {spec.gen.cta}
                  </button>
                )}
                {spec.gen?.mode === "request" && (
                  <button style={{ ...actionBtn, borderColor: C.warn, color: C.warn }} onClick={() => setResolution(docId, { state: "requested", note: `Request letter to your ${spec.gen?.requestTarget ?? "issuer"} — we chase and attach on arrival.` })}>
                    {spec.gen.cta}
                  </button>
                )}
                {spec.gen?.mode === "guided" && (
                  <>
                    <a
                      href={REGISTRATION_URLS[docId] ?? "https://www.ungm.org"}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ ...actionBtn, textDecoration: "none", display: "inline-flex", alignItems: "center", borderColor: C.accent, color: C.accent }}
                      onClick={() => setResolution(docId, { state: "guided" })}
                    >
                      {spec.gen.cta} ↗
                    </a>
                    <button style={{ ...actionBtn, borderColor: C.pos, color: C.pos }} onClick={() => setResolution(docId, { state: "attached", note: "Registration confirmed by you." })}>
                      I&apos;m registered — mark done
                    </button>
                  </>
                )}
                <button style={{ ...actionBtn, color: C.mute }} onClick={() => setResolution(docId, { state: "acknowledged" })}>
                  Proceed without it
                </button>
              </div>
            )}
            {!unresolved && res.state !== "attached" && (
              <button
                onClick={() => setResolution(docId, { state: "missing", vaultDocumentId: null, note: null })}
                style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: C.faint, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 8 }}
              >
                Undo
              </button>
            )}
          </div>
        );
      })}
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.faint, lineHeight: 1.5 }}>
        We never fabricate official paper: drafted documents are flagged for your signature; third-party
        paper is requested from its issuer and attached when it arrives.
      </div>
    </div>
  );
}

/* ── sealed financial envelope (RFP) ───────────────────────────────────── */

export function EnvelopeBlock({
  block,
  draft,
  patch,
  prefills,
}: {
  block: Extract<FlowBlock, { kind: "envelope" }>;
  draft: WizardDraftState;
  patch: Patch;
  prefills: Record<string, string>;
}) {
  return (
    <div style={{ border: `1px solid ${C.ink}`, background: C.white }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.ink }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: C.accent2 }}>
          Sealed financial envelope
        </span>
      </div>
      <div style={{ padding: 16 }}>
        <FieldsBlock fields={block.fields} draft={draft} patch={patch} prefills={prefills} />
        <div style={{ borderLeft: `2px solid ${C.neg}`, paddingLeft: 10, marginTop: 14 }}>
          <span style={{ fontFamily: F.sans, fontSize: 11.5, color: C.neg, lineHeight: 1.55 }}>{block.note}</span>
        </div>
      </div>
    </div>
  );
}
