# lifemaxx — native iOS client

The phone client. The Next.js app in the parent directory stays exactly as it
is: it remains the backend for this app and the UI on a laptop. This is not a
replacement for it and does not aim at feature parity with it.

Built to run in **Expo Go**, which shapes nearly every decision below.

---

## Running it

```bash
# once, from the repo root — the mobile typecheck needs the root's node_modules
npm install

# then
cd mobile
npm install
npx expo start
```

Install **Expo Go** from the App Store, open the camera, scan the QR code in the
terminal. That is the whole distribution story: no Apple Developer account, no
TestFlight, no EAS build, no `ios/` directory.

**Three values must be filled in before anything will load.** They ship empty
on purpose: a placeholder URL would send real requests to a domain nobody here
owns, so the app instead says plainly on the sign-in screen that it is not
configured. Either set them in the environment (they are inlined into the
bundle at build time, so restart the bundler after changing them):

```bash
EXPO_PUBLIC_API_BASE_URL=https://your-app.vercel.app
EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the anon key>
```

…or put them in `app.json` under `expo.extra` (`apiBaseUrl`, `supabaseUrl`,
`supabaseAnonKey`). The anon key is designed to ship in clients — the web app
already serves it to every browser — and row-level security in Postgres is what
actually protects the data. The sign-in screen says so plainly when either is
missing, rather than failing as a network error.

### Pointing it at a dev server on your LAN

Expo Go runs on a real phone, so `localhost` is the phone. To develop against
`npm run dev` on your laptop, open **You → Connection** and enter
`http://192.168.x.x:3000`. It is stored in SecureStore and overrides the
bundled URL, so the same scanned QR code works against either server with no
rebuild. Plain HTTP to a LAN address works in Expo Go without an ATS exemption,
and `newClientId()` in the shared outbox already has a fallback for
`crypto.randomUUID` being absent outside a secure context — which is exactly
this case.

The API needs `MOBILE_CORS_ORIGINS` set only for `npx expo start --web`; the
native client is not CORS-constrained.

### Scripts

| | |
|---|---|
| `npm start` | the dev server and QR code |
| `npm run ios` / `android` / `web` | start on a given target |
| `npm run typecheck` | `tsc --noEmit` (needs the root `npm install`) |
| `npm test` | vitest, pure logic only |
| `npm run bundle` | `expo export --platform ios` — the real build gate |

There is a diagnostic route at **`/shared-smoke`** (not linked from the UI). It
renders values computed by `src/lib/domain/*` across the project boundary. If
those numbers are right, the shared domain layer is live in Expo Go.

---

## The Expo Go constraint

Expo Go on the App Store ships exactly **one** SDK runtime: the current one.
This project targets **Expo SDK 58** (`expo@~58.0.19`, React Native 0.88.0,
React 19.3.0), which was the published release when it was built.

Every native-bearing version here is copied from `expo@58.0.19`'s own
`bundledNativeModules.json`. A reanimated, screens or gesture-handler version
outside the SDK's pin is the single most common cause of a red error screen, so
do not "upgrade" any of them individually.

**The dependency list is closed.** Only packages that work inside Expo Go are
allowed: modules shipped in the Expo SDK, pure-JavaScript libraries, and the
handful of third-party natives bundled into Expo Go because the default SDK 58
template depends on them. Anything requiring `expo prebuild`, a config plugin
with native code, or a custom dev client is out — one such package and scanning
the QR code produces a red screen instead of an app. Notably excluded, and
deliberately: `react-native-health`, `@kingstinct/react-native-healthkit`,
`@react-native-voice/voice`, `react-native-mmkv`,
`react-native-keyboard-controller`.

When Expo Go updates to SDK 59, this app will stop loading with "incompatible
version" until `expo` is bumped and `npx expo install --fix` is run. That is
unfixable in principle — it is the price of installing from the App Store rather
than building — so it is written down rather than hidden.

---

## How it is put together

### Not an npm workspace

`mobile/` is a self-contained npm project nested in the repo: its own
`package.json`, its own `node_modules`, its own lockfile. The root
`package.json` is untouched and gains no mobile dependencies.

This is deliberate. The root needs `react@19.0.0` for Next 15; React Native
0.88 requires `react@^19.3.0`. Workspaces hoist, and a single hoisted React
means Metro bundles a React that does not match the renderer it was built
against — "Invalid hook call", on a device, with no debugger. Two isolated trees
make that impossible. The cost is running `npm install` twice.

`metro.config.js` locks resolution to `mobile/node_modules`
(`nodeModulesPaths` + `disableHierarchicalLookup`) so Metro cannot climb to the
repo root and find the wrong React even by accident. Both lines are required.

### Sharing code with the web app

The domain layer (`src/lib/domain/*` — units, e1RM, progression, muscles, TDEE,
readiness, running) and the outbox queue (`src/lib/outbox/queue.ts`) are pure
TypeScript with no I/O and have test coverage in the root suite. The native app
**imports them**. It does not reimplement, copy or vendor them: two clients
computing the same number two ways is how they come to disagree about it.

Mechanically: `metro.config.js` adds `../src/lib` to `watchFolders`, and
`mobile/lib/shared/` holds one one-line re-export barrel per module. Those eight
files are the only ones in `mobile/` containing a `../../../` path; everything
else imports `@/lib/shared/units` and friends.

For **typechecking** only, `tsconfig.json` maps `@/db/schema` to
`../src/db/schema.ts`, because three domain files carry a type-only
`import type { Muscle } from "@/db/schema"`. Babel's TypeScript transform
elides that before Metro ever sees it, so `drizzle-orm` is never pulled into the
bundle — but `tsc` does need to resolve it, which is **why the root
`npm install` must have been run before `npm run typecheck` here.**

### Writes go through the outbox, reads through react-query

Every write — a set, a session start — is queued in SQLite
(`expo-sqlite`) and delivered in the background. A save never waits on a
network that, in the room where this app is used, is usually not there. The
delivery rules (strictly in order, stop at the first failure, only retry what
retrying can fix) are the shared `flush()` from `src/lib/outbox/queue.ts`; this
app adds a storage adapter, not a second queue.

Reads use `@tanstack/react-query`. The query cache is **not** persisted —
offline reads come from the one fat `GET /api/mobile/bootstrap` payload, which
is deliberately a single request so the phone has everything it needs after one
chance at the network on the way into a basement.

### Authentication

Supabase email/password on the device; the access token goes to the Next.js API
as `Authorization: Bearer <jwt>`. A native client has no cookies, so the
cookie-based `createServerClient` path the web app uses would resolve nobody and
every screen would render empty. Server-side the token is verified by Supabase
rather than decoded locally, and the resolved user id still flows through
`withUser()` — row-level security is unchanged.

The session is persisted in `expo-secure-store` through a **chunking adapter**.
SecureStore warns above 2048 bytes per value and a Supabase session JSON is past
that; a naive adapter appears to work and then silently loses the session on
next launch. See `lib/chunked-store.ts` and its tests.

---

## HealthKit is out of scope

Not attempted, no library installed. HealthKit requires a native module and
cannot work in Expo Go under any configuration — installing
`react-native-health` or `@kingstinct/react-native-healthkit` would make the QR
code produce a red screen on launch, which is a strictly worse outcome than not
having step counts.

Nothing is actually lost today: the **Health Auto Export** webhook already
delivers steps, sleep and weight into `body_metrics` and keeps working
untouched.

A future `eas build` dev client — which needs an Apple Developer account —
would unlock direct HealthKit reads (steps, sleep, resting heart rate, workouts
written back to Apple Health), a home-screen widget, background sync, and
on-device speech recognition for voice set logging (which currently records with
`expo-audio` and transcribes server-side instead).

---

## What is verified, and what cannot be

There is no simulator, no device and no Xcode in the environment this was built
in. Four gates are run:

- `npm run typecheck` in both projects
- `npm test` in both projects
- `npx expo export --platform ios` — proves Metro resolves every route, the
  cross-boundary shared imports, and every native-module import
- `npx expo start --web` — a rough visual check of pure-RN components

A successful Metro bundle catches version mismatch, unresolvable shared imports
and bad native-module imports. It **cannot** catch a module that bundles fine
but is absent from the Expo Go binary, which is why the closed dependency list
is the real control rather than the build.

Nothing about **gestures, haptics, the keyboard, scroll feel, tap latency,
audio recording or the camera** is verified. None of it can be exercised
without a phone. The first real test of this app is the first QR scan.
