# Launch discipline — rules from the patch session retro

This document captures the rules that came out of a single retro after seven
gateway flows were simultaneously broken in production. Read it before any work
that touches auth, dashboard, assessment, pricing, telegram, or email. The PR
template (`.github/pull_request_template.md`) enforces the same rules at merge
time — do not edit the template to skip its checks.

## What went wrong (the seven bugs, briefly)

1. **Google sign-in returned `AUTH_REQUIRED` for every visitor** — `/api/auth/google` and its callback were never added to the proxy's `PUBLIC_PATHS`. Broken since the proxy was introduced.
2. **Demo password mismatch** — UI hint said `TenderDemo2025!`, prod DB had `TenderDemo2026!`. A partial revert of one side. Demo Fill → Sign in returned "Invalid email or password" for everyone.
3. **Every assessment showed all-zero dimension bars** — `AssessmentResults.tsx` and the PDF route read ghost keys (`sector_fit`, `geography`, `compliance`, `experience`) that don't exist on `ReadinessDimensions`. The keys are `technical_capability` / `compliance_readiness` / `geographic_reach` / `experience_relevance`. A `Partial<T> & Record<string, X>` cast disabled the type check that would have caught it.
4. **Magic-link → dashboard → /assessment loop** — dashboard server-redirected signed-in-but-no-assessment users to `/assessment`, which had no auth indicator. Users assumed they were signed out and re-submitted email.
5. **Founding Member tier still on landing** — partially removed; the actual `TIERS[]` source was untouched.
6. **`PAY USDT · WIRE · WHISH` chips lingering** under every tier on landing.
7. **Telegram webhook was a black box** — silently dropped non-text messages, silently 200'd on secret mismatch, no logging of incoming updates at all. A real user reported the bot doing nothing and there was no log trail.

## The four rules these failures collapse into

### 1. Shared contracts require find-all-references discipline

When editing any string or key that appears in multiple files — passwords, schema field names, public route paths, env var names, tier slugs, callback URLs — grep every consumer and update them all in the same diff. The demo password, dimension keys, and proxy allowlist bugs are all the same failure: one side edited, the other forgotten.

Concrete triggers:
- Editing demo credentials → check both `scripts/create-demo-user.mjs` and `src/app/login/page.tsx` and `src/app/api/auth/password/route.ts`.
- Adding a public `/api/*` route → update `src/proxy.ts` `PUBLIC_PATHS` in the same diff.
- Renaming a field in a `lib/types.ts` interface → grep for every reader and fix each one. Don't lean on `??` fallbacks.
- Renaming an env var → update Vercel, `.env.example`, payment-health/source-health admin routes, and any inline references.

### 2. Walk the first-user journey before declaring done

Five of seven launch bugs were visible in one 5-minute incognito walkthrough. If your change touches auth, dashboard, assessment, pricing, or the assessment results/PDF rendering, walk the affected flow yourself on Vercel preview before declaring done. If you can't, explicitly hand it back to the user with the exact click-through steps — do not bury "should be fine" at the end of a summary.

The flows are enumerated in `~/.claude/projects/-Users-odaykamal-Desktop-TENDERPATH/memory/project_launch_flows.md` and tickbox'd in the PR template.

### 3. Don't widen types to read fields not on the interface

`as Partial<T> & Record<string, X>` is almost always a bug pattern. It tells TypeScript "accept any string key" and silently turns typos and stale field names into `undefined` reads paired with `?? 0` fallbacks. The all-zero dimension bug was this exact pattern.

If you need to read a hardcoded key name through a Record cast, the interface is wrong, the read is wrong, or you need an explicit transformer — fix one of those, never bypass the check.

### 4. Silent failures are unshipable

Every error branch in a webhook, API handler, or middleware that returns 200 / silently swallows must `console.error` or `console.warn` with a stable `[domain:context:reason]` tag. The Telegram webhook silenced everything; the auth API conflated 500s with 401s in the UI; the OAuth handler silently redirected on missing env. None were diagnosable from prod logs.

Frontends should not collapse all error states into one user-facing message. Differentiate 401 from 500 from network errors.

For every external integration (telegram, stripe, resend, neon, OAuth providers), provide an admin-gated `/api/admin/<x>-health` diagnostic endpoint so prod state can be inspected without redeploying. `src/app/api/admin/telegram-health/route.ts` is the established pattern.

## Why this exists

This codebase ships through AI sessions with no QA layer. The user is the QA pipeline. Without explicit, enforced discipline, every refactor risks silently breaking a gateway flow because nobody ran the gateway flow. The rules above plus the PR template plus the launch-flows inventory plus the per-rule memory files are the structural compensation for a missing QA layer. Treat them as load-bearing.
