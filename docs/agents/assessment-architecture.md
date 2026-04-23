# Tenderpath Assessment Architecture

## Purpose

The assessment system should answer three questions well:
1. What does this company actually do?
2. How procurement-ready is it?
3. Which tenders are relevant, and why?

## Current risk areas

- Static fetch may misread SPA websites.
- Redirect chains can send the crawler to the wrong base domain.
- Low-value pages can dominate the crawl context.
- Thin or wrong sites still flow into analysis.
- Matching quality depends heavily on sparse crawler fields.

## Desired crawl behavior

The website crawler should:
- normalize and resolve the final URL,
- detect JS-rendered shells,
- use the browser worker for browser-rendered fallback,
- probe a broader subpath list,
- skip duplicate subpages or homepage mirrors,
- prioritize business-description paragraphs,
- label crawl confidence and render method,
- degrade safely when the site is parked, login-walled, or too thin.

## Analysis stages

### Stage 1: Company understanding
Extract:
- primary industry,
- sectors,
- services,
- delivery model,
- geographies,
- evidence snippets.

### Stage 2: Readiness analysis
Evaluate:
- technical capability,
- compliance readiness,
- financial stability,
- geographic reach,
- experience relevance,
- major gaps and next actions.

### Stage 3: Matching
Use the assessed company profile to match against tenders. Preferred long-term pattern:
- embeddings on tenders,
- embeddings on assessed company profile,
- cosine similarity retrieval,
- persisted top matches,
- user feedback loop (`not relevant`, `saved`, `applied`).

## Trust rules

- Never present speculative company capabilities as if they were confirmed.
- If the site is poor, invite or prioritize user-entered company description.
- Put the evidence closest to the UI: explain why the company was classified a certain way.
- Keep outputs useful even when confidence is low.

## Recommended next implementation tasks

1. Fix website crawl fidelity.
2. Add browser-rendered fallback.
3. Add final URL + render method fields.
4. Reorder extracted text toward business-description paragraphs.
5. Persist top tender matches and reasons.
