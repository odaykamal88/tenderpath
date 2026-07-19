# Sprint 2 — Portal companion and submission readiness

Sprint 2 turns the Sprint 1 tender pack into an operational hand-off between
TenderPath and the agency's supplier portal:

`matched tender → private pack → portal checks → prepared submission intake`

The portal stays under the supplier's control. TenderPath opens it beside the
workspace, tells the user what to verify, and persists only readiness
confirmations—never usernames, passwords, MFA secrets, or portal sessions.

## Early-adopter relevance

| Rank | Capability | Relevance now | Why |
|---|---|---:|---|
| P0 | Open the verified portal beside TenderPath | Very high | Removes repeated searching and supports the real two-window behavior suppliers already use. |
| P0 | Seven evidence-backed hand-off checks | Very high | Makes missing notice, route, pack, core solicitation, amendment, cutoff, and access work visible before drafting. |
| P0 | One contextual next action | Very high | Keeps a principal or solo operator moving without reading a generic help centre. |
| P0 | Persist confirmations with the owner draft and order | Mandatory | The hand-off survives refresh and reaches fulfillment without introducing a cross-tenant object. |
| P1 | Registration timing warning and verified portal steps | High | Exposes first-time registration risk while there is still time to act. |
| Deferred | Embedded third-party portal iframe | Low / unreliable | Agency portals commonly use frame restrictions, MFA, session controls, and terms that make embedding brittle or inappropriate. |
| Deferred | Credential custody or automated submission | Out of scope | The supplier signs in, signs, submits, and retains the acknowledgement. |

## Production contract

### Adjacent-window launch

- **Open portal beside TenderPath** is a user-initiated browser action.
- TenderPath asks the browser for a resizable right-side portal window. Browsers
  may open a tab instead; the direct official link remains available.
- The opened portal receives no TenderPath data, credentials, or auth token.
- For a notice-specific email or offline channel, the UI does not invent a
  portal URL and instead points back to the official notice.

### Readiness model

Seven checks make up portal hand-off readiness:

1. official notice linked — derived from the tender context;
2. submission route identified — derived from a verified registry mapping or
   an explicit notice-specific override;
3. supplier portal access confirmed — user confirmation;
4. tender pack saved privately — derived from owner-scoped vault documents;
5. core solicitation identified — derived from a file labelled solicitation,
   TOR, or guidelines;
6. amendments and Q&A checked — user confirmation;
7. cutoff and envelopes confirmed — user confirmation.

Derived checks are never stored as editable booleans. They are recomputed from
the current tender and sanitized tender-pack manifest. The progress percentage
therefore reflects evidence or an explicit user confirmation, not decorative
product progress.

### Persistence and isolation

- `WizardDraftState.portalCompanion` stores only three allowlisted confirmation
  ids plus bounded ISO timestamps.
- Draft autosave and order creation normalize the client-controlled value.
- The paid order snapshot carries the normalized state under
  `intake_fields.portalCompanion` for fulfillment continuity.
- Tender-pack ownership remains enforced by `sanitizeTenderPackForUser`; the
  companion introduces no document ids, URLs, credentials, or new database
  table.
- Selecting a different matched tender, agency, or notice-specific portal
  clears prior confirmations so they cannot bleed between opportunities.

### Guidance behavior

- The first incomplete check becomes the **Next best action**.
- Verified portal steps come from the existing registry; the notice remains
  authoritative.
- Registration risk uses the existing hedged planning bands, not an agency SLA.
- The companion does not gate the existing 80% paid-intake threshold. It makes
  risk visible without claiming every procurement uses the same sequence.

## Acceptance

Run:

```bash
npm run smoke:sprint2
npm run smoke:sprint1
npx tsx scripts/submissions-smoke.ts
npm run security:sprint0
npx tsc --noEmit
npm run lint
npm run build
```

Then walk a Vercel preview:

1. Open a recognized WHO or UNOPS match through **Prepare in TenderPath**.
2. Confirm the verified portal, timing signal, and seven-check progress render.
3. Launch the portal beside TenderPath and confirm the workspace remains open.
4. Import or upload a tender pack and label the core solicitation.
5. Confirm access, amendment/Q&A, and cutoff checks; reload and verify they
   persist.
6. Change to another tender and confirm the prior checks do not carry over.
7. Confirm the review step summarizes portal hand-off readiness.

## Explicitly out of scope

- storing or replaying supplier credentials, MFA, recovery codes, or cookies;
- bypassing anti-bot, frame, session, or access controls;
- signing, certifying, or submitting on the supplier's behalf;
- treating an opened portal window as proof that the supplier logged in;
- replacing the existing format-specific required-document and elimination-risk
  checks later in the wizard.
