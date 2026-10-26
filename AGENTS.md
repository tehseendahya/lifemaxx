# Agents: start here

This repo's rules for AI coding agents live in [`CLAUDE.md`](CLAUDE.md) (and
[`mobile/CLAUDE.md`](mobile/CLAUDE.md) for the client). The mobile vs web split
is explained at the top of [`README.md`](README.md). Read all three before
changing anything. They apply to every agent, not just Claude.

The short version:
- `mobile/` is the only UI (phone and laptop). The repo root is backend only.
- The database is shared production. Never write test data or run migrations yourself.
- Root tests: `DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'`.
- Branch + PR, never push to `main`. CI must pass.
