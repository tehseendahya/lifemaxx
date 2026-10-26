# lifemaxx: orientation for Claude sessions

Personal health tracker with an AI coach: lifting (live set logging), meals
(photo to macros), runs (Strava / Health Auto Export), bodyweight and TDEE.
Two people and many concurrent Claude sessions change this repo at once. Read
this whole file before you edit anything. Client-specific notes are in
`mobile/CLAUDE.md`, and the mobile vs web split (with a diagram) is at the top
of `README.md`.

## Repo map

- **`mobile/`** is the **only UI**. One Expo (SDK 58, expo-router) app serves
  the phone (Expo Go) and the laptop (Expo web, from the same Vercel URL as
  the API). It is a separate npm project with its own `node_modules`, lockfile
  and React version.
- **Root (Next.js 15)** is **backend only**: `src/app/api/*`, plus
  `/auth/callback` and `/reset-password`, which password-reset emails need. Do
  not add pages or UI components here.
  - `src/lib/domain/*` is pure logic: units, e1RM, progression, muscles, TDEE,
    readiness, running. `src/lib/outbox/queue.ts` holds the offline-queue
    rules. **Both are shared with the client.** `mobile/lib/shared/*.ts` are
    one-line re-exports of them. Change the logic in `src/lib`, never fork a
    copy into `mobile/`.
  - `src/lib/llm/*` holds the OpenAI provider, prompts, the shorthand set
    parser and contract tests. `src/lib/models.ts` maps each route to one model.
  - `src/db/schema.ts` is the Drizzle schema. `drizzle/NNNN_*.sql` are the
    migrations, applied by `scripts/migrate.ts`.
  - `src/app/api/mobile/*` is the pattern for bearer-token (client) routes.
- **Build:** root `npm run build` exports the client (`expo export --platform
  web`) into root `public/`, then runs `next build`. Root `public/` is
  generated output, so don't edit it. Static web assets live in `mobile/public/`.
- `docs/SPEC.md` is the product spec. `docs/BACKEND.md` covers backend setup and
  operations (Strava, push, RLS, cron). `docs/history/` is superseded plans.
  Read them for context only.

## Product constraints (standing; do not relitigate)

- **Meal photos are never persisted.** They're analysed in memory and
  discarded: no storage bucket, no thumbnail, no temp file left behind. The
  phone uses the camera, the web uses a file picker, and both take the same
  resize, encode and discard path.
- **Display lb, store kg.** Convert once, at the edge, with
  `src/lib/domain/units.ts`.
- **Cheap, fast OpenAI models by default.** Bump one route in
  `src/lib/models.ts` only on evidence. Don't guess model ids.
- **No training split or program object.** The app ranks muscles by volume
  debt (muscle-debt ranking) and the user decides at the gym.
- **Never commit secrets.** `.env*` files are gitignored, and `.env.example`
  files hold names only. The Supabase anon key is fine in a client, but a
  service-role key never is.
- **Expo Go only.** Use no native module beyond what Expo Go ships for SDK 58:
  no `expo prebuild`, no config plugin with native code, no dev client. Install
  with `npx expo install` so versions match the SDK. If a package bundles but is
  missing from Expo Go, the result is a red screen on the phone.

## Verify before every PR (run all that apply)

```bash
# Root. DATABASE_URL= is mandatory: .env.local points at PRODUCTION.
DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'
npx tsc --noEmit

# Client (needs root `npm install` too: its tsc resolves drizzle-orm from root node_modules)
cd mobile && npx tsc --noEmit && npx vitest run

# The iOS bundle must still build: this is the Expo Go gate
cd mobile && npx expo export --platform ios --output-dir /tmp/lifemaxx-ios

# Laptop web + backend
npm run build
```

Never run the root tests without `DATABASE_URL=`. CI (`.github/workflows/ci.yml`)
runs all of these on every PR, and a red CI blocks merging. Don't change test
assertions to get green unless the behaviour change is the point of the PR.

## Production database: safety rules

- **There is one database, production, and everyone uses it:** local dev, every
  Claude session, Vercel previews. That was the owner's call.
- **Never write test data to it.** Don't sign up test accounts, log fake sets or
  meals, or run `db:seed`, `db:seed:demo`, `dev:setup`, `strava:verify` or
  `db:verify` with the production URL. Verify with tests, the typecheck, the
  exports and read-only browsing.
- **Never run `npm run db:migrate` (or `db:push`) yourself.** Migrations apply
  automatically when a **production** deploy builds (`VERCEL_ENV=production`),
  and never on preview builds. That way an unmerged branch's migration can't
  land.
- **Schema change = a new migration file, nothing else.** Hand-write
  `drizzle/NNNN_name.sql` and append an entry to `drizzle/meta/_journal.json`
  (next `idx`, the same `tag`, and a `when` **strictly greater** than the last
  entry's, or the migrator silently skips it). Update `src/db/schema.ts` to
  match. Don't use `drizzle-kit generate` or `push`: the snapshot is stale, and
  push skips RLS and extensions. Never edit a migration that has merged.
- **Keep migrations additive.** Add nullable or defaulted columns and new
  tables. The old code serves while the new deploy builds, and the phone may run
  an older bundle. If two open PRs both add `0006_*`, whichever merges second
  renumbers to `0007` and bumps `when`.
- Every table has RLS. Request code runs through `withUser()`, and cross-user
  jobs use `adminDb`. Keep it that way (see `docs/BACKEND.md`).

## Working alongside other sessions

- **Always branch and open a PR. Never push to `main`.** Name branches by
  intent, e.g. `claude/food-upload-photo`.
- **Keep each PR small and limited to one concern.** Don't reformat, reorder
  imports or "tidy" files your change doesn't need. Unrelated churn causes
  merge conflicts in other sessions.
- **Rebase on `origin/main` before you push the final version**, and again if
  main moved while CI ran. Re-run the verify commands after rebasing.
- Merge only with CI green. Squash-merge is fine.
- Don't commit generated or local files: `public/` build output,
  `mobile/.expo/`, `dist/`, `.env*`, scratch scripts (`scripts/zz-*.ts`).
- If another session's PR touches the same files, rebase onto it after it
  merges rather than duplicating the change.
- Use the PR template: what and why, how you verified it, whether there's a
  migration, and whether it touches phone or web.

## How shipping works

1. Merge the PR to `main`.
2. Vercel deploys production: the backend plus the laptop web build. The
   production build applies pending migrations first.
3. If the merge touched `mobile/**` or `src/lib/**`,
   `.github/workflows/eas-update.yml` publishes an **EAS Update** to branch
   `main` (`--environment production`). The phone gets it when Expo Go is fully
   closed and reopened.
4. Every PR also gets a Vercel preview URL (web plus API). **The preview uses
   the production DB**, so browse it read-only. Its migrations have not run.

The published app's `EXPO_PUBLIC_*` values come from the EAS `production`
environment, not from `mobile/.env`. `app.json`'s
`runtimeVersion: { policy: "sdkVersion" }` must stay exactly that, or Expo Go
silently stops loading updates.

## Gotchas

- **Expo typed routes** (`mobile/.expo/types`) regenerate only when `npx expo
  start` runs. If `tsc` rejects a route you just added, or a stale route, run
  `npx expo start` once (or delete `mobile/.expo/types`).
- **Two React versions:** the root uses Next's, `mobile/` uses React Native's.
  Never import from the root `node_modules` in `mobile/`, and never add client
  deps to the root `package.json` (or the reverse). `metro.config.js` blocks
  the root `node_modules`. Leave that alone, and don't add
  `disableHierarchicalLookup`.
- **Env loading:** `load-env.ts` uses dotenv with `override: false`. A real
  env var beats `.env.local`, which beats `.env`. That's why
  `DATABASE_URL= ...` works to blank out production.
- **API errors:** a bare `throw new Error()` inside `route()`
  (`src/lib/api.ts`) becomes a **500**. Throw `HttpError(msg, 400)` for caller
  mistakes.
- **The outbox retries 5xx, 408, 429, 401, 403 and network errors, and drops
  every other 4xx** (`classifyStatus` in `src/lib/outbox/queue.ts`). A wrong
  500 makes a client retry a bad payload forever, and a wrong 400 throws away a
  real set. Pick the status deliberately.
- `*.db.test.ts` needs a real (non-production) Postgres and skips without
  `DATABASE_URL`.
- `lifemaxx.vercel.app` is someone else's project. Production is
  `lifemaxx-tehseendahyas-projects.vercel.app`.
