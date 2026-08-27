import "../load-env";
import fs from "node:fs";
import path from "node:path";
import { adminDb, db, withUser } from "../src/db";
import { profiles, activities } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { parseActivitiesCsv } from "../src/lib/strava-export";
import { localDate } from "../src/lib/queries";

/**
 * Imports a Strava account archive.
 *
 * Strava moved Standard-tier API access behind a subscription in June 2026.
 * The export under Settings → My Account → Download or Delete Your Account is
 * free and holds the same activities, so this is the way in without one.
 *
 *   npm run runs:import -- ~/Downloads/export_12345/activities.csv
 *   npm run runs:import -- ~/Downloads/export_12345 --dry-run
 *
 * Rows are written as provider "strava" with Strava's own activity id, so they
 * land on the same (user_id, provider, external_id) unique index the nightly
 * pull uses. Re-importing a newer archive updates in place, and if a
 * subscription ever appears the API sync converges on these same rows instead
 * of duplicating them.
 */

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const OFF = "\x1b[0m";

function resolveCsv(input: string): string {
  const p = path.resolve(input.replace(/^~/, process.env.HOME ?? "~"));
  if (!fs.existsSync(p)) throw new Error(`No such file or directory: ${p}`);
  if (fs.statSync(p).isDirectory()) {
    const inside = path.join(p, "activities.csv");
    if (!fs.existsSync(inside)) {
      throw new Error(`No activities.csv in ${p}. Unzip the archive first and point at the folder or the csv.`);
    }
    return inside;
  }
  if (p.endsWith(".zip")) {
    throw new Error("Unzip the archive first, then point at the folder or activities.csv inside it.");
  }
  return p;
}

async function resolveUser(flag: string | undefined): Promise<{ id: string; tz: string; email: string }> {
  const all = await adminDb.select().from(profiles);
  if (all.length === 0) throw new Error("No profiles exist yet. Sign in to the app once first.");

  if (flag) {
    const match = all.find((p) => p.id === flag || p.email.toLowerCase() === flag.toLowerCase());
    if (!match) throw new Error(`No profile matching ${JSON.stringify(flag)}.`);
    return { id: match.id, tz: match.tz, email: match.email };
  }
  if (all.length > 1) {
    throw new Error(
      `More than one profile exists. Pass --user <uuid|email>:\n` +
        all.map((p) => `  ${p.id}  ${p.email}`).join("\n"),
    );
  }
  return { id: all[0].id, tz: all[0].tz, email: all[0].email };
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const userFlag = argv.includes("--user") ? argv[argv.indexOf("--user") + 1] : undefined;
  const target = argv.find((a) => !a.startsWith("--") && a !== userFlag);

  if (!target) {
    console.error(
      "Usage: npm run runs:import -- <path to activities.csv or export folder> [--user <uuid|email>] [--dry-run]",
    );
    process.exit(1);
  }

  const csvPath = resolveCsv(target);
  const user = await resolveUser(userFlag);

  console.log(`\nreading ${DIM}${csvPath}${OFF}`);
  const report = parseActivitiesCsv(fs.readFileSync(csvPath, "utf8"));

  console.log(`  ${GREEN}ok${OFF}   parsed ${report.activities.length} activities for ${user.email}`);
  if (report.distanceInferred) {
    console.log(
      `  ${YELLOW}note${OFF} only one Distance column was present, so it was read as ` +
        `kilometres and converted. Check a known run's distance below.`,
    );
  }
  if (report.skipped.length) {
    console.log(`  ${YELLOW}note${OFF} skipped ${report.skipped.length} row(s):`);
    for (const s of report.skipped.slice(0, 5)) console.log(`         line ${s.line}: ${s.reason}`);
    if (report.skipped.length > 5) console.log(`         …and ${report.skipped.length - 5} more`);
  }
  if (report.activities.length === 0) {
    console.log(`\n${RED}Nothing to import.${OFF}\n`);
    process.exit(1);
  }

  const byType = new Map<string, number>();
  for (const a of report.activities) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
  console.log(`\nby type`);
  for (const [type, n] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${DIM}${String(n).padStart(5)}  ${type}${OFF}`);
  }

  const sorted = [...report.activities].sort((a, b) => +a.startedAt - +b.startedAt);
  const sample = sorted[sorted.length - 1];
  console.log(`\nmost recent  ${DIM}${sample.startedAt.toISOString().slice(0, 10)}  ${sample.type}  ` +
    `${sample.distanceM ? (sample.distanceM / 1000).toFixed(2) + " km" : "no distance"}  ` +
    `${Math.round(sample.durationS / 60)} min${OFF}`);

  if (dryRun) {
    console.log(`\n${YELLOW}Dry run — nothing written.${OFF} Re-run without --dry-run to import.\n`);
    process.exit(0);
  }

  const before = await withUser(user.id, () =>
    db.select({ id: activities.id }).from(activities).where(eq(activities.userId, user.id)));

  let written = 0;
  await withUser(user.id, async () => {
    for (const a of report.activities) {
      await db.insert(activities).values({
        userId: user.id,
        provider: "strava" as const,
        externalId: a.externalId,
        type: a.type,
        name: a.name,
        startedAt: a.startedAt,
        localDate: localDate(user.tz, a.startedAt),
        durationS: a.durationS,
        distanceM: a.distanceM,
        elevationM: a.elevationM,
        avgHr: a.avgHr,
        kcal: a.kcal,
        sufferScore: a.sufferScore,
      }).onConflictDoUpdate({
        target: [activities.userId, activities.provider, activities.externalId],
        // The verdict is deliberately absent, exactly as in the API sync: a
        // re-import must not wipe the sentence already written about a run.
        set: {
          type: a.type, name: a.name, startedAt: a.startedAt,
          localDate: localDate(user.tz, a.startedAt),
          durationS: a.durationS, distanceM: a.distanceM, elevationM: a.elevationM,
          avgHr: a.avgHr, kcal: a.kcal, sufferScore: a.sufferScore,
        },
      });
      written += 1;
    }
  });

  const after = await withUser(user.id, () =>
    db.select({ id: activities.id }).from(activities).where(eq(activities.userId, user.id)));

  console.log(`\n  ${GREEN}ok${OFF}   ${written} row(s) upserted`);
  console.log(`  ${GREEN}ok${OFF}   activities for this user: ${before.length} → ${after.length} ` +
    `${DIM}(${after.length - before.length} new, ${written - (after.length - before.length)} updated)${OFF}`);
  console.log(`\nRun it again with the same file and the second number stays 0 — that is the ` +
    `${DIM}(user_id, provider, external_id)${OFF} index doing its job.\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${RED}${err instanceof Error ? err.message : String(err)}${OFF}\n`);
  process.exit(1);
});
