# lifemaxx: the client (phone and laptop)

This is **the only UI** lifemaxx has. The same Expo app runs on the iPhone in
**Expo Go** and on the laptop as **Expo web**. The production build exports it
into the root `public/`, and Vercel serves it from the same URL as the API.
The Next.js app in the parent directory is the backend only: `/api/*`, plus
`/auth/callback` and `/reset-password`. Its old pages are gone. A feature
belongs here, once, for both platforms, with a `Platform.OS === "web"` branch
only where a capability really differs (camera vs file upload, voice, number
pad vs text inputs). See [`CLAUDE.md`](CLAUDE.md) for the rules and the
phone/web table.

Built to run in **Expo Go**, which shapes nearly every decision below. Parts
of this file predate the laptop web. Where it says "the web app", it means the
retired Next.js pages.

---

## Run it

You need a Mac (or any machine that can run Node), an iPhone, and **Expo Go**
from the App Store. Nothing else — no Apple Developer account, no Xcode, no
TestFlight, no EAS build.

```bash
# 1. once, from the repo root. The mobile typecheck reads the root's
#    node_modules, so this is a prerequisite even though mobile/ has its own.
cd lifemaxx
npm install

# 2. the mobile project has its own, separate tree
cd mobile
npm install

# 3. configure (see the next section) — three values, or nothing loads
cp .env.example .env
$EDITOR .env

# 4. go
npx expo start
```

Open the iPhone camera, point it at the QR code in the terminal, tap the
banner. Expo Go opens and the app loads over your LAN.

The phone and the computer must be on the **same Wi-Fi**. If the QR code hangs
on "Downloading JavaScript bundle", try `npx expo start --tunnel`.

### The three values

They ship **empty on purpose**. A placeholder hostname would send real auth
tokens to a domain nobody here owns, so instead the sign-in screen says plainly
that it is not configured.

```bash
# mobile/.env
EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon key>
```

- `EXPO_PUBLIC_API_BASE_URL` — your deployed Vercel URL. Expo Go runs on a real
  phone, so `localhost` means *the phone*; this has to be a hostname the phone
  can reach.
- The two Supabase values **must be the same project** as the web app's
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The API
  verifies the phone's token against that project, so a different one 401s
  every request with a perfectly correct password.
- The anon key is designed to ship in clients — the web app already serves it
  to every browser — and row-level security in Postgres is the actual
  protection. Never put a service-role key here.

They can equally go in `app.json` under `expo.extra` (`apiBaseUrl`,
`supabaseUrl`, `supabaseAnonKey`) if you would rather commit them. The env var
wins where both are set.

**Expo inlines `EXPO_PUBLIC_*` at bundle time — restart the bundler after
editing `.env`.** A change does not reach a Metro process that is already
running.

### Against a dev server on your LAN

No rebuild and no second QR code: open **You → Connection**, tap *Edit*, and
enter `http://192.168.x.x:3000` (your laptop's LAN address, not `localhost`).
It is stored in SecureStore on the device and overrides the bundled URL, and
the card tells you whether that address is answering before you try to sign in.

Plain HTTP to a LAN address works in Expo Go with no ATS exemption, and
`newClientId()` in the shared outbox already falls back when
`crypto.randomUUID` is unavailable outside a secure context — which is exactly
this case, and is what keeps the offline queue minting valid ids over `http://`.

Set `MOBILE_CORS_ORIGINS=http://localhost:8081` on the API **only** if you also
want `npx expo start --web`. The native client is not CORS-constrained.

### Signing in

Email and password, on the sign-in screen that opens first. Deliberately not a
magic link: a link means leaving the app, registering a URL scheme and handling
a cold-start deep link, and the web app already has password auth.

- **Existing account** — the same email and password you use on the web app.
- **New account** — *No account yet? Create one →*. If your Supabase project
  has email confirmation switched on, you get "Check your email to confirm the
  account, then sign in"; confirm in the browser, come back, sign in. The
  `profiles` row is created on that first real sign-in.
- **Forgotten password** — the emailed link opens `/reset-password`, one of
  the two pages the backend still serves, in the browser.

If sign-in fails, read the **CONNECTION** card at the bottom of the same
screen. A wrong API base URL and a wrong password look identical from the
outside, and on a first run the URL is much the likelier of the two. `NOT
SIGNED IN` there means the server is reachable and answering correctly.

### Scripts

| | |
|---|---|
| `npm start` | the dev server and QR code |
| `npm run ios` / `android` / `web` | start on a given target |
| `npm run typecheck` | `tsc --noEmit` (needs the root `npm install` first) |
| `npm test` | vitest — 613 tests, pure logic only |
| `npm run bundle` | `expo export --platform ios` — the real build gate |

There is a diagnostic route at **`/shared-smoke`**, not linked from any screen.
It renders values computed by `src/lib/domain/*` across the project boundary.
If those numbers are right, the shared domain layer is live in Expo Go. Reach
it by appending `/shared-smoke` to the URL in Expo Go's developer menu, or from
`/_sitemap`.

---

## What works, and what does not

### Works

- **Logging a set mid-workout** — the flow this client exists for. One tap on
  the hero button writes the set it is labelled with (`LOG 185 × 5`),
  pre-filled from the last set of this session, then today's `lastSets`, then
  the server's suggestion. One increment heavier and log is two taps; an
  arbitrary weight is six. Swipe between exercises. Nothing waits on the
  network: the pill is drawn on the same frame as the tap.
- **Offline writes** — sets and session starts are queued in SQLite and
  delivered in order in the background. A gym basement loses nothing. Each set
  carries a client-minted `clientId` and the server upserts on
  `(workout_id, client_id)`, so a retry after a lost response is not a
  duplicate.
- **Typed set entry, including a multi-line paste.** `TYPE IT`, then as many
  lines as you like — this is the primary way to log after the fact:

  ```
  today did bench 165x5, 165,5, 175x3, 155x7
  incline smith press 3 sets 155x7
  pec deck 2 sets 20kg for 8

  preacher curls 3 sets 30kgx8
  cable rope hammer curls 3 sets 20kgx8
  ```

  That paste is the regression test for the whole path: 5 entries, 15 sets, all
  five lifts resolved exactly, **no model call**. Each line is parsed
  independently, so one line the parser cannot read costs one line rather than
  the whole paste. Leading filler ("today did") is stripped; `N sets WxR`,
  `WkgxR` and `for R` all parse; `165,5` is recognised as a typo and the
  impossible number is dropped rather than logged as a 165-rep set (the sheet
  says `IGNORED: "165"` so the loss is visible).

  Weights always display in **whole pounds** — `20kg` reads `44 lb`, not
  `44.1 lb` — and what is shown is what is stored. Storage stays kg.
- **Exercises that do not exist yet are created for you.** An unknown name
  costs zero taps: it is created, marked `+ Name` with a NEW chip, and the sets
  log against it. If the name is close to something you already have, it is
  still created but the sheet asks `Did you mean Barbell Curl?` with a one-tap
  answer — so a genuinely new lift is free while `bnch pres` cannot quietly
  become a second bench press. Answering, deleting the group or discarding the
  sheet hands the created row back (`DELETE /api/mobile/exercise`), which is
  refused for anything with sets against it. You can also add one from the
  exercise picker.
- **The confirmation sheet is grouped by exercise**, not one card per set: a
  header with the canonical name, its EQUIPMENT as a column (so "incline smith"
  and "incline barbell" differ at a glance rather than by one word mid-name),
  then hairline-separated set lines. Per-set RPE, per-set notes, and
  warmup/failure as a real choice, with bulk actions behind `⋯`. A fuzzy match
  is always marked `~` with the raw wording under it; confirming one teaches an
  alias, so it is free next time.
- **Spoken set entry** — the same flow with a microphone. Records with
  `expo-audio`, uploads to `/api/voice/transcribe`, and feeds the transcript
  into the same parse path and the same confirmation sheet. Needs
  `OPENAI_TRANSCRIBE_MODEL` set on the server (below).
- **Today is a dashboard**, not a restatement of the other tabs: one verdict
  sentence ("Rear Delts is 10 sets short this week and you last hit it 9 days
  ago"), a 28-day bodyweight trajectory with the fitted trend and intake
  against measured maintenance, your goals with the gap to each, strength
  deltas, an 8-week load chart, and streaks. It reads one cached
  `GET /api/mobile/bootstrap`, which now also carries 56 days of `history`.
  Days with nothing logged are absent from that series and are drawn as gaps —
  nothing interpolates across them.
- **Runs, Food, You, Coach, and a per-exercise history screen** — ports of the
  web pages, every figure computed by the shared domain layer.
- **Food reads correctly before you have targets.** Until day 21 only protein
  has one, because maintenance is measured from your own weigh-ins rather than
  guessed. Carbs and fat now show the figure with "no target yet" and no track
  behind it, instead of a 0%-wide bar in a grey trough that read as "you have
  eaten no carbs". The card also says which of the three things it is still
  waiting for — weigh-ins, logged days, or your choice of cut/maintain/bulk.
- **Meal capture** — camera, library or a typed sentence; macros estimated,
  then reviewed and edited before saving. The photo exists only in memory and
  the two temporary files the picker and the resizer write are deleted
  immediately.

### Does not, and will not here

- **HealthKit / step counts.** See below — out of scope, nothing installed.
- **Speech recognition on the device.** It is a native module. Transcription is
  server-side instead.
- **Push notifications**, including a rest-timer alarm. A backgrounded Expo Go
  app will not fire one reliably, and a timer that lies is worse than a bar you
  have to look at. The rest timer runs off an absolute deadline, so coming back
  from a pocket shows the truth.

### Stubbed, degraded or deliberately missing

- **The mic with no `OPENAI_TRANSCRIBE_MODEL`.** `/api/voice/transcribe`
  answers 503 and the button reads "Speaking isn't set up yet — type it
  instead". Typed entry is unaffected. Set the variable in the API's
  environment (see the root `.env.example`) and run `npm run llm:preflight` at
  the repo root to check the id against the models your key can see.
- **Last weigh-in on the You screen.** `bootstrap` carries no last reading, only
  the TDEE regression's *fitted* weight, which needs eight weigh-ins to exist.
  The screen labels it as trend weight rather than calling a regression output a
  reading, and shows nothing at all below that floor.
- **A cold launch with no signal has no data.** The react-query cache is not
  persisted and nothing yet writes the `bootstrap` payload into SQLite, so the
  first launch of the day in a basement has no catalogue, no `lastSets` and no
  gyms — the set pre-fill falls back to asking for a weight. A session already
  open before signal was lost is unaffected.
- **Weekly running verdicts** on the Runs screen are computed mileage and pace,
  not the written summaries the Sunday cron stores. Those are not in
  `bootstrap`.
- **Ending a session with sets still queued.** `POST /api/sets` resolves the
  workout server-side, so a set delivered after the session is closed is
  rejected and dropped. The stop sheet warns with the count and offers
  *SYNC, THEN END*; a dropped set still surfaces afterwards as a tappable line
  with a real retry. The proper fix is server-side and is not done.

---

## The Expo Go constraint

Expo Go on the App Store ships exactly **one** SDK runtime: the current one.
This project targets **Expo SDK 58** (`expo@~58.0.19`, React Native 0.88.0,
React 19.3.0), which was the published release when it was built.

Every native-bearing version here is copied from `expo@58.0.19`'s own
`bundledNativeModules.json`. A reanimated, screens or gesture-handler version
outside the SDK's pin is the single most common cause of a red error screen, so
do not "upgrade" any of them individually — use `npx expo install --fix`.

**The dependency list is closed.** Only packages that work inside Expo Go:
modules shipped in the Expo SDK, pure-JavaScript libraries, and the handful of
third-party natives bundled into Expo Go because the default SDK 58 template
depends on them. Anything needing `expo prebuild`, a config plugin with native
code, or a custom dev client is out — one such package and scanning the QR code
produces a red screen instead of an app. Notably excluded, deliberately:
`react-native-health`, `@kingstinct/react-native-healthkit`,
`@react-native-voice/voice`, `react-native-mmkv`,
`react-native-keyboard-controller`.

When Expo Go updates to SDK 59 this app will stop loading with "incompatible
version" until `expo` is bumped and `npx expo install --fix` is run. That is
unfixable in principle — it is the price of installing from the App Store
rather than building — so it is written down rather than hidden.

---

## How it is put together

### Not an npm workspace

`mobile/` is a self-contained npm project nested in the repo: its own
`package.json`, its own `node_modules`, its own lockfile. The root
`package.json` is untouched and gains no mobile dependencies.

This is deliberate. The root needs `react@19.0.0` for Next 15; React Native
0.88 requires `react@^19.3.0`. Workspaces hoist, and a single hoisted React
means Metro bundles a React that does not match the renderer it was built
against — "Invalid hook call", on a device, with no debugger. Two isolated
trees make that impossible. The cost is running `npm install` twice.

`metro.config.js` pins `nodeModulesPaths` to `mobile/node_modules` and adds a
`blockList` entry making `<repo>/node_modules/` unresolvable from here, so
Metro cannot climb to the repo root and find the wrong React even by accident.

It deliberately does **not** set `resolver.disableHierarchicalLookup`, which is
the obvious choice and is wrong: that flag also stops Metro walking into the
*nested* `node_modules` inside this project, and
`react-native-reanimated/node_modules/semver` has to stay reachable because the
hoisted `semver` is version 6 and has no `functions/satisfies` subpath. With it
on, `expo export` fails outright. The comment in `metro.config.js` says this
too, because the obvious fix here is the wrong one.

### Sharing code with the backend

The domain layer (`src/lib/domain/*` — units, e1RM, progression, muscles, TDEE,
readiness, running) and the outbox queue (`src/lib/outbox/queue.ts`) are pure
TypeScript with no I/O and are covered by the root test suite. The native app
**imports them**. It does not reimplement, copy or vendor them: two clients
computing the same number two ways is how they come to disagree about it.

Mechanically: `metro.config.js` adds `../src/lib` to `watchFolders`, and
`mobile/lib/shared/` holds one one-line re-export barrel per module. Those
eight files are the only ones in `mobile/` containing a `../../../` path;
everything else imports `@/lib/shared/units` and friends.

For **typechecking** only, `tsconfig.json` maps `@/db/schema` to
`../src/db/schema.ts`, because three domain files carry a type-only
`import type { Muscle } from "@/db/schema"`. Babel's TypeScript transform
elides that before Metro sees it, so `drizzle-orm` never reaches the bundle —
but `tsc` does have to resolve it, which is **why the root `npm install` must
have run before `npm run typecheck` here.**

### Writes go through the outbox, reads through react-query

Every write — a set, a session start — is queued in SQLite (`expo-sqlite`) and
delivered in the background. A save never waits on a network that, in the room
where this app is used, is usually not there. The delivery rules (strictly in
order, stop at the first failure, retry only what retrying can fix) are the
shared `flush()` from `src/lib/outbox/queue.ts`; this app adds a storage
adapter, not a second queue.

Reads use `@tanstack/react-query`. The query cache is **not** persisted — see
the cold-launch note above. `lib/query.ts` bridges React Native's `AppState` to
react-query's focus manager, because `refetchOnWindowFocus` otherwise waits for
a DOM `visibilitychange` event that never arrives on a phone.

Meals are the one write that does **not** go through the outbox, and should not:
the review step is the only reason the macros are trustworthy, and a queued
photo could not be reviewed before it was written.

### Authentication

Supabase email/password on the device; the access token goes to the Next.js API
as `Authorization: Bearer <jwt>`. A native client has no cookies, so the
cookie-based `createServerClient` path the web app uses would resolve nobody
and every screen would render empty. Server-side the token is verified by
Supabase rather than decoded locally, and the resolved user id still flows
through `withUser()` — row-level security is unchanged.

The session is persisted in `expo-secure-store` through a **chunking adapter**.
SecureStore warns above 2048 bytes per value and a Supabase session JSON is
past that; a naive adapter appears to work and then silently loses the session
on next launch. See `lib/chunked-store.ts` and its tests.

### Layout

```
app/          expo-router routes. Thin: each one re-exports a feature screen.
components/ui the design system — 12 components + tokens, ported from
              src/app/globals.css and src/components/ui.tsx, not redesigned.
features/     one folder per screen. Each keeps its decisions in a pure
              model.ts / logic.ts with no react-native import, which is what
              makes them unit-testable with no simulator.
lib/          api client, auth, config, outbox adapter, haptics, query client.
lib/shared/   one-line barrels re-exporting ../../../src/lib/domain/*.
public/       static web assets (manifest, icons, sw.js) copied into the web export.
```

---

## HealthKit is out of scope

Not attempted, no library installed. HealthKit requires a native module and
cannot work in Expo Go under any configuration — installing
`react-native-health` or `@kingstinct/react-native-healthkit` would make the QR
code produce a red screen on launch, which is strictly worse than not having
step counts.

Nothing is actually lost today: the **Health Auto Export** webhook already
delivers steps, sleep and weight into `body_metrics` and keeps working
untouched.

A future `eas build` dev client — which needs an Apple Developer account —
would unlock direct HealthKit reads (steps, sleep, resting heart rate, workouts
written back to Apple Health), remote push notifications and therefore a real
rest alarm, a home-screen widget, background sync, and on-device speech
recognition instead of a server round trip. **None of that is built.** It is
listed so the next person knows what the Expo Go constraint is costing, not as
a roadmap.

---

## What is verified, and what cannot be

There is no simulator, no device and no Xcode in the environment this was built
in. These gates pass:

- `npm run typecheck` in both projects — clean
- `npm test` — 493 here, 371 at the repo root
- the repo root's 17 database tests and `npm run db:verify`, both against a
  real PostgreSQL 16. These are the only things that exercise the row-level
  security policies; they **skip silently** without a `DATABASE_URL`, so
  `npm test` alone never proved RLS worked.
- `npx expo export --platform ios` — 2043 modules, a 5.2MB Hermes bundle, no
  errors. This proves Metro resolves every route, the cross-boundary shared
  imports and every native-module import.
- `npm run build` at the repo root, from a clean `git worktree` of HEAD rather
  than the working tree — which is what CI actually builds, and the only check
  that catches a file the working tree has but the commit does not.
- `npx expo export --platform web` — also clean, and used with Playwright for a
  rough visual check of the design system, the live-session screen, the number
  pad, the sheets and the exercise detail screen.

**That visual check predates the current screens.** The Today dashboard, the
grouped confirmation sheet and the food fuel card have had **no** visual
verification of any kind — not a screenshot, not a harness render. They are
covered by unit tests on their view-models and by a clean bundle, and that is
all. Any screenshot of them taken during development required a temporary
auth stub which was removed rather than committed, so none survives.

A successful Metro bundle catches version mismatch, unresolvable shared imports
and bad native-module imports. It **cannot** catch a module that bundles fine
but is absent from the Expo Go binary, which is why the closed dependency list
above is the real control rather than the build.

Nothing about **gestures, haptics, the keyboard, scroll feel, tap latency,
audio recording or the camera** is verified, and none of it can be without a
phone. The first genuine test of this app is the first QR scan.

## Running it without a laptop

The short answer to "can I publish it to Expo Go and stop running the dev
server": **yes, but you republish for every change**, and there is one trap in
the config that silently removes the Expo Go option entirely.

### What changed, and why the usual advice is out of date

The flow people remember — `expo publish`, then open it in Expo Go with no dev
server — was **Classic Updates**, and it was removed in SDK 50. SDK 49 was the
last version that supported it. This project is on SDK 58, so `expo publish`
does not exist here and no amount of configuration brings it back.

The replacement is **EAS Update**: `eas update` builds the JS bundle, uploads
it, and serves it from EAS. Expo Go can open your own project's published
updates, so the laptop-free path still exists — it is just a different command
and a different set of rules.

### The trap: the runtime version has to be Expo Go's

**An earlier version of this section said to leave `runtimeVersion` out. That
was wrong, and following it fails.** `eas update` calls
`ensureEASUpdateIsConfiguredAsync` on every publish, and that function writes a
`runtimeVersion` into `app.json` whenever there isn't one — defaulting to
`{ "policy": "appVersion" }` for SDK 49 and later. That resolves to `"0.1.0"`,
and Expo Go will not load an update tagged `"0.1.0"`: it only loads updates
tagged with its own runtime, `exposdk:58.0.0`.

So `app.json` sets it explicitly, to the one policy that resolves to Expo Go's
runtime:

```json
"runtimeVersion": { "policy": "sdkVersion" }
```

`@expo/config-plugins` resolves that through `getRuntimeVersionForSDKVersion`
to `exposdk:58.0.0`, and because the field is now set, `eas update` leaves it
alone. Check it any time with:

```bash
node -e "require('@expo/config-plugins').Updates.getRuntimeVersionNullableAsync(process.cwd(), require('@expo/config').getConfig(process.cwd()).exp, 'ios').then(console.log)"
```

If a tool, a guide or `eas update:configure` changes it to `appVersion` or
`fingerprint`, the Expo Go path dies quietly: the QR scans and the update
never loads. Those policies are for development and store builds, which this
project does not use.

`expo-updates` **is** in `package.json` — `eas update` installs it on first
run regardless. It is in Expo Go's bundled native modules (`~58.0.18`), so it
does not break the Expo Go dependency gate.

### The published app's config lives in EAS, not in `.env`

`EXPO_PUBLIC_*` values are inlined into the bundle when it is exported, and
`npm run publish` passes `--environment production` (required from SDK 55).
**With `--environment`, EAS supplies the variables from the EAS environment
and the local `.env` files are not used.** The first publish of this project
proved it the hard way: the EAS environment was empty, and the uploaded bundle
contained neither the API URL nor the Supabase URL — the app would have opened
to a "not configured" sign-in screen. A local `npx expo export` without
`--environment` looked fine, which is exactly why that test was not enough.

So the three values are set in the EAS **production** environment:

```bash
npx eas-cli@latest env:list --environment production
```

They are `plaintext` deliberately: none is a secret (the anon key is built to
ship in clients, and anything `EXPO_PUBLIC_` is readable in the bundle anyway).
To change one, e.g. after moving the API:

```bash
npx eas-cli@latest env:update --environment production \
  --variable-name EXPO_PUBLIC_API_BASE_URL --value https://new-host.example
```

`mobile/.env` is still what `npx expo start` reads, so local development keeps
pointing at your laptop's LAN address. **Never let that LAN address reach the
EAS environment** — a published app with it would call your laptop for every
request.

The API must be a deployment that includes the `/api/mobile/*` routes. It is
`https://lifemaxx-tehseendahyas-projects.vercel.app` (production, `main`).
`lifemaxx.vercel.app` is somebody else's project — never point the app at it.

**Verify any publish** by searching what was actually uploaded, not what was
configured. The bundle is Hermes bytecode, so use a byte search:

```bash
python3 -c "import glob;b=open(glob.glob('dist/_expo/static/js/ios/*.hbc')[0],'rb').read();print('api',b.count(b'lifemaxx-tehseendahyas-projects.vercel.app'),'lan',b.count(b'192.168.'))"
```

`api 1 lan 0` is correct. `api 0` means the publish shipped without config.

### Opening it on the phone

The project has a `main` channel pointing at the `main` branch, which gives one
**permanent** link that always resolves to the newest publish:

```
exp://u.expo.dev/74dacced-64fc-4a90-84c8-05e5650302e4?channel-name=main&runtime-version=exposdk:58.0.0
```

Open it (or scan it as a QR) on the iPhone with Expo Go signed in as
`tehseendahya` — since 12 May 2026 Expo Go only loads EAS Updates for projects
your account owns. After the next `npm run publish`, the same link serves the
new version; fully close and reopen the app to pick it up.

### Doing it

**This is automatic now.** Every push to `main` that touches `mobile/**` or
`src/lib/**` runs `.github/workflows/eas-update.yml`. That workflow typechecks
and tests the client, then publishes exactly the command below, using the
`EXPO_TOKEN` repository secret. If the secret is missing, the workflow skips
with a notice. It can also be run by hand from the Actions tab. To publish
manually from a laptop:

```bash
cd mobile
npx eas-cli@latest login      # once
npx eas-cli@latest init       # once; already done for @tehseendahya/lifemaxx
npm run publish               # publish the current checkout to the phone
# config comes from `eas env:list --environment production`, not from .env
```

Publish from an up-to-date `main` only. A publish from a feature branch puts
unmerged code on everyone's phone until the next merge overwrites it.

`npm run publish` is
`npx eas-cli@latest update --branch main --environment production --non-interactive --message "<last commit subject>"`.
`--environment` is required from SDK 55. `npx eas-cli@latest` rather than a
bare `eas`, because the CLI is not a dependency and is usually not installed
globally — a bare `eas` fails with "command not found".

The project is linked: `extra.eas.projectId` and `owner` in `app.json` are
committed, since this repository has one owner.

### Answering the second half of the question

**Local edits don't appear by themselves.** `eas update` publishes a
snapshot. A merge to `main` republishes it through the workflow above, but
editing a file on your machine does nothing to the published bundle until that
change merges (or you run `eas update`). Then reopen the app. It is a publish step, not live reload — the
dev server's fast refresh is the only thing that updates as you type, and that
needs the laptop.

So, roughly: dev server for iterating, `eas update` for carrying a build to the
gym.

### Two caveats worth knowing before you rely on it

- Since 12 May 2026, Expo Go only loads EAS Update projects you own or that
  belong to an organisation you are in. Signing in to Expo Go with the same
  account you ran `eas login` with is therefore not optional. A collaborator
  can only open the published link once the project belongs to an Expo
  organisation they're a member of. Until then, they use `npx expo start`.
- There is an open report of EAS Updates failing to load in Expo Go **on
  Android** for SDK 57, with iOS unaffected. This project targets iOS and is on
  SDK 58, so it probably does not apply — but it has not been confirmed from
  here, and a failure to load rather than a crash is what it would look like.
