# lifemaxx

A health tracker with an AI coach. It covers lifting, meals, runs and
bodyweight in one app, on the phone and on the laptop.

- **Lift:** run a live session with per-set reps, weight, RPE, to-failure and
  notes. One tap logs the next set, and typing or pasting `bench 165x5, 175x3`
  also works. Sets queue offline, so a gym basement loses nothing.
- **Train by muscle debt:** Today ranks muscles by how far behind their weekly
  volume they are, so you never follow a split.
- **Food:** photograph a meal (or describe it) to get macros you review before
  saving. **The photo is never stored.**
- **Measured maintenance:** calories come from your own weigh-ins and intake,
  not from a calculator.
- **Runs:** synced from Strava or Apple Health (Health Auto Export), with a
  verdict on each and a weekly mileage rollup.
- **Coach:** ask mid-set ("another set?") or any time, against your own
  history.

Weights display in lb and are stored in kg.

## How it's built

- **`mobile/`:** the only UI. An Expo app that runs on the phone in **Expo Go**
  and on the laptop as **Expo web**.
- **The repo root:** the Next.js backend (`src/app/api/*`) and the pure domain
  logic (`src/lib/domain`) that the client imports directly.
- **Supabase Postgres** with row-level security on every table, deployed on
  **Vercel**. Phone updates ship through **EAS Update**.

## Where to go next

| | |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Setup for a new collaborator, the branch and PR flow, previews and shipping |
| [`CLAUDE.md`](CLAUDE.md) | Rules and verification commands for Claude sessions (and humans) |
| [`mobile/README.md`](mobile/README.md) | The client: Expo Go constraint, config, EAS Update, what works |
| [`docs/BACKEND.md`](docs/BACKEND.md) | Backend setup, commands, security, Strava / Health / push, deploying |
| [`docs/SPEC.md`](docs/SPEC.md) | The product spec |
| [`docs/history/`](docs/history/) | Superseded plans, kept for context |

## Quick start

```bash
npm install && (cd mobile && npm install)
# get .env.local and mobile/.env values from the owner (never via git)
DATABASE_URL= npx vitest run --exclude '**/*.db.test.ts' --exclude '.claude/**'
cd mobile && npx expo start
```

`.env.local` points at the **production** database, which everyone shares.
Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before running anything else.
