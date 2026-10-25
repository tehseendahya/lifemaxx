# lifemaxx — native client plan

**Status:** approved in principle, not yet built. No code exists for this yet.

Produced by the planning agent on 2026-10-25, ahead of implementation. Sibling of [`SPEC.md`](./SPEC.md), which remains the product spec — this covers only the native client and the backend work it requires.

The distribution story is **Expo Go**: `npx expo start`, scan the QR with the Expo Go app. No Apple Developer account, no TestFlight, no EAS build, no native code. That single constraint drives most of what follows.


---

## Contents

0. [First-use fix round](#first-use-fix-round-2026-10-25) — **read this first: it supersedes parts of what follows**
1. [Architecture decisions](#architecture-decisions)
2. [Dependency allowlist](#dependency-allowlist)
3. [Information architecture](#information-architecture)
4. [Shared code strategy](#shared-code-strategy)
5. [Logging a set by hand](#logging-a-set-by-hand) — the hero flow
6. [Speaking a set](#speaking-a-set)
7. [Workstream briefs](#workstream-briefs)
8. [Risks](#risks)


---

## First-use fix round (2026-10-25)

The client above was built and then used on a real phone for the first time.
This section records what that found and what changed, because several
decisions below are now **superseded** and following them would undo the fix.

### What the owner typed

```
today did bench 165x5, 165,5, 175x3, 155x7
incline smith press 3 sets 155x7
pec deck 2 sets 20kg for 8

preacher curls 3 sets 30kgx8
cable rope hammer curls 3 sets 20kgx8
```

Five lines, one blank separator. It produced nothing usable: `parseShorthand`
was all-or-nothing, so one unsupported form on line 2 sent the whole paste to
the model; the typo `165,5` became a set of **165 reps at 165 lb**; two lifts
matched the wrong machine confidently; two did not exist in the catalogue at
all and there was **no way to create an exercise anywhere in the app**.

Today the same paste produces 5 entries and 15 sets with **no model call**, all
five resolving exactly. That run is the acceptance test for this round.

### The six changes, and where each lives

1. **Per-line parsing.** `parseLines()` in `src/lib/llm/shorthand.ts` parses
   each line independently; `parse-sets.ts` is hybrid, so deterministic lines
   stay free and only leftovers reach the model. `parseShorthand` keeps its
   all-or-nothing contract for the web app's offline path, which has no model
   to fall back on and must refuse rather than silently drop a line.
2. **New shorthand forms and sanity bounds.** `N sets WxR`, `N sets WkgxR`,
   `N sets Wkg for R`, `for R`. `SANITY` caps reps at 100, weight at 2000 lb
   and set counts at 30. Structure recognised but numbers implausible → the
   chunk is DROPPED and reported on `ParsedEntry.dropped`; structure
   unrecognised → the line goes to the model. That distinction is what turns
   `165x5, 165,5` into two sets of 5 at 165 instead of a 165-rep set.
3. **A 147-exercise catalogue** with 824 aliases, machines included. Also two
   database bugs: `hammer curl` pointed at Dumbbell Curl, and the seed was
   never idempotent for built-in aliases (two runs took the table from 141 rows
   to 1772) — fixed by `drizzle/0004_catalogue_alias_remap.sql` and a partial
   unique index `exercise_aliases_global_alias_idx`.
4. **Unknown exercises are created automatically.** See the next section — this
   is the part that supersedes the most.
5. **The confirmation sheet is grouped by exercise**, with real RPE, per-set
   notes, failure/warmup as a choice, and equipment as a column. See
   "Superseded" below.
6. **Today is a dashboard**, Food's calibration mode is legible, and `Sheet`
   no longer overflows past the status bar.

### Exercise resolution now has three outcomes, and step 3 WRITES

`resolveExerciseOutcome()` in `src/lib/exercises.ts` answers `match` /
`near_miss` / `new` / `blank` against two thresholds: `FUZZY_MATCH_SCORE`
(0.45, unchanged) and `NEAR_MISS_SCORE` (0.40).

`parseSetsText` acts on it:

| outcome | what happens | what the phone draws |
|---|---|---|
| `match`, exact | filed against it | the plain name |
| `match`, fuzzy | filed against it, and asked about | `~ Name`, `heard: "…"`, `Matched on spelling. Right?` |
| `near_miss` | **created AND asked about** | `+ Name`, NEW chip, `Did you mean X?` |
| `new` | **created**, silently | `+ Name`, NEW chip |
| `blank` | nothing | unmatched chip |

Both halves of the near-miss case matter: creating means a genuinely new lift
costs **zero taps**, and asking means `bnch pres` cannot silently mint a second
bench press and split a year of history. A query that is only set notation
(`225x5`) is refused by the shared `hasNameBeyondSetNotation()` guard, so the
automatic path cannot write a row called "225x5".

**The parse path is no longer read-only.** It creates before the user confirms,
because the sheet needs an id to name a lift and log a set against one.
`DELETE /api/mobile/exercise?id=` takes the row back, and the phone calls it
fire-and-forget when a group is deleted, when a near miss is answered "yes, I
meant that one", and when the sheet is discarded. The route refuses a catalogue
row and refuses any row with sets against it (`sets.exercise_id` is `ON DELETE
RESTRICT`, so the database is the real guarantee).

Resolution is also **sequential per entry**, not `Promise.all`. Two lines of
one paste naming the same unknown lift would otherwise both create a row; run
in order, the first creates it and learns the wording, so the second resolves
exactly and they share it.

### Superseded — do not implement these as written below

* **"One editable row per set"** and the per-row exercise chip (in *Speaking a
  set → The confirmation sheet*). The sheet is now **one group per parsed
  entry** with 56pt hairline-separated set LINES inside it. Fifteen identical
  cards was the complaint. State is still one row per set; `groupRows()` is a
  pure projection over it, which is why the outbox contract did not move.
* **"The confirm button is disabled until every row has a real
  `exerciseId`"**. Still true for an unmatched row, but unmatched is now rare —
  an unknown name is created instead. A `new` exercise does **not** block
  confirm, and neither does an unanswered near-miss question.
* **RPE / to-failure / warmup "as small chips"**. RPE is a segmented control
  (`@8`), kind is a two-glyph badge expanding to a segmented control, and both
  are per-set with bulk actions behind `⋯`.
* **`confidence: "exact" | "fuzzy"`**. It is `"exact" | "fuzzy" | "new"`, and
  `ParsedEntry` additionally carries optional `nearMiss` and `dropped`. All
  three are declared in `mobile/lib/types.ts`; both optional ones are optional
  so the sheet still renders against a server that sends neither.
* **Weights to one decimal.** Display is **always whole pounds**, rounded at
  the parse edge so what is shown is what is stored. 20 kg reads `44 lb`, not
  `44.1 lb`. Storage stays kg; there is no per-exercise unit memory.

### Today is a dashboard, not a restatement

`verdict.ts` (one sentence, six-rung precedence ladder), `goals.ts` (four
deterministic patterns over `goalsText`, no model call), `model.ts` (trajectory,
goal gaps, strength deltas, load buckets, streaks). `GET /api/mobile/bootstrap`
gained exactly one field, `history`, carrying 56 days of bodyweight, intake and
hard-set counts plus e1RM series for the three main lifts. Days with nothing
logged are ABSENT — a gap is a gap and the client must not interpolate.

Charts are `Chart` / `Sparkline` / `BarSeries` in `mobile/components/ui/`, on
`react-native-svg`, which was already a dependency. No new dependency was added
anywhere in this round.

---

## Architecture decisions

### 1. Expo SDK version

**Choice.** Expo SDK 58 — `expo@~58.0.19`, React Native 0.88.0, React 19.3.0. Every other native-bearing package pinned to the version in expo@58.0.19's `bundledNativeModules.json` (verified by downloading the package, not from memory).

**Why.** Expo Go on the App Store ships exactly one SDK runtime: the current one. Targeting any earlier SDK means the QR scan ends in "Project is incompatible with this version of Expo Go" — which is the exact failure mode the whole constraint exists to avoid. SDK 58 was confirmed as the current published release (`npm view expo version` → 58.0.19) rather than assumed.

**Expo Go.** This IS the Expo Go runtime. Mismatched versions of bundled libraries (reanimated, screens, gesture-handler) are the single most common red screen, so the pins are copied verbatim from the SDK's own manifest.

### 2. Navigation

**Choice.** expo-router `~58.0.26`, file-based, with a 4-item `Tabs` layout plus modal routes. Not react-navigation directly.

**Why.** expo-router is what `create-expo-app` produces for SDK 58, so it is the most-exercised configuration in existence for this runtime. It is react-navigation underneath, so nothing is given up. Picking it also means the native stack/tab animations, gestures and header behaviour come from the platform rather than being hand-rolled — which is most of the "it feels wrong" complaint.

**Expo Go.** expo-router and its whole peer set (react-native-screens, safe-area-context, gesture-handler, reanimated, worklets, @expo/ui, expo-linking, expo-symbols, @expo/metro-runtime) are the default template's dependencies, therefore all present in Expo Go at the pinned versions.

### 3. Where mobile/ sits — and explicitly NOT npm workspaces

**Choice.** `/home/user/lifemaxx/mobile/` is a self-contained npm project nested in the existing repo: its own `package.json`, its own `node_modules`, its own lockfile. The root `package.json` is not converted to workspaces and gains no mobile dependencies.

**Why.** The root app needs `react@19.0.0` for Next 15; Expo SDK 58 needs `react@19.3.0` plus `react-native`. Workspaces hoist, and a hoisted single React means Metro bundles a React that does not match the renderer it was built against — "Invalid hook call" / renderer-mismatch, on a device, with no debugger. Two isolated dependency trees make that impossible. The cost is `npm install` twice, which is nothing.

**Expo Go.** Removes the highest-probability bundle-time failure. Metro is then locked to mobile/node_modules only (`resolver.disableHierarchicalLookup = true`), so it can never climb into the Next app's tree and pick up the wrong React.

### 4. How src/lib/domain and the outbox queue are shared

**Choice.** Metro `watchFolders: [<repo>/src/lib]` + eight one-line re-export barrels under `mobile/lib/shared/` that import by relative path (`export * from "../../../src/lib/domain/units"`). All other mobile code imports `@/lib/shared/units` etc., where `@/*` → `./*` (mobile root) in `mobile/tsconfig.json`. No publish step, no copy, no symlink, no workspace.

**Why.** The domain layer and `outbox/queue.ts` are pure TypeScript with zero runtime imports — `src/lib/domain/*` only reaches outside itself for `import type { Muscle } from "@/db/schema"`, which Babel's TypeScript transform elides before Metro ever sees it. So the risky part (resolving a path outside the project root) is confined to eight files owned by one engineer, and everyone else uses the `@/` alias that the official template already proves works.

**Expo Go.** Nothing native involved. The failure mode would be a bundling error on `npx expo start`, which is caught in the container by running the bundler — not a device-only risk.

### 5. How the native client authenticates

**Choice.** Supabase email/password through `@supabase/supabase-js@2.118.0` on the device; the access token is sent to the Next.js API as `Authorization: Bearer <jwt>`. The API gains a bearer path alongside the existing cookie path. Tokens persist in `expo-secure-store` through a chunking adapter.

**Why.** A native client has no cookies, so `createServerClient` resolves nobody and every screen loads nothing — this is the project's hard dependency. Email/password already exists in the web app, so there is no magic-link deep-link dance. Server-side the token is verified by Supabase (`auth.getUser(token)`), never by locally decoding a JWT and trusting `sub`. The resolved id still flows through `withUser()`, so RLS is untouched.

**Expo Go.** supabase-js is pure JavaScript; expo-secure-store is an SDK module present in Expo Go. The chunking matters: SecureStore warns and can fail above 2048 bytes per value, and a Supabase session JSON exceeds that — so it is split across `lifemaxx.session.0..n` with a count key.

### 6. The backend read API (the second gap, discovered while reading)

**Choice.** A new read surface at `src/app/api/mobile/*`: `GET bootstrap`, `GET session`, `GET exercise?id=`, `GET food?date=`, `GET coach`, `POST exercise/alias`. Owned by one engineer (backend-auth).

**Why.** The web app has NO read API — every screen reads `src/lib/queries.ts` directly from a server component. There are only POST/DELETE routes today. Without GET endpoints the native app authenticates successfully and then displays nothing. `bootstrap` is deliberately one fat call (dashboard + 56 days of runs + full exercise catalogue + last set per exercise) so the phone has everything it needs to work in a basement after a single request.

**Expo Go.** Server-side only. Weights cross the wire in lb and dates as `YYYY-MM-DD`, matching the web's existing edge-conversion rule, so no native code ever touches kg.

### 7. Local persistence for the outbox

**Choice.** `expo-sqlite@~58.0.14` behind a new `OutboxStore` adapter (`all`/`put`/`remove`). The existing `flush()`, `backoffMs()`, `classifyStatus()` and `newClientId()` in `src/lib/outbox/queue.ts` are imported and reused unchanged.

**Why.** The queue was deliberately written storage-agnostic with a three-method interface; the native side is a ~40-line adapter, not a second queue. Duplicating the delivery rules (in order, stop at first failure, only retry what retrying can fix) would mean two implementations of the one thing that is actually tested.

**Expo Go.** expo-sqlite is an SDK module in Expo Go. react-native-mmkv is explicitly out (needs prebuild). AsyncStorage is avoided too — SQLite gives ordered, durable rows and is the module Expo actually ships.

### 8. Starting a session with no signal

**Choice.** `session-start` becomes a second outbox kind. If `POST /api/session/start` fails, the start is queued ahead of the sets and the session runs locally; the queue delivers the start first, then the sets. `OutboxKind` widens from `"set"` to `"set" | "session-start"` — the only permitted edit to queue.ts. A queued start older than 6 hours is dropped with a visible message.

**Why.** `POST /api/sets` resolves the workout server-side via `getActiveWorkout()` and the set payload carries no workout id — so an ordered queue makes this work with no new server contract at all. Without it, the first set of the day in a basement has nowhere to go and the whole offline story collapses at the one moment it matters. The 6-hour cap matches the spec's existing auto-abandon rule, because a start delivered the next morning would land on the wrong `local_date`.

**Expo Go.** Pure JS type widening; the Dexie adapter and all existing outbox tests are unaffected (a union gains a member, nothing narrows).

### 9. State and data fetching

**Choice.** `@tanstack/react-query@5.104.5` for all reads (one query per endpoint, `staleTime` 30s, refetch on focus and on outbox drain). Writes go through the outbox, never through react-query mutations. Live session UI state is plain React state inside the Lift feature. No Redux, no Zustand, no MMKV-backed store.

**Why.** Reads are server-owned and cacheable; writes are already solved by the outbox and must not be routed through a second mechanism that doesn't survive a dead phone. Eight engineers hand-rolling fetch + loading + error + refetch would produce eight different behaviours.

**Expo Go.** Pure JavaScript, no native module. Persistence of the query cache is NOT enabled (that would need another dep); offline reads come from the one `bootstrap` payload written into SQLite by the app itself.

### 10. Audio capture and upload

**Choice.** `expo-audio@~58.0.10` — `useAudioRecorder` with voice-tuned `RecordingOptions` (m4a / AAC, 16 kHz, mono, 24 kbps, metering on), uploaded as `multipart/form-data` to `POST /api/voice/transcribe` using RN's `{ uri, name, type }` FormData part. Transcription happens server-side; `expo-file-system` deletes the local file afterwards.

**Why.** Speech recognition is a native module and cannot exist in Expo Go, so the microphone is the only part that runs on-device. expo-audio is the SDK's recorder (expo-av is deprecated). Multipart avoids base64's 33% inflation; a 15-second mono AAC clip is ~45 KB, far under Vercel's 4.5 MB request limit.

**Expo Go.** expo-audio, expo-file-system and expo-keep-awake are all SDK modules in Expo Go. In Expo Go the microphone usage string comes from Expo Go itself, so no config plugin and no prebuild is needed — `ios.infoPlist.NSMicrophoneUsageDescription` goes in app.json anyway for a future dev build, which is inert in Expo Go. @react-native-voice/voice is explicitly out.

### 11. Streaming the coach

**Choice.** `import { fetch } from "expo/fetch"` for the two streaming routes (`/api/session/ask`, `/api/coach/chat`). Fall back to `await res.text()` and render at once if a stream misbehaves.

**Why.** React Native's default `fetch` is XHR-backed and leaves `response.body` undefined, so the existing `ReadableStream` text/plain routes would appear to hang and then dump everything at the end. Expo ships a WinterCG fetch at `expo/fetch` that supports `response.body.getReader()`. This is non-obvious and would otherwise cost an engineer a day; both routes already work unchanged either way.

**Expo Go.** `expo/fetch` is part of the `expo` package (confirmed in its exports map for 58.0.19), so it is in Expo Go by definition. No extra dependency.

### 12. Meal photo capture

**Choice.** `expo-image-picker@~58.0.10` (`launchCameraAsync`) + `expo-image-manipulator@~58.0.15` (`manipulateAsync` → resize 1024, JPEG q0.8, `base64: true`) → existing `POST /api/meals/analyze` as a `data:image/jpeg;base64,…` URL. Not expo-camera.

**Why.** The system camera UI is the native feel; a custom expo-camera viewfinder is more code for a worse result. The existing route already takes a data URL and discards the image, so the server contract does not change. Resizing before upload is the difference between one second and eight on cell data, exactly as the web client already does with canvas.

**Expo Go.** Both are SDK modules in Expo Go; permission strings come from Expo Go. The photo is never written to the app's documents directory, never added to the library, and never persisted server-side — in-memory only, as the spec requires.

### 13. Number entry

**Choice.** A custom `NumberPad` component (3×4 big keys in a bottom overlay) for every weight, rep, RPE and bodyweight entry. The system keyboard appears in exactly two places: the exercise search field and the coach's message field.

**Why.** This is the direct fix for three of the named complaints at once — keyboard, tap latency, layout displacement. A `TextInput` with a numeric keyboard costs focus latency, an animated keyboard that reflows the screen, and a dismiss gesture. A pad that is just `Pressable`s is instant, never moves the layout, and can have 64pt targets for chalky hands.

**Expo Go.** Plain View/Text/Pressable. No native module, no third-party keyboard library (react-native-keyboard-controller is deliberately not used).

### 14. Haptics

**Choice.** `expo-haptics@~58.0.7`, wrapped in `mobile/lib/haptics.ts` with three named calls: `tapSelect()` (selection), `tapSave()` (medium impact), `tapDone()` (success notification). Features call the wrapper, never expo-haptics directly.

**Why.** "No haptics" was named explicitly. One wrapper means the vocabulary stays consistent across eight engineers instead of becoming a random assortment of impact strengths, and it is one place to no-op if anything misbehaves.

**Expo Go.** SDK module, present in Expo Go.

### 15. API base URL

**Choice.** `app.json` → `expo.extra.apiBaseUrl`, read via `expo-constants`; overridden at bundle time by `EXPO_PUBLIC_API_BASE_URL`; overridden at runtime by a value the user can type in the You screen and which is stored in SecureStore. Default: the deployed Vercel URL.

**Why.** Expo Go runs on a real phone, so `localhost` is the phone itself. The deployed API is the right default. The runtime override lets the same scanned QR code point at `http://192.168.x.x:3000` for LAN development without touching the bundle — and `crypto.randomUUID` is already handled on plain HTTP by the existing `newClientId()` fallback, which was written for precisely this.

**Expo Go.** `extra` + `EXPO_PUBLIC_*` are standard Expo config, no plugin, no prebuild. Plain-HTTP LAN requests work in Expo Go without ATS exemptions because Expo Go's own entitlements permit them.

### 16. HealthKit

**Choice.** Out. No library installed, not attempted. One short paragraph in `mobile/README.md` saying what a future `eas build` dev client would unlock.

**Why.** It cannot work in Expo Go under any configuration, and the user said not to worry if it is hard. The Health Auto Export webhook already delivers steps, sleep and weight into `body_metrics` and keeps working untouched.

**Expo Go.** The safest possible choice — installing react-native-health or @kingstinct/react-native-healthkit would make the QR code produce a red screen on launch.

### 17. Visual language

**Choice.** Ported, not redesigned. `mobile/components/ui/tokens.ts` holds the exact hex values from `globals.css`; `fontVariant: ["tabular-nums"]` is baked into every numeric Text; micro-labels are 10pt Menlo, uppercase, `letterSpacing: 1.4`, muted. Dark only — `userInterfaceStyle: "dark"`.

**Why.** The user did not complain about how it looks. Re-deriving the palette by eye across eight engineers is how a port drifts; copying the tokens makes drift impossible.

**Expo Go.** No `expo-font`, no font files, no asset pipeline: Menlo is a system face on iOS. Fewer assets also means no missing-file errors on `expo start`.

### 18. Verification strategy in a container with no simulator

**Choice.** Four gates, all runnable here: `tsc --noEmit` in both projects, `vitest` for pure logic (root suite must stay green), `npx expo export --platform ios` to prove Metro bundles every route, and `npx expo start --web` as a rough visual smoke test of pure-RN components. No claim that a native behaviour is verified.

**Why.** A successful Metro bundle is the single most valuable signal available without a device: it catches version mismatch, unresolvable shared imports and bad native-module imports — which is the majority of what would otherwise be a red screen. Everything about gestures, haptics, keyboard and recording is unverifiable here and must be reported as such.

**Expo Go.** `expo export` resolves and bundles exactly what Expo Go would download, so an Expo-Go-incompatible import usually fails here first. It cannot catch a module that bundles fine but is absent from the Expo Go binary — which is why the allowlist is the real control.


---

## Dependency allowlist

Closed list. Engineers may not add anything outside it; a wanted package is reported as a blocker instead. Every entry is an Expo SDK module, a pure-JS library, or one of the third-party natives the official SDK 58 template already depends on — so present in the Expo Go binary by construction.

- `expo@~58.0.19`
- `expo-router@~58.0.26`
- `expo-constants@~58.0.13`
- `expo-linking@~58.0.14`
- `expo-symbols@~58.0.4`
- `@expo/ui@~58.0.23`
- `expo-glass-effect@~58.0.5`
- `expo-splash-screen@~58.0.11`
- `expo-status-bar@~58.0.4`
- `expo-system-ui@~58.0.6`
- `react@19.3.0`
- `react-dom@19.3.0`
- `react-native@0.88.0`
- `react-native-web@~0.21.4`
- `react-native-gesture-handler@~3.3.0`
- `react-native-reanimated@4.7.1`
- `react-native-worklets@0.13.0`
- `react-native-screens@~4.30.0`
- `react-native-safe-area-context@~5.10.1`
- `react-native-svg@15.16.0`
- `@expo/vector-icons@^15.0.2`
- `expo-sqlite@~58.0.14`
- `expo-secure-store@~58.0.2`
- `expo-haptics@~58.0.7`
- `expo-audio@~58.0.10`
- `expo-image-picker@~58.0.10`
- `expo-image-manipulator@~58.0.15`
- `expo-file-system@~58.0.11`
- `expo-network@~58.0.4`
- `expo-keep-awake@~58.0.3`
- `@supabase/supabase-js@2.118.0`
- `react-native-url-polyfill@4.0.0`
- `@tanstack/react-query@5.104.5`
- `typescript@~6.0.3 (devDependency)`
- `@types/react@~19.3.0 (devDependency)`
- `vitest@^2.1.5 (devDependency)`

---

## Information architecture

The web app's six tabs (Today / Food / Lift / Runs / Coach / You) do **not** survive contact with a phone. Six items in a 390pt tab bar is 65pt per target, and two of those tabs are things you look at weekly or daily-at-most while the one you open mid-set is the same size as the rest. The user's complaint is tap count; the fix is to spend the tab bar on what is opened under time pressure.

**Four tabs:**

| Tab | Route | Why it earns a tab |
|---|---|---|
| **Today** `◎` | `app/(tabs)/index.tsx` | The landing surface. Fuel card, train-next, running week, measured maintenance. Pull-to-refresh. |
| **Lift** `▮` | `app/(tabs)/lift.tsx` | The reason the project exists. Opens **directly into the live session** when one is active — no start screen, no "resume?" prompt, no extra tap. |
| **Food** `◍` | `app/(tabs)/food.tsx` | Logged 3–4× a day. A single FAB goes straight to the camera. |
| **You** `○` | `app/(tabs)/you.tsx` | Weight entry at the very top (one tap + NumberPad), then goals, API base URL, sign in/out. Weight is a daily ritual and belongs above the fold, not three taps deep. |

**Runs loses its tab.** Runs are read-only data synced from Strava and Health Auto Export — you never log one, you review them weekly. The week's mileage, pace and interference warning stay on Today as a card (computed on-device from `bootstrap.runs` with the shared `summarizeRunningWeek`), and `See the week →` pushes `app/runs.tsx` as a stack screen *inside the Today tab*, so the back gesture works and the tab bar stays put. Net effect: runs cost one extra tap when you want them and zero when you don't, and Lift gets 25% of the bar instead of 16%.

**Coach loses its tab too, and gains two better doors.** Chat is a task, not a place. `app/coach.tsx` is a modal (`presentation: "modal"`, native sheet) opened from a `◆` button in the Today header. Separately, the in-session `ASK` control inside the Lift screen posts to `/api/session/ask` — a *different* endpoint with session context and a cached prefix, streamed. Giving chat a permanent tab would cost a sixth of the bar for something used once a day, and would also blur two endpoints that answer differently.

**Full route tree** (expo-router, `mobile/app/`):

```
app/
  _layout.tsx            root stack · dark theme · QueryClientProvider · outbox boot · session gate
  (tabs)/
    _layout.tsx          4-item Tabs, accent active tint, glyph icons (◎ ▮ ◍ ○)
    index.tsx            Today
    lift.tsx             Session (live) or Start
    food.tsx             Food
    you.tsx              You / settings
  runs.tsx               pushed from Today
  exercise.tsx           ?id= — history, e1RM trend; pushed from a session card or Runs
  coach.tsx              modal
  exercise-picker.tsx    modal, full-screen search — shared by Lift and Voice
  sign-in.tsx            replaces the stack when there is no session
```

Rules that keep the feel native: every push is a native stack push (back-swipe works), every picker is a sheet or a modal and never a `<select>`-style dropdown, and no screen ever uses `Alert.alert` for anything a user does on purpose.

---

## Shared code strategy

Goal: the native app imports `src/lib/domain/*` and `src/lib/outbox/queue.ts` with **no copy, no publish step, and no npm workspace**. Metro must resolve files above its own project root; here is exactly how.

### 1. Layout

```
/home/user/lifemaxx/
  package.json            Next app. UNCHANGED. No mobile deps, not converted to workspaces.
  tsconfig.json           one edit: "exclude": ["node_modules", "mobile"]
  src/lib/domain/*.ts     shared, unchanged
  src/lib/outbox/queue.ts shared, one permitted edit (OutboxKind union)
  mobile/
    package.json          separate project, its own node_modules + lockfile
    tsconfig.json
    metro.config.js
    app.json
    app/  components/  features/  lib/
```

**Not workspaces.** Root needs `react@19.0.0` (Next 15); Expo SDK 58 needs `react@19.3.0` + `react-native`. Hoisting those into one tree gives Metro a React that does not match its renderer — "Invalid hook call" on a device with no debugger. Two trees makes that impossible.

### 2. `mobile/metro.config.js`

```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, "..", "src", "lib");

const config = getDefaultConfig(projectRoot);

// Metro only serves files it watches. Watch the shared folder — and only that,
// so the crawler never walks .next/, the root node_modules or public/.
config.watchFolders = [sharedRoot];

// Resolve packages ONLY from mobile/node_modules. Without both of these lines
// Metro climbs to the repo root and can bundle the Next app's react@19.0.0
// alongside react-native 0.88's renderer.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
```

That is the whole of it. Watching `../src/lib` + relative imports is the long-proven monorepo pattern; `disableHierarchicalLookup` is the part people forget.

### 3. `mobile/tsconfig.json`

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

`@/*` → the **mobile** root, matching the official Expo template (which proves tsconfig-paths resolution works in Expo Go). It deliberately does *not* alias the Next app's `@/` → `src/`.

### 4. The eight barrels — the only files that reach outside `mobile/`

`mobile/lib/shared/` contains one one-line file per shared module, each a relative re-export:

```
mobile/lib/shared/units.ts        export * from "../../../src/lib/domain/units";
mobile/lib/shared/e1rm.ts         export * from "../../../src/lib/domain/e1rm";
mobile/lib/shared/progression.ts  export * from "../../../src/lib/domain/progression";
mobile/lib/shared/muscles.ts      export * from "../../../src/lib/domain/muscles";
mobile/lib/shared/readiness.ts    export * from "../../../src/lib/domain/readiness";
mobile/lib/shared/tdee.ts         export * from "../../../src/lib/domain/tdee";
mobile/lib/shared/running.ts      export * from "../../../src/lib/domain/running";
mobile/lib/shared/outbox.ts       export * from "../../../src/lib/outbox/queue";
```

Every other file in the app imports through the alias and never writes a `../../../`:

```ts
import { displayLb, platesPerSide } from "@/lib/shared/units";
import { flush, newClientId, type OutboxItem, type OutboxStore } from "@/lib/shared/outbox";
import { summarizeRunningWeek, weekStartOf, formatPace } from "@/lib/shared/running";
```

One file per module rather than a single index, because `export *` across seven modules risks a name collision the day someone adds one.

### 5. Why this works at runtime, and the one thing to watch

- `src/lib/outbox/queue.ts` has **zero imports**. Nothing to resolve.
- `src/lib/domain/*.ts` only reach outside themselves for `import type { Muscle } from "@/db/schema"` in `muscles.ts`, `readiness.ts` and `running.ts`. That is a **type-only** import: Babel's TypeScript transform elides it before Metro sees the file, so no Next-app alias ever needs to resolve at bundle time and `drizzle-orm` is never pulled into the bundle.
- For **typechecking**, `tsc` in `mobile/` does need `@/db/schema` → it resolves because `mobile/tsconfig.json` has no such alias, which means `tsc` reports it as unresolved. Fix: add `"@/db/schema": ["../src/db/schema.ts"]` to `paths` as a second, narrow entry. That pulls `src/db/schema.ts` into the mobile typecheck program, which imports `drizzle-orm/pg-core`; Node resolution from that file's own directory finds `/home/user/lifemaxx/node_modules/drizzle-orm`. **So the root `npm install` must have been run before `npm run typecheck` in `mobile/`** — document that in `mobile/README.md`.
- `src/lib/domain/*` is `strict`-clean already, so it typechecks under the mobile config without changes.

### 6. Tests

Root `vitest.config.ts` includes only `src/**/*.test.ts`, so nothing in `mobile/` is picked up by the existing 158-test suite and it stays green. `mobile/` gets its own `vitest.config.ts` (`include: ["lib/**/*.test.ts"]`, `environment: "node"`) for pure-logic modules only — anything importing `react-native` is not unit-tested here. `vitest` is a devDependency and is never bundled.

### 7. Root-level edits (expo-scaffold only, and these are the complete list)

- `tsconfig.json`: add `"mobile"` to `exclude` — otherwise `next build`'s typecheck compiles React Native code with `jsx: "preserve"` and the DOM lib, and fails.
- `.gitignore`: add `mobile/node_modules/`, `mobile/.expo/`, `mobile/dist/`.
- `src/lib/outbox/queue.ts`: widen `export type OutboxKind = "set"` to `"set" | "session-start"`. Nothing else in the file changes; all existing outbox tests must still pass.

Nobody touches `README.md`, `.env.example`, `package.json` at the root, `src/app/`, `src/components/` or `public/` except where a brief explicitly grants it.

---

## Logging a set by hand

— logging a set by hand, mid-workout

Context: standing up, holding a barbell, chalk on hands, phone in one hand, possibly no signal, 90 seconds of rest. On the web today this costs a `<select>`, three number fields and a save tap. Target: **one tap for the common case**, and nothing that can go wrong when the network is gone.

### Screen: `mobile/app/(tabs)/lift.tsx` → `features/lift/SessionScreen.tsx`

No intermediate screen. Tapping the Lift tab with an active session goes straight to the live session. With no session, the same route renders `StartScreen`.

**StartScreen** — one 72pt `Button` reading "START LIFT", the gym name under it as a tappable line (defaults to the default gym; tapping opens a small picker sheet, not a dropdown), and the owed-muscles line from `bootstrap.volume.ranked` as plain text. Nothing else.

### SessionScreen layout, top to bottom

1. **Header, 44pt.** Elapsed minutes (`tnum`, updates every 10s) · queue pill · "STOP". STOP opens a confirm sheet (never a JS `confirm`), and the sheet shows the session summary returned by `/api/session/stop`.
   - Queue pill: `3 QUEUED` in `muted`, mono micro-label style. Not red, no spinner, no badge animation. When the queue drains it fades out. If an item is dropped permanently, the pill becomes one tappable line: "1 set didn't save — tap to retry" in `warn`.
   - If the session itself is still queued (offline start): "SESSION PENDING" in `muted`, and the elapsed clock runs from the locally stored start time.

2. **Exercise pager.** A horizontal `react-native-gesture-handler` pager, one page per exercise in today's session, in the order first performed, plus a trailing "+ ADD EXERCISE" page. Swipe left/right to move between exercises — this replaces the dropdown entirely. Page dots + the exercise name sit above the card. `tapSelect()` haptic on page change. Pages are rendered lazily (current ±1).

3. **The current exercise card.**
   - **Line 1:** exercise name, 20pt semibold.
   - **Line 2:** `LAST: 185 × 5 × 3 @7 · 4d ago`, mono micro-label + `tnum`, from `bootstrap.lastSets[exerciseId]`. When there is no history: `FIRST TIME`.
   - **The primary control — a 72pt-tall, full-width button labelled with the exact set it will log: `LOG 185 × 5`.** This is repeat-last-set as the default action. One tap writes the set. It is the largest target on the screen and sits where a thumb lands.
     - Pre-fill order: (a) the last set logged for this exercise *in this session*, (b) `bootstrap.lastSets[exerciseId]`, (c) the `suggestion`/`baseline` from `POST /api/session/suggest` if it arrives, (d) empty → the button reads `SET WEIGHT` and opens the NumberPad instead.
     - `/api/session/suggest` is fire-and-forget on page focus. If it returns, the baseline and suggestion render as two small lines *below* the button, exactly as the web shows them (the rule's number next to the model's, so a deviation is visible). If it fails or there is no signal, nothing is shown and logging is unaffected.
   - **Steppers, one row under the button:** `−  185 lb  +` and `−  5 reps  +`. Increment for weight is the exercise's own `incrementLb` from the catalogue (5 lb default); reps step by 1. 56pt targets, `tapSelect()` on each. Tapping the *number itself* (not the ± ) opens the NumberPad for that field.
   - **Chips, one wrapping row:** `RPE` (tapping expands an inline 6–10 chip row, second tap collapses), `TO FAILURE`, `WARMUP`, `WEAK` / `NORMAL` / `STRONG`. All one-tap toggles, all 44pt high. No dropdowns anywhere in this flow.
   - **A `NOTE` chip** at the end of that row; tapping it reveals a single-line `TextInput` (the only system keyboard in the flow besides search). Collapsed by default because it costs a keyboard.

4. **Today's sets for this exercise**, as pills below the card: `185 × 5 @7`. Warmups in `muted` with a plain border; queued sets with a **dashed** border at 70% opacity (identical to the web's treatment); failure sets with a trailing `F` in `warn`. Long-press a pill → "Remove set?" sheet → `DELETE /api/sets { id }` for a delivered set, or removal from the outbox for a queued one.

5. **Rest timer.** A 3pt bar pinned directly above the tab bar, with `1:27` in `tnum` at its right end. Starts automatically on every save, 120s default. It is a bar, not a modal, and never blocks anything. Tap to dismiss, long-press to restart. At zero: `tapDone()` haptic and the bar turns `accent` for 2s then clears. No notification is scheduled (expo-notifications is out of scope; a backgrounded Expo Go app will not fire it reliably anyway — say so in the README rather than ship a timer that lies).

### What a save does

```
const clientId = newClientId();                       // shared, from src/lib/outbox/queue.ts
await enqueue("set", "/api/sets", {                    // mobile/lib/outbox.ts
  clientId, exerciseId, reps, weightLb, rpe, toFailure, isWarmup, felt, note, rawText: ""
});
tapSave();                                             // medium impact, immediately
```
- `tapSave()` fires **before** the await resolves — the haptic is the acknowledgement, not the network.
- The set pill appears optimistically the moment it is queued and is reconciled by `clientId` when `/api/mobile/session` next returns it, matching `LiftClient`'s existing approach. Match on `clientId`, never by counting.
- RPE, to-failure, felt and note reset after each save. **Weight and reps persist.** That is what makes the next set one tap.
- The rest timer starts. The pager does not move.

### Tap costs (the acceptance criterion)

| Action | Taps |
|---|---|
| Repeat last set | **1** |
| One increment heavier, then log | 2 |
| Arbitrary weight (tap number, 3 keys, Done, Log) | 6 |
| Add RPE to the set you're about to log | 2 + 1 |
| Move to the next exercise | 1 swipe |
| Add an exercise not yet in the session | 1 swipe + 1 tap + type 2–3 chars + 1 tap |

### Add-exercise

The trailing pager page and the voice flow both open `features/lift/ExercisePicker.tsx` as a full-screen modal: one `TextInput` (autofocus), a `FlatList` filtered over the cached catalogue, with exercises whose muscles appear in `volume.ranked` pinned at the top under an `OWED THIS WEEK` label. Tapping one appends a page to the pager and focuses it. Fully offline — the catalogue came down in `bootstrap`.

### Non-negotiables

- No `Alert.alert` and no `confirm` anywhere in this flow. Errors are inline lines; destructive actions are sheets.
- Nothing in this flow awaits the network before updating the UI. The only networked affordances (suggest, baseline) are additive and absent when offline.
- `useKeepAwake()` while a session is active.
- The queued state must be obvious and unalarming: muted text, no red, no modal, no "offline!" banner.

---

## Speaking a set

> **Scope note.** After this was written the priority changed: free-text entry is the requirement, voice is a nice-to-have. The confirmation sheet below is identical either way — only how the text arrives differs. Text-first is the build order.

— speaking a set

Target phrase: *"did 3 sets weighted pull ups 45lbs for 6 reps"* → 3 rows in `sets`, against the pull-up exercise, 45 lb, 6 reps each. Nothing is written until the user confirms.

Note up front, so nobody "fixes" the wrong thing: **that phrase does not parse with the shorthand parser** (`parseEntry` finds `"did"` as the exercise name and bails), so it falls through to the model with `SETS_SYSTEM` — which is exactly the designed path. Do **not** extend `src/lib/llm/shorthand.ts` to handle prose; it has passing tests and the fallback already exists.

### Entry point

A 56pt circular mic button at the bottom-right of the current-exercise card in the session screen, with 12pt `hitSlop`. Also present (same component) on the session StartScreen, where confirming queues a `session-start` ahead of the sets.

### Start / stop: tap-to-toggle, not hold-to-talk

**Tap to start, tap to stop.** Rationale, since it is the one interaction decision here: with chalk or sweat on your fingers a press can lift without you noticing, and a hold gesture that drops mid-sentence truncates the recording *silently* — you find out when the transcript is half a sentence. A toggle also lets you set the phone down on the bench and talk. Hard cap 15s with a countdown appearing in the last 5s, then auto-stop. No silence detection in v1 (metering-based VAD is a guess, and a guess that ends your sentence early is worse than a second tap).

### While recording

- Button fills `accent`, label becomes `STOP`, with `0:04` in `tnum` beside it.
- A 5-bar level meter driven by `useAudioRecorderState(recorder, 100).metering` — this is the only honest proof that the mic is live.
- `tapSelect()` on start, `tapSave()` on stop. `useKeepAwake()` for the duration.
- The rest of the session screen stays fully interactive. Recording never blocks the manual path.
- Permission: `getRecordingPermissionsAsync()` then `requestRecordingPermissionsAsync()` on first use; denial shows one inline line, not an alert. `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` before `prepareToRecordAsync()`.

### While the server works

Button becomes a pulsing outline labelled `TRANSCRIBING…`; a skeleton row appears where the parsed sets will land. Client timeout 20s. On timeout or 5xx: `Didn't come back. Tap to retry, or log it by hand.` — **the recording file is kept**, so retry re-uploads the same audio instead of making the user say it again. The file is deleted only after a confirm or an explicit discard.

### The confirmation sheet — nothing is written before this

> **SUPERSEDED IN PART.** Points 2 and 3 below describe a per-SET layout and a
> two-value `confidence`; the sheet was rebuilt around per-ENTRY groups after
> first use, and an unknown exercise is now created rather than reported. See
> [First-use fix round](#first-use-fix-round-2026-10-25). Point 1 (the verbatim
> transcript and RE-PARSE) and point 4 (the outbox, one item per set, with
> `rawText`) are unchanged and still correct.

A bottom sheet, not a full screen, so the session stays visible behind it.

1. **Transcript, verbatim**, in `muted` 13pt. Tappable → becomes a `TextInput` with a `RE-PARSE` button, which re-runs parsing on the edited text via `POST /api/sets/parse { text }` (same response shape, no new audio). This is the escape hatch for a badly misheard sentence.
2. **One editable row per set** — per *set*, not per entry, because fixing "3 sets" heard as 2 must not require re-speaking:
   `[ Weighted Pull-up ▾ ]   [ 45 lb ]   [ × 6 ]   [ ⧉ ]  [ × ]`
   - Every number is tappable and opens the **same NumberPad as the hero flow**. No typing.
   - `⧉` duplicates the row (adds a set); `×` deletes it.
   - RPE / to-failure / warmup from the parse render as small chips on the row and are toggleable.
3. **Exercise resolution, made visible:**
   - `confidence: "exact"` → plain chip with the canonical name.
   - `confidence: "fuzzy"` → chip marked with a leading `~` and a line under it: `heard: "weighted pull ups"`. A wrong fuzzy match is the one failure that corrupts history quietly, so it is always shown.
   - Tapping the chip opens `ExercisePicker` pre-filled with the raw query. Picking an exercise re-files **every row of that entry** and fires `POST /api/mobile/exercise/alias { exerciseId, alias: <rawQuery> }` so the same wording is free next time.
   - **Unresolved** (`unresolved[]` non-empty, or `exercise: null`): the row shows `UNMATCHED: "weighted pull ups"` in `bad`, and **the confirm button is disabled until every row has a real `exerciseId`**. Never guess, never drop the row silently.
   - Zero entries parsed: `Couldn't parse that.` plus the editable transcript and a `LOG BY HAND` button that closes the sheet with the NumberPad already open. The transcript is never lost.
4. **Primary button: `LOG 3 SETS`.** On tap, each row is queued as its own outbox item with its own `newClientId()`, through the **same `mobile/lib/outbox.ts` used by manual logging** — and with `rawText: <transcript>` so `sets.raw_text` keeps what was actually said (the column already exists for exactly this). `tapDone()` haptic, sheet closes, pills appear dashed/queued in the session list. Local audio file deleted.

### No signal

The mic button renders disabled with a `NEEDS SIGNAL` sub-label when `expo-network`'s state reports no connectivity. Tapping it does **not** record: it shows one inline line — `No signal. Speaking needs the server; logging by hand works offline.` — and opens the NumberPad. Queueing audio for later transcription is deliberately rejected: the result needs confirmation, and asking someone to confirm a sentence they said forty minutes ago in the car park is worse than a one-tap manual log.

### API contract, end to end

**`POST /api/voice/transcribe`**

Request — `multipart/form-data`, `Authorization: Bearer <supabase access token>`, no manually set `Content-Type` (RN writes the boundary):

| part | type | notes |
|---|---|---|
| `audio` | file | `{ uri: recorder.uri, name: "set.m4a", type: "audio/m4a" }`. AAC-LC in MPEG-4, 16 kHz mono, 24 kbps. ~45 KB for 15s. |
| `hint` | text, optional | the current exercise name, passed to the transcriber as a decoding prompt to bias toward e.g. "weighted pull up". |

Server:
1. `const form = await req.formData()`. Reject: missing `audio` → 400; `size < 1_000` → 400 `"Nothing recorded."`; `size > 2_000_000` → 413; non-audio mime → 415.
2. Transcribe via a new `src/lib/llm/transcribe.ts` with the same two-provider shape as `getLlm()`: OpenAI (`client.audio.transcriptions.create({ file, model: MODELS.transcribe, language: "en", prompt: hint, response_format: "text" })`) and a fixtures provider returning a canned transcript that the **shorthand parser can actually parse** (e.g. `"bench 5x5 185"`), so `LLM_PROVIDER=fixtures` demonstrates the whole flow with no key and no network. If no transcription model is configured, return 503 `{ error: "Transcription is not configured." }` and the client shows `Speaking isn't set up yet — log it by hand.`
3. **Reuse the existing parse path, do not duplicate it.** Extract the body of `src/app/api/sets/parse/route.ts` into `src/lib/llm/parse-sets.ts`:
   ```ts
   export async function parseSetsText(text: string, userId: string): Promise<{
     usedModel: boolean;
     entries: { query: string; exercise: ResolvedExercise | null; sets: ParsedSet[] }[];
     unresolved: string[];
   }>
   ```
   with the same three steps in the same order: `parseShorthand(text)` → on empty, `getLlm().structured({ model: MODELS.setsParse, SETS_SYSTEM, JSON_SCHEMAS.parsed_sets, parsedSetsSchema })` → `withUser(userId, …)` + `resolveExercise()` per entry.
   *(Superseded: step 1 is now `parseLines` per line and step 3 is
   `resolveExerciseOutcome` plus creation. The signature gained an optional
   `nearMiss` and `dropped` per entry; nothing was removed.)* Then rewrite `/api/sets/parse` to call it, so there is exactly one implementation and the web client's behaviour is byte-identical.
4. Scoping: `route(..., { scope: "manual" })`. Both the transcription and the parse are model calls and must not run inside `withUser()`'s transaction — read/resolve in a scope *after* them, as `/api/sets/parse` already does.
5. The audio is never written to disk and never persisted. It lives in memory for one request, same rule as meal photos.

Response — `200`, deliberately `{ transcript } & <the exact /api/sets/parse response>` so the confirmation sheet is shared between spoken and typed entry:

```json
{
  "transcript": "did 3 sets weighted pull ups 45lbs for 6 reps",
  "usedModel": true,
  "entries": [{
    "query": "weighted pull ups",
    "exercise": { "id": "…", "name": "Weighted Pull-up", "slug": "weighted-pull-up",
                  "incrementLb": 5, "equipment": "bodyweight", "confidence": "fuzzy" },
    "sets": [
      { "reps": 6, "weight_lb": 45, "rpe": null, "to_failure": false, "is_warmup": false },
      { "reps": 6, "weight_lb": 45, "rpe": null, "to_failure": false, "is_warmup": false },
      { "reps": 6, "weight_lb": 45, "rpe": null, "to_failure": false, "is_warmup": false }
    ]
  }],
  "unresolved": []
}
```

Writes still go through `POST /api/sets` via the outbox. This route never writes a set.

---

## Workstream briefs

Eight engineers, working in parallel in one tree. File ownership is absolute — it is the only thing preventing collisions.


### `backend-auth` — Foundation phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# backend-auth — make the Next.js API serve a native client

You are the hard dependency the entire project sits on. Until this lands, no native screen can load anything. Two jobs: accept bearer tokens, and add the read endpoints that do not exist yet.

## Files you OWN (nobody else touches these)
- `src/lib/supabase/server.ts`
- `src/lib/api.ts`
- `src/lib/auth/**` (new)
- `src/app/api/mobile/**` (new)
- `src/app/api/session/ask/route.ts`, `src/app/api/coach/chat/route.ts`, `src/app/api/auth/ensure-profile/route.ts` — these three hand-roll their own auth and must be switched to the shared resolver. Change the auth lines only; leave their streaming and prompt logic alone.
- `src/middleware.ts`
- New test files under `src/lib/auth/`.

**Do not touch** anything else under `src/app/`, anything under `src/components/`, `public/`, `README.md`, `.env.example`, root `package.json`, root `tsconfig.json`, or anything under `mobile/`. Report any env var you need instead of adding it to `.env.example`.

## Job 1 — bearer auth

Today every data route resolves the user through `currentUserId()` in `src/lib/supabase/server.ts`, which reads Supabase SSR cookies via `createServerClient`. A phone has no cookies; it holds a Supabase JWT.

Create `src/lib/auth/bearer.ts`:

```ts
export function extractBearer(header: string | null): string | null
export async function userFromBearer(token: string): Promise<{ id: string; email: string } | null>
```

- `extractBearer`: case-insensitive `bearer ` scheme, exactly one space, non-empty remainder, no whitespace inside the token. Anything else → null.
- `userFromBearer`: verify with Supabase, do **not** decode the JWT locally. Build a throwaway client with the anon key and `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`, then `await client.auth.getUser(token)`. That call validates signature and expiry server-side. **Trusting a `sub` claim from an unverified decode is an auth bypass; it is the one thing that must not happen in this workstream.**
- Expose the verifier through a module-level seam (e.g. an exported `setVerifier()` or an injectable default) so tests never touch the network.

Then rework `src/lib/supabase/server.ts`:

```ts
export async function currentUser(req?: Request): Promise<{ id: string; email: string } | null>
export async function currentUserId(req?: Request): Promise<string | null>  // keep this name and signature working
```

Resolution order, and it matters:
1. If an `Authorization` header is present → verify it. Valid → that user. **Invalid → return null. Never fall through to cookies or to the dev shim.** A typo'd token must 401, not silently authenticate as somebody else.
2. No `Authorization` header → `DEV_USER_ID` shim, unchanged.
3. Then cookies, unchanged.

The `DEV_USER_ID` shim keeps **both** existing locks exactly as they are: `null` when `NODE_ENV === "production"`, inert unless the variable is set, and the one-time `console.warn`. Read the comment above it before editing; it must never become a feature flag.

RLS does not change. The resolved id still goes through `withUser()`. No service-role key ever reaches a client.

## Job 2 — `route()` gains request context

`src/lib/api.ts`'s `route()` currently hands the handler `{ userId, tz, today, body }` and discards the `Request`. Two additive changes, both backwards compatible (existing handlers ignore extra fields):

```ts
export type Handler<T> = (ctx: {
  userId: string; tz: string; today: string; body: T;
  req: Request;
  searchParams: URLSearchParams;
}) => Promise<unknown>;
```

- Pass `req` into `currentUserId(req)`.
- `searchParams` = `new URL(req.url).searchParams`. GET endpoints need it and there is no other way in through this helper.
- Keep the `scope: "auto" | "manual"` option, the `withUser()` wrapper, the 401 on no user, and the error shape identical. **Every existing route must keep working unchanged** — verify by reading each one under `src/app/api/`.

For the three hand-rolled routes, switch `currentUserId()`/`createClient()+getUser()` to `currentUser(req)` / `currentUserId(req)`. `ensure-profile` needs the email, which is why `currentUser` returns it; it must still take the id from the verified session and never from the request body.

## Job 3 — the read API (`src/app/api/mobile/`)

There is currently **no read API at all** — the web reads `src/lib/queries.ts` directly from server components. Build these with the `route()` helper, reusing `src/lib/queries.ts` and `src/lib/domain/*` as-is. Conventions, all six endpoints: weights in **lb** (`displayLb`), dates as `YYYY-MM-DD` local strings, timestamps as ISO 8601 UTC strings, **primitives only — never a `Date` object in a response**.

### `GET /api/mobile/bootstrap`
One fat call; the phone must be able to work offline afterwards.
```ts
{
  today: string; tz: string; goalsText: string;
  target: { kcal: number|null; proteinG: number; carbsG: number|null; fatG: number|null; mode: string } ;
  totals: { kcal: number; proteinG: number; carbsG: number; fatG: number };  // today, from sumMacros
  mealCount: number;
  volume: { summary: string;  // domain/readiness summarize()
            ranked: { muscle: string; label: string; setsLast7d: number; daysSinceTrained: number|null; score: number }[] };
  tdee: TdeeResult;                    // getTdee() verbatim; it is already primitives-only
  activeWorkout: { id: string; startedAt: string } | null;
  runs: { id: string; localDate: string; startedAt: string; name: string; type: string;
          distanceM: number|null; durationS: number; elevationM: number|null;
          avgHr: number|null; sufferScore: number|null; verdict: string|null }[];  // getRuns(), startedAt → ISO
  lowerBodyLiftDates: string[];        // getLowerBodyLiftDates()
  gyms: { id: string; name: string; isDefault: boolean }[];
  catalogue: { id: string; name: string; slug: string; incrementLb: number; equipment: string;
               muscles: { muscle: string; contribution: number }[] }[];
  lastSets: Record<string /* exerciseId */, { localDate: string; weightLb: number; reps: number;
                                              rpe: number|null; sets: number; bestE1rmLb: number|null }>;
}
```
- `target`: `getActiveTarget()`; when there is none, `kcal/carbsG/fatG` are null, `proteinG` is `defaultProteinTarget()`, `mode` is `"calibrating"`.
- `runs` + `lowerBodyLiftDates` are sent **raw on purpose** — the native app runs the same `summarizeRunningWeek()` on them, so the two clients cannot disagree. Do not precompute the weekly stats here.
- `catalogue` is the same query `src/app/lift/page.tsx` runs (user's + global exercises, ordered by name) plus `incrementLb` (`displayLb(incrementKg)`) and the muscle map from `musclesFor()`.
- `lastSets`: for each exercise the user has sets for, the most recent **completed** session's working sets — modal weight/reps, the set count, max RPE, and `bestE1rm` in lb. This is what makes repeat-last-set work with no signal; it is the single most load-bearing field in the payload.

### `GET /api/mobile/session`
`{ today, activeWorkout: { id, startedAt } | null, sets: [...] }` where each set is the `getWorkoutSets()` row with `weightKg` replaced by `weightLb` and `loggedAt` as ISO — i.e. exactly what `src/app/lift/page.tsx` already passes to `LiftClient`, plus `setIndex`, `restS` and `loggedAt`.

### `GET /api/mobile/exercise?id=<uuid>&limit=8`
Query param, not a dynamic segment (`route()` does not forward `params`). Returns `{ exercise: { id, name, slug, incrementLb, equipment }, history: [{ date, sets: [{ reps, weightLb, rpe, toFailure, isWarmup, felt, note }] }], bestE1rmLb: number|null }` from `getExerciseHistory()`.

### `GET /api/mobile/food?date=YYYY-MM-DD`
`{ date, meals: [{ id, slot, note, source, confidence, kcal, proteinG, carbsG, fatG, items: [{ name, qty, unit, kcal, proteinG, carbsG, fatG }] }], totals, target }`. Default `date` to `today` when absent. Validate the parameter against `/^\d{4}-\d{2}-\d{2}$/` and 400 otherwise.

### `GET /api/mobile/coach?limit=30`
`{ messages: [{ id, role, content, createdAt }] }`, oldest first, from `coach_messages`.

### `POST /api/mobile/exercise/alias`
`{ exerciseId: string, alias: string }` → calls the existing `learnAlias()` in `src/lib/exercises.ts`. Returns `{ ok: true }`. This is how a corrected voice mishearing becomes free next time. Validate `exerciseId` is a uuid the user can actually see; a non-empty alias under 80 chars.

## Job 4 — CORS

Native `fetch` is not CORS-constrained, so this is needed for exactly one thing: Expo's web target (`npx expo start --web`, origin `http://localhost:8081`) used as a visual smoke test. Keep it tight:
- Read an allowlist from `MOBILE_CORS_ORIGINS` (comma-separated). **Default empty — no CORS headers at all.** Never `*`.
- On an allowlisted `Origin`: `Access-Control-Allow-Origin: <that exact origin>`, `Vary: Origin`, `Access-Control-Allow-Headers: authorization, content-type`, `Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS`. No `Allow-Credentials` — the native path is bearer-only and credentialed CORS plus a wildcard is how cookie auth gets exposed.
- Add an `OPTIONS` handler for the routes you own. Put the shared logic in `src/lib/auth/cors.ts`.
- In `src/middleware.ts`, add `api` to the matcher's exclusions **only if** you confirm the cookie-refresh call is pointless for bearer requests; it is a perf nicety, not required. If you touch the matcher, keep `/auth/callback` and every page route inside it.

## Tests (vitest, no network — required)

In `src/lib/auth/*.test.ts`:
1. `extractBearer`: valid; `"bearer x"` (lowercase) valid; missing header; `"Basic abc"`; `"Bearer"`; `"Bearer "`; `"Bearer a b"`; leading/trailing whitespace.
2. Valid token → the verifier's id; the verifier is called exactly once.
3. **Invalid token → null, and neither the cookie path nor `DEV_USER_ID` is consulted.** Assert the cookie client is never constructed.
4. `DEV_USER_ID` set + `NODE_ENV=production` → null.
5. `DEV_USER_ID` set + no auth header + dev → the dev id.
6. `DEV_USER_ID` set + a valid bearer header → the bearer user wins.
7. No header, no dev id → falls through to cookies.
8. CORS: allowlisted origin gets the header with that exact origin and `Vary: Origin`; a non-allowlisted origin gets none; an empty allowlist gets none; the header is never `*`.

## Verify
- `npm test` — the full existing suite stays green (158 tests), plus yours.
- `npm run typecheck`.
- `npm run build` — proves no route handler signature broke.
- Read every file under `src/app/api/` and confirm each still compiles against the new `route()` ctx.
- With `DEV_USER_ID` set and `npm run dev:setup` data, `curl` each of the six endpoints and paste one real response per endpoint into your report. The mobile engineers are coding against these shapes sight-unseen; a field you renamed is a day of someone else's work.

## Report
The six response bodies (real, not invented), any env var you need (`MOBILE_CORS_ORIGINS`), and anything you changed about `route()`'s contract.

### `expo-scaffold` — Foundation phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# expo-scaffold — the Expo app, and the foundation seven other engineers build on

You are the only engineer who may install packages or touch config. Everything you build in `mobile/lib/` and `mobile/app/` is a contract others are coding against in parallel, sight-unseen, so the **exported names and signatures below are fixed** — build to them exactly, even if you would have named something differently.

## Files you OWN
- `mobile/package.json`, `mobile/app.json`, `mobile/tsconfig.json`, `mobile/metro.config.js`, `mobile/vitest.config.ts`, `mobile/.gitignore`, `mobile/README.md`
- `mobile/app/**` — the navigation shell and placeholder screens (features replace the placeholder bodies, not the routes)
- `mobile/lib/**`
- Root `tsconfig.json` — one edit: add `"mobile"` to `exclude`
- Root `.gitignore` — add `mobile/node_modules/`, `mobile/.expo/`, `mobile/dist/`
- `src/lib/outbox/queue.ts` — **one** permitted edit, below

**Do not touch** `src/app/`, `src/components/`, `public/`, root `README.md`, `.env.example`, root `package.json`, `mobile/components/`, `mobile/features/`.

## THE CONSTRAINT

The user runs this by installing Expo Go from the App Store, running `npx expo start`, and scanning the QR code. No Apple Developer account, no TestFlight, no EAS build, no custom dev client, no `expo prebuild`, no `ios/` or `android/` directory. **One package that is not in Expo Go means a red error screen instead of an app.** Install only from the list below, at exactly these versions. If you believe you need something else, stop and report it as a blocker — do not install it.

```
expo@~58.0.19                        expo-sqlite@~58.0.14
expo-router@~58.0.26                 expo-secure-store@~58.0.2
expo-constants@~58.0.13              expo-haptics@~58.0.7
expo-linking@~58.0.14                expo-audio@~58.0.10
expo-symbols@~58.0.4                 expo-image-picker@~58.0.10
@expo/ui@~58.0.23                    expo-image-manipulator@~58.0.15
expo-glass-effect@~58.0.5            expo-file-system@~58.0.11
expo-splash-screen@~58.0.11          expo-network@~58.0.4
expo-status-bar@~58.0.4              expo-keep-awake@~58.0.3
expo-system-ui@~58.0.6               @expo/vector-icons@^15.0.2
react@19.3.0  react-dom@19.3.0       @supabase/supabase-js@2.118.0
react-native@0.88.0                  react-native-url-polyfill@4.0.0
react-native-web@~0.21.4             @tanstack/react-query@5.104.5
react-native-gesture-handler@~3.3.0
react-native-reanimated@4.7.1        devDependencies (never bundled):
react-native-worklets@0.13.0           typescript@~6.0.3
react-native-screens@~4.30.0           @types/react@~19.3.0
react-native-safe-area-context@~5.10.1 vitest@^2.1.5
react-native-svg@15.16.0
```
These versions come from `expo@58.0.19`'s own `bundledNativeModules.json` and the SDK 58 default template. Do not "upgrade" any of them; a reanimated or screens version outside the SDK's pin is the classic red screen.

## 1. Scaffold

`mobile/` is a **separate npm project** nested in the repo — its own `node_modules` and lockfile. Do **not** convert the root to npm workspaces and do not add anything to the root `package.json`. Root needs `react@19.0.0` for Next 15 while Expo needs `19.3.0`; hoisting them gives Metro a React that does not match its renderer, which is an "Invalid hook call" on a device you cannot debug.

`mobile/app.json`:
```json
{ "expo": {
  "name": "lifemaxx", "slug": "lifemaxx", "version": "0.1.0",
  "scheme": "lifemaxx", "orientation": "portrait",
  "userInterfaceStyle": "dark",
  "backgroundColor": "#0d1013",
  "plugins": ["expo-router"],
  "experiments": { "typedRoutes": true },
  "web": { "output": "single" },
  "ios": { "supportsTablet": false, "infoPlist": {
    "NSMicrophoneUsageDescription": "Record a spoken set so it can be logged.",
    "NSCameraUsageDescription": "Photograph a meal to estimate its macros. Photos are never stored.",
    "NSPhotoLibraryUsageDescription": "Pick a meal photo. Photos are never stored."
  }},
  "extra": { "apiBaseUrl": "https://<the deployed vercel url>" }
}}
```
- **Omit every icon, splash and favicon key, and do not add the `expo-splash-screen` plugin.** Those reference asset files that do not exist, and a missing asset path fails `expo start`. Expo Go shows its own default.
- The `infoPlist` strings are inert in Expo Go (permission prompts come from Expo Go itself) but are correct for a future dev build. They do **not** require prebuild.
- Do **not** add `experiments.reactCompiler` — keep runtime semantics plain, since nothing here can be tested on a device.
- Do **not** create `babel.config.js`. SDK 58's default preset already wires reanimated/worklets; the official template ships without one.

`mobile/tsconfig.json`:
```json
{ "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true,
    "paths": { "@/*": ["./*"], "@/db/schema": ["../src/db/schema.ts"] } },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }
```
The second path entry exists only so `tsc` can follow the type-only `import type { Muscle } from "@/db/schema"` inside the shared domain files. It requires the root `npm install` to have been run; say so in `mobile/README.md`.

`mobile/metro.config.js`:
```js
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(projectRoot, "..", "src", "lib")];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
module.exports = config;
```
Both resolver lines are required. Without them Metro climbs to the repo root and may bundle the Next app's React.

Scripts: `start` (`expo start`), `android`, `ios`, `web`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `bundle` (`expo export --platform ios --output-dir /tmp/lifemaxx-export`).

## 2. Shared code — the eight barrels

`mobile/lib/shared/{units,e1rm,progression,muscles,readiness,tdee,running,outbox}.ts`, each exactly one line:
```ts
export * from "../../../src/lib/domain/units";
// …outbox.ts: export * from "../../../src/lib/outbox/queue";
```
These are the **only** files in `mobile/` that may contain a `../../../` path. Everything else imports `@/lib/shared/units` etc. One file per module, not one index, to avoid `export *` name collisions.

The domain layer has ~75 passing tests and must be imported, never reimplemented. Likewise `flush()`, `backoffMs()`, `classifyStatus()`, `MAX_ATTEMPTS` and `newClientId()` from `queue.ts`.

## 3. `src/lib/outbox/queue.ts` — the one permitted edit

```ts
export type OutboxKind = "set" | "session-start";
```
Nothing else in that file changes. The Dexie adapter in `src/lib/outbox/index.ts` is untouched (widening a union breaks nothing) and `npm test` at the root must still pass all 158 tests. Run it to prove that.

## 4. `mobile/lib/` — the contracts others are coding against

### `mobile/lib/config.ts`
```ts
export function apiBaseUrl(): string          // override ?? EXPO_PUBLIC_API_BASE_URL ?? Constants.expoConfig.extra.apiBaseUrl
export async function setApiBaseOverride(url: string | null): Promise<void>
export async function loadApiBaseOverride(): Promise<void>   // called once at boot, before any request
```
The override lives in SecureStore so the user can point the same scanned QR at `http://192.168.x.x:3000` from the You screen with no rebuild. Trailing slashes trimmed. Plain-HTTP LAN works in Expo Go.

### `mobile/lib/auth.ts`
```ts
export const supabase: SupabaseClient
export type Session = { userId: string; email: string } | null
export function useSession(): { session: Session; loading: boolean }
export async function signIn(email: string, password: string): Promise<void>   // throws Error with a human message
export async function signUp(email: string, password: string): Promise<void>   // then POST /api/auth/ensure-profile
export async function signOut(): Promise<void>
export async function accessToken(): Promise<string | null>
```
- `import "react-native-url-polyfill/auto"` at the top of the module, before the client is created.
- Client options: `{ auth: { storage: <the chunked adapter>, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }`.
- **Chunked SecureStore adapter.** `expo-secure-store` warns and can fail above **2048 bytes per value**, and a Supabase session JSON exceeds that — a naive adapter appears to work and then silently loses the session. Split the value into ≤1800-byte chunks across `<key>.0 … <key>.n` plus `<key>.count`; `removeItem` deletes all of them; a partial read returns null and clears the rest. Unit-test the adapter against a fake store with 1-byte, 2047-byte, 2049-byte and 10 KB values.
- Wire `AppState`: `supabase.auth.startAutoRefresh()` on `active`, `stopAutoRefresh()` otherwise. Without this the token expires while backgrounded and every request 401s the moment the user walks into the gym.

### `mobile/lib/api.ts`
```ts
export class ApiError extends Error { status: number }
export async function apiGet<T>(path: string): Promise<T>
export async function apiPost<T>(path: string, body?: unknown): Promise<T>
export async function apiDelete<T>(path: string, body?: unknown): Promise<T>
export async function apiUpload<T>(path: string, form: FormData): Promise<T>
export async function apiStream(path: string, body: unknown, onChunk: (s: string) => void): Promise<void>
```
- Every call: prepend `apiBaseUrl()`, attach `Authorization: Bearer ${await accessToken()}`, 15s timeout via `AbortController` (30s for `apiUpload`). JSON helpers set `Content-Type: application/json`; **`apiUpload` must NOT set `Content-Type`** — React Native writes the multipart boundary itself and overriding it breaks the upload.
- Non-2xx → throw `ApiError(status, <the body's `error` field or the status text>)`.
- A 401 clears the session and sends the user to `/sign-in` once (not per failed request).
- `apiStream` **must use `import { fetch } from "expo/fetch"`**, not the global. React Native's default fetch is XHR-backed and leaves `response.body` undefined, so the streaming coach routes would appear to hang and then dump everything at once. Read `response.body.getReader()`, decode UTF-8 incrementally, call `onChunk` per chunk. Document a fallback (`await res.text()` then one `onChunk`) in a comment.

### `mobile/lib/outbox.ts`
```ts
export async function enqueue(kind: OutboxKind, url: string, payload: Record<string, unknown>): Promise<string>
export function flushOutbox(): Promise<FlushResult>
export function startOutbox(): () => void
export function useOutbox(): { pending: number; dropped: OutboxItem[]; syncing: boolean }
export async function pendingItems(): Promise<OutboxItem[]>
export async function removeQueued(id: string): Promise<void>
```
- A `SQLiteOutboxStore` implementing the **existing** `OutboxStore` interface (`all` / `put` / `remove`) over `expo-sqlite`: `openDatabaseAsync("lifemaxx.db")`, one table `outbox(id TEXT PRIMARY KEY, kind TEXT, url TEXT, payload TEXT, created_at INTEGER, attempts INTEGER, next_attempt_at INTEGER, last_error TEXT)`, payload JSON-encoded. Use `execAsync` for DDL, `runAsync`/`getAllAsync` for rows.
- **Delivery uses the shared `flush()` from `@/lib/shared/outbox`. Do not write a second queue.** The rules that matter (deliver in order, stop at the first failure, only retry what retrying can fix, `MAX_ATTEMPTS`, exponential backoff) are already implemented and tested there.
- `send` mirrors the Dexie adapter in `src/lib/outbox/index.ts`: POST JSON, no response → `{status:"retry"}`, otherwise `classifyStatus(res.status)`.
- `enqueue` stamps `payload.loggedAt = new Date().toISOString()` and uses `payload.clientId ?? newClientId()` as the item id, exactly as the web does. A set logged at 6:12pm in a basement and delivered at 7:04pm happened at 6:12, and the server derives `rest_s` from it.
- `startOutbox()` triggers a flush on app foreground (`AppState`), on reconnect (`expo-network`), and on a 30s interval. iOS suspends a backgrounded app, so foreground is the trigger that actually fires.
- Fall back to the shared `memoryStore()` if SQLite fails to open, with a console warning — a save button that throws is worse than a tab-lifetime queue.

### `mobile/lib/types.ts`
All cross-workstream types. At minimum `Bootstrap`, `SessionPayload`, `CatalogueExercise`, `LastSet`, `RunDto`, `MealDto`, `ExerciseHistory`, `ParsedSet`, `ParseResponse`, `TranscribeResponse` — shaped exactly as the `/api/mobile/*` contracts (ask the orchestrator for the backend-auth report if you have not seen the response bodies). Features import types from here and never redeclare them.

### `mobile/lib/query.ts`
A `QueryClient` (`staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: true`) and `queryKeys = { bootstrap: ["bootstrap"], session: ["session"], food: (d) => ["food", d], exercise: (id) => ["exercise", id], coach: ["coach"] }`.

### `mobile/lib/haptics.ts`
```ts
export function tapSelect(): void   // Haptics.selectionAsync()
export function tapSave(): void     // impactAsync(Medium)
export function tapDone(): void     // notificationAsync(Success)
export function tapError(): void    // notificationAsync(Warning)
```
Fire-and-forget, never awaited, never throws. Features call these and never import `expo-haptics` directly, so the vocabulary stays consistent across eight engineers.

## 5. Navigation shell

Build the route tree with placeholder screen bodies (a `Screen` with the title and one line of text). Features replace the bodies; the routes and layouts are yours.

```
mobile/app/_layout.tsx        root Stack · dark theme · SafeAreaProvider · GestureHandlerRootView
                              · QueryClientProvider · loadApiBaseOverride() then startOutbox()
                              · session gate: no session → redirect to /sign-in
mobile/app/(tabs)/_layout.tsx 4 tabs: Today ◎ · Lift ▮ · Food ◍ · You ○
mobile/app/(tabs)/index.tsx   Today
mobile/app/(tabs)/lift.tsx    Lift
mobile/app/(tabs)/food.tsx    Food
mobile/app/(tabs)/you.tsx     You
mobile/app/runs.tsx           pushed from Today
mobile/app/exercise.tsx       ?id= — pushed
mobile/app/coach.tsx          presentation: "modal"
mobile/app/exercise-picker.tsx presentation: "modal"
mobile/app/sign-in.tsx        standalone
```
Tab bar: background `#15191d`, top border `#262d33`, active tint `#7fa7ff`, inactive `#8e979f`, labels 10pt mono uppercase, icons as those glyph characters in `<Text>`. Stack: `headerShown: false` (screens draw their own headers), `contentStyle: { backgroundColor: "#0d1013" }`. Dark only; no light theme.

## 6. `mobile/README.md` (yours alone)
How to run it: `npm install` at the repo root **and** in `mobile/`, then `npx expo start` and scan the QR with Expo Go. How to point at a LAN dev server. The Expo Go constraint and the fact that the dependency list is closed. And one short paragraph: **HealthKit is out of scope** — it cannot work in Expo Go; the Health Auto Export webhook already brings steps, sleep and weight in; a future `eas build` dev client would unlock `expo-health`-style access, a widget and background sync.

## Verify (there is no simulator, no device and no Xcode here)
- `npm run typecheck` in `mobile/` — clean.
- `npm test` in `mobile/` — the SecureStore chunking and outbox-adapter tests pass.
- `npm test` at the repo root — all 158 still pass after the `OutboxKind` edit.
- `npm run build` at the repo root — proves the root `tsconfig` exclude works and Next does not try to compile RN code.
- **`npx expo export --platform ios`** must succeed. This is your most valuable signal: it proves Metro resolves every route, every shared import across the project boundary, and every native-module import. Paste the output.
- Write one throwaway screen that renders `displayLb(100)` and `newClientId()` from the shared barrels and confirm it survives the bundle — the cross-boundary import is the thing most likely to be subtly broken.
- `npx expo start --web` for a rough visual check of the shell. **Never claim a native behaviour is verified** — gestures, haptics, keyboard and recording cannot be tested here.

## Report
The exact installed versions, the `expo export` output, whether the shared-barrel import bundled, any env var or deployed URL you need, and anything you had to deviate on.

### `design-system` — Foundation phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# design-system — React Native primitives that match the existing app exactly

The user did **not** complain about how the app looks. The visual language is fine. **Port it; do not redesign it.** Your job is to make the native app indistinguishable in style from the web app, so that six other engineers can build screens without each re-deriving a palette by eye.

## Files you OWN
- `mobile/components/ui/**` and nothing else.

You may **read** `src/app/globals.css` and `src/components/ui.tsx` — those are the source of truth you are porting. **Do not modify them**, and do not touch `mobile/lib/`, `mobile/app/`, `mobile/features/`, or any config file. You install nothing: if you think you need a package, report it as a blocker.

## Available primitives
`react-native` core (View, Text, Pressable, ScrollView, FlatList, TextInput, Modal, Animated), `react-native-safe-area-context`, `react-native-gesture-handler`, `react-native-reanimated`, `react-native-svg`, `@expo/vector-icons`. No styling library — plain `StyleSheet`. Everything must work inside Expo Go; nothing else may be imported.

## 1. `mobile/components/ui/tokens.ts` — copy the values, do not eyeball them

From `src/app/globals.css`:
```ts
export const color = {
  ground: "#0d1013", surface: "#15191d", surface2: "#1c2126",
  line: "#262d33", lineStrong: "#39424a",
  ink: "#e8ebe9", muted: "#8e979f",
  accent: "#7fa7ff", accentInk: "#a9c2ff", accentSoft: "#16233c",
  good: "#5cc08c", warn: "#e0a35c", bad: "#e07a6b",
} as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;
export const font = {
  mono: Platform.select({ ios: "Menlo", default: "monospace" }),
  // no sans family — the system font IS the web app's --font-sans stack
} as const;
export const tnum = { fontVariant: ["tabular-nums"] as const };  // the port of .tnum
export const hit = { min: 44, big: 56, huge: 72 } as const;       // tap targets, chalky hands
```
No custom font files, no `expo-font`: Menlo is a system face on iOS, and an asset pipeline is one more thing that can fail `expo start`. Dark only — no light variants, no `useColorScheme`.

**Tabular numerals are mandatory on every figure** — weights, reps, macros, pace, timers, set counts. Bake `...tnum` into the numeric components rather than relying on each feature engineer to remember it; a column of weights that jitters is the most visible possible regression from the web app.

## 2. Components

Each one mirrors its web counterpart in `src/components/ui.tsx`. Keep prop names the same where the web has them, so a screen reads the same in both codebases.

- **`Screen`** — `{ title, subtitle?: ReactNode, action?: ReactNode, children, scroll?: boolean (default true), refreshing?: boolean, onRefresh?: () => void }`. Safe-area aware top padding, 24pt title semibold tight, 13pt muted subtitle, `action` right-aligned on the title row. When `scroll`, a `ScrollView` with `contentContainerStyle` bottom padding of 96 (tab bar + rest-timer bar + home indicator) and `RefreshControl` wired to `onRefresh` with `tintColor: color.muted`. No two-column variant — that was a laptop affordance.
- **`Card`** — `{ children, tone?: "default" | "accent", style? }`. `surface` background, 1pt `line` border, radius `xl`, padding `lg`, `marginBottom: md`. `accent` → `accentSoft` background with an `accent` border.
- **`Label`** — the mono micro-label: 10pt, `font.mono`, uppercase, `letterSpacing: 1.4`, `color.muted`, `marginBottom: sm`. This appears on nearly every card; get it right.
- **`Stat`** — `{ label, value: ReactNode, hint? }`. `Label` + 20pt semibold `tnum` value + 11pt muted hint.
- **`Button`** — `{ children, onPress, variant?: "primary" | "secondary" | "ghost" | "danger", size?: "md" | "lg" | "hero", disabled?, style? }`. `Pressable` with `activeOpacity`-equivalent (0.7 while pressed) and `disabled` at 0.4. Heights: `md` 44, `lg` 56, `hero` **72**. Variants match the web: primary = `accent` background with `ground`-coloured semibold text; secondary = `surface2` with a `lineStrong` border; ghost = muted text only; danger = `bad` text with a `lineStrong` border. Every variant must meet `hit.min`. **No haptic calls inside Button** — features own that decision via `mobile/lib/haptics.ts`.
- **`MacroBar`** — `{ label, value, target?: number | null, unit?: string, tone?: "accent" | "good" | "warn" }`. Port the web version exactly: label left, `tnum` `value/target` right, a 6pt track in `surface2` with a rounded fill, clamped at 100% width while the percentage itself is capped at 150, and the fill turning `warn` above 105% of target. A bar, not a ring — the only question anyone asks is "how far over or under".
- **`NumberPad`** — the most important component you build, and the direct fix for three named complaints (keyboard, tap latency, layout displacement).
  `{ visible: boolean, value: string, label: string, unit?: string, allowDecimal?: boolean, onChange: (next: string) => void, onDone: () => void, onCancel: () => void }`
  - An absolutely-positioned overlay anchored to the bottom inside a `Modal` with `transparent` and `animationType: "slide"`. It **must not displace or reflow the content behind it** — `Screen` already reserves bottom padding; the pad floats above it. No `TextInput`, so there is no system keyboard, no focus latency, no iOS zoom and no keyboard-avoiding layout.
  - 3×4 grid: `1-9`, then `.` (only when `allowDecimal`), `0`, `⌫`. Keys at least 64pt tall, full-width-divided, 1pt `line` separators, 22pt `tnum` glyphs, `surface2` while pressed.
  - Above the keys: the `label` as a `Label`, and the current value at 34pt semibold `tnum` with the unit in muted beside it.
  - A full-width `Button size="lg" variant="primary"` reading `DONE`, plus a tap-outside-to-cancel backdrop at 60% black.
  - Pure and controlled: it never parses or clamps. It emits the raw digit string; callers convert. Reject a second `.` and a leading run of zeros; cap length at 6 characters.
- **`Toggle`** — a pill chip: `{ on, onPress, children, tone?: "accent" | "warn" }`. Off = `line` border + muted text; on = `accent` border + `accentSoft` background + `accentInk` text. Min height 44, horizontal padding `md`, radius `pill`. Used for RPE, to-failure, warmup and felt-state.
- **`Pill`** — the read-only set chip: `{ children, variant?: "default" | "warmup" | "queued" }`. `default` = `lineStrong` border; `warmup` = `line` border with muted text; **`queued` = a dashed border at 0.7 opacity**, matching the web's treatment of a set that is saved on the phone but not yet synced. `tnum` throughout.
- **`Sheet`** — `{ visible, onClose, children, title? }`. A bottom sheet in a transparent `Modal`: `surface` background, top corners radius `xl`, a 36×4 `lineStrong` grabber, safe-area bottom inset, 60% black backdrop that closes on tap. **This replaces every `confirm()` and every `Alert.alert` in the app**, and replaces dropdowns.
- **`Empty`** — dashed `line` border, radius `xl`, centred 13pt muted text, vertical padding `xxl`.
- **`Spinner`** — a small `ActivityIndicator` wrapper in `color.muted`. Used sparingly; the hero flow has none.
- **`mobile/components/ui/index.ts`** — re-export everything, so features write one import line.

## 3. Rules you are enforcing on everyone else

Write these at the top of `index.ts` as a comment, because six engineers will read it there and nowhere else:
1. Every number renders with `tnum`.
2. Micro-labels are `Label`, never an ad-hoc styled Text.
3. No colour literals outside `tokens.ts`.
4. No `Alert.alert`, no `confirm` — use `Sheet`.
5. No `TextInput` for numbers — use `NumberPad`.
6. Minimum tap target 44pt; the primary action in a flow is 56 or 72.

## Verify
- `npm run typecheck` in `mobile/` — clean, `strict`.
- `npx expo start --web` and build one throwaway page (delete it before you finish) that renders every component in every variant. Screenshot it and compare side by side against the running web app's cards. This is a rough check — `react-native-web` is not iOS — but it does catch a wrong hex, a missing border and a broken layout.
- Confirm no component imports anything outside `react-native`, the allowlisted RN libraries and `./tokens`.
- **Do not claim** that the NumberPad's feel, the Sheet's gesture or any haptic is verified. None of that is testable here.

## Report
The component list with final prop signatures (seven other engineers are coding against them in parallel), the screenshot, and anything in the web design you could not reproduce faithfully in RN.

### `lift-session` — Build phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# lift-session — the hero flow

This is why the project exists. The one flow the user named as worst: **logging a set mid-workout**. They are standing in a gym holding a barbell, chalk on their hands, possibly with no signal. On the web today it costs a dropdown, three number fields and a save tap. Make it cost almost nothing.

## Files you OWN
- `mobile/features/lift/**`

You also own one component that another workstream imports: `mobile/features/lift/ExercisePicker.tsx`. Its signature is fixed (below) because the voice workstream is building against it in parallel.

**Do not touch** `mobile/app/`, `mobile/lib/`, `mobile/components/ui/`, any config file, or anything under `src/`. You install nothing — if you think you need a package, report it as a blocker. The route file `mobile/app/(tabs)/lift.tsx` is owned by expo-scaffold; it will render `<SessionScreen />` from your feature. Export that as the default from `mobile/features/lift/index.ts`.

## What you get from other workstreams (contracts — build against these)

From `@/components/ui`: `Screen, Card, Label, Stat, Button, Toggle, Pill, NumberPad, Sheet, Empty`, plus `color/space/radius/tnum/hit` from `@/components/ui/tokens`. `Button` has `size="md"|"lg"|"hero"` (44/56/72pt). `NumberPad` is a controlled bottom overlay: `{ visible, value, label, unit?, allowDecimal?, onChange, onDone, onCancel }` — it emits a raw digit string and **never displaces the layout**. `Pill` has `variant="default"|"warmup"|"queued"`, where `queued` is a dashed border at 0.7 opacity.

From `@/lib/api`: `apiGet<T>`, `apiPost<T>`, `apiDelete<T>`, `ApiError`.
From `@/lib/outbox`: `enqueue(kind, url, payload)`, `useOutbox() → { pending, dropped, syncing }`, `pendingItems()`, `removeQueued(id)`.
From `@/lib/haptics`: `tapSelect()`, `tapSave()`, `tapDone()`, `tapError()`. **Use these, never `expo-haptics` directly.**
From `@/lib/shared/units`: `displayLb`, `platesPerSide`. From `@/lib/shared/outbox`: `newClientId`. From `@/lib/query`: `queryKeys`.

Server contracts:
- `GET /api/mobile/bootstrap` → includes `catalogue: { id, name, slug, incrementLb, equipment, muscles: {muscle,contribution}[] }[]`, `lastSets: Record<exerciseId, { localDate, weightLb, reps, rpe, sets, bestE1rmLb }>`, `volume.ranked: { muscle, label, setsLast7d, daysSinceTrained, score }[]`, `gyms`, `activeWorkout: { id, startedAt } | null`.
- `GET /api/mobile/session` → `{ today, activeWorkout, sets: { id, clientId, exerciseId, exerciseName, setIndex, reps, weightLb, rpe, toFailure, isWarmup, felt, note, restS, loggedAt }[] }`.
- `POST /api/session/start { gymId }` → `{ workout, resumed }`.
- `POST /api/session/stop { name? }` → `{ workout, summary: { durationMin, totalSets, volumeKg, muscles: {muscle,label,sets}[] } }` or `{ workout: null, discarded: true }`.
- `POST /api/session/suggest { exerciseId }` → `{ baseline: { action, weightLb, sets, reps, reason }, suggestion: { weightLb, sets, reps, reason } | null, clamped }`.
- `POST /api/sets` — **always via the outbox, never directly.** Payload: `{ clientId, exerciseId, reps, weightLb, rpe, toFailure, isWarmup, felt, note, rawText }`. The server resolves the active workout itself and upserts on `(workout_id, client_id)`, so a retry after a lost response is not a duplicate.
- `DELETE /api/sets { id }`.

## Build this

### `StartScreen` (no active session)
One `Button size="hero"` reading `START LIFT`. Under it the gym name as a tappable line — tapping opens a `Sheet` with the gym list (**not** a dropdown; there are no `<select>`-equivalents in this app). Under that, the owed-muscles line from `volume.ranked` filtered to `score > 0.2`, top three, joined with ` · `. Nothing else on the screen.

Start: `POST /api/session/start`. **If it fails or there is no signal, do not block.** `enqueue("session-start", "/api/session/start", { gymId })`, store a local start timestamp, and enter the session in a `pending` state. The outbox delivers in order, so the queued start arrives before the sets, and `POST /api/sets` resolves the workout server-side — the sets land in the right session with no extra server contract. If a queued start is still undelivered **6 hours** later, drop it and show one line saying the session could not be saved (the backend auto-abandons stale sessions, and a start delivered the next morning would be filed on the wrong date).

### `SessionScreen` (active session) — layout top to bottom

**1. Header, 44pt.** Elapsed minutes in `tnum`, recomputed every 10s from `activeWorkout.startedAt` (or the local start time when pending) · the queue pill · `STOP`.
- Queue pill: `3 QUEUED` as a `Label` in `muted`. **Not red, no spinner, no animation.** It disappears when the queue drains. If `useOutbox().dropped` is non-empty: one tappable line, `1 set didn't save — tap to retry`, in `warn`.
- Pending session: `SESSION PENDING` in `muted`.
- `STOP` opens a `Sheet` (never `confirm`) and, on confirm, calls `/api/session/stop` and shows the returned summary in that same sheet before navigating away. A discarded empty session says so in the sheet.

**2. Exercise pager.** A horizontal pager over the exercises in today's session, in the order first performed, plus a trailing `+ ADD EXERCISE` page. Swipe left/right to move between exercises — **this replaces the dropdown entirely**, and it is the gesture the user asked for. Build it with `react-native-gesture-handler` + `react-native-reanimated` (both are in Expo Go at the SDK's pinned versions; do not install anything else and do not use a pager library). Page dots plus the exercise name above the card. `tapSelect()` on page change. Render the current page ±1 only.

**3. The current-exercise card.**
- Exercise name, 20pt semibold.
- `LAST: 185 × 5 × 3 @7 · 4d ago` as a `Label`-styled line with `tnum`, from `lastSets[exerciseId]`. No history → `FIRST TIME`.
- **The primary control: a full-width `Button size="hero"` labelled with the exact set it will log — `LOG 185 × 5`.** Repeat-last-set is the default action and **one tap must log a set.** This is the single most important thing in the brief.
  - Pre-fill order: the last set logged for this exercise in this session → `lastSets[exerciseId]` → the `suggestion ?? baseline` from `/api/session/suggest` → nothing, in which case the button reads `SET WEIGHT` and opens the NumberPad.
  - Call `/api/session/suggest` fire-and-forget when a page gains focus. If it returns, render two small lines below the button: the mechanical baseline and the model's suggestion side by side with their reasons, exactly as `src/components/SetLogger.tsx` does — when the model deviates, the user must be able to see it deviating and why. **If it fails or there is no signal, render nothing and change nothing.** A failed suggestion must never block logging.
- One stepper row: `−  185 lb  +` and `−  5 reps  +`. Weight steps by that exercise's `incrementLb` (default 5), reps by 1. 56pt targets, `tapSelect()` each. Tapping the **number** (not the ±) opens `NumberPad` for that field.
- One wrapping chip row of `Toggle`s: `RPE` (expands an inline 6–10 chip row, collapses on second tap), `TO FAILURE`, `WARMUP`, `WEAK` / `NORMAL` / `STRONG` (mutually exclusive), and `NOTE` (reveals a single-line `TextInput` — the only system keyboard in this flow besides search; collapsed by default because a keyboard is expensive).

**4. Today's sets for this exercise** as `Pill`s under the card: `185 × 5 @7`, warmups as `variant="warmup"`, queued ones as `variant="queued"`, a trailing `F` in `warn` for to-failure. Long-press a pill → a `Sheet` offering removal: `DELETE /api/sets { id }` for a delivered set, `removeQueued(id)` for a queued one.

**5. Rest timer.** A 3pt bar pinned above the tab bar with `1:27` in `tnum` at its right end. Starts automatically on every save, 120s default. **It is a bar, not a modal, and never blocks anything.** Tap to dismiss, long-press to restart. At zero: `tapDone()`, the bar turns `accent` for 2s, then clears. Do not schedule a notification — expo-notifications is out of scope and a backgrounded Expo Go app will not fire one reliably.

### Saving a set
```ts
const clientId = newClientId();
await enqueue("set", "/api/sets", { clientId, exerciseId, reps, weightLb, rpe, toFailure, isWarmup, felt, note, rawText: "" });
```
- Fire `tapSave()` **before** the await resolves. The haptic is the acknowledgement, not the network.
- Draw the set optimistically the moment it is queued, and reconcile against `/api/mobile/session` **by `clientId`** — the way `src/components/../lift/LiftClient.tsx` does. Never reconcile by counting: a refetch landing mid-flight must neither duplicate nor lose a set.
- Reset RPE, to-failure, felt and note after each save. **Keep weight and reps.** That is what makes the next set one tap.
- Start the rest timer. Do not move the pager.

### `ExercisePicker.tsx` — fixed signature, imported by the voice workstream
```ts
export function ExercisePicker(props: {
  query?: string;
  onPick: (exercise: CatalogueExercise) => void;   // from @/lib/types
  onCancel: () => void;
}): JSX.Element
```
Full-screen: one autofocused `TextInput`, a `FlatList` filtered over the cached `catalogue` (case-insensitive substring on name and slug), with exercises whose muscles appear in `volume.ranked` pinned at the top under an `OWED THIS WEEK` `Label`. 56pt rows. Fully offline — the catalogue arrived in `bootstrap`. Picking from the pager's trailing page appends an exercise page and focuses it.

## Tap-cost acceptance criteria
Repeat last set: **1 tap.** One increment heavier then log: 2. Arbitrary weight: 6 (tap number, 3 keys, Done, Log). Next exercise: 1 swipe. New exercise: swipe + tap + 2–3 characters + tap. If your implementation costs more than this, it is not done.

## Hard rules
- No `Alert.alert`, no `confirm`, anywhere. Inline lines for errors, `Sheet` for destructive actions.
- **Nothing in this flow awaits the network before updating the UI.**
- `useKeepAwake()` (from `expo-keep-awake`, already a dependency) while a session is active.
- The queued state is obvious and unalarming: muted text, no red, no banner, no modal.
- Reuse `src/lib/domain/*` through `@/lib/shared/*` for every calculation (plate maths, e1RM). Do not reimplement any of it.

## Verify
- `npm run typecheck` in `mobile/` — clean.
- `npx expo export --platform ios` succeeds with your screens in the graph.
- `npx expo start --web` for a rough layout check of the card, the stepper row and the pill list. The pager, the haptics, the long-press and the rest timer's feel **cannot** be verified here — say so plainly in your report rather than implying they work.
- Unit-test (vitest, in `mobile/features/lift/*.test.ts`, pure logic only — no `react-native` imports) the set-payload builder and the optimistic/server reconciliation by `clientId`, including a duplicate delivery and an out-of-order refetch.

## Report
The tap count you actually achieved per row of the table above, the `ExercisePicker` signature as built, what you could not verify, and any dependency you wanted and did not install.

### `today-and-runs` — Build phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# today-and-runs — the Today dashboard and the Runs screen

## Files you OWN
- `mobile/features/today/**`
- `mobile/features/runs/**`

**Do not touch** `mobile/app/`, `mobile/lib/`, `mobile/components/ui/`, `mobile/features/*` belonging to anyone else, any config file, or anything under `src/`. You install nothing — if you think you need a package, report it as a blocker. Export `TodayScreen` and `RunsScreen` as defaults from `mobile/features/today/index.ts` and `mobile/features/runs/index.ts`; expo-scaffold's route files (`app/(tabs)/index.tsx`, `app/runs.tsx`) render them.

## What you get (contracts — build against these)

From `@/components/ui`: `Screen, Card, Label, Stat, Button, MacroBar, Pill, Empty`, tokens from `@/components/ui/tokens`. `Screen` takes `{ title, subtitle?, action?, refreshing?, onRefresh? }` and wires pull-to-refresh.
From `@/lib/api`: `apiGet<T>`. From `@/lib/query`: `queryKeys`. From `@/lib/haptics`: `tapSelect()`.
From the shared domain — **use these, do not reimplement any of it**: `@/lib/shared/running` (`summarizeRunningWeek`, `weekStartOf`, `weeklyRunStats`, `formatPace`, `classifyRun`, `paceSecPerMile`, `miles`, `feet`, `paceTrend`, `averagePaceSecPerMile`, `MIN_RUNS_FOR_TREND`), `@/lib/shared/readiness` (`summarize`), `@/lib/shared/muscles` (`WEEKLY_SET_TARGET`, `muscleLabel`), `@/lib/shared/units`. These are ~75 passing tests of pure TypeScript shared with the web app; the two clients must not be able to disagree about a number.

`GET /api/mobile/bootstrap` is your only read. It returns:
```ts
{ today, tz, goalsText,
  target: { kcal: number|null; proteinG: number; carbsG: number|null; fatG: number|null; mode: string },
  totals: { kcal, proteinG, carbsG, fatG }, mealCount: number,
  volume: { summary: string; ranked: { muscle, label, setsLast7d, daysSinceTrained, score }[] },
  tdee: TdeeResult,                 // { status: "ok", tdee, marginKcal, trendKgPerWeek, currentKg, meanIntake, weighIns }
                                    // | { status: "insufficient_data", weighIns, needed }
  activeWorkout: { id, startedAt } | null,
  runs: { id, localDate, startedAt, name, type, distanceM, durationS, elevationM, avgHr, sufferScore, verdict }[],
  lowerBodyLiftDates: string[],
  gyms, catalogue, lastSets }
```
`runs` and `lowerBodyLiftDates` arrive **raw on purpose**: you compute the weekly view on-device with `summarizeRunningWeek(runs, lowerBodyLiftDates, weekStartOf(today))`, which is exactly what `src/app/page.tsx` does server-side. Cache the payload with react-query (`queryKeys.bootstrap`) so both screens work from one request and keep rendering with no signal.

## Today screen — port `src/app/page.tsx`, in this order

Read that file before you start. Same cards, same order, same copy where the copy is good.

1. **Session-in-progress card** (only when `activeWorkout`): `tone="accent"`, `SESSION IN PROGRESS` label, `Tap to resume logging`, a `→`. Navigates to the Lift tab. This sits above everything because it is time-sensitive.
2. **Fuel.** `FUEL` label; the day's kcal at 30pt semibold `tnum` with `of 2600 kcal` beside it in muted — or, when there is no target, `kcal — no target yet, still calibrating` (the app deliberately shows no calorie target during the first three weeks; do not invent one). Then three `MacroBar`s: Protein (`tone="good"`, target `target.proteinG`), Carbs, Fat. Then a tappable line to the Food tab: `Log your first meal →` when `mealCount === 0`, otherwise `3 meals logged →`.
3. **Train next** — this is what replaces a training split, so get it right. `TRAIN NEXT` label, `summarize(volume.ranked)` as a sentence, then the top four entries with `score > 0.2` as rows: label left, `7.5/10 sets · 5d ago` right in `tnum` (use `WEEKLY_SET_TARGET.min`, and `· never` when `daysSinceTrained` is null). When nothing is behind: `Nothing is behind. Train whatever you feel like.` A tappable line to Lift reading `Resume session →` or `Start a lift →`.
4. **Running this week** — rendered only when `runs.length > 0`. The week's `distanceMi` at 30pt `tnum`, then `mi · 8:42/mi · 3 runs` (`formatPace`). When `interference.length > 0`, one line in `warn`: `Hard running stacked on a leg day this week.` (with ` N times` when more than one) — that warning is the one thing this app can say that a calorie app cannot, so it takes precedence over last week's mileage. Otherwise last week's mileage, or `First week of logged mileage.` A `See the week →` line that pushes `/runs`.
5. **Measured maintenance.** When `tdee.status === "ok"`: two `Stat`s — `TDEE` with `±120 kcal · from 11 weigh-ins` as the hint, and `TREND` as `+0.4 lb/wk` (`trendKgPerWeek * 2.2046`, signed). Otherwise the honest version: `Not enough weigh-ins for a reliable number — 5 of 8. Weigh in most mornings and this fills itself in.` **Never render a TDEE number below the threshold**; the app's rule is to say it does not know rather than manufacture confidence. A `Log weight →` line to the You tab.

Header: title `Today`, subtitle the long-form local date (`Saturday, October 25`). Pull-to-refresh refetches `bootstrap`. Also refetch when the outbox drains, so a session logged offline appears without a manual pull.

## Runs screen — port `src/app/runs/page.tsx`

Read it first. From the same cached `bootstrap.runs`:
- **This week** card: distance, duration, elevation, average pace, longest run, hard-or-long count — all from `weeklyRunStats`, all `tnum`.
- **Pace trend**: `paceTrend(runs)`, but **only when there are at least `MIN_RUNS_FOR_TREND` runs**; below that say there is not enough data rather than drawing a line through three points.
- **Interference**: one row per `InterferenceHit` — the run date, the lift date, the effort, and the gap. Easy runs are excluded by the domain function on purpose; do not re-add them.
- **Run list**, newest first: name, date, `6.2 mi · 8:42/mi · 52 min`, the `verdict` when present, and the effort from `classifyRun(run, averagePaceSecPerMile(runs))` as a `Pill`. Tapping a run does nothing in v1 (there is no run detail endpoint) — do not add navigation that dead-ends.
- **Weekly history**: the last eight `weekStartOf` buckets as rows of `weekStart · distanceMi · avgPace`. If you want a chart, `react-native-svg` is available; a clean list is an acceptable and lower-risk answer.

Runs are read-only — they sync from Strava and the Health Auto Export webhook. There is **no** manual run entry, no edit and no delete on this screen. Runs deliberately do not have their own tab (you look at them weekly, you never log one), which is why the entry point is the Today card.

## Hard rules
- Every figure uses `tnum`. A jittering column of mileage is the most visible possible regression from the web app.
- No colour literals; tokens only. No `Alert.alert`.
- Both screens must render from cache with no network — no spinner-blocked screens, no error screen for a failed refetch. A stale dashboard is correct behaviour; show the data you have.
- Do **not** compute macros, pace, weekly stats, interference or readiness yourself. Every one of those functions already exists in the shared domain layer and is tested.

## Verify
- `npm run typecheck` in `mobile/` — clean.
- `npx expo export --platform ios` succeeds.
- `npx expo start --web`, point it at a dev server with `npm run dev:setup` demo data (a month of meals, six lift sessions, six runs, enough weigh-ins to clear the 8-sample TDEE floor), and compare both screens side by side with the running web app. Screenshot both.
- Unit-test (vitest, pure logic only, no `react-native` imports) your `bootstrap` → view-model mapping against: zero runs, zero meals, no target, `status: "insufficient_data"`, and an interference hit. Those are the five states most likely to crash a dashboard.
- Do not claim pull-to-refresh or scroll feel is verified.

## Report
The two screenshots, which domain functions you used, any field in `bootstrap` that was missing or the wrong shape (name it precisely — backend-auth owns that payload), and any dependency you wanted and did not install.

### `food` — Build phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# food — meal logging with camera capture and the editable macro card

Target: photo to saved meal in about eight seconds.

## Files you OWN
- `mobile/features/food/**`

**Do not touch** `mobile/app/`, `mobile/lib/`, `mobile/components/ui/`, other features, any config file, or anything under `src/`. You install nothing — if you think you need a package, report it as a blocker. Export `FoodScreen` as the default from `mobile/features/food/index.ts`; expo-scaffold's `app/(tabs)/food.tsx` renders it.

## THE RULE THAT OVERRIDES EVERYTHING ELSE HERE

**A meal photo is never persisted anywhere.** Not to the device's documents directory, not to the photo library, not to a server, not as a thumbnail, not in a react-query cache, not in a log line. It is captured, resized in memory, sent to the analysis endpoint, and dropped. The whole app has no object storage precisely so this layer cannot exist. If `expo-image-picker` leaves a file in the cache directory, delete it with `expo-file-system` as soon as the base64 has been produced, in a `finally` block so it happens on the error path too.

## What you get (contracts)

From `@/components/ui`: `Screen, Card, Label, Stat, Button, MacroBar, NumberPad, Sheet, Empty, Pill`, tokens.
`NumberPad` is a controlled bottom overlay — `{ visible, value, label, unit?, allowDecimal?, onChange, onDone, onCancel }` — that never displaces the layout. Use it for every macro edit; **do not put a numeric `TextInput` in the review card.**
From `@/lib/api`: `apiGet<T>`, `apiPost<T>`, `apiDelete<T>`, `ApiError`. From `@/lib/haptics`: `tapSave()`, `tapDone()`, `tapError()`. From `@/lib/query`: `queryKeys.food(date)`.

Available packages (already installed; nothing else): `expo-image-picker@~58.0.10`, `expo-image-manipulator@~58.0.15`, `expo-file-system@~58.0.11`.

Server contracts, all unchanged from the web app:
- `GET /api/mobile/food?date=YYYY-MM-DD` → `{ date, meals: [{ id, slot, note, source, confidence, kcal, proteinG, carbsG, fatG, items: [{ name, qty, unit, kcal, proteinG, carbsG, fatG }] }], totals, target }`
- `POST /api/meals/analyze { imageDataUrl?: string, note?: string }` → `{ items: [{ name, qty, unit, kcal, protein_g, carbs_g, fat_g }], confidence: number, note: string, totals: { kcal, proteinG, carbsG, fatG } }`. At least one of the two inputs is required. **Note the snake_case on item macros** — that is the model's schema and it is not yours to change.
- `POST /api/meals { slot, note, source, confidence, localDate?, items: [{ name, qty, unit, kcal, protein_g, carbs_g, fat_g }] }` → `{ meal }`
- `DELETE /api/meals { id }`

## Build this

Read `src/components/MealCapture.tsx` and `src/app/food/FoodClient.tsx` first. You are porting that flow, not redesigning it.

### The day list (default state)
Header `Food`, subtitle the date. A totals card at the top: kcal at 30pt `tnum` against `target.kcal` (or `no target yet, still calibrating` when null), then `MacroBar`s for protein/carbs/fat. Then one `Card` per meal: slot as a `Label`, the item names as a single wrapped line, `520 kcal · 38p 44c 18f` in `tnum`. Long-press a meal → `Sheet` → `DELETE /api/meals`. `Empty` state when the day has no meals. A date stepper in the header `action` (`‹ today ›`) that refetches for the chosen day; do not allow a future date.

### Capture — three paths, the camera is the primary
1. **Photo.** A 72pt primary button. `ImagePicker.requestCameraPermissionsAsync()` then `launchCameraAsync({ quality: 1, exif: false })`. Then resize **before** upload:
   ```ts
   const out = await manipulateAsync(uri, [{ resize: { width: 1024 } }],
                                     { compress: 0.8, format: SaveFormat.JPEG, base64: true });
   const imageDataUrl = `data:image/jpeg;base64,${out.base64}`;
   ```
   Resizing first is not a nicety: a 4 MB phone photo over cell data is the difference between one second and eight, and eight seconds is where people stop logging meals. 1024px at q0.8 lands around 120 KB. Resize to the **longest edge**, so handle a portrait photo correctly (`resize: { height: 1024 }` when taller than wide).
2. **Text only.** A multi-line `TextInput` for the note (this is the one place a keyboard belongs) → `POST /api/meals/analyze { note }` with no image. Push the note hard in the UI: placeholder `What was it? Portion size matters more than the photo — "about 2 cups of rice, thigh not breast"`. The note carries more signal than the photo, because the model cannot see portion mass or cooking oil.
3. **Repeat.** The day list's meals are long-pressable to `REPEAT`, which re-posts the same items with `source: "repeat"` and today's date, no model call. Two taps, no network beyond the save. (The spec lists this as a wanted shortcut; it is the cheapest feature in the app.)

While analysing: the button reads `READING…` and is disabled. 30s timeout. On failure, one inline line in `bad` — `tapError()`, never an `Alert`.

### The editable review card — the heart of this feature
Analysis never saves directly. It produces a card the user corrects first, because photo macro estimation is roughly ±20% on a single meal and systematically under-counts oil.
- `CHECK THE NUMBERS` label.
- One row per item: the name (editable via a single-line `TextInput`), then kcal and protein as tappable `tnum` numbers that open `NumberPad`, then a `×` to remove the row. Carbs and fat are editable the same way behind a per-row `MORE` disclosure — keep the default row to three fields so it reads at a glance.
- An `+ ADD ITEM` row that appends an empty item.
- A totals line that recomputes live: `640 kcal · 42p 61c 19f`, `tnum`.
- When `confidence < 0.6`: one line in `warn` — `Low confidence on this one. A note about portion size fixes it faster than anything else.`
- Slot: four `Toggle` chips (Breakfast / Lunch / Dinner / Snack), defaulted by the hour exactly as the web does (<10 breakfast, <15 lunch, <21 dinner, else snack). **Not a dropdown.**
- `SAVE MEAL` as a 56pt primary button → `POST /api/meals` with `source: "photo" | "text" | "repeat"`, the edited items (snake_case macros), the note and the confidence. `tapDone()` on success, invalidate `queryKeys.food(date)`, return to the list. Keep the card mounted while saving so it cannot unmount mid-request.
- `CANCEL` discards everything, including the in-memory image.

### Offline
Meal analysis needs the server; there is no on-device fallback. When the request fails for connectivity, say so in one line — `No signal. Meal analysis needs the server; the note is kept.` — and keep the note text so nothing the user typed evaporates. **Do not queue meals through the outbox:** the outbox is ordered and set-shaped, a queued photo cannot be reviewed before it is written, and the review step is the thing that makes the numbers trustworthy. This is a deliberate asymmetry with set logging; note it in your report rather than inventing a second queue.

## Hard rules
- Every figure uses `tnum`. No colour literals. No `Alert.alert` — inline lines and `Sheet`.
- No numeric `TextInput` anywhere; `NumberPad` only.
- The photo is never persisted and never logged. Delete the picker's cache file in a `finally`.
- Do not change any of the four server contracts above; the web client depends on them.

## Verify
- `npm run typecheck` in `mobile/` — clean.
- `npx expo export --platform ios` succeeds.
- `npx expo start --web` against a dev server with `LLM_PROVIDER=fixtures` (which returns plausible macros with no API key and no network) and exercise: text-only analyse → edit every field → save → the meal appears in the day list with the edited totals → delete it. Screenshot the review card. The camera itself **cannot** be tested here; say so.
- Unit-test (vitest, pure logic only, no `react-native` imports): the totals recomputation after an edit, the camelCase/snake_case mapping in both directions, and the default-slot-by-hour function at 09:59, 10:00, 14:59, 20:59 and 21:00.

## Report
The screenshot, confirmation that no code path writes an image anywhere, the offline decision above, and any dependency you wanted and did not install.

### `coach-settings` — Build phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# coach-settings — streaming coach chat, and the You screen including sign-in

## Files you OWN
- `mobile/features/coach/**`
- `mobile/features/settings/**`

**Do not touch** `mobile/app/`, `mobile/lib/`, `mobile/components/ui/`, other features, any config file, or anything under `src/`. You install nothing — if you think you need a package, report it as a blocker. Export `CoachScreen`, `SettingsScreen` and `SignInScreen` as defaults from your feature index files; expo-scaffold's `app/coach.tsx` (a modal), `app/(tabs)/you.tsx` and `app/sign-in.tsx` render them.

## What you get (contracts)

From `@/components/ui`: `Screen, Card, Label, Stat, Button, Toggle, NumberPad, Sheet, Empty, Spinner`, tokens.
From `@/lib/auth`: `useSession() → { session, loading }`, `signIn(email, password)`, `signUp(email, password)`, `signOut()`. These throw an `Error` with a human-readable message; show it, do not swallow it.
From `@/lib/api`: `apiGet<T>`, `apiPost<T>`, **`apiStream(path, body, onChunk)`**, `ApiError`.
From `@/lib/config`: `apiBaseUrl()`, `setApiBaseOverride(url | null)`.
From `@/lib/haptics`: `tapSelect()`, `tapDone()`, `tapError()`.
From `@/lib/shared/tdee`: `proposeTargets`, `proteinTargetG`. From `@/lib/shared/units`: `displayLb`, `lbToKg`.

Server contracts:
- `GET /api/mobile/coach?limit=30` → `{ messages: [{ id, role, content, createdAt }] }`, oldest first.
- `POST /api/coach/chat { question }` → **a streamed `text/plain` body**, not JSON. Each chunk is a fragment of the answer. The route persists both sides itself.
- `POST /api/session/ask { question }` → same streaming shape, but scoped to the **active lift session** with a cached context prefix. 400 when there is no active session.
- `POST /api/profile { goalsText?, tz? }` → `{ ok }` or the updated profile.
- `POST /api/weight { weightLb, localDate? }` → `{ ok }`.
- `GET /api/mobile/bootstrap` → includes `goalsText`, `tdee`, `target`, `tz` (read it with react-query; do not fetch it twice on this screen).

## Streaming — read this before writing any fetch

`apiStream` in `@/lib/api` is already built on `import { fetch } from "expo/fetch"`, because **React Native's default `fetch` is XHR-backed and leaves `response.body` undefined** — the stream would appear to hang and then dump the whole answer at once. Use `apiStream`; do not call `fetch` yourself, and do not install a streaming library. If `apiStream` turns out to misbehave, fall back to rendering the full text at once (both routes work either way) and report it — do not try to fix `mobile/lib/api.ts`, which you do not own.

Render the stream by appending to a single assistant message as chunks arrive. Keep the list scrolled to the bottom while streaming (`onContentSizeChange` → `scrollToEnd`). If the stream errors mid-answer, keep the partial text and append one muted line — the routes themselves already append `(The coach is unreachable right now…)` on their side, so do not duplicate that message.

## Coach screen (`app/coach.tsx`, a modal)

A chat transcript, not a dashboard. Load history from `GET /api/mobile/coach`, oldest at the top. User messages right-aligned in `accentSoft` with `accentInk` text; assistant messages left-aligned on `surface`, full width, selectable. One multi-line `TextInput` pinned at the bottom with a `SEND` button, growing to four lines then scrolling; the system keyboard is correct here. While streaming: `SEND` is disabled and a cursor-style block follows the text.

The coach's voice is set by the system prompt — blunt, one recommendation, no praise. **Do not soften it in the UI**: no encouraging empty state, no suggestion chips that prompt for compliments.

It used to say `"not enough data" when there isn't any`, and that clause was the bug — see §5.4 of SPEC.md. A thin log changes what the coach cites and whether it may call a trend; it never changes whether the question gets answered. Nothing in the UI may promise otherwise, so the subtitle reads `Your own data, with the sample size stated. Thin weeks still get an answer.` and the empty transcript says the two questions that need no history: `Ask about your plan, a lift, or tonight's macros. Questions about your goals and your split need nothing logged at all.`

`ASK` **inside the lift session** is a different thing and is owned by the lift workstream — it hits `/api/session/ask`. Export a reusable `useStreamingAsk(path)` hook from `mobile/features/coach/` so the lift feature can import it rather than writing a second streaming client. Keep its signature simple: `{ messages, send(question), streaming, error }`.

## You screen (`app/(tabs)/you.tsx`)

Order matters — weight is a daily ritual and must be the first thing on the screen, not three taps deep.

1. **Weight.** A `Label` `WEIGH IN`, the last known weight large in `tnum` with its date, and a 56pt button `LOG WEIGHT` that opens `NumberPad` (`allowDecimal`, unit `lb`). `POST /api/weight { weightLb }`, `tapDone()`, then refetch `bootstrap`. One tap plus three keys.
2. **Maintenance.** The `tdee` block from `bootstrap`: when `status === "ok"`, the number with `±N kcal · from N weigh-ins` and the trend in lb/week; otherwise `Not enough weigh-ins for a reliable number — 5 of 8.` **Never show a TDEE below the threshold.** When `status === "ok"` and `target.kcal` is null, show the three options from `proposeTargets(tdee, currentKg)` as `Toggle` chips (cut / maintain / lean bulk) with their kcal numbers — this is the end of the three-week calibration, and the user picks once with real data. Picking one is **read-only in v1**: there is no endpoint that writes a `targets` row, so show the numbers and a line saying to set it on the laptop. Do not invent an endpoint; report the gap.
3. **Goals.** A multi-line `TextInput` pre-filled with `goalsText`, saved on blur via `POST /api/profile { goalsText }` with a small `SAVED` confirmation. This text goes into the system prompt of every model call, so explain that in one muted line: `Written in your own words. The coach reads this on every answer.` Free text, never a dropdown — a goal picker would reduce "half marathon in the fall, plus shoulders and back" to one bit of information.
4. **Connection.** `apiBaseUrl()` shown in mono, and an `Edit` affordance opening a `Sheet` with a `TextInput` → `setApiBaseOverride()`. This is how the user points the same scanned QR code at a LAN dev server (`http://192.168.x.x:3000`) with no rebuild. Include a `Reset to default` action. Show a one-line reachability check: `GET /api/mobile/bootstrap` returning 2xx → `CONNECTED` in `good`, otherwise `UNREACHABLE` in `bad`.
5. **Account.** Email, and `SIGN OUT` as a `danger` button behind a `Sheet` confirmation. On sign-out, clear the react-query cache; **do not clear the outbox** — undelivered sets belong to that user and must survive a sign-out so they can be delivered on the next sign-in.
6. **About.** App version, Expo SDK version, and two honest lines: push notifications are web-only today and do not reach this client; HealthKit cannot work in Expo Go and the Health Auto Export webhook already brings steps, sleep and weight in.

## Sign-in screen (`app/sign-in.tsx`)

Email and password only — the native client holds a Supabase JWT and needs no magic-link deep linking. Two modes, `SIGN IN` and `CREATE ACCOUNT`, toggled by a text link. Email field: `autoCapitalize="none"`, `keyboardType="email-address"`, `autoComplete="email"`, `textContentType="username"`. Password: `secureTextEntry`, `textContentType` `password` / `newPassword`. Errors render inline in `bad` — never an `Alert`. On sign-up, `signUp()` then `POST /api/auth/ensure-profile` (every screen reads the `profiles` row; a signed-in user without one is authenticated but invisible). If sign-up returns a user with no session, show `Check your email to confirm the account, then sign in.` rather than navigating to a screen that bounces back. **No password reset flow** — that is a web page with a redirect; link the user to the web app for it and say so.

This screen must also work when `apiBaseUrl()` is wrong, which is the most likely first-run failure. Put the same `Edit connection` affordance at the bottom, so a user staring at `UNREACHABLE` can fix it without being signed in.

## Hard rules
- Every figure uses `tnum`. No colour literals. No `Alert.alert`.
- Never log, display or persist a token. Never put one in a URL or an error message.
- `NumberPad` for weight, not a `TextInput`.
- Do not reimplement TDEE, target proposal or unit conversion — import from the shared domain.

## Verify
- `npm run typecheck` in `mobile/` — clean.
- `npx expo export --platform ios` succeeds.
- `npx expo start --web` against a dev server with `LLM_PROVIDER=fixtures`: sign in, ask the coach a question and watch the text arrive **incrementally** (if it arrives in one lump, say so — that is the `expo/fetch` path not working, and it is the finding that matters most from this workstream), log a weight, edit goals, change the base URL, sign out. Screenshot the coach and You screens.
- Unit-test (vitest, pure logic only, no `react-native` imports): the chunk-accumulation reducer (including a chunk split mid-UTF-8-character), and the `tdee`/target view-model across `ok` with a target, `ok` without one, and `insufficient_data`.
- Do not claim keyboard behaviour, modal presentation or scroll-follow-while-streaming is verified.

## Report
Whether incremental streaming actually worked, the screenshots, the missing `targets`-write endpoint, and any dependency you wanted and did not install.

### `voice-logging` — Build phase

**HOLD: do not start until the user has approved this plan. They asked to review it before any code is written.**

# voice-logging — speak a set, confirm it, log it

The user wants to say *"did 3 sets weighted pull ups 45lbs for 6 reps"* while lifting and have it land as **3 rows in `sets`**, against the pull-up exercise, 45 lb, 6 reps each. You own the whole vertical slice: a new Next.js transcription route and the mobile recording and confirmation UI.

## Files you OWN
- `src/app/api/voice/**` (new)
- `src/lib/llm/transcribe.ts` and `src/lib/llm/parse-sets.ts` (new)
- `src/app/api/sets/parse/route.ts` — **one refactor only**, see below
- `src/lib/models.ts` — **append one key, change nothing else**
- `mobile/features/voice/**`

**Do not touch** anything else under `src/app/`, anything under `src/components/`, `public/`, `README.md`, `.env.example`, any `package.json`, `mobile/lib/`, `mobile/components/ui/`, `mobile/app/`, or other features. You install nothing in `mobile/` — if you think you need a package, report it as a blocker. Report new env vars instead of editing `.env.example`.

## Read these first, and reuse them rather than rebuilding them
- `src/lib/llm/shorthand.ts` + `src/lib/llm/shorthand.test.ts` — a deterministic, tested parser for lifting notation.
- `src/app/api/sets/parse/route.ts` — shorthand first, model second, then `resolveExercise()`.
- `src/lib/llm/prompts.ts` → `SETS_SYSTEM`. `src/lib/llm/schemas.ts` → `parsed_sets` / `parsedSetsSchema`. `src/lib/exercises.ts` → `resolveExercise()` (exact alias, then `pg_trgm` fuzzy) and `learnAlias()`.
- `src/lib/api.ts` → `route()`, and `src/db/index.ts` → `withUser()`.

**Important and counter-intuitive:** the target phrase does **not** parse with the shorthand parser. `parseEntry` takes everything before the first numeric token as the exercise name, finds `"did"`, and bails — which is correct, and is why the model fallback exists. **Do not extend `shorthand.ts` to handle prose.** It has passing tests, it is the offline path for typed notation, and loosening it to swallow sentences is how you break the thing that already works.

## Part 1 — extract the parse path (so there is one, not two)

Create `src/lib/llm/parse-sets.ts`:
```ts
export interface ParsedEntryResolved {
  query: string;
  exercise: ResolvedExercise | null;
  sets: ParsedSet[];
}
export async function parseSetsText(text: string, userId: string): Promise<{
  usedModel: boolean;
  entries: ParsedEntryResolved[];
  unresolved: string[];
}>
```
Move the body of `/api/sets/parse` into it **verbatim in behaviour**: `parseShorthand(text)` → if empty, `getLlm().structured({ model: MODELS.setsParse, messages: [SETS_SYSTEM, text], schemaName: "parsed_sets", jsonSchema: JSON_SCHEMAS.parsed_sets, validator: parsedSetsSchema })` → then `withUser(userId, …)` wrapping one `resolveExercise()` per entry → `unresolved` = the queries that resolved to null.

Then rewrite `/api/sets/parse` to be a thin caller. Its **request and response shape must not change by one byte** — `{ usedModel, entries: [{ query, exercise, sets }], unresolved }` — because `src/components/SetLogger.tsx` in the live web app consumes it. Keep `{ scope: "manual" }`: the model call must not run inside `withUser()`'s transaction, since Supabase's pooler is in transaction mode and a multi-second round trip would pin a connection.

## Part 2 — `POST /api/voice/transcribe`

Auth: the standard `route()` helper, so it inherits the `Authorization: Bearer <supabase jwt>` path that the backend-auth workstream is adding. Do **not** write your own auth, and do not read a user id from the body.

**Request** — `multipart/form-data`:

| part | notes |
|---|---|
| `audio` | the recording. From Expo Go on iOS: AAC-LC in MPEG-4, filename `set.m4a`, type `audio/m4a`. |
| `hint` | optional text: the current exercise name, passed to the transcriber as a decoding prompt to bias toward e.g. "weighted pull up". |

Handler:
1. `const form = await req.formData()`. Reject: no `audio` → 400; `size < 1_000` → 400 `"Nothing recorded."`; `size > 2_000_000` → 413; a non-audio content type → 415. (Vercel's request limit is 4.5 MB; a 15-second mono clip is ~45 KB, so anything large is a bug, not a long sentence.)
2. Transcribe via `src/lib/llm/transcribe.ts`, which mirrors the existing provider pattern in `src/lib/llm/index.ts` — a real implementation and a fixtures implementation, selected the same way (`LLM_PROVIDER=fixtures` or a missing `OPENAI_API_KEY`):
   ```ts
   export interface Transcriber { readonly name: string; transcribe(input: { file: File; hint?: string }): Promise<string> }
   export function getTranscriber(): Transcriber
   ```
   - Real: `client.audio.transcriptions.create({ file, model: MODELS.transcribe, language: "en", prompt: hint, response_format: "text" })` with a 20s timeout and the same `LlmError` wrapping and error-describing style as `src/lib/llm/openai.ts`.
   - **Model id:** add `transcribe: process.env.OPENAI_TRANSCRIBE_MODEL ?? null` to `MODELS`. **Do not invent a model name.** `src/lib/models.ts` pins explicit ids on purpose and an invented one is a 400 in production that looks like a bug in your code. When it is unset, return **503** `{ error: "Transcription is not configured." }` and report `OPENAI_TRANSCRIBE_MODEL` as a required env var. Note in your report that `npm run llm:preflight` is the only thing that can prove the id exists — no call has ever reached `api.openai.com` from this repo.
   - Fixtures: return a canned transcript that **the shorthand parser can actually parse**, e.g. `"bench 5x5 185"`. This matters: the fixtures provider implements `parsed_sets` by running `parseShorthand` on its input, so a prose fixture would yield zero entries and the offline demo path would look broken.
3. `const parsed = await parseSetsText(transcript, userId)` — the same function `/api/sets/parse` now uses. No second parser, no second resolver, no second prompt.
4. `{ scope: "manual" }`. Two model calls happen here; neither may be inside a transaction.
5. **The audio is never written to disk and never persisted.** In memory for one request, then dropped — the same rule as meal photos. Do not log the transcript to the console in production.

**Response** — `200`, deliberately the transcript plus the exact `/api/sets/parse` body, so the confirmation UI is shared with typed entry:
```json
{ "transcript": "did 3 sets weighted pull ups 45lbs for 6 reps",
  "usedModel": true,
  "entries": [{ "query": "weighted pull ups",
    "exercise": { "id": "…", "name": "Weighted Pull-up", "slug": "weighted-pull-up",
                  "incrementLb": 5, "equipment": "bodyweight", "confidence": "fuzzy" },
    "sets": [ { "reps": 6, "weight_lb": 45, "rpe": null, "to_failure": false, "is_warmup": false } ] }],
  "unresolved": [] }
```
This route **never writes a set.**

## Part 3 — the mobile slice (`mobile/features/voice/`)

Export `<VoiceButton exerciseId? exerciseName? onConfirmed={() => void} />` for the lift workstream to drop into its session card, and keep the confirmation sheet inside your feature.

From other workstreams: `@/components/ui` (`Sheet, Card, Label, Button, Toggle, Pill, NumberPad, Spinner`, tokens); `@/lib/api` (`apiUpload<T>`, `apiPost<T>`, `ApiError`); `@/lib/outbox` (`enqueue`); `@/lib/haptics` (`tapSelect/tapSave/tapDone/tapError`); `@/lib/shared/outbox` (`newClientId`); and `ExercisePicker` from `mobile/features/lift/ExercisePicker.tsx` with the fixed signature `{ query?: string; onPick: (e: CatalogueExercise) => void; onCancel: () => void }`. Installed packages you may use: `expo-audio`, `expo-file-system`, `expo-keep-awake`, `expo-network`.

### Recording — tap-to-toggle, not hold-to-talk
A 56pt circular mic button with 12pt `hitSlop`. **Tap to start, tap to stop.** With chalk or sweat on your fingers a press can lift without you noticing, and a hold that drops mid-sentence truncates the recording silently — you find out when you read the transcript. A toggle also lets you put the phone on the bench. Hard cap 15s with a countdown in the last 5s, then auto-stop. No silence detection in v1: a guess that ends your sentence early is worse than a second tap.

```ts
const recorder = useAudioRecorder({ extension: ".m4a", sampleRate: 16000, numberOfChannels: 1,
  bitRate: 24000, isMeteringEnabled: true,
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM,
         linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false } });
const state = useAudioRecorderState(recorder, 100);
```
`getRecordingPermissionsAsync()` → `requestRecordingPermissionsAsync()` on first use; a denial is one inline line, never an `Alert`. `setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })` before `prepareToRecordAsync()`, then `recorder.record()`; stop with `await recorder.stop()` and read `recorder.uri`.

While recording: the button fills `accent`, reads `STOP`, shows `0:04` in `tnum`, and displays a 5-bar level meter driven by `state.metering` — the only honest proof the mic is live. `tapSelect()` on start, `tapSave()` on stop, `useKeepAwake()` throughout. **The rest of the session screen stays interactive**; recording never blocks the manual path.

Upload:
```ts
const form = new FormData();
form.append("audio", { uri, name: "set.m4a", type: "audio/m4a" } as any);
if (exerciseName) form.append("hint", exerciseName);
const res = await apiUpload<TranscribeResponse>("/api/voice/transcribe", form);
```
**Never set `Content-Type` yourself** — React Native writes the multipart boundary. (`apiUpload` already handles this.)

While the server works: the button pulses with `TRANSCRIBING…` and a skeleton row appears. 20s timeout. On timeout or 5xx: `Didn't come back. Tap to retry, or log it by hand.` — and **keep the recording file**, so retry re-uploads the same audio instead of making the user repeat themselves in a gym. Delete the file only after a confirm or an explicit discard, in a `finally`.

### The confirmation sheet — nothing is written before this
A bottom `Sheet`, so the session stays visible behind it.
1. **The transcript, verbatim**, 13pt muted. Tappable → a `TextInput` plus `RE-PARSE`, which re-runs `POST /api/sets/parse { text }` on the edited text (same response shape, no new audio). This is the escape hatch for a badly misheard sentence.
2. **One editable row per set** — per *set*, not per entry, so fixing "3 sets" heard as 2 never requires re-speaking: `[ Weighted Pull-up ]  [ 45 lb ]  [ × 6 ]  [ ⧉ ]  [ × ]`. Every number opens the **same `NumberPad`** as manual logging. `⧉` duplicates the row, `×` deletes it. RPE / to-failure / warmup from the parse appear as `Toggle` chips on the row.
3. **Resolution, made visible.** `confidence: "exact"` → a plain chip. `confidence: "fuzzy"` → a chip marked `~` with `heard: "weighted pull ups"` underneath. A wrong fuzzy match is the one failure that corrupts trend history quietly, so it is always shown. Tapping the chip opens `ExercisePicker` pre-filled with the raw query; picking re-files **every row of that entry** and fires `POST /api/mobile/exercise/alias { exerciseId, alias: rawQuery }` so the same wording is free next time.
4. **Unresolved** (`exercise: null` or a non-empty `unresolved`): the row reads `UNMATCHED: "weighted pull ups"` in `bad` and **the confirm button stays disabled until every row has a real `exerciseId`.** Never guess and never silently drop a row. Zero entries: show `Couldn't parse that.` with the editable transcript and a `LOG BY HAND` button; the transcript is never lost.
5. **`LOG 3 SETS`** → each row becomes its own outbox item with its own `newClientId()`, through the **same `@/lib/outbox` used by manual logging** — never a direct `POST /api/sets`:
   ```ts
   await enqueue("set", "/api/sets", { clientId, exerciseId, reps, weightLb, rpe, toFailure, isWarmup, felt: null, note: "", rawText: transcript });
   ```
   `rawText` carries the transcript so `sets.raw_text` keeps what was actually said — that column exists for exactly this, and it means a mangled parse can be revisited later without losing the original. `tapDone()`, close, delete the audio file, call `onConfirmed()`.

### No signal
When `expo-network` reports no connectivity, the mic renders disabled with a `NEEDS SIGNAL` sub-label. Tapping it does **not** record: one inline line — `No signal. Speaking needs the server; logging by hand works offline.` Queueing audio for later transcription is deliberately rejected, because the result needs confirmation and asking someone to confirm a sentence they said forty minutes ago in the car park is worse than a one-tap manual log. Put that reasoning in a code comment so nobody "improves" it later.

## Verify
- `npm test` at the repo root — all 158 existing tests still pass, **especially `shorthand.test.ts`**, which proves you did not change the parser.
- New vitest tests: `parseSetsText` with (a) shorthand that the deterministic parser handles, (b) prose that forces the model fallback (use the mock provider pattern in `src/lib/llm/__testing__/mock-openai.ts` — no network), (c) an entry that resolves exactly, (d) one that resolves fuzzily, (e) one that does not resolve at all. Plus `/api/voice/transcribe` rejections: no file, too small, too large, wrong mime, and `MODELS.transcribe` unset → 503.
- `npm run typecheck` and `npm run build` at the root.
- `npm run typecheck` and `npx expo export --platform ios` in `mobile/`.
- `curl -F audio=@<a small m4a> -F hint="bench press" .../api/voice/transcribe` with `LLM_PROVIDER=fixtures` and a `DEV_USER_ID` dev server, and paste the real response.
- **You cannot test recording.** There is no device, no simulator and no microphone in this container, and `react-native-web`'s recorder is a different implementation. Say so plainly; do not imply the recording path works.

## Report
The real `/api/voice/transcribe` response, the required `OPENAI_TRANSCRIBE_MODEL` env var and the fact that the model id is unproven until `llm:preflight` runs, confirmation that `/api/sets/parse`'s shape is unchanged, what you could not verify, and any dependency you wanted and did not install.

---

## Risks

**1. Expo Go on the App Store supports only the current SDK. If the user's Expo Go updates to SDK 59 before they scan, or if their installed copy is older than 58, the QR code ends in "incompatible version" and nothing runs.**

Everything is pinned to SDK 58 from expo@58.0.19's own manifest, so the app matches today's Expo Go exactly. `mobile/README.md` must state the SDK version and that an Expo Go upgrade means a one-line `expo` bump plus `npx expo install --fix`. This is unfixable in principle — it is the price of the distribution story — so it is documented rather than hidden.

**2. One Expo-Go-incompatible dependency means a red error screen instead of an app, and a bundle that builds fine here can still fail on the device if the native module is absent from the Expo Go binary.**

The allowlist is closed and every entry is either an Expo SDK module, a pure-JS library, or one of the five third-party natives the official SDK 58 template depends on (so present in Expo Go by construction). Only expo-scaffold may install; every other engineer reports a wanted dependency as a blocker. `npx expo export --platform ios` is run as a gate, which catches resolution and version-mismatch failures — but not absence from the binary, which is why the allowlist, not the build, is the real control.

**3. Two Reacts in one bundle. The repo root needs react@19.0.0 for Next 15; Expo needs 19.3.0. A hoisted or hierarchically-resolved duplicate produces "Invalid hook call" or a renderer mismatch on the device, with no debugger.**

No npm workspaces; mobile/ is a separate project with its own node_modules. Metro is pinned with `resolver.nodeModulesPaths = [mobile/node_modules]` and `resolver.disableHierarchicalLookup = true`, so it cannot climb into the Next app's tree. Both lines are mandatory and are called out in the scaffold brief.

**4. Metro resolving shared files above the project root is the least-standard part of the design. If `watchFolders` or the relative barrel paths are wrong, nothing bundles.**

The risky `../../../src/...` paths are confined to eight one-line files owned by one engineer; everyone else uses the `@/` alias that the official template proves works. expo-scaffold must prove it end to end with a throwaway screen that renders `displayLb(100)` and `newClientId()` and survives `expo export`, and report which mechanism it used. If outside-root resolution fails entirely, the fallback is copying the three domain files and the queue into mobile/ — which the briefs explicitly forbid, so it becomes a reported blocker rather than a silent duplication.

**5. expo-secure-store fails above 2048 bytes per value, and a Supabase session JSON exceeds that. A naive storage adapter appears to work in testing and then silently loses the session — the user is signed out the moment they reach the gym.**

A chunking adapter (≤1800-byte chunks plus a count key) is specified as a requirement, not a suggestion, with unit tests at 1, 2047, 2049 and 10240 bytes. Plus AppState-driven `startAutoRefresh`/`stopAutoRefresh`, without which the access token expires while backgrounded and every request 401s.

**6. The web app has NO read API — every screen reads src/lib/queries.ts from a server component. This was not in the task description and is a second hard dependency alongside bearer auth. Underestimating it would leave six mobile engineers building against endpoints that never arrive.**

Six new `/api/mobile/*` endpoints are specified field by field and assigned to a single owner, and `route()` is extended (additively) to forward `req` and `searchParams` because it currently discards both. backend-auth must paste real response bodies into its report; the mobile briefs carry the same shapes inline so work proceeds in parallel against the contract.

**7. An auth change that weakens RLS. Verifying a bearer token by locally decoding the JWT and trusting `sub` would be a complete authentication bypass, and it is the obvious shortcut.**

The brief mandates `supabase.auth.getUser(token)` — server-side signature and expiry verification — and names local decoding as the thing that must not happen. Resolution order is specified so an invalid bearer token returns null and never falls through to cookies or the DEV_USER_ID shim. RLS, `withUser()` and the shim's production lockout are untouched, with eight required tests including the precedence and production-lockout cases.

**8. Streaming the coach silently does not work. React Native's default fetch leaves `response.body` undefined, so the two existing streaming routes would appear to hang and then dump everything at once — and it would read as a backend bug.**

`apiStream` is built on `expo/fetch` (confirmed present in expo@58.0.19's exports), with a documented full-text fallback since both routes work either way. coach-settings is required to report explicitly whether text arrived incrementally — that is the single most valuable finding from that workstream.

**9. The transcription model id is unproven. The repo pins fictional `gpt-5.6-*` ids and no call has ever reached api.openai.com from this codebase; an invented audio model name would be a production 400 that looks like a code bug.**

`MODELS.transcribe` reads `OPENAI_TRANSCRIBE_MODEL` with no default, and the route returns a clean 503 with a user-facing "speaking isn't set up yet" message when unset. No name is invented. The fixtures transcriber returns shorthand the deterministic parser can handle, so the whole flow is demonstrable offline. `npm run llm:preflight` is named as the only thing that can confirm the id.

**10. Voice logging writes the wrong exercise. A fuzzy `pg_trgm` match on a misheard name files sets against the wrong row and corrupts trend charts quietly — the worst failure mode in the app, because nobody notices for weeks.**

Nothing is written before confirmation. Fuzzy matches are visibly marked with the raw transcript shown underneath; unresolved names disable the confirm button entirely; corrections re-file every row of the entry and learn an alias. The transcript is persisted in the existing `sets.raw_text` column so a bad parse can be revisited. And the shorthand parser is explicitly off-limits, so its 158 passing tests cannot be collateral damage.

**11. Eight engineers in one working tree collide on shared files.**

Ownership is absolute and stated per brief: only expo-scaffold touches mobile config, root tsconfig/.gitignore and the one-line `OutboxKind` widening; only backend-auth touches auth, `route()` and `/api/mobile/`; only voice-logging touches `/api/voice/`, `src/lib/models.ts` (append-only) and the `/api/sets/parse` refactor. Nobody edits `README.md`, `.env.example` or any root `package.json` — new env vars are reported instead, which removes the one file four workstreams would otherwise all append to. `ExercisePicker` is the only cross-feature component and its signature is fixed in both briefs.

**12. Honest limits of this container: there is no iOS simulator, no device, no Xcode and no microphone. Gesture feel, scroll and transition smoothness, haptics, keyboard behaviour, tap latency, audio recording, camera capture, native modal presentation and background/foreground outbox flushing are all unverifiable here — and those are precisely the complaints the project exists to fix.**

Four gates that do work: `tsc --noEmit` in both projects, the root vitest suite staying green, `npx expo export --platform ios` on every mobile workstream, and `expo start --web` for rough visual comparison against the running web app. Every brief requires the engineer to state plainly what it could not verify and forbids implying a native behaviour works. The first real test is the user scanning the QR code; the design keeps the fallback paths (manual logging, by-hand entry, baseline without suggestion) working whenever a native nicety fails.

**13. Offline session start. `POST /api/session/start` is a server insert, so the first set of the day in a basement has nowhere to land, and a start delivered the next morning would be filed on the wrong local date.**

`session-start` becomes a second outbox kind, queued ahead of the sets; the ordered queue delivers it first and `POST /api/sets` resolves the active workout server-side, so no new server contract is needed. A queued start older than 6 hours is dropped with a visible message, matching the spec's existing auto-abandon rule. The only change to the shared queue is widening a union, and all existing outbox tests must still pass.

**14. Meal photos leaking to disk. expo-image-picker writes a file into the app cache, which quietly violates the spec's "nothing kept" rule that the whole architecture is built around.**

The food brief leads with the rule, requires deletion of the picker's cache file in a `finally` so it happens on the error path too, forbids persisting the image in any cache or log, and requires the engineer to confirm in its report that no code path writes an image anywhere.

