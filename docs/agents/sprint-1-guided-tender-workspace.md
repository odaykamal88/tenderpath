# Sprint 1 — Guided tender workspace

Sprint 1 removes the highest-friction hand-off in the early-adopter journey:

`UNGM / matched notice → TenderPath match → agency supplier portal → submission preparation`

The user can now start from a matched EOI, RFQ, ITB, or RFP and arrive in the
correct TenderPath submission wizard with the opportunity, deadline, source,
verified portal route, and private solicitation set carried forward.

## Early-adopter relevance

| Rank | Capability | Relevance now | Why |
|---|---|---:|---|
| P0 | One-click match → correct format workspace | Very high | Removes re-selection and wrong-format starts at the moment intent is highest. |
| P0 | Private public-pack import + guided portal upload | Very high | Early adopters already download these files; keeping them with the opportunity removes repeated handling and makes review possible. |
| P0 | Verified agency portal route and official guide | Very high | Avoids the common UNGM-is-the-submission-portal mistake and exposes registration lead time early. |
| P0 | Owner-scoped manifests and downloads | Mandatory | Vendors competing for the same tender must never see one another's files. |
| P1 | UNICEF, UNOPS, WHO, WFP portal mappings | High | These are common agency paths in the current UN procurement lane. The tender notice remains authoritative. |
| Deferred | Supplier-portal credential vault | Low for the pilot / high risk | MFA, delegated authority, portal terms, password rotation, and incident exposure make credential custody a separate security project. |
| Deferred | TenderPath submits the bid | Out of scope | The supplier signs and submits. TenderPath guides and prepares; it does not claim to file on the supplier's behalf. |

## Production contract

### Entry

- A recognized match type deep-links to
  `/dashboard/proposals?start=<EOI|RFQ|ITB|RFP>&match=<match-id>`.
- An explicit match deep-link replaces a saved draft for a different tender so
  answers and files cannot bleed across opportunities.
- Unknown formats keep the existing qualification / roster path; TenderPath
  does not guess a submission format.

### Portal guidance

`src/lib/tenders/submission-portals.ts` holds only verified mappings. The live
Sprint 1 registry covers UNHCR, UNDP Quantum partner agencies, UNICEF, UNOPS,
WHO, and WFP. Unknown agencies use the honest generic fallback.

WFP is deliberately hedged because it is migrating sourcing activity to
SmartSourcing (Coupa). The specific event notice or invitation controls.

Primary references:

- WHO supplier registration: <https://www.who.int/about/accountability/procurement/become-a-supplier>
- WHO In-Tend: <https://ungm.in-tend.co.uk/who/aspx/Home>
- WFP supplier route: <https://www.wfp.org/do-business-with-wfp>
- UNOPS supplier resource centre: <https://www.unops.org/business-opportunities/supplier-resource-centre>
- UNOPS eSourcing vendor guide: <https://esourcing.unops.org/Scripts/App/Help/Guides/UNOPS_eSourcing_Vendor%20Guide_EN.pdf>
- UNICEF current electronic-submission example: <https://www.unicef.org/ukraine/lrps-2026-9204560-implementation-readiness-materials-electronic-case-management-system>

### Tender-pack import

`POST /api/dashboard/tender-pack/import` accepts a persisted `tenderId`, never
an arbitrary client URL. The server loads the official `tenders.source_url`,
validates DNS/IP safety at every redirect, scans direct HTML first, and may use
the existing Cloudflare Browser Rendering worker for thin or JS-rendered pages.

Public document imports are capped at:

- 8 documents per run;
- 20 MB per document;
- 50 MB total;
- 10 import requests per account per hour.

No public attachment is not an error. The response becomes `needs_upload` and
guides the user to keep the supplier portal open beside TenderPath, download the
pack, and upload it privately.

### Confidentiality boundary

- Imported and uploaded files use the existing private Vercel Blob store.
- Customer-facing file links are owner-authorized TenderPath download routes;
  raw Blob URLs never enter the wizard manifest.
- Direct uploads retain the Sprint 0 signed upload receipt and owner check.
- Autosave and order creation rebuild every tender-pack document from
  `vault_documents WHERE user_id = caller`, rejecting forged ids with `403`.
- The paid work order stores the sanitized tender context and manifest in
  `submission_orders.intake_fields`; no new cross-tenant table is introduced.
- TenderPath does not ask for or store portal usernames, passwords, MFA seeds,
  or recovery codes.
- The public demo login fails closed while resetting and clears submission
  drafts, submission orders, vault metadata, upload receipts, and stored file
  bytes before the next visitor enters the shared account.

### Document roles

The live manifest uses the proposal engine's existing roles: `guidelines`,
`tor`, `solicitation`, `amendment`, `qa`, `info_session`, `annex`, and
`supporting`. Filename inference is conservative and the user can correct a
role before starting the order. This is load-bearing for the rule that
corrigenda and Q&A must be read before scoring the base solicitation.

## Failure behavior and observability

- Stable logs use `[tp:tender-pack:*]`.
- A blocked/login-walled source becomes guided upload, not a silent no-op.
- Individual attachment failures do not discard successful imports; the user
  receives a partial-pack note.
- Private storage misconfiguration returns `503` before import work begins.
- A forged or foreign vault id returns `403` during autosave and order creation.

## Acceptance

Run:

```bash
npx tsx scripts/sprint1-tender-workspace-smoke.ts
npx tsx scripts/submissions-smoke.ts
npm run security:sprint0
npx tsc --noEmit
npm run build
```

Then walk a Vercel preview as a first user:

1. Open a recognized matched tender and choose **Prepare in TenderPath**.
2. Confirm the correct format, opportunity, source notice, and verified portal.
3. Import a public pack or upload a login-gated pack.
4. Reload and confirm the private manifest survives autosave.
5. Open a document while signed in, then confirm the same owner route rejects a
   different account.
6. Start the order and confirm `intake_fields.tenderContext` and
   `intake_fields.tenderPack` are present for fulfillment.

## Explicitly out of scope

- credential storage or browser replay of supplier logins;
- bypassing portal anti-bot, MFA, or access controls;
- submitting or signing on the supplier's behalf;
- claiming every WFP or UNICEF notice uses one fixed portal;
- automated amendment polling beyond the existing linked-tender deadline watcher.
