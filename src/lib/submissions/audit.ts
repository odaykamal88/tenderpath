/* Intake audit — completeness math, blocker derivation, the payment gate, and
 * the order-building snapshot. Faithful port of audit() + buildOrder() from
 * the prototype's sub-wizard.jsx. Pure over (flow, draft) so the wizard
 * (client) and the commission endpoint (server) compute the SAME numbers; the
 * server result is authoritative at pay time.
 *
 * Prototype semantics held exactly:
 *   · every visible field counts 1 (showIf-hidden fields don't); a static
 *     pre-fill satisfies the count until edited;
 *   · only a docs-block's `required` subset counts; other listed docs are
 *     good-to-have;
 *   · elimination risks = the CURATED block-level blockers only (ungm, fin,
 *     cv3 …) — a regular missing doc reduces completeness but never blocks
 *     payment on its own;
 *   · gate: tender chosen ∧ no `open` blockers ∧ completeness ≥ 80%. */

import type {
  IntakeFields,
  SubmissionBlocker,
  SubmissionDeliverable,
  WizardDraftState,
} from "./types";
import type { FlowBlock, SubmissionFlow } from "./flows";

export const PAY_GATE_PCT = 80;

export interface AuditResult {
  need: number;
  have: number;
  pct: number;
  blockers: SubmissionBlocker[];
  /** Blockers still `open` — these alone hard-gate the pay button. */
  open: SubmissionBlocker[];
  tenderChosen: boolean;
  canPay: boolean;
}

function fieldValue(draft: WizardDraftState, k: string, pre?: string): string {
  const stored = draft.fields[k];
  return (stored != null ? stored : pre ?? "").trim();
}

function docState(draft: WizardDraftState, docId: string): string {
  return draft.docs.find((d) => d.docId === docId)?.state ?? "missing";
}

export function auditDraft(flow: SubmissionFlow, draft: WizardDraftState): AuditResult {
  let need = 0;
  let have = 0;
  const blockers: SubmissionBlocker[] = [];

  for (const step of flow.steps) {
    for (const b of step.blocks ?? []) {
      collect(b, step.id);
    }
  }

  function collect(b: FlowBlock, stepId: string) {
    switch (b.kind) {
      case "fields":
      case "envelope": {
        for (const f of b.fields) {
          if (f.showIf && fieldValue(draft, f.showIf.k) !== f.showIf.v) continue;
          need++;
          if (fieldValue(draft, f.k, f.pre)) have++;
        }
        return;
      }
      case "criteria": {
        for (const k of b.items) {
          need++;
          if (fieldValue(draft, k.id)) have++;
        }
        return;
      }
      case "docs": {
        for (const key of b.docs) {
          const required = (b.required ?? []).includes(key);
          if (!required) continue;
          need++;
          const st = docState(draft, key);
          if (st !== "missing") have++;
          if (b.blocker) {
            // Curated elimination risk — state follows the doc row unless the
            // row is satisfied (attached/resolved/drafted ⇒ resolved risk).
            const state =
              st === "missing" ? ("open" as const)
              : st === "ack" ? ("acknowledged" as const)
              : st === "requested" ? ("requested" as const)
              : ("resolved" as const);
            blockers.push({ id: b.blocker.id, label: b.blocker.label, sev: b.blocker.sev, state, note: b.blocker.fix });
          }
        }
        return;
      }
      case "declarations": {
        b.items.forEach((_, i) => {
          need++;
          if (draft.declarations.includes(`${stepId}:${i}`)) have++;
        });
        return;
      }
      case "pickrefs": {
        need += b.min;
        have += Math.min(b.min, draft.refs.length);
        return;
      }
      case "lines": {
        if (draft.lines.length === 0) {
          need++; // at least one priced line
          return;
        }
        for (const l of draft.lines) {
          need++;
          if ((l.unitPrice ?? 0) > 0) have++;
        }
        return;
      }
      case "conformity": {
        const min = b.min ?? 0;
        if (draft.conformity.length < min) need += min - draft.conformity.length;
        for (const r of draft.conformity) {
          need++;
          if (r.response === "comply" || (r.response === "deviate" && (r.deviation ?? "").trim())) have++;
        }
        return;
      }
    }
  }

  const pct = need ? Math.round((have / need) * 100) : 0;
  const open = blockers.filter((b) => b.state === "open");
  const tenderChosen = Boolean(draft.tender?.title?.trim());
  return {
    need,
    have,
    pct,
    blockers,
    open,
    tenderChosen,
    canPay: tenderChosen && open.length === 0 && pct >= PAY_GATE_PCT,
  };
}

/* ── Order-building snapshot (commission time) ─────────────────────────── */

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function linesTotal(draft: WizardDraftState): number {
  return draft.lines.reduce((sum, l) => sum + (l.unitPrice ?? 0) * (l.qty || 0), 0);
}

/** Per-format intake summary [[k, v], …] — the prototype's buildOrder() rows,
 *  shown in the drawer ("What we received at intake") and the ops queue card.
 *  Built only from what the user actually entered. */
export function buildIntakeSummary(flow: SubmissionFlow, draft: WizardDraftState): [string, string][] {
  const out: [string, string][] = [];
  const f = (k: string, pre?: string) => fieldValue(draft, k, pre);

  if (flow.code === "EOI") {
    out.push(
      ["Positioning", f("angle") || "—"],
      ["Coverage", f("geo") || "—"],
      ["References", `${draft.refs.length} selected`],
    );
    if (f("capacity")) out.push(["Capacity evidence", f("capacity")]);
  }
  if (flow.code === "RFQ") {
    const tot = linesTotal(draft);
    out.push(
      ["Quote total", tot ? `${draft.currency} ${money(tot)}` : "pending"],
      ["Validity", f("validity") || "90 days"],
      ["Delivery", f("delivery") || "—"],
    );
    if (f("incoterms")) out.push(["Incoterms", f("incoterms")]);
    const dev = f("specs") === "Compliant with declared deviations";
    out.push(["Conformity", dev ? `Declared deviations: ${f("deviations") || "—"}` : "Fully compliant with all specs"]);
  }
  if (flow.code === "ITB") {
    const devs = draft.conformity.filter((r) => r.response === "deviate").length;
    out.push(
      ["Conformity", `${draft.conformity.length - devs} comply · ${devs} declared deviation(s)`],
      ["Bid validity", f("validity") || "120 days"],
      ["Security", f("security") || "Bid-securing declaration"],
    );
    const tot = linesTotal(draft);
    if (tot) out.push(["BoQ total", `${draft.currency} ${money(tot)} across ${draft.lines.length} line items`]);
    if (f("sitevisit")) out.push(["Site visit", f("sitevisit")]);
  }
  if (flow.code === "RFP") {
    out.push(
      ["Methodology", f("k1") || "—"],
      ["Fee ceiling", f("ceiling") ? `USD ${f("ceiling")}` : "—"],
      ["Team", f("k2") || "—"],
    );
    if (f("k3")) out.push(["References to cite", f("k3")]);
    if (f("days")) out.push(["Person-days basis", f("days")]);
    if (f("reimb")) out.push(["Reimbursables", f("reimb")]);
  }

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
