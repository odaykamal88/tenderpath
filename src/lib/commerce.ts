/* Commerce kill-switch — invite-only beta (2026-06).
 *
 * While COMMERCE_ENABLED is false the product runs in invite-only mode:
 *   • the public landing hides ALL pricing and gates entry behind an email
 *     invite request (src/components/landing/*);
 *   • every signed-in user holds the full Pro entitlement — Document Vault,
 *     readiness-gap Navigator and unlimited bid/no-bid — because evaluateAccess()
 *     (src/lib/access.ts) short-circuits to full access, which in turn hides every
 *     trial/subscribe surface keyed on access.* (Shell trial card, TrialBanner,
 *     PasteModal cap, NavigatorDrawer lock, the free-submission promo); and
 *   • the trial-ending payment reminder email is silenced.
 *
 * Flip back to true to restore trials, subscription gating and billing. Search
 * for COMMERCE_ENABLED to find every behaviour it governs. NOTE: the pricing
 * *copy* removed from the landing/dashboard (Pricing section, Account billing
 * tabs, Submissions price cards, the Paste upsell) is a separate, git-revertible
 * edit — this flag governs runtime entitlement + the reminder cron only. */
export const COMMERCE_ENABLED = false;
