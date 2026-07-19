"use client";

/* Block renderers for the intake wizard — faithful port of the prototype's
 * sub-fields.jsx. Schema-driven: adding a fifth format touches flows.ts, not
 * this file.
 *
 * Production adaptations: vault matching replaces the demo `vault:"on_file"`
 * flags; the gen panel's ask input travels to ops on the order; lines and
 * conformity rows are user-built (tenders don't ship parsed schedules); the
 * benchmark bar renders only when a real band exists. */

import { useState } from "react";
import { C, F } from "../tokens";
import { Btn } from "../ui";
import type {
  ConformityRow,
  DocResolution,
  PricedLine,
  ReferenceEntry,
  WizardDraftState,
} from "@/lib/submissions/types";
import type { FlowBlock, FlowField } from "@/lib/submissions/flows";
import { docSpec, type DocSpec } from "@/lib/submissions/docs-catalog";
import type { VaultDocRow } from "./api";

export type Patch = (p: Partial<WizardDraftState>) => void;

/* ── small atoms ───────────────────────────────────────────────────────── */

function PreTag() {
  return (
    <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.accent, border: `1px solid ${C.accent2}`, padding: "1px 5px", whiteSpace: "nowrap" }}>
      pre-filled
    </span>
  );
}

function Lbl({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: F.sans, fontSize: 12.5, fontWeight: 600, color: C.ink, marginBottom: 6 }}>
      {children}
      {required && <span style={{ color: C.neg }}>*</span>}
    </span>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.mute, marginTop: 5, lineHeight: 1.5 }}>{children}</div>;
}

const inputBase: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: F.sans,
  fontSize: 13.5,
  color: C.ink,
  background: C.white,
  border: `1px solid ${C.rule}`,
  padding: "10px 12px",
  outline: "none",
  lineHeight: 1.5,
  borderRadius: 0,
};

const eyebrowLbl: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: 9.5,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: C.mute,
  marginBottom: 8,
};

/* ── kind: fields ──────────────────────────────────────────────────────── */

export function FieldsBlock({
  fields,
  draft,
  patch,
  prefills,
}: {
  fields: FlowField[];
  draft: WizardDraftState;
  patch: Patch;
  /** Profile-derived prefill values (materialized into the draft at hydrate) —
   *  used here only to keep the "pre-filled" tag honest until edited. */
  prefills?: Record<string, string>;
}) {
  const val = (k: string) => draft.fields[k];
  const visible = fields.filter((f) => !f.showIf || (val(f.showIf.k) ?? "") === f.showIf.v);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {visible.map((f) => {
        const v = val(f.k) != null ? (val(f.k) as string) : (f.pre ?? "");
        const prefilled =
          (Boolean(f.pre) && val(f.k) == null) ||
          (Boolean(prefills?.[f.k]) && v === prefills?.[f.k]);
        const set = (value: string) => patch({ fields: { ...draft.fields, [f.k]: value } });
        return (
          <div key={f.k}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <Lbl required={f.required}>{f.label}</Lbl>
              {prefilled && <PreTag />}
            </div>
            {f.type === "textarea" ? (
              <textarea rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} style={{ ...inputBase, resize: "vertical" }} />
            ) : f.type === "select" ? (
              <select value={v} onChange={(e) => set(e.target.value)} style={{ ...inputBase, cursor: "pointer" }}>
                {!v && <option value="">Choose…</option>}
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "money" ? (
              <div style={{ display: "flex", alignItems: "stretch" }}>
                <span style={{ fontFamily: F.mono, fontSize: 12, display: "flex", alignItems: "center", padding: "0 12px", border: `1px solid ${C.rule}`, borderRight: 0, background: C.paper2, color: C.ink2 }}>
                  USD
                </span>
                <input value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} style={{ ...inputBase, fontFamily: F.mono, fontVariantNumeric: "tabular-nums" }} />
              </div>
            ) : (
              <input value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} style={inputBase} />
            )}
            {f.help && <Help>{f.help}</Help>}
          </div>
        );
      })}
    </div>
  );
}

/* ── kind: docs — vault auto-attach + generate / request / acknowledge ──── */

function GenPanel({
  spec,
  onDone,
  onCancel,
}: {
  spec: DocSpec;
  onDone: (state: "drafted" | "requested", ask: string) => void;
  onCancel: () => void;
}) {
  const g = spec.gen!;
  const [val, setVal] = useState("");
  return (
    <div style={{ marginTop: 10, border: `1px solid ${C.accent2}`, background: "#fdfaf2", padding: "13px 14px" }}>
      <div style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.accent, marginBottom: 6 }}>
        {g.mode === "draft" ? "We draft it — you sign" : "We draft the request — then chase it"}
      </div>
      <p style={{ fontFamily: F.sans, fontSize: 12, color: C.ink2, lineHeight: 1.55, margin: "0 0 10px" }}>{g.blurb}</p>
      {g.ask && (
        <div style={{ marginBottom: 10 }}>
          <Lbl>{g.ask.label}</Lbl>
          {g.ask.long ? (
            <textarea rows={3} value={val} autoFocus onChange={(e) => setVal(e.target.value)} placeholder="Paste anything — we structure it" style={{ ...inputBase, fontSize: 12.5, resize: "vertical" }} />
          ) : (
            <input value={val} onChange={(e) => setVal(e.target.value)} style={{ ...inputBase, fontSize: 12.5 }} />
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Btn size="sm" kind="gold" onClick={() => onDone(g.mode === "draft" ? "drafted" : "requested", val.trim())}>
          {g.mode === "draft" ? "Generate draft →" : "Send the request →"}
        </Btn>
        <Btn size="sm" kind="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

export function matchVaultDoc(spec: DocSpec, vaultDocs: VaultDocRow[]): VaultDocRow | null {
  const byBoth = vaultDocs.find((d) => spec.vaultTypes.includes(d.type) && (!spec.nameHint || spec.nameHint.test(d.name)));
  if (byBoth) return byBoth;
  if (spec.nameHint) return vaultDocs.find((d) => spec.nameHint!.test(d.name)) ?? null;
  return null;
}

const REGISTRATION_URLS: Record<string, string> = {
  ungm: "https://www.ungm.org/Account/Registration",
};

export function DocsBlock({
  block,
  draft,
  patch,
  vaultDocs,
  onUpload,
}: {
  block: Extract<FlowBlock, { kind: "docs" }>;
  draft: WizardDraftState;
  patch: Patch;
  vaultDocs: VaultDocRow[];
  onUpload: () => void;
}) {
  const [genOpen, setGenOpen] = useState<string | null>(null);
  const resolutionFor = (docId: string): DocResolution =>
    draft.docs.find((d) => d.docId === docId) ?? { docId, state: "missing" };
  const setResolution = (docId: string, p: Partial<DocResolution>) => {
    const others = draft.docs.filter((d) => d.docId !== docId);
    patch({ docs: [...others, { ...resolutionFor(docId), ...p }] });
  };

  return (
    <div>
      {block.label && <div style={eyebrowLbl}>{block.label}</div>}
      <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
        {block.docs.map((key, i) => {
          const spec = docSpec(key);
          if (!spec) return null;
          const vaultMatch = matchVaultDoc(spec, vaultDocs);
          // Auto-attach from the vault when a match exists and no explicit
          // resolution has been made (the prototype's `vault:"on_file"`).
          const explicit = draft.docs.find((d) => d.docId === key);
          const st = explicit?.state ?? (vaultMatch ? "attached" : "missing");
          const required = (block.required ?? []).includes(key);
          const gen = spec.gen;
          const dot =
            st === "attached" || st === "resolved" || st === "drafted" ? C.pos
            : st === "ack" || st === "requested" ? C.warn
            : C.neg;
          const meta = st === "attached" && vaultMatch ? vaultMatch.name : null;
          return (
            <div key={key} style={{ padding: "12px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <span style={{ marginTop: 3, width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: dot }} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: C.ink }}>{spec.label}</span>
                    {meta && <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>{meta}</span>}
                    {required && st === "missing" && (
                      <span style={{ fontFamily: F.mono, fontSize: 8.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.neg }}>required</span>
                    )}
                  </div>
                  {st === "attached" && <div style={{ fontFamily: F.mono, fontSize: 10, color: C.pos, marginTop: 3 }}>✓ auto-attached from your vault</div>}
                  {st === "resolved" && <div style={{ fontFamily: F.mono, fontSize: 10, color: C.pos, marginTop: 3 }}>✓ resolved — {block.blocker ? "registration confirmed" : "uploaded just now"}</div>}
                  {st === "drafted" && <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.pos, marginTop: 3, lineHeight: 1.45 }}>✓ {gen?.result ?? "Drafted by TenderPath — in your final pack for review."}</div>}
                  {st === "requested" && <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, marginTop: 3, lineHeight: 1.45 }}>⧖ {gen?.result ?? "Requested — we chase and attach on arrival."}</div>}
                  {st === "ack" && <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.warn, marginTop: 3, lineHeight: 1.45 }}>Acknowledged — we&apos;ll flag this in the draft and route around it where the rules allow.</div>}
                  {st === "missing" && block.blocker && (
                    <div style={{ fontFamily: F.sans, fontSize: 11.5, color: C.ink2, marginTop: 4, lineHeight: 1.5 }}>{block.blocker.fix}</div>
                  )}
                </div>
                {st === "missing" && (
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {gen?.mode === "guided" ? (
                      <>
                        <a
                          href={REGISTRATION_URLS[key] ?? "https://www.ungm.org"}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          <Btn size="sm" kind="gold">Resolve with Navigator ↗</Btn>
                        </a>
                        <Btn size="sm" kind="ghost" onClick={() => setResolution(key, { state: "resolved", note: "Registration confirmed by you." })}>
                          I&apos;m registered
                        </Btn>
                      </>
                    ) : gen ? (
                      <Btn size="sm" kind="gold" onClick={() => setGenOpen(genOpen === key ? null : key)}>
                        {gen.cta} →
                      </Btn>
                    ) : null}
                    <Btn size="sm" kind="ghost" onClick={onUpload}>Upload</Btn>
                    <Btn size="sm" kind="ghost" onClick={() => setResolution(key, { state: "ack" })} style={{ color: C.mute }}>
                      Acknowledge
                    </Btn>
                  </div>
                )}
                {(st === "ack" || st === "drafted" || st === "requested" || (st === "resolved" && explicit)) && (
                  <Btn size="sm" kind="ghost" onClick={() => { setResolution(key, { state: "missing", vaultDocumentId: null, ask: null, note: null }); setGenOpen(null); }} style={{ flexShrink: 0 }}>
                    Undo
                  </Btn>
                )}
              </div>
              {st === "missing" && genOpen === key && gen && gen.mode !== "guided" && (
                <div style={{ marginLeft: 20 }}>
                  <GenPanel
                    spec={spec}
                    onDone={(state, ask) => {
                      setResolution(key, { state, ask: ask || null });
                      setGenOpen(null);
                    }}
                    onCancel={() => setGenOpen(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── kind: declarations ────────────────────────────────────────────────── */

export function DeclarationsBlock({
  items,
  stepId,
  draft,
  patch,
}: {
  items: string[];
  stepId: string;
  draft: WizardDraftState;
  patch: Patch;
}) {
  const toggle = (k: string) => {
    const has = draft.declarations.includes(k);
    patch({ declarations: has ? draft.declarations.filter((d) => d !== k) : [...draft.declarations, k] });
  };
  return (
    <div>
      <div style={eyebrowLbl}>Declarations — required to submit</div>
      <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
        {items.map((txt, i) => {
          const k = `${stepId}:${i}`;
          const on = draft.declarations.includes(k);
          return (
            <button
              key={k}
              onClick={() => toggle(k)}
              style={{ display: "flex", gap: 12, alignItems: "flex-start", width: "100%", textAlign: "left", padding: "11px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0, cursor: "pointer", background: on ? "#fbf9f3" : "transparent", border: "none", borderTopStyle: i ? "solid" : undefined, borderTopWidth: i ? 1 : 0, borderTopColor: C.ruleSoft }}
            >
              <span style={{ width: 16, height: 16, border: `1.5px solid ${on ? C.ink : C.rule}`, background: on ? C.ink : C.white, color: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0, marginTop: 1 }}>
                {on ? "✓" : ""}
              </span>
              <span style={{ fontFamily: F.sans, fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>{txt}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── kind: pickrefs ────────────────────────────────────────────────────── */

let refSeq = 0;

export function PickRefsBlock({
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
  const addTyped = () => {
    if (!typed.trim()) return;
    refSeq += 1;
    add({ id: `rt${Date.now().toString(36)}-${refSeq}`, label: typed.trim(), src: "typed" });
    setTyped("");
  };
  return (
    <div>
      <div style={eyebrowLbl}>
        {block.label} — pick at least {block.min}
      </div>
      <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
        {draft.refs.map((r, i) => (
          <div key={r.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
            <span style={{ width: 16, height: 16, border: `1.5px solid ${C.ink}`, background: C.ink, color: C.paper, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, flexShrink: 0 }}>✓</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: C.ink, display: "block" }}>{r.label}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>
                {r.src === "vault" ? "signed reference on file" : "cited — reference available on request"}
              </span>
            </span>
            <button onClick={() => patch({ refs: draft.refs.filter((x) => x.id !== r.id) })} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>
          </div>
        ))}
        {candidates.slice(0, 5).map((d, i) => (
          <button
            key={d.id}
            onClick={() => { refSeq += 1; add({ id: `rv${d.id}-${refSeq}`, label: d.name, src: "vault", vaultDocumentId: d.id }); }}
            style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", padding: "11px 14px", borderTop: draft.refs.length + i ? `1px solid ${C.ruleSoft}` : 0, background: "transparent", border: "none", cursor: "pointer" }}
          >
            <span style={{ width: 16, height: 16, border: `1.5px solid ${C.rule}`, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 500, color: C.ink, display: "block" }}>{d.name}</span>
              <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint }}>on file in your vault — tap to cite</span>
            </span>
          </button>
        ))}
        <div style={{ display: "flex", gap: 8, padding: "11px 14px", borderTop: draft.refs.length + candidates.length ? `1px solid ${C.ruleSoft}` : 0 }}>
          <input
            value={typed}
            placeholder="Client — scope, year, value (e.g. UNDP Kenya — M&E services, 2024, $120k)"
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTyped()}
            style={{ ...inputBase, fontSize: 12.5, padding: "8px 10px" }}
          />
          <Btn size="sm" kind="ghost" onClick={addTyped} style={{ flexShrink: 0 }}>Add</Btn>
        </div>
      </div>
      {block.help && <Help>{block.help}</Help>}
    </div>
  );
}

/* ── price benchmark — over/under-shoot wrapper for priced blocks ───────── */

function fmtMoney(n: number): string {
  return n ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";
}

export function BenchmarkBar({
  total,
  bench,
  mode,
}: {
  total: number;
  bench: { low: number; high: number; note: string } | null;
  mode: "rfq" | "boq" | "rfp";
}) {
  if (!bench) return null;
  const span = bench.high - bench.low;
  const min = bench.low - span * 0.45;
  const max = bench.high + span * 0.45;
  const px = (v: number) => Math.max(1, Math.min(99, ((v - min) / (max - min)) * 100));
  const has = total > 0;
  const status = !has ? null : total < bench.low ? "low" : total > bench.high ? "high" : "in";
  const col = status === "in" ? C.pos : status ? C.warn : C.faint;
  const label = status === "in" ? "Competitive" : status === "low" ? "Undershooting" : status === "high" ? "Overshooting" : "Awaiting prices";
  const copy = !has
    ? `Typical winning range: ${fmtMoney(bench.low)}–${fmtMoney(bench.high)} — ${bench.note}.`
    : status === "in"
      ? `Inside the typical winning range — ${bench.note}.`
      : status === "low"
        ? mode === "rfp"
          ? "Below the winning range — earns price points but reads as under-resourced to technical evaluators. Check the staffing math."
          : "Below the typical winning range — risks rejection as “abnormally low” and margin pain. Make sure every cost is in."
        : mode === "rfp"
          ? "Above the winning range — justify with seniority or scope depth, or trim toward the band."
          : "Above the typical winning range — in lowest-price evaluation this likely loses. Trim, or check whether you're over-delivering the spec.";
  return (
    <div style={{ padding: "12px 14px 13px", borderTop: `1px solid ${C.ruleSoft}`, background: C.white }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: C.mute }}>Price benchmark</span>
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: col }}>{label}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: C.paper2 }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${px(bench.low)}%`, width: `${px(bench.high) - px(bench.low)}%`, background: "#d9e7db" }} />
        {has && <div style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${px(total)}% - 1px)`, width: 2, background: col }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(bench.low)}</span>
        <span style={{ fontFamily: F.mono, fontSize: 8.5, color: C.faint, fontVariantNumeric: "tabular-nums" }}>{fmtMoney(bench.high)}</span>
      </div>
      <div style={{ fontFamily: F.sans, fontSize: 11, color: C.mute, lineHeight: 1.5, marginTop: 6 }}>{copy}</div>
    </div>
  );
}

/* ── kind: lines — priced schedule / BoQ (user-built rows) ─────────────── */

let lineSeq = 0;
function newLine(): PricedLine {
  lineSeq += 1;
  return { id: `l${Date.now().toString(36)}${lineSeq}`, desc: "", specRef: null, qty: 1, unit: "ea", unitPrice: null };
}

export function linesSum(lines: PricedLine[]): number {
  return lines.reduce((s, l) => s + (l.unitPrice ?? 0) * (l.qty || 0), 0);
}

export function LinesBlock({
  block,
  draft,
  patch,
  mobile,
}: {
  block: Extract<FlowBlock, { kind: "lines" }>;
  draft: WizardDraftState;
  patch: Patch;
  mobile: boolean;
}) {
  const lines = draft.lines;
  const total = linesSum(lines);
  const setLine = (id: string, p: Partial<PricedLine>) =>
    patch({ lines: lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const cols = mobile ? "1fr 56px 96px 24px" : "1fr 56px 64px 104px 104px 24px";
  const cell: React.CSSProperties = { ...inputBase, padding: "7px 9px", fontSize: 12.5 };
  return (
    <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "8px 14px", borderBottom: `1px solid ${C.rule}`, background: C.paper2 }}>
        {(mobile
          ? ["Line item", "Qty", "Unit price", ""]
          : ["Line item", "Qty", "Unit", `Unit price (${draft.currency})`, "Line total", ""]
        ).map((h, i) => (
          <span key={i} style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute, textAlign: i > 0 ? "right" : "left" }}>{h}</span>
        ))}
      </div>
      {lines.length === 0 && (
        <div style={{ padding: "16px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>
          Copy the line items straight from the {block.mode === "boq" ? "BoQ" : "RFQ schedule"} — one row each.
        </div>
      )}
      {lines.map((l, idx) => {
        const up = l.unitPrice ?? 0;
        return (
          <div key={l.id} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "9px 14px", borderTop: idx ? `1px solid ${C.ruleSoft}` : 0 }}>
            <span style={{ minWidth: 0 }}>
              <input value={l.desc} placeholder="Item description" onChange={(e) => setLine(l.id, { desc: e.target.value })} style={cell} />
              <input
                value={l.specRef ?? ""}
                placeholder="Spec ref (e.g. §2.1)"
                onChange={(e) => setLine(l.id, { specRef: e.target.value || null })}
                style={{ border: "none", outline: "none", background: "transparent", fontFamily: F.mono, fontSize: 9.5, color: C.faint, padding: "3px 9px 0", width: "100%" }}
              />
            </span>
            <input
              value={String(l.qty)}
              inputMode="numeric"
              onChange={(e) => setLine(l.id, { qty: Math.max(0, Number(e.target.value.replace(/[^\d.]/g, "")) || 0) })}
              style={{ ...cell, textAlign: "right", fontFamily: F.mono }}
            />
            {!mobile && <input value={l.unit} onChange={(e) => setLine(l.id, { unit: e.target.value })} style={{ ...cell, textAlign: "right", fontFamily: F.mono, fontSize: 11 }} />}
            <input
              inputMode="decimal"
              value={l.unitPrice == null ? "" : String(l.unitPrice)}
              placeholder="0"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9.]/g, "");
                setLine(l.id, { unitPrice: raw === "" ? null : Number(raw) });
              }}
              style={{ ...cell, textAlign: "right", fontFamily: F.mono, fontVariantNumeric: "tabular-nums", border: `1px solid ${up ? C.rule : C.accent2}`, background: up ? C.white : "#fdfaf2" }}
            />
            {!mobile && (
              <span style={{ fontFamily: F.mono, fontSize: 12.5, color: up ? C.ink : C.faint, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {up ? fmtMoney(up * (l.qty || 0)) : "—"}
              </span>
            )}
            <button onClick={() => patch({ lines: lines.filter((x) => x.id !== l.id) })} title="Remove line" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14, padding: 0 }}>
              ×
            </button>
          </div>
        );
      })}
      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.ruleSoft}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => patch({ lines: [...lines, newLine()] })}
          style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px" }}
        >
          + Add line
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: F.mono, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: C.mute }}>Currency</span>
        <select value={draft.currency} onChange={(e) => patch({ currency: e.target.value })} style={{ ...inputBase, width: 92, padding: "5px 8px", fontSize: 12 }}>
          {["USD", "EUR", "GBP", "KES", "ETB", "EGP", "XOF"].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "12px 14px", borderTop: `1px solid ${C.ink}`, background: "#fbf9f3" }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.ink2 }}>
          {block.mode === "boq" ? "BoQ total" : "Quotation total"} · {draft.currency}
        </span>
        <span style={{ fontFamily: F.display, fontSize: 24, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{total ? fmtMoney(total) : "—"}</span>
      </div>
      <BenchmarkBar total={total} bench={block.bench} mode={block.mode} />
    </div>
  );
}

/* ── kind: conformity — ITB technical schedule (user-built rows) ────────── */

let confSeq = 0;
function newConfRow(): ConformityRow {
  confSeq += 1;
  return { id: `c${Date.now().toString(36)}${confSeq}`, requirement: "", response: "", deviation: null };
}

export function ConformityBlock({
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
    <div style={{ border: `1px solid ${C.rule}`, background: C.white }}>
      {rows.length === 0 && (
        <div style={{ padding: "16px 14px", fontFamily: F.sans, fontSize: 12.5, color: C.mute }}>
          Add the ITB&apos;s technical schedule, item by item — one specification per row.
        </div>
      )}
      {rows.map((r, i) => (
        <div key={r.id} style={{ padding: "12px 14px", borderTop: i ? `1px solid ${C.ruleSoft}` : 0 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <span style={{ fontFamily: F.mono, fontSize: 10, color: C.faint, marginTop: 10, flexShrink: 0 }}>{String(i + 1).padStart(2, "0")}</span>
            <textarea
              value={r.requirement}
              rows={1}
              placeholder="e.g. Battery storage ≥ 20 kWh, LiFePO₄ chemistry"
              onChange={(e) => setRow(r.id, { requirement: e.target.value })}
              style={{ ...inputBase, flex: 1, minWidth: 200, fontSize: 12.5, padding: "8px 10px", resize: "vertical" }}
            />
            <span style={{ display: "flex", flexShrink: 0, marginTop: 1 }}>
              {([["comply", "Comply", C.pos], ["deviate", "Deviate", C.warn]] as const).map(([m, lab, col]) => (
                <button
                  key={m}
                  onClick={() => setRow(r.id, { response: m })}
                  style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", padding: "7px 10px", cursor: "pointer", border: `1px solid ${r.response === m ? col : C.rule}`, background: r.response === m ? col : "transparent", color: r.response === m ? C.white : C.mute, marginLeft: -1 }}
                >
                  {lab}
                </button>
              ))}
            </span>
            <button onClick={() => patch({ conformity: rows.filter((x) => x.id !== r.id) })} title="Remove row" style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14, padding: "8px 0 0" }}>
              ×
            </button>
          </div>
          {r.response === "deviate" && (
            <div style={{ marginTop: 8, marginLeft: 30 }}>
              <input
                value={r.deviation ?? ""}
                placeholder="Describe the deviation — we phrase it to survive evaluation"
                onChange={(e) => setRow(r.id, { deviation: e.target.value })}
                style={{ ...inputBase, fontSize: 12.5, borderColor: (r.deviation ?? "").trim() ? C.rule : C.warn }}
              />
            </div>
          )}
        </div>
      ))}
      <div style={{ padding: "11px 14px", borderTop: rows.length ? `1px solid ${C.ruleSoft}` : 0 }}>
        <button
          onClick={() => patch({ conformity: [...rows, newConfRow()] })}
          style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: C.ink, background: "none", border: "none", borderBottom: `1px solid ${C.ink}`, cursor: "pointer", padding: "0 0 2px" }}
        >
          + Add specification
        </button>
      </div>
    </div>
  );
}

/* ── kind: criteria — RFP scoring matrix ───────────────────────────────── */

export function CriteriaBlock({
  block,
  draft,
  patch,
  prefills,
}: {
  block: Extract<FlowBlock, { kind: "criteria" }>;
  draft: WizardDraftState;
  patch: Patch;
  prefills: Record<string, string>;
}) {
  const hasPublishedWeights = block.items.every((item) => typeof item.pts === "number");
  const totalPts = hasPublishedWeights
    ? block.items.reduce((sum, item) => sum + (item.pts ?? 0), 0)
    : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.mute }}>
        {hasPublishedWeights
          ? `Published evaluation matrix · ${totalPts} technical points`
          : "Response planning framework · weights added only from the published rubric"}
      </div>
      {block.items.map((k) => {
        const pre = prefills[k.id] ?? "";
        const stored = draft.fields[k.id];
        const v = stored != null ? stored : pre;
        const prefilled = Boolean(pre) && (stored == null || stored === pre);
        return (
          <div key={k.id} style={{ border: `1px solid ${C.rule}`, background: C.white }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${C.ruleSoft}`, background: "#fbf9f3" }}>
              <span style={{ fontFamily: F.sans, fontSize: 13, fontWeight: 600, color: C.ink, flex: 1 }}>{k.crit}</span>
              {prefilled && <PreTag />}
              {typeof k.pts === "number" && (
                <span style={{ fontFamily: F.display, fontSize: 19, color: C.accent }}>
                  {k.pts}
                  <span style={{ fontFamily: F.mono, fontSize: 9, color: C.faint }}> pts</span>
                </span>
              )}
            </div>
            <div style={{ padding: "12px 14px" }}>
              <Lbl>{k.fieldLabel}</Lbl>
              <textarea rows={2} value={v} onChange={(e) => patch({ fields: { ...draft.fields, [k.id]: e.target.value } })} style={{ ...inputBase, resize: "vertical" }} />
              {k.help && <Help>{k.help}</Help>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── kind: envelope — RFP financial, sealed framing ────────────────────── */

export function EnvelopeBlock({
  block,
  draft,
  patch,
  prefills,
}: {
  block: Extract<FlowBlock, { kind: "envelope" }>;
  draft: WizardDraftState;
  patch: Patch;
  prefills?: Record<string, string>;
}) {
  const ceilRaw = draft.fields.ceiling ?? "";
  const ceilVal = parseFloat(String(ceilRaw).replace(/[^0-9.]/g, "")) || 0;
  return (
    <div style={{ border: `1px solid ${C.ink}`, background: C.white }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: C.ink, color: C.paper }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={C.accent2} strokeWidth="1.5">
          <rect x="3" y="7" width="10" height="6.5" />
          <path d="M5 7V5a3 3 0 016 0v2" />
        </svg>
        <span style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: C.paper }}>
          Financial envelope — sealed separately from the technical proposal
        </span>
      </div>
      <div style={{ padding: "16px 14px" }}>
        <FieldsBlock fields={block.fields} draft={draft} patch={patch} prefills={prefills} />
      </div>
      <BenchmarkBar total={ceilVal} bench={block.bench} mode="rfp" />
    </div>
  );
}
