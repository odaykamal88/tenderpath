# TenderPath Desktop And Mobile Viability Audit

Date: 2026-06-06
Audit type: combined UX, product viability, responsive review
Destination: local folder

## Audit Scope

Reviewed the local Next.js app at `http://localhost:3000` using captured screenshots and code context.

Primary flow sampled:

1. Public landing page
2. Assessment entry
3. Assessment wizard step 1
4. Login / demo sign-in
5. Authenticated dashboard empty state
6. Pipeline workbench
7. Bid/no-bid and proposal service paths
8. Document vault
9. Work orders
10. Mobile versions of the same core surfaces

Evidence limits:

- I did not submit a full live assessment because that would exercise crawler/AI/payment-adjacent production behavior beyond a visual audit.
- The demo account intentionally resets assessments and work orders on sign-in, so the authenticated overview showed the empty first-assessment state.
- This is not a full WCAG audit. Accessibility findings are visible/structural risks from screenshots and route inspection.
- Local Next.js dev overlay elements were hidden in Playwright screenshots where possible because they are not product UI.

## Screenshot Evidence

Accepted evidence screenshots:

- `05-playwright-desktop-home.png`
- `06-playwright-desktop-assessment-entry.png`
- `07-playwright-desktop-assessment-step1.png`
- `08-playwright-desktop-login-magic.png`
- `09-playwright-desktop-login-password.png`
- `12-playwright-desktop-pipeline-add-form.png`
- `27-playwright-desktop-dashboard-ready.png`
- `29-playwright-desktop-service-bid-no-bid-ready.png`
- `30-playwright-desktop-service-proposal-ready.png`
- `31-playwright-desktop-vault-ready.png`
- `32-playwright-desktop-work-orders-ready.png`
- `33-playwright-mobile-home-ready.png`
- `34-playwright-mobile-assessment-entry-ready.png`
- `35-playwright-mobile-login-ready.png`
- `36-playwright-mobile-dashboard-ready.png`
- `37-playwright-mobile-pipeline-ready.png`
- `38-playwright-mobile-service-bid-no-bid-ready.png`
- `39-playwright-mobile-vault-ready.png`
- `40-playwright-mobile-dashboard-menu-ready.png`
- `41-playwright-mobile-assessment-step1-ready.png`
- `42-playwright-mobile-pipeline-after-touch.png`
- `43-playwright-mobile-pipeline-card-view.png`
- `44-playwright-mobile-service-form-view.png`

Rejected/limited screenshots:

- `10-playwright-desktop-dashboard-overview.png`: loading-only state.
- `11-playwright-desktop-pipeline-initial.png` and `28-playwright-desktop-pipeline-ready.png`: loading-only pipeline state, retained as evidence of the pipeline initialization risk.

## Viability Verdict

TenderPath is viable as a desktop-first procurement workbench after assessment, but not yet viable enough as a reliable mobile workbench for repeated daily use.

The product direction is strong: it feels specific to procurement, not generic SaaS. The readiness assessment, pipeline, service paths, vault, and work-order ledger map well to the user jobs described in the product docs: understand fit, decide whether to pursue, prepare evidence, and order support.

The main viability blockers are reliability and workflow continuity, not visual design. Users need a completed assessment or demo state to immediately show value, and the pipeline must never stall on loading when API calls are succeeding.

## Strengths

1. Strong product specificity

The landing page and assessment entry are clearly about procurement readiness, not generic AI matching. The sample report, sourced UN procurement context, readiness language, and service paths all support a coherent category.

2. Assessment entry is compelling on desktop and mobile

The entry screen explains the value before asking for data, offers website crawling as optional, and gives a start-from-scratch escape hatch. Mobile spacing is generally good and the first step is readable.

3. Login handoff is much improved

The login screen is branded, explains "Save your assessment," supports magic link, Google, and demo password. This is credible enough for launch testing.

4. Dashboard information architecture is mostly right

The sidebar groups Overview, Work orders, Services, Vault, and Settings in a way that maps to a procurement workflow. Mobile drawer navigation is clear, readable, and has adequate target sizes.

5. Service pages are concrete and monetizable

Bid/no-bid and proposal pages state price, expected use case, steps, caveats, context intake, uploads, and sample output. This is the clearest revenue path in the product.

6. Document vault is one of the strongest mobile surfaces

The vault clearly explains why documents matter, shows expiry/document stats, and the upload form reflows cleanly on mobile.

## UX Risks

1. P0: Pipeline can remain visually stuck on loading

Evidence: `37-playwright-mobile-pipeline-ready.png`, `28-playwright-desktop-pipeline-ready.png`; server logs showed `/api/dashboard/pipeline` returning 200 during the same run.

Impact: The pipeline is supposed to be the operational heart of TenderPath. A stale loading state makes the product feel unreliable even when the backend is working.

Recommendation: Add explicit client-side fetch failure/success diagnostics, always clear loading in a `finally`, surface "No pipeline items yet" as a real empty state, and log a stable event when pipeline fetch returns but the UI has not rendered items after a timeout.

2. P0: Demo/first dashboard shows structure before value

Evidence: `27-playwright-desktop-dashboard-ready.png`, `36-playwright-mobile-dashboard-ready.png`.

Impact: Demo users and newly signed-in users see "Run your first assessment" plus pricing before seeing the differentiated matched workflow. This is sensible for privacy, but weak for sales/demo viability.

Recommendation: For demo only, seed a safe sample assessment and pipeline. For real new users, keep the empty state but add a preview card showing exactly what will appear after assessment: top matches, one readiness gap, and next paid action.

3. P1: Mobile pipeline is not yet a comfortable board

Evidence: `43-playwright-mobile-pipeline-card-view.png`.

Impact: Cards are usable but cramped. Multiple columns appear side by side, text truncates heavily, and the horizontal board model is not obvious on phone.

Recommendation: Replace the mobile pipeline board with a stage-filtered list: segmented stage tabs, one-column cards, and a "Move stage" menu. Keep drag/drop for desktop only.

4. P1: Service pages start strong, but order context is often empty

Evidence: `29-playwright-desktop-service-bid-no-bid-ready.png`, `38-playwright-mobile-service-bid-no-bid-ready.png`.

Impact: The service path says it checks tender context, but when reached directly it says no tender is attached. That weakens the promise at checkout.

Recommendation: Put "Choose from pipeline" or "Paste tender URL" as the first visible action, not just a note inside the order panel. If no context is attached, the primary CTA should become "Attach tender first."

5. P1: Floating help button overlaps primary mobile surfaces

Evidence: `38-playwright-mobile-service-bid-no-bid-ready.png`, `44-playwright-mobile-service-form-view.png`, `39-playwright-mobile-vault-ready.png`.

Impact: It competes with forms and lower-right CTAs on mobile.

Recommendation: Move the help button above sticky safe-area spacing, hide it while a form input is focused, or dock it into the mobile menu.

6. P2: Assessment timing copy is inconsistent

Evidence: assessment entry says 3 minutes; dashboard empty copy says about five minutes; step progress says ~120s.

Impact: Small trust leak. Procurement users are sensitive to process promises.

Recommendation: Pick one promise: "3 minutes to submit, a few minutes to generate" and reuse it across landing, assessment, and dashboard empty states.

## Accessibility Risks

1. Focus and route-change behavior need verification

Wizard step transitions should move focus to the step heading or first required field. A previous browser capture showed an unstable blank top after keyboard navigation; later metrics showed the DOM was present, so treat this as a verification risk, not a confirmed bug.

2. Very small mono labels may be hard to read

The visual system relies on 9-11px uppercase mono labels. It looks refined, but on mobile and low-vision settings some labels may become decorative rather than useful.

3. Pipeline drag/drop must have keyboard equivalent

Desktop drag/drop is useful, but stage movement needs a keyboard and screen-reader-accessible control. The code has stage action buttons in some contexts; ensure they are available and labelled for all cards.

4. Color is doing some status work

Confidence dots, warning bars, and status dots should always include text labels or accessible names. Some are labelled; verify all repeated status indicators.

5. Mobile horizontal overflow can confuse screen magnification

The pipeline board's min-width grid creates horizontal browsing on mobile. This can be difficult for zoomed users and screen magnifier users.

## Recommended Changes

### Launch Fixes

1. Fix pipeline loading lifecycle.

Acceptance test: load `/dashboard/pipeline` after demo sign-in on desktop and mobile. Within 3 seconds it must show either cards, an empty state, or a clear error. It must not stay on "Loading pipeline..." after a 200 API response.

2. Seed the demo account with safe sample value.

Demo users should land on a dashboard with a sample assessment, 2-3 matched opportunities, one visible readiness gap, and one clear next action. Keep the reset, but reset to curated demo data rather than blank.

3. Build mobile pipeline as a list, not a board.

Use stage tabs and cards stacked vertically. Each card should answer: why this matters, why it matches, what to do next.

4. Make service intake context-first.

If no tender is attached, the first action should be "Attach tender" with options: choose pipeline item, paste URL, upload TOR. Only then show checkout CTA.

### High-Value UX Improvements

5. Add a "post-assessment next action" strip.

After a completed assessment, make the first screen say:

- Best tender to evaluate now
- Biggest readiness blocker
- Suggested next paid service
- One trust caveat or evidence source

6. Add mobile sticky CTA behavior carefully.

Service pages need a persistent path to "Start bid/no-bid" or "Attach tender," but it must not collide with the help button.

7. Tighten timing and trust copy.

Use one timing model across the product and distinguish "form time" from "analysis time."

8. Add empty-state variants tied to procurement tasks.

Examples:

- No pipeline items: "Add a tender URL or run assessment to seed matches."
- No vault docs: "Upload the 3 documents most UN buyers ask for first."
- No work orders: "Start with bid/no-bid on one matched tender."

### Desktop Polish

9. Keep the editorial design but reduce huge headings inside work surfaces.

Desktop service and pipeline headings are elegant, but some operational screens lose vertical efficiency. Keep hero-scale type for entry pages; use tighter headings in repeated workbench pages.

10. Keep dashboard pricing secondary.

The founder pricing card is large on the empty dashboard. It should not overpower the activation path before a user has seen a match.

## Step Health Summary

1. Desktop landing: healthy. Strong brand, clear wedge, strong first CTA.
2. Desktop assessment entry: healthy. Clear value and optional crawl.
3. Desktop assessment step 1: mostly healthy. Good form hierarchy; verify focus on step changes.
4. Desktop login: healthy. Branded, clear, demo path present.
5. Desktop dashboard empty state: mixed. Clear, but value is delayed.
6. Desktop pipeline: risky. Strong concept, but loading lifecycle is unreliable.
7. Desktop services: healthy. Clear monetizable paths; needs better context attachment.
8. Desktop vault: healthy. Strong utility and good empty/upload state.
9. Desktop work orders: healthy as a ledger; needs real work-order examples in demo.
10. Mobile landing: healthy. Strong and readable.
11. Mobile assessment entry: mostly healthy. Button text wraps but remains usable.
12. Mobile assessment step 1: healthy. Good spacing and readable fields.
13. Mobile dashboard/menu: healthy. Navigation works well.
14. Mobile pipeline: risky. Loading bug plus cramped board model.
15. Mobile service order: mixed. Readable, but help widget overlaps and context attachment is buried.
16. Mobile vault: healthy. One of the best mobile workbench screens.

## Bottom Line

TenderPath has a viable product shape. The strongest path is not "tender alerts"; it is assessment -> matched opportunities -> bid/no-bid/proposal/vault workflow. The current desktop experience is close enough to test with real users after fixing pipeline loading and demo seeding. The mobile experience is viable for assessment, login, service intake, and vault, but the pipeline needs a mobile-native redesign before it can be considered a dependable daily workflow.
