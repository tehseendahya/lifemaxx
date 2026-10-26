# lifemaxx

A health tracker with an AI coach. It covers lifting, meals, runs and
bodyweight in one app, on the phone and on the laptop.

> **Claude or any other AI agent: read this file, then [`CLAUDE.md`](CLAUDE.md),
> before you change anything.** Several people and many concurrent sessions edit
> this repo, and it is wired to a **shared production database**. The rules below
> are the short version; `CLAUDE.md` has the full set and the exact commands.

---

## One app, two screens: the mobile vs web split

There is **one UI**, and it lives in `mobile/`. The phone and the laptop run
the same code, so a change ships to both. Nothing else in this repo draws a
screen.

```
                ┌──────────────── mobile/ (Expo, React Native) ────────────────┐
                │  the ONLY user interface: screens, navigation, outbox       │
                └───────────────┬──────────────────────────────┬───────────────┘
                                │                              │
              iPhone, Expo Go (EAS Update)        laptop browser (Expo web,
              camera, mic, bottom tab bar         exported into public/ at build)
                                │                 sidebar, dialogs, typed input
                                │                              │
                                └───────────┬──────────────────┘
                                            │ HTTPS + Supabase bearer token
                ┌───────────────────────────▼──────────────────────────────────┐
                │  repo root: Next.js on Vercel, BACKEND ONLY                  │
                │  src/app/api/*   ·   src/lib/domain (pure logic, also used   │
                │  by mobile/)   ·   src/db + drizzle/ (Supabase Postgres)     │
                └──────────────────────────────────────────────────────────────┘
```

| | Where | Notes |
|---|---|---|
| **Screens / UI** | `mobile/app` (routes), `mobile/features/<area>` | Phone and laptop. Never add pages or components under `src/app`. |
| **Phone-only behaviour** | `Platform.OS !== "web"` | Camera for meal photos, voice set entry, bottom tab bar, number pad. |
| **Laptop-only behaviour** | `useIsWide()` in `mobile/lib/layout.ts` (web, 900px or wider) | Sidebar with six places, two-column layouts, sheets as centered dialogs, typed weight/reps. Narrow browsers look like the phone. |
| **Any browser** | `Platform.OS === "web"` | "Upload photo" instead of the camera, no mic, outbox in localStorage, optional web push. |
| **API** | `src/app/api/*` (client routes follow `src/app/api/mobile/*`) | Bearer-token auth, same origin on the web. |
| **Business rules** | `src/lib/domain/*` | Pure TS, shared with `mobile/` through one-line re-exports in `mobile/lib/shared/`. Change the rule once, here. |
| **Database** | `src/db/schema.ts` + `drizzle/NNNN_*.sql` | Supabase Postgres, RLS on every table. |

How it reaches people, after a PR merges to `main`:

- **Laptop + API:** Vercel builds production. `npm run build` exports the
  client to `public/`, runs pending migrations (production only), then runs
  `next build`.
- **Phone:** `.github/workflows/eas-update.yml` publishes an EAS Update. Users
  get it the next time Expo Go is fully closed and reopened.

---

## Rules that keep this repo from breaking

1. **Branch + PR, never push to `main`.** One concern per PR, small diffs, no
   drive-by reformatting (other sessions are editing the same files). Rebase on
   `origin/main` before merging; CI must be green.
2. **The database is production, and everyone shares it.** That includes local
   dev, every Claude session and every Vercel preview. Never write test data,
   sign up test accounts, run seed/demo scripts, or run `db:migrate` yourself.
3. **Root tests must blank the database URL**, because `.env.local` points at
   production:
   `DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'`
4. **Schema changes are additive migration files only.** Write a new
   `drizzle/NNNN_name.sql`, append to `drizzle/meta/_journal.json` (with a `when`
   larger than the last), update `src/db/schema.ts`. They apply automatically on
   the production deploy. Never edit a merged migration; never use
   `drizzle-kit push`.
5. **The phone runs in Expo Go.** No native modules beyond what Expo Go ships,
   no `expo prebuild`; install client packages with `npx expo install`. If the
   iOS bundle doesn't build, the phone is broken:
   `cd mobile && npx expo export --platform ios --output-dir /tmp/lifemaxx-ios`
6. **Keep the two `node_modules` apart.** `mobile/` has its own dependencies and
   React version. Never add client packages to the root `package.json`, or
   server packages to `mobile/`.
7. **Product rules are settled.** Don't relitigate them:
   - Meal photos are **never persisted**. They're analysed in memory and
     discarded.
   - Display **lb**, store **kg**.
   - Cheap, fast OpenAI models by default (`src/lib/models.ts`).
   - **No training split or program**: muscle-debt ranking decides.
   - **Never commit secrets** (`.env*` is gitignored).
8. **Verify before you open a PR** (CI runs the same checks):

   ```bash
   npx tsc --noEmit
   DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'
   cd mobile && npx tsc --noEmit && npx vitest run
   cd mobile && npx expo export --platform ios --output-dir /tmp/lifemaxx-ios
   npm run build        # laptop web + backend
   ```

---

## What the app does

- **Lift:** run a live session with per-set reps, weight, RPE, to-failure and
  notes. Typing `bench 165x5, 175x3` also works. Sets queue offline. Past
  workouts can be opened, edited or deleted.
- **Train by muscle debt:** Today ranks muscles by how far behind their weekly
  volume they are, so you never follow a split.
- **Food:** photograph (phone) or upload (laptop) a meal, or describe it, and
  review the macros before saving. **The photo is never stored.**
- **Measured maintenance:** calories come from your own weigh-ins and intake,
  not a calculator.
- **Runs:** synced from Strava or Apple Health (Health Auto Export).
- **Coach:** ask mid-set ("another set?") or any time, against your own
  history.

## Where to go next

| | |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | The full rules, gotchas and commands for Claude sessions (and humans) |
| [`mobile/CLAUDE.md`](mobile/CLAUDE.md) | Client layout and phone-vs-web details |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup for a new collaborator, the branch and PR flow, previews and shipping |
| [`mobile/README.md`](mobile/README.md) | The client in depth: Expo Go, config, EAS Update |
| [`docs/BACKEND.md`](docs/BACKEND.md) | Backend setup, commands, security, Strava / Health / push |
| [`docs/SPEC.md`](docs/SPEC.md) | The product spec |
| [`docs/history/`](docs/history/) | Superseded plans, kept for context only |

## Quick start

```bash
npm install && (cd mobile && npm install)
# get .env.local and mobile/.env from the owner (never via git)

MOBILE_CORS_ORIGINS=http://localhost:8081 npm run dev   # API on :3000
npm run dev:web                                          # laptop UI on :8081
cd mobile && npx expo start                              # phone: scan the QR in Expo Go
```

Anything you do in a locally running app writes to production as you.
