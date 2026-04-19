---
title: TenderPath Design System Gaps
scope: Spacing, typography, color, buttons, cards, icons, premium feel
date: 2026-04-18
auditor: Claude Code
---

# TenderPath Design System Gaps

## Token Definitions (from globals.css)

```css
--color-navy:       #1a2332
--color-navy-light: #1e2b3c
--color-navy-dark:  #131b27
--color-gold:       #c8973e
--color-gold-dark:  #b5832e
--color-gold-light: #d4a84e
--color-cream:      #fefcf7
--color-green:      #2d8a4e
--color-red:        #d94f4f

font-sans:   Inter (Google Fonts)
font-serif:  Playfair Display (Google Fonts)
```

The token system is well-defined. The gaps are in how tokens are applied inconsistently across components.

---

## 1. Color Inconsistencies

### Background Colors

| Location | Color Used | Problem |
|----------|-----------|---------|
| Login page background | `bg-gray-50` | Tailwind default gray — not a design token |
| Login page card | `bg-white border-gray-200` | No navy/gold — completely off-brand |
| Assessment page background | `bg-navy` | Correct |
| Homepage body | `bg-white` (set in layout.tsx) | Correct for homepage sections |
| Challenge section | Dark variant of navy (no token) | Should explicitly use `bg-navy-dark` |

**Gap**: `bg-gray-50` and `bg-white` are used interchangeably outside the design system. The login page must be updated to use navy tokens. All section backgrounds should use the token vocabulary, not raw Tailwind grays.

### Text Colors

| Usage | Color Used | Problem |
|-------|-----------|---------|
| Body copy on white bg | `text-gray-600`, `text-gray-400` | Tailwind defaults — fine, but no token alias |
| Muted text on navy bg | `text-gray-400`, `text-gray-500` | Inconsistent — sometimes `text-white/60` |
| Error messages | `text-red-600` (login) vs `text-red` (assessment) | **Two different red systems**: Tailwind `red-600` and custom `--color-red` |

**Gap**: Error text uses `text-red-600` (Tailwind) in login and `text-red` (custom token) in assessment. These render as different shades. Standardize on `text-red` (custom token: `#d94f4f`).

### Gold Usage

Gold (`#c8973e`) is used for:
- Active nav states
- Button backgrounds
- Accent highlights
- Progress indicators
- Checkboxes

This is appropriate and consistent. No gap here.

---

## 2. Typography

### Heading Scale

| Level | Current Usage | Consistency |
|-------|--------------|-------------|
| H1 | `font-serif text-4xl font-bold` (Hero), `font-serif text-3xl font-bold` (Assessment) | Inconsistent size |
| H2 | `font-serif text-3xl` (some sections), `text-2xl` (results) | Inconsistent serif/sans |
| H3 | Sometimes serif, sometimes sans | No clear rule |
| Body | `text-sm`, `text-base` mixed | Fine for density variation |

**Gap**: No documented heading scale. H1 and H2 sizes vary by page without clear hierarchy rules. The serif font (Playfair Display) is used for some H2/H3 but not others — inconsistent premium feel.

**Recommendation**: Define explicit heading scale:
- `h1`: Playfair Display, 3xl–5xl depending on page context
- `h2`: Playfair Display, 2xl–3xl, section headings
- `h3`: Inter semibold, xl, card titles
- Body: Inter regular, base/sm

### Font Weight Usage

- `font-bold` and `font-semibold` used interchangeably on headings
- Some section labels use `font-semibold`, others `font-medium`

**Gap**: No consistent weight system. Recommendation: Reserve `font-bold` for H1/eyebrow emphasis; use `font-semibold` for H2/H3 and UI labels.

### Line Height / Leading

- Body copy in sections uses default leading
- Assessment form labels use `leading-relaxed` inconsistently
- No explicit leading tokens defined

**Gap**: Minor but affects readability. Add `leading-relaxed` to all paragraph/description text blocks.

---

## 3. Button System

### Current Button Variants in Use

| Variant | Example | Class |
|---------|---------|-------|
| Primary | "Run Free Assessment" | `bg-gold py-3 text-sm font-semibold text-white hover:bg-gold-dark` |
| Primary small | Nav "Get Assessment" | `bg-gold px-4 py-1.5 text-white text-xs font-medium rounded-md` |
| Ghost/text | "See How It Works" | `text-gold border border-gold/30 px-6 py-3 rounded-lg` |
| Dark primary | Login "Send magic link" | `px-4 py-2 bg-gray-900 text-white text-sm rounded` |

**Gaps**:

1. **Login button uses `bg-gray-900`** — off-brand, should be `bg-gold` or `bg-navy-dark`
2. **Button corner radius inconsistency**: primary uses `rounded-lg`, login uses `rounded`, nav badge uses `rounded-md` — three different radii for conceptually similar components
3. **No disabled state definition** — disabled buttons use `opacity-50` which works but is not documented as a pattern
4. **No outlined/ghost variant on navy backgrounds** — the hero secondary CTA uses a custom border treatment that isn't reusable
5. **No size scale** — `text-xs`, `text-sm`, `text-base` are all used for button text without a defined SM/MD/LG scale

**Recommendation**: Define three button variants with a standard size scale:
```
primary: bg-gold text-white rounded-lg [S: px-3 py-1.5 text-xs | M: px-5 py-2.5 text-sm | L: px-6 py-3 text-sm]
secondary: border border-gold text-gold rounded-lg (same size scale)
ghost: text-gold underline (inline text link)
```

---

## 4. Card System

### Current Card Variants

| Card Type | Component | Style |
|-----------|-----------|-------|
| Service tier card | `Services.tsx` | `bg-navy-light border border-white/10 rounded-xl` |
| Why Us feature card | `WhyUs.tsx` | `bg-navy-light/50 rounded-xl` |
| Challenge problem card | `Challenge.tsx` | `bg-navy-light border border-white/5 rounded-xl` |
| VendorReadinessCard | `VendorReadinessCard.tsx` | `bg-navy-light border border-white/10 rounded-2xl` |
| Tender result card | `AssessmentResults.tsx` | `border border-white/10 rounded-xl` |
| Grant result card | `AssessmentResults.tsx` | `border border-white/10 rounded-xl` |

**Gaps**:

1. **Border opacity varies**: `border-white/5`, `border-white/10` across similar cards — not intentional differentiation
2. **VendorReadinessCard uses `rounded-2xl`** while all others use `rounded-xl` — subtle but inconsistent
3. **Background opacity varies**: `bg-navy-light`, `bg-navy-light/50` — inconsistent without documented reason
4. **No card hover state** — tier cards and result cards are visually static; no affordance for interactivity
5. **No card shadow system** — all elevation is communicated through borders and opacity, not shadows. Subtle shadows would add depth.

**Recommendation**: Standardize on:
- Base card: `bg-navy-light border border-white/10 rounded-xl`
- Elevated card: same + `shadow-lg shadow-black/20`
- Interactive card: base + `hover:border-gold/30 hover:bg-navy-light/80 transition-colors cursor-pointer`

---

## 5. Spacing System

### Section Padding

| Section | Top/Bottom Padding | Desktop | Mobile |
|---------|--------------------|---------|--------|
| Hero | `py-20 sm:py-28` | 112px | 80px |
| Challenge | `py-20 lg:py-24` | 96px | 80px |
| HowItWorks | `py-20 lg:py-24` | 96px | 80px |
| Services | `py-20 lg:py-28` | 112px | 80px |
| WhyUs | `py-20` | 80px | 80px |
| CTA | `py-20 lg:py-24` | 96px | 80px |

**Assessment**: Section padding is reasonably consistent (80–112px range). No critical gaps here, though a design token (`--section-padding`) would lock this in.

### Internal Component Spacing

- Card padding: `p-6`, `p-8` mixed without clear rule
- Form field gap: `space-y-5` (assessment) — good
- Form label-to-input: `mb-1` — tight, could be `mb-1.5` for more breathing room
- Gap between heading and subheading: `mb-2`, `mb-3`, `mb-4` — inconsistent

---

## 6. Icon System

**Gaps**:

1. **No icon library defined** — all icons are inline SVG `<path>` elements hand-coded throughout components
2. **Inconsistent icon sizing**: `w-4 h-4`, `w-5 h-5`, `w-6 h-6`, `w-8 h-8` used without a scale
3. **No icon color system** — icons use `text-gold`, `text-green`, `text-gray-400` without a semantic color rule (e.g., "action icons = gold, status icons = green/red")
4. **Checkmark SVG duplicated**: the same `M5 13l4 4L19 7` path is written multiple times across Navbar, assessment form checkboxes, progress indicators, and assessment results — should be a `<CheckIcon />` component

**Recommendation**: Extract a small icon component set (CheckIcon, ChevronIcon, ExternalLinkIcon) to eliminate duplication. Establish icon size scale: 14px (inline), 16px (UI), 20px (card feature), 24px (section feature).

---

## 7. Form Element System

| Element | Current Style | Gap |
|---------|--------------|-----|
| Text input | `rounded-lg bg-navy-light border border-white/10 px-4 py-2.5 focus:border-gold` | Good — consistent across assessment form |
| Checkbox | `w-3.5 h-3.5 rounded border-white/20 bg-navy text-gold focus:ring-gold` | Fine on assessment; login has no styled checkboxes |
| Button (form submit) | `bg-gold py-3 text-sm font-semibold` | Good |
| Login inputs | `border rounded px-3 py-2 text-sm` | **No design system tokens** — plain gray Tailwind defaults |
| Error state | `focus:border-red` | No definition — only `focus:border-gold` defined |

**Gap**: The login form completely bypasses the design system. All inputs must inherit the same `bg-navy-light border border-white/10` treatment as the assessment form.

---

## 8. Premium Feel Gaps

The overall aesthetic is clean and functional but lacks the "we are the premium option in this space" signal. Specific gaps:

| Gap | Description | Fix |
|-----|-------------|-----|
| No micro-animations | Sections, cards, and CTAs appear instantly — no entrance animations | Add `fade-in-up` on scroll for section headings and cards |
| No gradient accents | The gold token is flat — no gradient highlights to add depth | Add subtle `from-gold to-gold-light` on hero eyebrow or key badge |
| No background texture | Navy backgrounds are flat solid — reference uses subtle noise/grain | Add 2–3% opacity noise texture overlay on navy sections |
| Static progress indicators | Assessment loading spinner is basic `border-t-gold` CSS | Add a more polished multi-step progress treatment |
| No hover depth on cards | Cards don't respond to hover with elevation/light | Add `hover:shadow-md hover:shadow-gold/5` to interactive cards |
| Font rendering | No explicit `-webkit-font-smoothing: antialiased` | Add to body in globals.css for crisper rendering on Mac/retina |

---

## Summary of Design System Gaps

| Category | Critical | Major | Minor |
|----------|----------|-------|-------|
| Color | 1 (error red) | 1 (login off-brand) | 2 |
| Typography | 0 | 2 (heading scale, weight) | 2 |
| Buttons | 1 (login btn) | 2 (radius, variants) | 2 |
| Cards | 0 | 1 (hover state) | 3 |
| Spacing | 0 | 0 | 3 |
| Icons | 0 | 1 (duplication) | 2 |
| Forms | 1 (login form) | 0 | 2 |
| Premium feel | 0 | 0 | 6 |

The system has a solid foundation. The most impactful single fix is the login page — applying the existing navy/gold token system there would immediately close the biggest visual gap.
