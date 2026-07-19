# Sprint 5 — Workflow continuity

Status: planned after Sprint 4 production verification.

## Outcome

A principal, solo operator, or adviser can leave and return without losing the
thread of a bid, and the tender workspace remains usable on a phone or narrow
laptop.

## Ranked scope

| Priority | Fixture | Early-adopter relevance | Acceptance signal |
|---|---|---:|---|
| P0 | Repair browser-rendering worker deployment and deep health | High | Deep health is green and a JS-rendered tender produces useful text |
| P0 | Named, addressable drafts with resume/new/duplicate | High | Two tender drafts coexist and reload independently |
| P1 | Compact mobile stepper and sticky next action | High | 390 px walkthrough completes without horizontal clipping or hidden state |
| P1 | Upload retry/replace controls for unreadable files | High | A failed amendment can be replaced in place and freshness recalculates |
| P1 | Submission-route/source-priority copy pass | Medium | No agency-default instruction contradicts the notice |
| P2 | Unified model-call usage and failure dashboard | Medium | Operators see success, latency, tokens, model, and stable failure code |

## Constraints

- Continue using one `WizardDraftState` contract across autosave, order, and
  audit snapshots.
- Never show progress that is not backed by a stored operational state.
- Keep credentials and supplier-portal sessions outside TenderPath.
- Preserve all owner checks on draft, match, work order, pack, and vault reads.

## Ship gate

Run the service-provider fixture on desktop and 390 px mobile from public
notice through a resumed draft, readable pack, compliance map, and unpaid
work-order hand-off. Confirm browser-worker failure is visible rather than a
silent empty extraction.
