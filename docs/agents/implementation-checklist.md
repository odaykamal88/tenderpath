# Tenderpath Implementation Checklist

## Files to add to repo

- `AGENTS.md` (replace existing minimal version, preserve Next.js warning block)
- `CLAUDE.md` (small update)
- `docs/agents/managed-agents-setup.md`
- `docs/agents/crawler-architecture.md`
- `docs/agents/assessment-architecture.md`
- `docs/agents/dashboard-architecture.md`
- `docs/agents/claude-code-prompts.md`

## First rollout order

1. Commit docs only.
2. Create Managed Agents in Claude platform using `managed-agents-setup.md`.
3. Run Prompt 1 in Claude Code to align repo docs.
4. Run Prompt 2 for UNGM + worker hardening.
5. Run Prompt 3 for direct-source expansion.
6. Run Prompt 4 for website crawl fidelity.
7. Run Prompt 5 for persisted match quality.
8. Run Prompt 6 for dashboard workflow improvements.

## Notes

- Keep Managed Agents as warehoused role definitions.
- Keep repo docs as the implementation truth Claude Code reads locally.
- Prefer direct sources over aggregator copies.
- Fix crawl fidelity before changing matching or UI.
