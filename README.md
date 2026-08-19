# lifemaxx

All-in-one health tracker with an AI coach — meals, lifting, cardio and body
metrics in one place, on phone and laptop.

- Snap a photo of a meal, get a macro breakdown. The photo is never stored.
- Run a live lift session: per-set reps, weight, RPE, to-failure, notes.
- Ask questions mid-set — "should I do another set?" — against your own history.
- Maintenance calories measured from your data, not guessed by a calculator.
- Homepage ranks muscles by volume debt, so you never need to follow a split.

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

Then create the schema and load the exercise catalogue:

```bash
npm run db:push     # applies drizzle/0000_*.sql
npm run db:seed     # 35 exercises with muscle mappings and aliases
```

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

Open on your phone, sign in, then **Add to Home Screen**. That step is not
cosmetic: iOS only delivers web push to installed PWAs, and it gets you the
full-screen layout.

---

## Commands

| | |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Domain and parser tests (66, no network needed) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:push` | Apply schema to the database |
| `npm run db:seed` | Load/refresh the exercise catalogue (idempotent) |

## Architecture

```
src/
  app/            Next.js routes — screens and API handlers
  components/     UI, incl. MealCapture, SetLogger, AskCoach
  db/             Drizzle schema, exercise catalogue, seed
  lib/
    domain/       Pure logic: units, e1RM, progression, muscles, TDEE, readiness
    llm/          Provider interface, OpenAI + fixtures, prompts, shorthand parser
    queries.ts    Data access
    models.ts     One constant per route — the model dial
```

**The domain layer is pure and fully tested.** Progression, TDEE, muscle
accounting and readiness ranking have no I/O, so they run in the gym with no
signal and are covered by 50 tests that need no database.

**Model selection lives in one file.** `src/lib/models.ts` maps each route to a
model. The default is the cheapest tier that does the job (~$4/month at normal
use); bumping a route is a one-line change.

**Caching is prefix-shaped.** OpenAI caches automatically above ~1024 tokens at
10% of standard, but only on an exact prefix match — so `lib/llm/context.ts`
assembles goals and history first and the question last, and `stableJson()`
sorts keys. Break that ordering and you silently pay full price all session.

## What still needs doing

- [ ] Strava OAuth + nightly activity pull
- [ ] Nightly and weekly digest crons, and web-push delivery
- [ ] IndexedDB outbox for fully offline set logging (the UI is ready for it)
- [ ] Row-level security policies (single-user today; needed before sharing)
