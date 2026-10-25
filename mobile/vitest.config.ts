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
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
