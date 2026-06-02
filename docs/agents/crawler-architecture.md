# Tenderpath Crawler Architecture

## Current shape

Tenderpath already has a multi-source crawler system with source-specific crawler files, a sync orchestrator, dedup logic, link verification, and a Cloudflare Browser Rendering worker. The main product problem is not absence of crawling, but uneven crawl quality, source gaps, blocking resilience, and downstream field completeness.

## Goals

- Maximize direct primary-source coverage.
- Reduce field sparsity, especially `description`, `sector`, and normalized deadlines.
- Make UNGM reliable despite Cloudflare challenges.
- Keep cross-posted tenders deduplicated without losing the strongest source URL.
- Make crawler health visible to operations.

## Source strategy

### Canonical sources
Use direct procurement sources as canonical whenever available:
- UNGM
- UNDP / UNDP Atlas
- ReliefWeb
- SAM.gov / DOS-type direct sources
- TED EU
- UK FTS
- World Bank / MDB portals
- GIZ
- ADB
- IsDB (Islamic Development Bank project procurement — MENA / Muslim-majority coverage; distinct from the Inter-American IDB)
- EBRD
- UNRWA
- NRC, AFD, KfW, JICA, ADA (recommended additions)

### Aggregators
Treat aggregators like Devex as market-intelligence signals, not the primary source of truth. If Devex points to a source already crawled directly, prefer the direct source record and use the aggregator only for discovery, not storage.

## Worker strategy

Use `workers/crawler-browser/` whenever:
- a source is Cloudflare-protected,
- a page is JS-rendered,
- direct fetch returns challenge HTML,
- or a fetch returns structurally thin content despite the page being known to have listings.

The worker should support:
- user-agent rotation,
- anti-bot warmup,
- `navigate` mode for SPAs,
- batch mode for paginated runs,
- health endpoint,
- longer retry profile for UNGM fallback.

## Parsing standards

Each crawler should:
- return `CrawlResult` even on partial success,
- never fail the whole run because one field is missing,
- normalize obvious values early,
- enrich `description` when source listing text is too thin,
- map sector via shared mapping or source-specific augmentation,
- preserve the most direct `source_url` possible.

## Dedup principles

Dedup should happen across overlapping sources using normalized title + agency + deadline or a stronger equivalent. When duplicates exist:
- keep the best primary source URL,
- preserve richer descriptions,
- preserve source provenance for ranking/debugging,
- avoid duplicate end-user cards.

## Operational observability

Add or maintain:
- source-level crawl logs,
- tenders added / updated counts,
- failure reason summaries,
- worker health endpoint,
- stale-link verification,
- optional admin API for last 7 days by platform.

## Recommended next implementation tasks

1. Harden UNGM worker flow.
2. Add direct missing sources that Devex mirrors.
3. Backfill description enrichment.
4. Improve sector mapping coverage.
5. Add crawl-health admin route.
