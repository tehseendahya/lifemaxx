# Backend: setup and operations

The Next.js app at the repo root is the backend. It serves `src/app/api/*`,
plus `/auth/callback` and `/reset-password` for password-reset emails, and it
hosts the laptop web build of the Expo client in `mobile/`. Most of this file
moved here from the old root README. Rules for day-to-day work are in
[`CLAUDE.md`](../CLAUDE.md).

> **The project database is production, and it's shared.** Every command below
> that writes (`db:migrate`, `db:seed`, `dev:setup`, `db:seed:demo`,
> `db:verify`, `strava:verify`) is for a **fresh or throwaway** database only:
> a new Supabase project, or the local Docker Postgres described below. Never
> point them at the production `DATABASE_URL`. Production migrations run
> automatically on production deploys.

## Standing up a new environment

Three things need real credentials. Without them the API runs in **offline
mode**: meals get plausible macros, and set parsing still works, because it's
a real parser rather than a stub.

```bash
npm install
cp .env.example .env.local
```

### 1. Database: Supabase

Create a project at [supabase.com](https://supabase.com). Then, from
**Project Settings**:

- **Database → Connection string → URI** goes in `DATABASE_URL`. Use the
  **pooler** URI on port 6543, not the direct connection.
- **API → Project URL** goes in `NEXT_PUBLIC_SUPABASE_URL`.
- **API → anon public key** goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Then, **against that new database only**:

```bash
npm run db:migrate  # applies drizzle/*.sql in order
npm run db:seed     # exercise catalogue with muscle mappings and aliases
npm run db:verify   # proves the database is set up correctly
```

`db:migrate` replaced `drizzle-kit push`. Push diffs `schema.ts` against the
live database and never reads the SQL folder, so `CREATE EXTENSION pg_trgm`
and every RLS policy were silently skipped. The first symptom was a runtime
`function similarity(text, text) does not exist` on the first mistyped exercise
name. `db:push` is now an alias for `db:migrate`.

The migrator decides what to apply by comparing each journal entry's `when`
with the newest applied migration's timestamp. **A new entry whose `when` is
not greater than the last one is silently skipped.**

**Run `db:verify` before you trust a new database.** It checks that pg_trgm is
live, that the generated e1RM column computes, that RLS is enabled with a
policy on every table, and that one user genuinely can't read another's rows
through the app's own query layer.

Under **Authentication → Providers → Email**, enable email/password sign-in
and add `<origin>/auth/callback` to the redirect allowlist.

### 2. OpenAI

Put your key in `OPENAI_API_KEY`. Without it, the app logs a warning and uses
the offline provider, and nothing crashes. To force offline mode even with a
key present, set `LLM_PROVIDER=fixtures`. Leave `OPENAI_TRANSCRIBE_MODEL`
blank until you have a real id. While it's blank, voice entry answers 503 and
typed entry is unaffected.

### 3. A throwaway local Postgres

```bash
docker run -d --name lifemaxx-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lifemaxx postgres:16
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lifemaxx npm run dev:setup
```

`dev:setup` migrates, seeds the catalogue and writes a month of demo data:
meals, six lift sessions with a real progression on bench, six runs, and
enough weigh-ins for the TDEE estimate to clear its 8-sample floor. It then
points `DEV_USER_ID` at that user. `DEV_USER_ID` authenticates every request
as that user. It does nothing unless the variable is set, and production
builds (`NODE_ENV=production`) switch it off entirely. The same `DATABASE_URL`
also makes `*.db.test.ts` run. They're the only tests that exercise RLS.

## Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build: exports the web client into `public/`, then runs `next build` (applies migrations first only when `VERCEL_ENV=production`) |
| `npm test` | **Use `DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'` instead** when `.env.local` points at production |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply `drizzle/*.sql` in order (fresh DBs only; production does this on deploy) |
| `npm run db:seed` | Load or refresh the exercise catalogue (idempotent) |
| `npm run dev:setup` | Migrate, seed, write demo data, set `DEV_USER_ID` (throwaway DB only) |
| `npm run db:seed:demo` | Rewrite just the demo user's data (throwaway DB only) |
| `npm run db:verify` | Check extensions, generated columns and RLS isolation (writes test users) |
| `npm run strava:verify` | Prove the nightly Strava pull is idempotent (writes rows) |
| `npm run push:verify` | Check VAPID keys and the push signing path (no DB) |
| `npm run llm:preflight` | Call the live OpenAI API once per route |
| `npm run runs:import` | Import a Strava account archive (writes your runs) |

## How the backend is put together

```
src/
  app/api/        route handlers; api/mobile/* is the bearer-token pattern
  db/             Drizzle schema, exercise catalogue, seed; withUser() / adminDb
  lib/
    domain/       pure logic, shared with the client via mobile/lib/shared
    llm/          provider interface, OpenAI + fixtures, prompts, shorthand
                  parser, and a contract-checking stand-in for the API
    outbox/       offline write queue rules (queue.ts is shared with the client)
    api.ts        route() wrapper, HttpError, jsonError
    models.ts     one constant per route: the model dial
drizzle/          hand-written SQL migrations + meta/_journal.json
scripts/          migrate, seed, and the verify/preflight commands
```

**The domain layer is pure and fully tested.** Progression, TDEE, muscle
accounting, readiness ranking and the running maths have no I/O. The outbox's
queue logic is written the same way, storage-agnostic, so the rules that
matter (deliver in order, stop at the first failure, retry only what retrying
can fix) are tested.

**The OpenAI layer has contract tests.** `src/lib/llm/__testing__/mock-openai.ts`
enforces the documented contract: the strict structured-outputs schema subset,
the vision content-part shape and the token parameter names. Refusals and
truncated completions are tested as first-class response shapes.

**Model selection lives in one file.** `src/lib/models.ts` maps each route to
a model. The default is the cheapest tier that does the job, and bumping a
route is a one-line change.

**Caching is prefix-shaped.** OpenAI caches automatically above about 1024
tokens, but only on an exact prefix match. So `lib/llm/context.ts` assembles
goals and history first and the question last, and `stableJson()` sorts keys.
Break that ordering and you silently pay full price for the whole session.

## Security

Every table has RLS enabled and a policy. Both paths enforce the same
predicate:

- **PostgREST.** Supabase serves every table in `public` at
  `https://<ref>.supabase.co/rest/v1`, and the anon key ships to every client.
  Policies scope `authenticated` by JWT, and `anon` has no table privileges at
  all.
- **The app.** It connects as `postgres` and drops to a `lifemaxx_app` role for
  each request's transaction, with the user id published as a GUC. So a
  forgotten `where user_id = ...` returns nothing rather than leaking. See
  `withUser()` in `src/db/index.ts`.

`postgres` still bypasses RLS, deliberately: migrations, the catalogue seed
and the cron jobs that iterate every user all need cross-user access. Those use
`adminDb`, named that way so it's obvious at the call site. OAuth refresh
tokens and push credentials aren't granted to the browser roles at all.

The client authenticates with Supabase email/password and sends
`Authorization: Bearer <jwt>`. The server verifies the token with Supabase and
the user id flows through `withUser()`.

## Integrations

**Runs: three ways in,** because every automatic one costs money.

As of June 2026 Strava requires an active subscription to create an API
application. Their API policy separately bars loading API-sourced data into a
language model's context, with Strava's own MCP Connector as the only
sanctioned route — worth knowing before pointing the coach at it, since asking
the coach about a run is most of the point. Data arriving through Apple Health
or the screenshot importer did not come from Strava's API and is outside that
policy.

- *With a subscription:* create an app at
  [strava.com/settings/api](https://www.strava.com/settings/api). The
  Authorization Callback Domain is the bare deployment domain. Set
  `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`, redeploy, then connect from
  **You → Connections** in the app (phone or laptop). The OAuth `state` is
  signed with `STRAVA_STATE_SECRET`, falling back to `CRON_SECRET`.
  Activities pull nightly.
- *Free, from the phone:* **Add a run from a screenshot** on the Running
  screen. A vision model reads the figures off a screenshot of the run and the
  confirmation sheet shows what will be stored; nothing is written until it is
  accepted, and the image is never persisted (same rule as meal photos).
  Rows land as provider `manual` under an id derived from the start minute, so
  re-importing the same screenshot updates in place rather than giving the week
  a run that never happened.

  The hazard this path is built around is the unit. Every running app prints a
  bare number beside a `mi` or `km`, and miles read as kilometres is a 61%
  error on every distance, pace and weekly total downstream. So the unit is its
  own field, the import refuses rather than guesses when it is not on screen,
  and the distance and time are checked against the printed pace — a screen's
  three numbers are not independent, which makes them each other's only
  available witness inside one image. `src/lib/domain/run-import.ts`.
- *Without a subscription, from a laptop:* request the account archive (**Settings → My Account →
  Download or Delete Your Account**), then run
  `npm run runs:import -- ~/Downloads/export_12345 --dry-run`, and again
  without `--dry-run`. Rows are keyed by Strava's activity id, the same unique
  index the nightly pull uses, so re-imports update in place. The export has
  `Distance` twice (athlete units and metres), and the importer picks the
  larger, because guessing wrong is a 1000x error.

**Health Auto Export.** The best automatic route if you would rather not pay
Strava — but it is **not free**: that app's REST API automation is behind its
Premium tier (seven-day trial). "Free of a Strava subscription" is not the same
as free, and this file used to say otherwise.

Point the iOS app at `POST /api/webhooks/health` with
`Authorization: Bearer $HEALTH_WEBHOOK_SECRET`, in JSON, with **Batch Requests
on**. That keeps payloads under Vercel's 4.5 MB limit. Overlapping windows
resend the same workouts, so every write is an upsert. Units are read per
quantity from its own `units` field. A value with an unrecognised unit is
dropped rather than guessed. A workout that also came from Strava exists twice,
once per provider, so pick one source.

**Web push.** `npm run push:verify` generates a VAPID pair if none is
configured. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`CRON_SECRET`. On iOS, web push only reaches home-screen installs. The phone
app in Expo Go can't receive push.

## Deploying

Vercel deploys `main` to production and every PR to a preview. Both use the
production database. Env vars live in Vercel's encrypted settings, so set
every variable from `.env.example` there. The production build runs
`npm run db:migrate` before `next build`, and preview builds never do.

Check the Vercel side for these:

- **Cron plan limits.** `vercel.json` schedules the nightly and dispatch jobs.
  Hobby caps cron jobs and fires them at most daily. Fire one by hand with
  `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/nightly`.
- **`lifemaxx.vercel.app` is someone else's project.** Production is
  `lifemaxx-tehseendahyas-projects.vercel.app`.

## Still unproven

- The Strava OAuth round trip end to end. `strava:verify` already proves the
  nightly pull is idempotent. The round trip needs a Strava subscription, so
  `runs:import` is the way in without one.
- Live model ids. `npm run llm:preflight` is the only check that the ids in
  `src/lib/models.ts` exist for your key.
