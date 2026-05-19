# Bilateral donor coverage — 2026-05-19

**Trigger:** launch audit 2026-05-19 P1 #8 — Persona 3 (Mada Women Cooperative,
Jordan) asked for "MENA bilateral donor grants" matching but saw zero
bilaterals in the top six results. Persona 1 (Kenya) saw US State + EU
bilaterals in the matched set. Audit asked: is the matching corpus
consistently indexing the major MENA bilateral donors?

**Methodology:** static inventory of `src/lib/crawlers/*.ts` against
`src/lib/crawlers/sync.ts` `activeCrawls` list. Cannot run
[scripts/_assessment-country-diag.ts](../../scripts/_assessment-country-diag.ts)
against prod from this audit pass; recommend running it next to confirm
indexed-tender counts per source per country.

**Companion code change:** [src/lib/assessment/match.ts](../../src/lib/assessment/match.ts)
in PR-5 gates regional-geo adjacency behind an explicit opt-in (audit P1 #6).
This means a Jordan user will no longer silently see Iraq/Egypt tenders as
"strict" matches — the gap report below describes the bilateral coverage they
SHOULD be seeing instead, where the gaps are, and which crawlers to land first.

## Active bilateral / institutional sources

Wired in [src/lib/crawlers/sync.ts](../../src/lib/crawlers/sync.ts):

| Source | Donor type | Geographic scope | Notes |
|---|---|---|---|
| `crawlAFD` ([afd.ts](../../src/lib/crawlers/afd.ts)) | French bilateral (AFD) | French institutional procurement only via BOAMP | **Does NOT cover project-financed development tenders.** AFD-Jordan project tenders are published through borrower-country procurement portals, not BOAMP. |
| `crawlKfW` ([kfw.ts](../../src/lib/crawlers/kfw.ts)) | German bilateral (KfW) | 60+ developing countries via GTAI aggregator | Covers project-financed procurement, so should surface KfW-Jordan. |
| `crawlGIZ` ([giz.ts](../../src/lib/crawlers/giz.ts)) | German bilateral (GIZ, ~€3B/yr) | German eVergabe institutional portal | Covers GIZ headquarters/Germany procurement; need to verify field-office Jordan tenders. |
| `crawlADA` ([ada.ts](../../src/lib/crawlers/ada.ts)) | Austrian bilateral (ADA) | entwicklung.at calls page, single page | Very low volume (3-15 active). |
| `crawlJICA` ([jica.ts](../../src/lib/crawlers/jica.ts)) | Japanese bilateral (JICA) | English listing returns 404; Japanese-only | **Disabled** in SESSION.md Sprint 23 — real listing is Japanese-only with PDF-only details. |
| `crawlTED` ([ted-eu.ts](../../src/lib/crawlers/ted-eu.ts)) | EU institutions / EuropeAid / EU Delegations / EU member-state | Pan-EU + EU-financed third-country procurement | Covers EU-Jordan tenders (e.g. EuropeAid CSO calls). |
| `crawlUKFTS` ([uk-fts.ts](../../src/lib/crawlers/uk-fts.ts)) | UK (incl. FCDO) | UK procurement portal | **Gated by [source-rules.ts](../../src/lib/assessment/source-rules.ts)** to UK-country users only — Jordan users currently never see FCDO-Jordan opportunities through this source. |
| `crawlSAMGov` ([sam-gov.ts](../../src/lib/crawlers/sam-gov.ts)) | US Federal (incl. State Dept post-USAID dissolution, DFC) | US Federal contract opportunities | **Gated by source-rules.ts** to US-country users only — Jordan users currently never see USAID-Jordan/State-Jordan opportunities through this source. |
| `crawlNRC` ([nrc.ts](../../src/lib/crawlers/nrc.ts)) | NGO (Norwegian Refugee Council) | nrc.no/procurement, ~10-30 active | Not strictly bilateral; included for adjacency. |

Multilateral / regional development bank crawlers also active: World Bank
([world-bank.ts](../../src/lib/crawlers/world-bank.ts)), IDB
([idb.ts](../../src/lib/crawlers/idb.ts)), DevelopmentAid NPO feed
([developmentaid-npo.ts](../../src/lib/crawlers/developmentaid-npo.ts)).
Blocked-by-default behind `ENABLE_BLOCKED_CRAWLERS`: ADB, AfDB, EBRD.

UN/multilateral covered separately via UNGM, UNDP, UNDP Atlas, ReliefWeb.

## Audit-named bilateral donors and their status for Persona 3 (Jordan)

| Donor (audit-named) | Crawler exists? | Reaches a Jordan user today? | Why |
|---|---|---|---|
| **USAID-Jordan** | Yes (via `crawlSAMGov` — USAID/State absorbed) | **No** | `sam.gov` rule in [source-rules.ts:28-37](../../src/lib/assessment/source-rules.ts:28) requires US in country set; Jordan user has no US in country set so the rule filters all SAM.gov tenders out. |
| **GIZ-Jordan** | Yes (`crawlGIZ`) | Partially | GIZ portal is the German institutional procurement system. Some GIZ field-office Jordan tenders flow through it, but quality depends on whether GIZ publishes country-specific notices to eVergabe vs to local Jordan procurement systems. Needs prod diag verification. |
| **EU-Jordan** | Yes (`crawlTED`) | Yes | TED covers EuropeAid and EU Delegations. EU-Jordan civil-society and humanitarian calls should surface. |
| **AFD-Jordan** | Yes (`crawlAFD`) — but wrong scope | **No** | AFD crawler is institutional procurement only (BOAMP). AFD's project-financed tenders for Jordan (water/transport/energy) are NOT covered. Per the AFD module docstring: "this does NOT cover AFD's project-financed development tenders, which are published through borrower country procurement portals." |
| **FCDO-Jordan** | Yes (via `crawlUKFTS`) | **No** | `find-tender.service.gov.uk` rule in [source-rules.ts:38-42](../../src/lib/assessment/source-rules.ts:38) requires UK in country set; Jordan user has no UK in country set so the rule filters all UK FTS tenders out. The rule comment says "local UK councils out of ICP scope (Sprint 4)" — designed for the council-noise case, but it also gates legitimate FCDO development tenders. |

**Headline finding:** Of the five audit-named donors, only EU-Jordan reliably
reaches Persona 3 with the current corpus. USAID-Jordan and FCDO-Jordan are
filtered out by overcoercive source-rules. AFD-Jordan is not crawled at the
right surface. GIZ-Jordan is partial and unverified.

## Recommended follow-up tickets (Sprint 25 backlog)

1. **Loosen source-rules.ts for development-aid sub-portals** — split SAM.gov
   and UK FTS into two rules each: (a) keep US/UK-country gating for
   pure-domestic noise, (b) carve out a development-aid lane that surfaces
   USAID (org code 7200), State Dept dev solicitations, FCDO-Jordan/Lebanon/etc.
   regardless of user country. Audit confirmed this is exactly the "MENA
   bilateral donor matching" Persona 3 expected.
2. **AFD project tenders crawler** — replace or augment the BOAMP-only AFD
   crawler with a borrower-country portal scraper for AFD's top recipients
   (Jordan, Tunisia, Morocco, Senegal, Vietnam, Ivory Coast). Likely needs
   country-by-country implementation given each borrower-country uses its own
   procurement portal. Sized at 2-3 sprints.
3. **GIZ field-office verification** — run [scripts/_assessment-country-diag.ts](../../scripts/_assessment-country-diag.ts)
   against a Jordan-typed assessment to count actual GIZ-Jordan notices in
   the indexed corpus; if zero, GIZ crawler needs a sibling for field-office
   notices.
4. **JICA re-enable** — current crawler is disabled because the English
   listing 404s. Re-enable with a Japanese-language scraper + machine
   translation on the PDF notice text, OR scope it down to JICA's
   country-office English notice boards (e.g. JICA-Jordan posts in English).
5. **Add EU-Jordan eligibility check** — even when TED surfaces a EuropeAid
   call, MENA NGOs often need PADOR registration. The crawler doesn't emit
   PADOR-required signal today; consider adding to `RawTender` requirements.

## Verification handback

Before any of these tickets land, run:

```bash
DATABASE_URL=<prod-neon-url> npx tsx scripts/_assessment-country-diag.ts <assessment-id>
```

against a representative Jordan assessment (e.g. the Mada Women Cooperative
test row referenced in the audit walkthrough). Confirm:

- Per-source tender count per `countries` value
- Which named donors actually appear in `matched_tenders`
- Whether `source-rules.ts` is filtering out donors that the audit expected
  to see
