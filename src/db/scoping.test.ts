import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `adminDb` bypasses row-level security. That is correct for a short list —
 * migrations, the catalogue seed, the cron jobs that iterate every profile
 * before narrowing to one user, and the health webhook, which has no session
 * and must look up which profile a payload belongs to before scoping to it —
 * and a leak for everything else.
 *
 * It is a one-word import away from any file, and the failure mode is silent:
 * the query works, returns everyone's rows, and nothing complains. So the list
 * of files allowed to reach for it is written down here, and adding to it has
 * to be deliberate.
 */
const ALLOWED = new Set([
  "src/db/index.ts",
  "src/app/api/cron/nightly/route.ts",
  "src/app/api/cron/weekly/route.ts",
  "src/app/api/cron/strava/route.ts",
  // No session on a webhook: it resolves the profile, then writes inside
  // withUser like everything else.
  "src/app/api/webhooks/health/route.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    // Test files and the mock server talk *about* these names rather than using
    // them, so scanning them only ever produces false positives.
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe("database scoping", () => {
  const files = walk("src");

  it("only the cross-user paths import adminDb", () => {
    const offenders = files.filter((path) => {
      if (ALLOWED.has(path.replace(/\\/g, "/"))) return false;
      const source = readFileSync(path, "utf8");
      return /\badminDb\b/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it("every server component that reads user data opens a scope", () => {
    const pages = files.filter((p) => /[\\/]page\.tsx$/.test(p));
    const offenders = pages.filter((path) => {
      const source = readFileSync(path, "utf8");
      // A page that never resolves a user is a public page and needs nothing.
      if (!source.includes("currentUserId")) return false;
      return !source.includes("withUser");
    });

    expect(offenders).toEqual([]);
  });
});
