# Legal / Policy Audit — TenderPath

_Produced by three-agent review (UX/UI · Legal/Policy · Ops). April 2025._

---

## 1. Current state (as-found)

### Footer / Resources links
- **Product column:** Free Assessment (`/assessment`), Tender Matching (`#`), Readiness Report (`#`), Pricing (`#`)
- **Resources column:** UN Procurement Guide (`#`), UNGM Registration (`#`), Blog (`#`), FAQ (`/faq`)
- **Company column:** About (`#`), Contact (`/contact`), Privacy Policy (`#` — dead), Terms of Service (`#` — dead)
- **Legal bottom bar:** none existed

### Help widget / question-mark launcher (SupportWidget)
- Custom question-mark button, lower-right, fixed position, present on all pages via root layout.
- Expands to show: Email Support, Book a Free Call, Browse FAQ, WhatsApp.
- **"MENA region support" wording appeared** in two places:
  - `src/components/SupportWidget.tsx` → WhatsApp entry subtitle
  - `src/app/contact/page.tsx` → WhatsApp note
  - **Fixed in this session** → changed to "Quick questions via WhatsApp"
- No third-party chat integration (no Intercom, Crisp, Drift). Fully custom component.

### Existing legal / policy pages
| Page | Status |
|------|--------|
| Terms of Service | Did not exist — link was dead (`#`) |
| Privacy Policy | Did not exist — link was dead (`#`) |
| Cookie Policy | Did not exist |
| Disclaimer | Did not exist |
| Security / Vulnerability Reporting | Did not exist |
| Contact | Existed at `/contact` |
| FAQ | Existed at `/faq` |

---

## 2. Data collection inventory

### Personal data collected (by feature)

| Feature | Data |
|---------|------|
| Signup / magic link | Email, name (optional) |
| Assessment wizard | Company name, website URL, business description, sectors, operating countries |
| Assessment results | AI-generated profile, readiness scores, matched tenders, capability extracts |
| Tender feedback | Per-tender status (saved / not relevant / in progress / applied) |
| Document vault | User-uploaded files (PDF, Word, Excel, image — up to 10 MB) |
| Payments | Subscription records, Stripe session IDs (card data stays with Stripe) |
| Auth | Magic-link tokens (30-min TTL), `tp_session` JWT in httpOnly cookie |
| Server logs | IP addresses, request metadata |

### Third-party services processing user data

| Service | Data involved | Notes |
|---------|--------------|-------|
| Vercel | All traffic | Hosting provider |
| Vercel Blob | Vault documents | Object storage |
| Neon / Vercel Postgres | All user & product data | Primary DB |
| Resend | Email address, email content | Transactional emails |
| Stripe | Payment & billing data | Card data never reaches TenderPath servers |
| Cloudflare | Company website URLs during assessment crawl | Browser rendering worker |
| Google Fonts | IP address (font load requests) | Via next/font/google |

### Analytics / tracking tools
- **None found.** No PostHog, Mixpanel, Google Analytics, Sentry, Hotjar, or similar in the codebase.
- This simplifies the cookie policy significantly.

### Cookies set
- `tp_session` — httpOnly JWT, authentication only (strictly necessary)
- No marketing, analytics, or preference cookies.

---

## 3. Resources / Legal IA (UX/UI decision)

### Chosen structure
Legal links are surfaced in two places:

**Footer bottom bar** (visible on landing page):
Privacy Policy · Terms · Cookie Policy · Disclaimer · Security

**Footer "Company" column** (landing page):
About · Contact · Disclaimer · Security

**LegalShell footer** (visible on all legal pages):
Privacy Policy · Terms · Cookie Policy · Disclaimer · Security · Contact

**Contact page and SupportWidget** — already link to `/contact` and `/faq`. No changes to these flows beyond the MENA wording fix.

### Design rationale
- No visual redesign. Uses the same nav/footer shell pattern as `/contact`.
- Legal pages share `src/components/LegalShell.tsx` for consistency.
- Bottom legal bar in the landing footer follows standard SaaS footer convention.
- Pages are dark-nav / white-body, consistent with `/contact` and `/faq`.

---

## 4. Pages created

| Route | File |
|-------|------|
| `/privacy` | `src/app/privacy/page.tsx` |
| `/terms` | `src/app/terms/page.tsx` |
| `/cookie-policy` | `src/app/cookie-policy/page.tsx` |
| `/disclaimer` | `src/app/disclaimer/page.tsx` |
| `/security` | `src/app/security/page.tsx` |

Shared shell: `src/components/LegalShell.tsx`

---

## 5. Lawyer review checklist

The following items contain `[PLACEHOLDER]` markers in the page source and **must be resolved with legal counsel before publishing**:

- [ ] **Legal entity name and registered address** — appears in Privacy Policy §1, Terms §1. Required for enforceable policies.
- [ ] **Governing jurisdiction and applicable law** — Terms §12. Determines which data-protection regime applies (GDPR, PDPL, local law).
- [ ] **Sub-processor list** — Privacy Policy §3. Confirm the table is complete. Check whether any additional services (CDN, monitoring, error tracking) have been added since this audit.
- [ ] **Data retention windows** — Privacy Policy §4. Define specific periods for: account data, assessment data, vault documents, server logs. Define post-account-closure deletion timelines.
- [ ] **User rights language** — Privacy Policy §5. GDPR / other-regime rights (access, erasure, portability, objection) depend on jurisdiction.
- [ ] **Refund and subscription cancellation policy** — Terms §6. Define before Stripe subscriptions go live.
- [ ] **Trial period terms** — Terms §5. Confirm duration and what happens at trial end.
- [ ] **Account deletion timeline** — Terms §10. Define how long data is retained after account closure.
- [ ] **Liability cap** — Terms §9. Jurisdiction-specific; confirm amount or exclusion with counsel.
- [ ] **Security response SLA** — Security page. Define acknowledgement and response time targets.
- [ ] **Bug bounty programme** — Security page. Confirm if planned.
- [ ] **DPA (Data Processing Agreement)** — if handling EU personal data, consider whether a DPA is needed with sub-processors.
- [ ] **Cookie consent banner** — currently not required (no non-essential cookies). Re-evaluate if analytics are added.
- [ ] **`tp_session` cookie expiry** — confirm actual expiry duration to document accurately in Cookie Policy.

---

## 6. Ops observations (non-blocking for legal pages)

- No analytics tool is currently integrated. Before adding one (PostHog, Sentry, etc.), update the Privacy Policy and Cookie Policy.
- WhatsApp link `https://wa.me/message/tenderpath` — confirm this resolves to the correct business account before launch.
- "Book a Free Call" links go to a mailto, not a booking system — acceptable short-term; update copy if a calendar tool (Calendly, etc.) is added.
- Support hours claim "Mon–Fri, 9am–5pm GMT" exists on the contact page — confirm this is operationally accurate.
