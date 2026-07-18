# Sprint 0 — customer confidentiality boundary

Sprint 0 protects customer tender documents before the guided portal workflow
accepts live early-adopter files. It does **not** claim zero-knowledge
encryption: TenderPath's server and configured AI processors must read content
to perform requested analysis. The product promise is narrower and testable:

- customer objects are owner-scoped at every dashboard route;
- new files and generated artifacts live in a dedicated private Blob store;
- browser-visible DTOs contain authenticated TenderPath download routes, never
  raw Blob URLs;
- staff queues expose metadata only by default;
- content access requires a customer-created, work-order-specific grant;
- grants expire automatically and every content read/write is appended to the
  customer-visible access log.

## Deployment order

1. Inspect the connected Vercel Blob store and confirm its access is
   **Private**. If no store exists, create a private store and connect it to the
   project.
2. Confirm Vercel added the standard `BLOB_READ_WRITE_TOKEN` in Preview and
   Production.
3. If—and only if—a separate public store contains legacy objects, preserve
   that store's token temporarily as `LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN`.
4. Deploy the Sprint 0 code. Confirm `/api/dashboard/vault/upload` stores a URL
   on the `.private.blob.vercel-storage.com` domain and the raw URL returns 403.
   Before deployment, the infrastructure-only check can be run with
   `vercel env run -e production -- npm run security:private-blob -- --live`;
   it creates and deletes one temporary object.
5. Run `npm run migrate:private-blobs` to inspect the legacy count, then check
   `/api/admin/private-storage-health` for the metadata-only storage summary.
   After the schema migration, run `npm run security:sprint0-db` to verify the
   required tables and columns without reading customer content.
6. Run `npm run migrate:private-blobs -- --apply` to copy objects and
   update database references. This leaves public sources intact for rollback.
7. Complete the owner walkthrough and download every migrated object through
   its authenticated TenderPath route.
8. Only after verification, run with `--apply --delete-source` and remove
   `LEGACY_PUBLIC_BLOB_READ_WRITE_TOKEN`.

The health endpoint reports `source_deletion_required` during the rollback
window. It reports `ok` only after no referenced legacy/unsupported objects and
no copied public sources remain.

Never replace an in-use public-store token before step 3. Blob-store access
cannot be changed in place, and both tokens are needed when a legacy public
inventory actually exists.

## Access model

`customer_access_grants` is anchored to `work_orders.id`. A grant covers only
the content necessary to fulfill or troubleshoot that order, lasts at most
seven days (the UI defaults to 72 hours), and can be revoked immediately.

`customer_access_events` is append-only application history for grant creation,
revocation, denied access, content reads and content writes. Staff authentication
alone never authorizes customer-content reads.

## RLS decision

The current app uses custom HS256 sessions and one server-side Neon connection.
Adding Postgres RLS policies without a per-request database identity would give
false assurance because the table-owner connection can bypass ordinary RLS.
Sprint 0 therefore centralizes owner predicates and adds isolation smoke tests.
Database-enforced RLS remains a follow-up architecture change requiring a
restricted application role plus per-request claims/transactions or Neon JWT
RLS. Do not market RLS as active before that migration is complete.

## Processor and data-flow inventory

| Data | Stored in | Processed by | Human access |
|---|---|---|---|
| Account/profile | Neon Postgres | TenderPath/Vercel | Account owner; operational metadata for authorized staff |
| Tender/vault files | Private Vercel Blob; extracted text in Neon | Anthropic and/or OpenAI when the user requests analysis | Owner; temporary order grant only |
| Work-order intake | Neon Postgres | TenderPath; configured AI provider for the purchased service | Owner; temporary order grant only |
| Generated PDF/ZIP | Private Vercel Blob | TenderPath rendering pipeline | Owner; temporary order grant only |
| Payments | Stripe + TenderPath payment metadata; private Blob for stored proof files | Stripe | Staff payment metadata; proof content requires an order grant |
| Email | Resend | Resend | Delivery metadata for operations |

## Sprint 0 acceptance checks

- User A cannot read, download, update or delete User B's vault document.
- User A cannot retrieve User B's work order, proposal package or submission by
  changing an integer ID.
- Admin queue responses contain no intake fields, evidence text, Q&A, revision
  notes, deliverables, raw Blob URLs or proposal output.
- Admin assessment detail responses contain activation metadata and counts, not
  customer narrative, crawl text, AI analysis, match details, or readiness gaps.
- An admin detail read without a live customer grant returns 403 and logs a
  denied-access event.
- A granted admin read succeeds, records the actor/order/purpose/time, and stops
  succeeding after revocation or expiry.
- New Blob URLs are private and all user downloads flow through authenticated
  owner routes with `Cache-Control: private, no-store` and `nosniff`.
- The migration script reports zero public vault/artifact/payment-proof URLs before the
  private-storage gate is considered complete.
