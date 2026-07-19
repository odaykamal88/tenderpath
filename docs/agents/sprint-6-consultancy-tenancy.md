# Sprint 6 — Consultancy tenancy

Status: planned; schema and threat model must be approved before implementation.

## Outcome

A consultancy can manage several bidding clients without any client's profile,
files, recommendations, drafts, or outcomes appearing in another client's
workspace.

## Ranked scope

| Priority | Fixture | Early-adopter relevance | Acceptance signal |
|---|---|---:|---|
| P0 | Account mode: vendor or adviser | High for consultancy ICP | Adviser onboarding no longer overwrites the consultancy's own profile |
| P0 | Client/legal-entity model and active-client context | Critical | Every customer object carries and verifies `client_id` plus account ownership |
| P0 | Cross-client negative authorization suite | Critical | Forged IDs fail for profiles, matches, drafts, vault files, orders, and packages |
| P0 | Addressable drafts and evidence vault per client | Critical | Two clients can pursue the same tender with isolated evidence and strategy |
| P1 | Client member roles, approvals, and audit trail | High | Named users can be restricted to assigned clients and actions are attributable |
| P1 | Per-client encryption envelope | High trust, higher effort | Ciphertext is decrypted only in an authorized client context; key access is logged |
| P2 | Portfolio view with aggregate metadata only | Medium | Adviser sees workload without leaking one client's document content into another |

## Privacy architecture decision

Database row-level ownership is the first hard gate. “Sealed even from super
admins” is not a simple toggle: it requires application-level envelope
encryption, a managed KMS, per-client data-encryption keys, strict separation
of key and database access, rotation/recovery procedures, and clear handling
for server-side AI processing. Sprint 6 should first ship cross-client isolation
and auditability, then add envelope encryption behind a migration plan. Do not
claim zero-admin access until key operations and support workflows actually
enforce it.

## Ship gate

Run the consultancy fixture with two legal entities pursuing the same RFP.
Attempt every read and mutation with the other client's IDs. All must fail
closed, while normal client switching, draft resume, approvals, payment, and
outcome logging remain intact.
