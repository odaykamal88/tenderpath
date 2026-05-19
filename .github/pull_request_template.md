<!--
Required structure. Fill in every section. PRs that skip the launch-flows
checkboxes or leave the verification section empty should not be merged.
Background: docs/agents/launch-discipline.md
-->

## Summary
<!-- 1-3 sentences. What changed and why. -->


## Launch flows touched
<!--
Tick every flow this PR could plausibly affect. If unsure, tick it.
For each ticked flow, the "Verification" section below must say how you confirmed it still works.
Reference: ~/.claude/projects/-Users-odaykamal-Desktop-TENDERPATH/memory/project_launch_flows.md
-->

- [ ] **Demo login** (`/login` Password tab → Fill → Sign in → `/dashboard`)
- [ ] **Google sign-in** (`/login` → Continue with Google → Google consent → `/dashboard`)
- [ ] **Magic link** (`/login` → email → click link → `/dashboard`)
- [ ] **Dashboard empty state** (signed-in user with no assessment lands inside dashboard chrome, not /assessment)
- [ ] **/assessment signed-in state** (nav shows "Open dashboard" + email; kicker says "Signed in")
- [ ] **Assessment results + PDF dimensions** (bars render non-zero, match dashboard ScoreTab)
- [ ] **Telegram bot** (`/start` → main menu; non-text → fallback)
- [ ] None of the above

## Shared contracts touched
<!--
List every multi-file string/key this PR edits. If it's only in one place, write "none".
Examples: passwords, schema field names, route paths in PUBLIC_PATHS, env var names, tier slugs, callback URLs.
For each entry, confirm every consumer was updated in the same diff.
-->

- 

## Verification
<!--
For each ticked launch flow above, state how you verified it.
Acceptable: "Walked it in incognito on Vercel preview <URL>", "Ran curl against /api/X and confirmed Y".
NOT acceptable: "Should be fine", "Will test on prod", silence.
If a flow can't be verified locally (DB/JWT/Telegram/Stripe required), say so explicitly and request the reviewer verify on preview before merge.
-->

- 

## Silent-failure check
<!-- Tick when done. -->

- [ ] No new `return NextResponse.json({ ok: true })` on error paths without a `console.error` / `console.warn` log tag (`[domain:context:reason]` format).
- [ ] No new `as Partial<T> & Record<string, X>` casts. If you needed one, justify here:

## Risk / rollback
<!-- 1-2 lines. What breaks if this is wrong, and how do we roll back. -->

