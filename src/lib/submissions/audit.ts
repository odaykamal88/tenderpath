/* Intake audit — completeness math, blocker derivation, the payment gate, and
 * the order-building snapshot. Pure functions over (flow, draft) so the wizard
 * (client) and the commission endpoint (server) compute the SAME numbers; the
 * server result is authoritative at pay time. (Prototype: audit() in
 * sub-wizard.jsx + buildOrder().)
 *
 * Counting rule (SPEC §3): every required field / doc / declaration / priced
 * line / conformity row counts 1; pct = have/need. Payment gate: tender chosen
 * ∧ no `open` blockers ∧ completeness ≥ 80%. `acknowledged` / `requested`
 * blockers pass the gate but carry into order.blockers. */

import type {
  IntakeFields,
  SubmissionBlocker,
  SubmissionDeliverable,
  WizardDraftState,
} from "./types";
import type { FlowBlock, SubmissionFlow } from "./flows";
import { docSpec } from "./docs-catalog";

export const PAY_GATE_PCT = 80;

export interface AuditItem {
  key: string;
  label: string;
  have: boolean;
  step: number;
}

export interface AuditResult {
  need: number;
  have: number;
  pct: number;
  /** Items still missing, in flow order — drives "N inputs remaining". */
  remaining: AuditItem[];
  blockers: SubmissionBlocker[];
  openBlockers: SubmissionBlocker[];
  tenderChosen: boolean;
  /** tender ∧ no open blockers ∧ pct ≥ PAY_GATE_PCT */
  canPay: boolean;
}

function fieldValue(draft: WizardDraftState, k: string): string {
  return (draft.fields[k] ?? "").trim();
}

export function auditDraft(flow: SubmissionFlow, draft: WizardDraftState): AuditResult {
  const items: AuditItem[] = [];
  const blockers: SubmissionBlocker[] = [];

  const tenderChosen = Boolean(draft.tender?.title?.trim());
  items.push({ key: "tender", label: "Opportunity selected", have: tenderChosen, step: 0 });

  flow.steps.forEach((step, stepIdx) => {
    for (const block of step.blocks) {
      collectBlock(block, stepIdx);
    }
  });

  function collectBlock(block: FlowBlock, stepIdx: number) {
    switch (block.kind) {
      case "tender":
      case "review":
        return;
      case "fields":
      case "envelope": {
        for (const f of block.fields) {
          if (!f.required) continue;
          items.push({
            key: `field:${f.k}`,
            label: f.label,
            have: fieldValue(draft, f.k).length > 0,
            step: stepIdx,
          });
        }
        return;
      }
      case "lines": {
        const lines = draft.lines;
        if (lines.length === 0) {
          items.push({ key: "lines:any", label: "At least one priced line", have: false, step: stepIdx });
          return;
        }
        lines.forEach((l, i) => {
          items.push({
            key: `line:${l.id}`,
            label: `Unit price — ${l.desc || `line ${i + 1}`}`,
            have: l.unitPrice != null && l.unitPrice > 0,
            step: stepIdx,
          });
        });
        return;
      }
      case "conformity": {
        const rows = draft.conformity;
        const min = block.min ?? 0;
        if (rows.length < min) {
          items.push({
            key: "conformity:min",
            label: `Conformity matrix — at least ${min} specification${min === 1 ? "" : "s"}`,
            have: false,
            step: stepIdx,
          });
        }
        rows.forEach((r, i) => {
          const answered = r.response === "comply" || (r.response === "deviate" && Boolean(r.deviation?.trim()));
          items.push({
            key: `conf:${r.id}`,
            label: `Response — ${r.requirement || `spec ${i + 1}`}`,
            have: answered,
            step: stepIdx,
          });
        });
        return;
      }
      case "declarations": {
        for (const d of block.items) {
          items.push({
            key: `decl:${d.id}`,
            label: d.label,
            have: draft.declarations.includes(d.id),
            step: stepIdx,
          });
        }
        return;
      }
      case "pickrefs": {
        const have = Math.min(draft.refs.length, block.min);
        for (let i = 0; i < block.min; i++) {
          items.push({
            key: `ref:${i}`,
            label: `${block.label} — ${i + 1} of ${block.min}`,
            have: i < have,
            step: stepIdx,
          });
        }
        return;
      }
      case "docs": {
        for (const docId of block.docs) {
          const spec = docSpec(docId);
          if (!spec) continue;
          const res = draft.docs.find((d) => d.docId === docId);
          const state = res?.state ?? "missing";
          const handled = state !== "missing" && state !== "guided";
          items.push({ key: `doc:${docId}`, label: spec.label, have: handled, step: stepIdx });
          if (state === "missing" || state === "guided") {
            blockers.push({ id: docId, label: spec.label, sev: spec.sev, state: "open", note: spec.why });
          } else if (state === "requested") {
            blockers.push({ id: docId, label: spec.label, sev: spec.sev, state: "requested", note: res?.note ?? null });
          } else if (state === "acknowledged") {
            blockers.push({
              id: docId,
              label: spec.label,
              sev: spec.sev,
              state: "acknowledged",
              note: res?.note ?? "Proceeding at risk — flagged in the draft.",
            });
          }
        }
        return;
      }
    }
  }

  const need = items.length;
  const have = items.filter((i) => i.have).length;
  const pct = need === 0 ? 0 : Math.round((have / need) * 100);
  const openBlockers = blockers.filter((b) => b.state === "open");

  return {
    need,
    have,
    pct,
    remaining: items.filter((i) => !i.have),
    blockers,
    openBlockers,
    tenderChosen,
    canPay: tenderChosen && openBlockers.length === 0 && pct >= PAY_GATE_PCT,
  };
}

/* ── Order-building snapshot (commission time) ─────────────────────────── */

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function linesTotal(draft: WizardDraftState): number {
  return draft.lines.reduce((sum, l) => sum + (l.unitPrice ?? 0) * (l.qty || 0), 0);
}

/** Human-readable intake summary [[k, v], …] — shown in the drawer, the admin
 *  queue card, and used by the reader's docContent(). Built only from what the
 *  user actually entered — empty inputs are simply omitted. */
export function buildIntakeSummary(flow: SubmissionFlow, draft: WizardDraftState): [string, string][] {
  const out: [string, string][] = [];
  out.push(["Format", `${flow.code} — ${flow.name}`]);

  if (draft.lines.length > 0) {
    const priced = draft.lines.filter((l) => l.unitPrice != null && l.unitPrice > 0).length;
    out.push([
      flow.code === "ITB" ? "BoQ total" : "Quotation total",
      `${draft.currency} ${money(linesTotal(draft))} across ${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}${priced < draft.lines.length ? ` · ${draft.lines.length - priced} unpriced` : ""}`,
    ]);
  }

  if (draft.conformity.length > 0) {
    const comply = draft.conformity.filter((r) => r.response === "comply").length;
    const deviations = draft.conformity.filter((r) => r.response === "deviate");
    const devNames = deviations
      .map((d) => d.requirement.split(/[,—–]/)[0]?.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    out.push([
      "Conformity",
      `${comply} of ${draft.conformity.length} specs comply · ${deviations.length} deviation${deviations.length === 1 ? "" : "s"} declared${devNames ? ` (${devNames})` : ""}`,
    ]);
  }

  for (const step of flow.steps) {
    for (const block of step.blocks) {
      if (block.kind === "fields" || block.kind === "envelope") {
        for (const f of block.fields) {
          const v = fieldValue(draft, f.k);
          if (!v) continue;
          out.push([f.label, v.length > 140 ? `${v.slice(0, 140)}…` : v]);
        }
      }
    }
  }

  if (draft.refs.length > 0) {
    out.push(["References", draft.refs.map((r) => r.label).join(" · ")]);
  }

  const docStates = draft.docs
    .map((d) => {
      const spec = docSpec(d.docId);
      if (!spec) return null;
      const verb =
        d.state === "attached" ? "attached"
        : d.state === "drafted" ? "we draft (for signature)"
        : d.state === "requested" ? "requested"
        : d.state === "acknowledged" ? "proceeding without (at risk)"
        : "open";
      return `${spec.label.toLowerCase()} — ${verb}`;
    })
    .filter(Boolean);
  if (docStates.length > 0) out.push(["Documents", docStates.join(" · ")]);

  const declBlocks = flow.steps.flatMap((s) => s.blocks).filter((b) => b.kind === "declarations");
  const declTotal = declBlocks.reduce((n, b) => n + (b.kind === "declarations" ? b.items.length : 0), 0);
  if (declTotal > 0) out.push(["Declarations", `${draft.declarations.length} of ${declTotal} affirmed`]);

  return out;
}

export function buildDeliverables(flow: SubmissionFlow): SubmissionDeliverable[] {
  return flow.deliverables.map((d) => ({ ...d, status: "queued" as const }));
}

/** Raw wizard values persisted on the order — the reader builds document pages
 *  from these, so the preview is the order's own intake, never invented. */
export function buildIntakeFields(draft: WizardDraftState): IntakeFields {
  return {
    fields: draft.fields,
    lines: draft.lines,
    currency: draft.currency,
    conformity: draft.conformity,
    declarations: draft.declarations,
    refs: draft.refs,
    docs: draft.docs,
  };
}
