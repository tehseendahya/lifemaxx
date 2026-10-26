## What and why

<!-- One concern per PR. What changed, and why, in a few lines. -->

## How I verified it

- [ ] `DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'`
- [ ] `npx tsc --noEmit` (root)
- [ ] `cd mobile && npx tsc --noEmit && npx vitest run`
- [ ] `cd mobile && npx expo export --platform ios --output-dir /tmp/lifemaxx-ios`
- [ ] `npm run build` (or `cd mobile && npx expo export --platform web --output-dir /tmp/lifemaxx-web`)
- [ ] Looked at it on a preview or locally, **read-only** (the preview uses the production DB)
- [ ] No test data written to production, no secrets committed

## Migration?

- [ ] No
- [ ] Yes: `drizzle/NNNN_*.sql` plus a `_journal.json` entry with a higher `when`. It's additive, and it runs on the production deploy only.

## Touches

- [ ] Phone (ships through EAS Update on merge)
- [ ] Laptop web
- [ ] Backend / API only
