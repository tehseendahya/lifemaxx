# mobile/: the client (phone + laptop web)

Read the root `CLAUDE.md` first. This file only adds what's specific to the
client. The long-form background is in `mobile/README.md`.

## Layout

```
app/            expo-router routes. Keep them thin: each re-exports a feature screen.
  (tabs)/       Today (index), Lift, Food, You.
features/<area>/
  *Screen.tsx   UI
  model.ts      pure decisions (also logic.ts etc.): no react-native import
  model.test.ts tests next to it
components/ui/  design system (tokens + primitives). Reuse; don't restyle per screen.
lib/            api client, auth, config, outbox adapter, query client, storage.
lib/shared/     one-line re-exports of ../src/lib (the only files allowed to reach outside).
public/         static web assets copied into the web export (manifest, icons, sw.js).
```

- Put decisions (formatting, ranking, validation, what to show when data is
  missing) in a pure `model.ts` and test them with vitest. **Test pure logic,
  not components.** There's no React Native runtime under test and no RN mocks,
  and a test that imports `react-native` won't run.
- vitest only collects `lib/**`, `components/**` and `features/**`
  (`*.test.ts`). Put tests anywhere else and they silently don't run.
- Import with `@/…` (for example `@/lib/shared/units`), never with
  `../../../src`.
- Writes (sets, session starts) go through the outbox (`lib/outbox.ts`), and
  reads go through react-query. Meals are the exception: they're reviewed
  first and then posted directly.

## Phone vs web

The same code runs on both. Branch on `Platform.OS === "web"` only where a
capability really differs:

| | Phone (Expo Go) | Web (laptop or phone browser) |
|---|---|---|
| Meal photo | Camera + library | "Upload photo" via a file picker (expo-image-picker on web). Same resize/discard path, never stored. |
| Voice set entry | Mic (expo-audio) | Hidden |
| Set entry | Custom number pad | Real text inputs (Tab between fields, Enter logs) |
| Sheets | Bottom sheets | Centered dialogs on wide screens (Escape / backdrop closes) |
| Push | None (Expo Go can't) | Web push via `/sw.js` when `PushManager` exists |
| Session storage | SecureStore (chunked) | localStorage (`lib/secure-store.ts`) |
| API base URL | `EXPO_PUBLIC_API_BASE_URL` / You → Connection | Same origin (`window.location.origin`) |

**Wide layout:** web with `useWindowDimensions().width >= 900`. A left sidebar
(Today, Lift, Food, Runs, Coach, You) replaces the tab bar, and content sits
in a centered column of about 1100px max, with two-column grids where cards
are independent. Narrow web looks like the phone app. Use the shared
responsive helper rather than hard-coding 900 in each screen.

## Rules

- Install dependencies with `npx expo install <pkg>`, never a bare
  `npm i <pkg>@latest`, and only packages that work in Expo Go.
- Don't touch `app.json` `runtimeVersion`, `updates.url` or `extra.eas`.
- `EXPO_PUBLIC_*` values are inlined at bundle time, so restart Metro after you
  edit `.env`.
- Before a PR, run `npx tsc --noEmit && npx vitest run` and
  `npx expo export --platform ios --output-dir /tmp/lifemaxx-ios`. If you
  touched anything web-specific, also run `npx expo export --platform web
  --output-dir /tmp/lifemaxx-web`.
