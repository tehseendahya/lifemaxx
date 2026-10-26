import { route, HttpError } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { db } from "@/db";
import { targets } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getTdee } from "@/lib/queries";
import { proposeTargets, proteinTargetG } from "@/lib/domain/tdee";

/**
 * Set the calorie target from the phone: CUT, MAINTAIN or LEAN BULK.
 *
 * Until this existed, the You screen measured maintenance, showed three chips
 * and then said "set it on the laptop" — a dead end on the one screen that had
 * just finished three weeks of asking the owner to weigh in. This is the write
 * end of those chips.
 *
 * ── THE CLIENT SENDS A MODE, NEVER A NUMBER ────────────────────────────────
 *
 * `{ mode }` only. The kcal is recomputed here from `getTdee` and
 * `proposeTargets` — the same two functions the chips were rendered from — so
 * a phone holding a bootstrap from yesterday, or a hand-built request, cannot
 * write a target the measured data does not support. The chip's figure is a
 * preview; this is the number.
 *
 * Bodyweight for the arithmetic is the regression's fitted weight
 * (`tdee.currentKg`), which is what the phone's chips use too. The web settings
 * page reads the latest raw weigh-in instead; one noisy morning would then make
 * the saved number differ from the chip the owner tapped, by a few kcal and
 * for no reason they could see.
 *
 * ── REFUSED UNTIL MAINTENANCE IS MEASURED ──────────────────────────────────
 *
 * 409 while `getTdee` is insufficient. A target from a guessed maintenance is
 * the thing this app is built not to produce (SPEC §5.5), and the chips are
 * never shown in that state — a request arriving anyway is a stale screen, and
 * it gets a conflict that says so rather than a calculator's estimate.
 *
 * ── ONE ROW PER DAY ────────────────────────────────────────────────────────
 *
 * Targets are versioned by `effective_from`, so a change today must not rewrite
 * yesterday. Picking twice in one day replaces today's row rather than adding a
 * second: `getActiveTarget` orders by `effective_from` alone, and two rows on
 * the same date would make "which target is active" depend on the order
 * Postgres happens to return them. Both statements run inside `route()`'s
 * per-request transaction, so there is no moment with no target at all.
 *
 * Carbs and fat stay null, as every target row has been so far: protein and
 * kcal are the two figures the app holds an opinion on, and the Food card draws
 * carbs and fat as logged figures rather than against an invented split.
 */

const MODES = ["cut", "maintain", "bulk"] as const;
type Mode = (typeof MODES)[number];

interface Body {
  mode?: unknown;
}

const isMode = (value: unknown): value is Mode =>
  typeof value === "string" && (MODES as readonly string[]).includes(value);

export const POST = route<Body>(async ({ userId, today, body }) => {
  if (!isMode(body.mode)) throw new HttpError("mode must be cut, maintain or bulk.");
  const mode = body.mode;

  const tdee = await getTdee(userId, today);
  if (tdee.status !== "ok") {
    throw new HttpError(
      `Maintenance isn't measured yet — ${tdee.weighIns} of ${tdee.needed} weigh-ins. `
        + "Targets switch on once it is.",
      409,
    );
  }

  const kcal = proposeTargets(tdee.tdee, tdee.currentKg)[mode];
  const proteinG = proteinTargetG(tdee.currentKg);

  await db.delete(targets)
    .where(and(eq(targets.userId, userId), eq(targets.effectiveFrom, today)));

  const [row] = await db.insert(targets)
    .values({
      userId,
      effectiveFrom: today,
      mode,
      kcal,
      proteinG,
      carbsG: null,
      fatG: null,
      tdeeEstimate: tdee.tdee,
    })
    .returning();

  return {
    target: {
      mode: row.mode,
      kcal: row.kcal,
      proteinG: row.proteinG,
      effectiveFrom: row.effectiveFrom,
      tdeeEstimate: row.tdeeEstimate,
    },
  };
});

export const OPTIONS = preflight;
