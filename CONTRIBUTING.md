# Contributing

This is how to get set up and how changes reach the app. Claude sessions
should also read [`CLAUDE.md`](CLAUDE.md), which lists the rules and the exact
verification commands. Humans should skim it too.

## The shape of it

- `mobile/` is the Expo app and the **only UI**. It runs on the phone in Expo
  Go and on the laptop as Expo web, served from the same Vercel URL as the API.
- The repo root is the Next.js **backend**: `src/app/api/*` plus the shared
  pure domain logic in `src/lib/domain`.
- There is **one database, production** (Supabase Postgres). Your local
  checkout, every preview deploy and every Claude session all talk to it.
  Treat it like production, because it is.

## One-time setup

### 1. Access you'll need

Ask the owner for:

| What | Why | Needed for |
|---|---|---|
| GitHub collaborator (write) | push branches, open PRs | everything |
| `.env.local` values | backend env: DB URL, Supabase, OpenAI, VAPID… | running the API locally |
| `mobile/.env` values | API URL + Supabase URL/anon key | running the client locally |
| Expo organization membership | Expo Go only opens published updates from projects your Expo account belongs to | opening the published app on your phone |
| Vercel team membership (optional) | see deploy logs, env vars, protected previews | debugging deploys |
| Supabase org membership (optional) | dashboard, SQL editor, auth users | debugging data, read-only |

**Secrets travel through a password manager or another private channel, never
through git, an issue, a PR or a commit.** `.env*` files are gitignored. Don't
change that.

### 2. Install

```bash
git clone git@github.com:tehseendahya/lifemaxx.git
cd lifemaxx
npm install              # root (backend). The client's typecheck needs it too.
cd mobile && npm install # the client is a separate npm project with its own React
```

Use Node 22 (CI does). Never install client packages at the root or the other
way round. To add a client dependency, use `cd mobile && npx expo install
<pkg>`, and only packages that work inside Expo Go (see
[`mobile/README.md`](mobile/README.md#the-expo-go-constraint)).

### 3. Env files

```bash
cp .env.example .env.local         # paste the owner's values
cp mobile/.env.example mobile/.env # paste the owner's values
```

`.env.local` points at the **production** database. That has two
consequences:

- Root tests **must** run as `DATABASE_URL= npx vitest run --exclude
  '**/*.db.test.ts' --exclude '.claude/**'`. Without `DATABASE_URL=`, the
  database tests would run against production.
- Never run `db:migrate`, `db:push`, `db:seed`, `db:seed:demo`, `dev:setup` or
  the `*:verify` scripts locally. Migrations apply themselves on production
  deploys.

### 4. Expo Go on your phone

Install **Expo Go** from the App Store and sign in with your Expo account.

- **Dev server (any time):** `cd mobile && npx expo start`, then scan the QR
  code with the iPhone camera. The phone and the laptop must be on the same
  Wi-Fi. If they can't be, use `npx expo start --tunnel`.
- **The published app (no laptop needed):** open the permanent link in
  [`mobile/README.md`](mobile/README.md#opening-it-on-the-phone). This needs
  your Expo account to be a member of the project's Expo organization.

### 5. Running things locally

```bash
npm run dev                  # API on http://localhost:3000 (production DB)
cd mobile && npx expo start  # client: QR for the phone, press w for web
```

The client calls whatever `EXPO_PUBLIC_API_BASE_URL` says. That's normally
the production deploy, and it can be changed on the phone under **You →
Connection** (use your laptop's LAN IP, not `localhost`). To point Expo web on
`localhost:8081` at a local API, set `MOBILE_CORS_ORIGINS=http://localhost:8081`
in `.env.local`. To see the real laptop build with everything on one origin, run
`npm run build && npm start`.

Anything you do in a locally running app writes to production as **you**. Use
it as you would the real app, and don't create junk accounts or fake entries.

## Making a change

1. Branch from an up-to-date `main`: `git switch -c <you>/<short-intent>`.
2. Keep the change small and limited to one concern. Don't reformat files you
   aren't changing: many sessions are editing at once, and unrelated churn
   becomes someone else's merge conflict.
3. Run the checks (all of them are in [`CLAUDE.md`](CLAUDE.md#verify-before-every-pr-run-all-that-apply)).
4. `git fetch && git rebase origin/main`, re-run the checks, and push.
5. Open a PR and fill in the template. CI runs the backend tests, the client
   tests, the iOS and web exports, and the production build.
6. Merge when CI is green. Rebase again first if `main` moved.

**Never push to `main` directly.**

### Schema changes

Hand-write a new `drizzle/NNNN_name.sql` and add its entry to
`drizzle/meta/_journal.json`, with a `when` larger than the previous entry's.
Then update `src/db/schema.ts`. Keep migrations **additive** (new tables,
nullable or defaulted columns), because the old code and older phone bundles
keep running against the new schema. The migration runs during the next
production deploy. Preview deploys never run it.

## Previews and shipping

- **Every PR** gets a Vercel preview URL with the backend plus the laptop web
  build. It uses the **production database**, so browse it read-only. Your
  PR's migrations have **not** run there, so a feature that needs a new column
  won't work on the preview until it merges.
- **Merging to `main`** deploys production on Vercel (backend + web) and
  applies pending migrations during the build.
- **The phone** updates via EAS Update. When a merge touches `mobile/**` or
  `src/lib/**`, the `EAS Update` GitHub workflow publishes to branch `main`.
  Fully close and reopen Expo Go to pick it up. `cd mobile && npm run publish`
  does the same by hand, if you have Expo access.
