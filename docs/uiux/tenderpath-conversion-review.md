---
title: TenderPath Conversion Review
scope: Headline clarity, CTA hierarchy, trust signals, proof points, pricing clarity, friction
date: 2026-04-18
auditor: Claude Code
---

# TenderPath Conversion Review

## Conversion Funnel Overview

```
Homepage → /assessment (form) → /assessment (loading) → /assessment (results) → /login?next=/dashboard
```

The funnel is structurally sound. The homepage correctly drives toward a free, low-friction assessment. The results page is rich and compelling. The login handoff is the weakest link.

---

## Headline Clarity

### Homepage H1
> "Qualified businesses lose millions in UN contracts they never even find."

**Rating: Good.** Clear problem statement, emotionally resonant. The word "millions" is strong but needs the $40B context (one paragraph above) to land. On its own it's slightly vague about the scale.

**Improvement**: Optionally sharpen to "Qualified businesses miss millions in UN contracts — because they never see them." (shorter, punchier)

### Homepage Eyebrow
> "$40B UN Market — You're Being Locked Out"

**Rating: Excellent.** Specific number, adversarial framing ("locked out"), creates urgency and curiosity. No change needed.

### Assessment Page H1
> "Free Vendor Readiness Assessment"

**Rating: Adequate but flat.** Describes what the page is, not why the visitor should care. The meta-title ("Takes 2 minutes") is a better hook.

**Improvement**: "Find Out If You're Ready for UN Contracts — Free, 2 Minutes"

### Results Page
No persistent headline — the company name and score dominate. This is appropriate; the results are the headline.

### Login Page H1
> "Sign in to TenderPath"

**Rating: Weak.** No value statement. The visitor just completed an assessment and is being asked to log in — the headline should reinforce the payoff.

**Improvement**: "Save Your Assessment Results" or "Your Vendor Score Is Ready — Sign In to Keep It"

---

## CTA Hierarchy

### Homepage

| CTA | Location | Text | Destination | Rating |
|-----|----------|------|-------------|--------|
| Primary | Hero | "See What You're Missing — Free" | /assessment | Good — curious, low-friction |
| Secondary | Hero | "See How It Works" | #how-it-works | Good — educates non-ready visitors |
| Nav | Sticky | "My Dashboard" | /assessment | **BAD** — label implies account exists |
| Services | Each tier | All → /assessment | /assessment | **BAD** — no differentiation |
| Bottom CTA | Section | "Start Your Free Assessment" | /assessment | Good |

**Issue**: Three separate surface areas (Nav, Hero, Services, bottom CTA) all point to /assessment but with different labels. A first-time visitor scanning the page sees contradictory signals: "My Dashboard" implies they have an account; the hero CTA implies they don't. This is a primary CTA hierarchy failure.

**Fix**: Establish a single primary CTA label. Recommended: "Get Free Assessment" across all surfaces except Services tier CTAs (which should vary by tier as noted in backlog).

### Assessment Form

| CTA | Location | Text | Rating |
|-----|----------|------|--------|
| Submit | Bottom of form | "Run Free Assessment" | Good — action-oriented, reinforces "free" |

No issues with assessment form CTA.

### Results Page

| CTA | Location | Text | Destination | Rating |
|-----|----------|------|-------------|--------|
| Primary | Bottom | "Go to my dashboard →" | /login?next=/dashboard | Adequate — functional but generic |
| Tier cards | Each plan | None (cards are not clickable) | — | **BAD** — clicked a card, nothing happens |
| Share | — | None | — | Missing — high-value moment to add social/email sharing |

**Issue**: After receiving a personalized readiness score, the only CTA is a generic "Go to my dashboard." The moment of maximum engagement and intent is not being capitalized on. Users who click a tier card expecting to select it receive no feedback.

**Fix**: Make tier cards clickable (→ `/login?plan=<slug>`). Change primary CTA to "Save Results & Get Started" or "Unlock Full Dashboard."

### Login Page

| CTA | Location | Text | Rating |
|-----|----------|------|--------|
| Primary | Form | "Send magic link" | Adequate |
| Primary | Step 2 | "Sign in" | Adequate |
| Back | — | None | **Missing** — no way to go back |

---

## Trust Signals

### Present

| Signal | Where | Quality |
|--------|-------|---------|
| "$40B UN market" stat | Hero eyebrow, Challenge | Good — specific, credible |
| "190+ UN agencies" | Challenge | Good |
| "30K+ active tenders" | Challenge | Good |
| "Free — No credit card" | CTA, assessment | Good |
| ReadinessScore with dimensions | Results | Good — feels authoritative |
| Matched tenders with deadlines/values | Results | Excellent — concrete proof |

### Missing (and Why They Matter)

| Missing Signal | Impact | Where to Add |
|----------------|--------|--------------|
| Customer testimonials | Highest-trust signal for B2B SaaS | Homepage (new section), Login page sidebar |
| Customer/user count | Social proof — "Join 400+ vendors" | Hero, below primary CTA |
| UN agency logo strip | Establishes context and authority | Below hero fold |
| Team credentials | "Built by ex-UNDP procurement officers" | WhyUs, Footer |
| Press/media mentions | Third-party validation | Homepage (if available) |
| Security/privacy badge | B2B buyers are privacy-aware | Footer, Login page |
| Money-back guarantee | Reduces signup risk | Services/Pricing section |

**Assessment**: The site currently relies entirely on its own claims for credibility. For a product targeting businesses bidding on government contracts — where trust and compliance are paramount — the absence of third-party validation is a significant conversion blocker.

---

## Proof Points

### Quantified Claims (Present)
- $40B market size ✓
- 70% of tenders go to repeat vendors ✓ (source needed)
- 190+ UN agencies ✓
- 30K+ active tenders ✓

**Issue**: None of these statistics have source citations. For a procurement-focused audience, unsourced statistics are credibility risks.

**Fix**: Add a single "Source: UN Procurement Reports / UNGM" footnote beneath the Challenge stats block.

### Missing Proof Points
- Win rate improvement data
- Number of vendors assessed to date
- Sample tender matches (real examples, anonymized)
- Total value of tenders surfaced for users

---

## Pricing Clarity

### Current State (Critical Issue)

The pricing a visitor encounters depends on where they are in the funnel:

| Page | Tier 1 | Tier 2 | Tier 3 |
|------|--------|--------|--------|
| Homepage `/` (Services.tsx) | $49/mo | **$199/mo** | **$599/mo** |
| Assessment Results | $49/mo | **$299/mo** | **$999/mo** |

This is a direct conversion killer. A visitor who sees $199 on the homepage, completes a 10-minute assessment, and is then quoted $299 will feel deceived. **This must be fixed before any paid acquisition.**

### Pricing Presentation Issues

1. **No annual pricing option** — monthly-only pricing makes SaaS feel expensive; annual/monthly toggle is standard
2. **No free tier clearly defined** — "Free Assessment" is prominent but visitors don't know what they get for free vs. paid
3. **No comparison table** — three cards with bullet lists require mental effort to compare
4. **"Most Popular" on wrong tier** — on highest priced tier; should be on middle

---

## Friction Points

### High Friction

| Friction | Where | Severity |
|----------|-------|----------|
| Magic link → paste token flow | Login | Users expect auto-verify from email link; manual paste is unusual and feels broken | HIGH |
| No "save results" CTA on assessment results | Results | Users who want to save must log in with no clear path | HIGH |
| Login page has no TenderPath branding | Login | Cognitive dissonance; users wonder if they're on the right site | HIGH |

### Medium Friction

| Friction | Where | Severity |
|----------|-------|----------|
| No field-level validation on assessment form | Assessment form | Error only shown at submit; inline validation is faster | MEDIUM |
| Country selection requires typing — no "Select All" for a region | Assessment form | Vendors operating in East Africa want all countries at once | MEDIUM |
| No loading state progress on form submission feedback | Assessment step 2 | Progress stages are simulated with timeouts, not real | MEDIUM |

### Low Friction (Positive Signals)

| Element | Why It Reduces Friction |
|---------|------------------------|
| "Free — No credit card" everywhere | Removes financial anxiety |
| 3-step progress indicator on assessment | Users know where they are |
| Real tender results with match % | Instant value demonstration |
| Single required field group (name + email) on form | Low barrier to start |

---

## Overall Conversion Verdict

**Funnel quality: 6/10**

The top-of-funnel (homepage → assessment form) is well-designed and low-friction. The results page is genuinely impressive and creates strong intent. The fatal flaws are at the money moment: pricing inconsistency, non-interactive tier selection, and an unbranded login handoff. Fix those four P0 issues and this funnel becomes an 8/10.
