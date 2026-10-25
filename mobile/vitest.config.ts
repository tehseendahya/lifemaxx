import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Pure logic only. Anything that imports `react-native` is not unit-tested
 * here: there is no native runtime in CI, and a jest-style RN mock would be
 * testing the mock. The storage adapters are tested against fakes instead,
 * which is where their actual rules live.
 *
 * Deliberately separate from the root suite — the root `vitest.config.ts`
 * includes only `src/**`, so these two never collide.
 */
export default defineConfig({
  /**
   * `@/…` is what `tsconfig.json` resolves and therefore what every file in
   * this project imports. Vitest does not read tsconfig paths and there is no
   * tsconfig-paths plugin installed, so without this alias a `model.ts` that
   * imports a shared barrel at runtime cannot be collected at all — the test
   * file fails to load, which reports as zero tests rather than as a failure.
   *
   * It does not need to cover `@/db/schema` (the second tsconfig path): every
   * import of it is an `import type`, erased before anything is resolved.
   */
  resolve: { alias: { "@": path.resolve(__dirname) } },

  // `features/**` belongs here as much as `lib/**` does: every feature keeps its
  // decisions in a `model.ts` / `logic.ts` with no `react-native` import, and
  // those are tested. Without this glob they are collected by nothing and 200
  // passing tests report as zero — which is indistinguishable from not having
  // written them.
  test: {
    environment: "node",
    // `components/**` is here for the same reason: the keypad's logic and the
    // guard that `tokens.ts` has not drifted from `globals.css` are both pure
    // Node. Neither imports `react-native` — `tokens.test.ts` reads the two
    // files as *text* precisely so it does not have to.
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.ts",
      "features/**/*.test.ts",
    ],
  },
});
