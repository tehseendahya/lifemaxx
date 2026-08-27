# lifemaxx

All-in-one health tracker with an AI coach — meals, lifting, cardio and body
metrics in one place, on phone and laptop.

- Snap a photo of a meal, get a macro breakdown. The photo is never stored.
- Run a live lift session: per-set reps, weight, RPE, to-failure, notes.
- Ask questions mid-set — "should I do another set?" — against your own history.
- Maintenance calories measured from your data, not guessed by a calculator.
- Homepage ranks muscles by volume debt, so you never need to follow a split.
- Runs sync from Strava and get a verdict each, plus a weekly mileage rollup.
- Sets log to IndexedDB first, so a gym basement with no signal loses nothing.

**[Read the spec →](docs/SPEC.md)**

---

## Setup

Three things need real credentials. Until then the app runs in **offline mode**:
every screen works, meals get plausible macros, and set parsing is fully
functional — it's a real parser, not a stub.

```bash
npm install
cp .env.example .env.local
```

### 1. Database — Supabase

Create a project at [supabase.com](https://supabase.com), then from
**Project Settings**:

- **Database → Connection string → URI** → `DATABASE_URL`
  (use the **pooler** URI on port 6543, not the direct connection)
- **API → Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **API → anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then create the schema, load the exercise catalogue, and check the result:

```bash
npm run db:migrate  # applies drizzle/*.sql in order
npm run db:seed     # 35 exercises with muscle mappings and aliases
npm run db:verify   # proves the database is actually set up correctly
```

`db:migrate` replaced `drizzle-kit push`. Push diffs `schema.ts` against the
live database and never reads the SQL folder, which meant `CREATE EXTENSION
pg_trgm` and every RLS policy were silently skipped — the first symptom was a
runtime `function similarity(text, text) does not exist` on the first typo'd
exercise name. `db:push` still works as an alias.

**Run `db:verify` before trusting a new database.** It checks pg_trgm is live,
that the generated e1RM column computes, that RLS is enabled with a policy on
every table, and that one user genuinely cannot read another's rows through the
app's own query layer.

Enable magic-link sign-in under **Authentication → Providers → Email**, and add
`http://localhost:3000/auth/callback` to the redirect allowlist.

### 2. OpenAI

Put your key in `OPENAI_API_KEY`. Without it the app logs a warning and uses the
offline provider — nothing crashes.

To force offline mode even with a key present, set `LLM_PROVIDER=fixtures`.

### 3. Run it

```bash
npm run dev
```

### Running it with no Supabase at all

Magic-link sign-in needs a reachable Supabase, so without one every screen
redirects to `/login` and there is nothing to look at. One command gets you a
working app against any Postgres:

```bash
npm run dev:setup     # migrate, seed the catalogue, write demo data, set DEV_USER_ID
npm run dev
```

No Postgres to hand?

```bash
docker run -d --name lifemaxx-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=lifemaxx postgres:16
```

then put `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/lifemaxx`
in `.env.local` and run `npm run dev:setup`.

`dev:setup` writes a month of demo data — meals, six lift sessions with a real
progression on bench, six runs, and enough weigh-ins for the TDEE estimate to
clear its 8-sample floor — then points `DEV_USER_ID` at that user.
`DEV_USER_ID` authenticates every request as them. It is inert unless the
variable is set, and `next build` sets `NODE_ENV=production`, which switches it
off entirely — so it cannot reach a deployed bundle, Vercel previews included.

Open on your phone, sign in, then **Add to Home Screen**. That step is not
cosmetic: iOS only delivers web push to installed PWAs, and it gets you the
full-screen layout.

---

## Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Domain, parser, LLM-contract and outbox tests (133, no network) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply `drizzle/*.sql` in order |
| `npm run db:seed` | Load/refresh the exercise catalogue (idempotent) |
| `npm run dev:setup` | Migrate, seed, write demo data, set `DEV_USER_ID` |
| `npm run db:seed:demo` | Rewrite just the demo user's data |
| `npm run db:verify` | Check extensions, generated columns and RLS isolation |
| `npm run strava:verify` | Prove the nightly Strava pull is idempotent |
| `npm run push:verify` | Check VAPID keys and the push signing path |
| `npm run llm:preflight` | Call the live OpenAI API once per route |

### Verifying

Four of these talk to something real, and between them they cover everything
that can be checked without a phone in your hand:

- **`db:verify`** needs a database. Cross-user isolation is exercised through
  the real query layer, not asserted in a comment.
- **`strava:verify`** needs a database. It runs the sync three times against a
  stand-in for Strava and asserts no duplicate rows, then does it again with
  230 activities across pages.
- **`push:verify`** needs nothing. It generates VAPID keys if you have none and
  verifies the JWT signing and payload encryption locally.
- **`llm:preflight`** needs `OPENAI_API_KEY` and network. It is the only one
  that can tell you whether the model ids in `lib/models.ts` exist.

## Architecture

```
src/
  app/            Next.js routes — screens and API handlers
  components/     UI, incl. MealCapture, SetLogger, AskCoach
  db/             Drizzle schema, exercise catalogue, seed
  lib/
    domain/       Pure logic: units, e1RM, progression, muscles, TDEE,
                  readiness, running
    llm/          Provider interface, OpenAI + fixtures, prompts, shorthand
                  parser, and a contract-checking stand-in for the API
    outbox/       Offline write queue — storage-agnostic logic + a Dexie store
    queries.ts    Data access
    running.ts    Run verdicts and the weekly rollup
    models.ts     One constant per route — the model dial
scripts/          migrate, and the four verify/preflight commands above
```

**The domain layer is pure and fully tested.** Progression, TDEE, muscle
accounting, readiness ranking and the running maths have no I/O, so they run in
the gym with no signal and are covered by tests that need no database. The
outbox's queue logic is written the same way — storage-agnostic, so the rules
that actually matter (deliver in order, stop at the first failure, only retry
what retrying can fix) are tested rather than hoped for.

**The OpenAI layer has contract tests.** `api.openai.com` was unreachable from
the machine this was built on, so `src/lib/llm/__testing__/mock-openai.ts`
enforces the documented contract instead — the strict structured-outputs schema
subset, the vision content-part shape, the token parameter names — and refusals
and truncated completions are exercised as first-class response shapes.

**Model selection lives in one file.** `src/lib/models.ts` maps each route to a
model. The default is the cheapest tier that does the job (~$4/month at normal
use); bumping a route is a one-line change.

**Caching is prefix-shaped.** OpenAI caches automatically above ~1024 tokens at
10% of standard, but only on an exact prefix match — so `lib/llm/context.ts`
assembles goals and history first and the question last, and `stableJson()`
sorts keys. Break that ordering and you silently pay full price all session.

## Optional extras

Both are wired up and will start working the moment you add credentials.

**Strava** — create an app at [strava.com/settings/api](https://www.strava.com/settings/api),
set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`, then hit **Connect** in
Settings. Activities pull nightly.

**Push notifications** — generate keys once:

```bash
npm run push:verify   # generates a pair if none is configured, then checks it
```

Put them in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, set
`CRON_SECRET` to any random string, then enable in Settings. `vercel.json`
already schedules the nightly verdict, Sunday review and Strava sync.

> On iOS, push only reaches home-screen installs. The Settings screen says so
> rather than failing silently if you're in a Safari tab.

## Security

Every table has RLS enabled and a policy, enforced on both paths against one
predicate:

- **PostgREST** — Supabase serves every table in `public` at
  `https://<ref>.supabase.co/rest/v1`, and the key that reaches it ships to
  every browser that opens the app. Policies scope `authenticated` by JWT;
  `anon` has no table privileges at all. This was the real hole: without
  policies, reading the page source was enough to fetch every user's meals.
- **The app** — it connects as `postgres` (Supabase's pooler URI) and drops to
  a `lifemaxx_app` role for the duration of each request's transaction, with
  the user id published as a GUC. So a forgotten `where user_id = ...` returns
  nothing rather than leaking. See `withUser()` in `src/db/index.ts`.

`postgres` still bypasses RLS deliberately — migrations, the catalogue seed and
the cron jobs that iterate every user all need cross-user access, and they hold
the service credentials already. Those use `adminDb`, which is named that way
so it is obvious at the call site.

OAuth refresh tokens and push credentials are not granted to the browser roles
at all, RLS or no RLS.

## Deploying

```bash
npm run push:verify      # generates VAPID keys if you have none
```

Then set every variable from `.env.example` in Vercel's encrypted env vars,
deploy, and run `npm run llm:preflight` against your key.

Two things to check on the Vercel side, neither of which can be verified from
a build container:

- **Cron plan limits.** `vercel.json` schedules three jobs. The Hobby tier caps
  cron jobs per project and only fires them once a day, so confirm three fit
  your plan before assuming the nightly verdict is running. Consolidating the
  three into one dispatcher that branches on the day is a small change if not.
- **Push on iOS.** Web push only reaches home-screen installs. Add to Home
  Screen first, enable notifications in Settings, then fire a cron by hand:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/nightly
  ```

## What still needs doing

- [ ] Meal "repeat" shortcut for frequently-eaten meals
- [ ] Live verification against the real OpenAI API (`npm run llm:preflight`) —
      the request shapes are covered by contract tests, but no call has ever
      reached `api.openai.com`, so the model ids are unproven
- [ ] The Strava OAuth round trip end to end (the nightly pull's idempotency is
      already proven by `strava:verify`)
