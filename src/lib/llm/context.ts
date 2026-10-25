import { db } from "@/db";
import { sessionMessages, gyms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COACH_VOICE, coverageBlock, goalsBlock, stableJson, THIN_SAMPLE_DAYS } from "./prompts";
import type { DataCoverage } from "./prompts";
import type { Message } from "./provider";
import { displayLb } from "@/lib/domain/units";
import {
  getProfile, getExerciseHistory, getWorkoutSets, getMuscleVolume,
  getTdee, getDayMeals, sumMacros, getActiveTarget, getRecentActivities, shiftDate,
  getDailyHardSets, getWeighIns,
} from "@/lib/queries";

/**
 * Context assembly.
 *
 * Ordering here is the whole ballgame for cost. OpenAI caches automatically
 * above ~1024 tokens at 10% of standard, but it's a prefix match — so the parts
 * that don't change during a workout go first and never move, and only the
 * question at the end varies. Get this right and six questions in a session
 * cost about what one uncached question would.
 *
 * Positions, front to back:
 *   1. goals        — stable for weeks
 *   2. voice rules  — stable forever
 *   3. coverage     — how many days each stream actually has
 *   4. history      — stable for the whole session
 *   5. today so far — grows as you lift
 *   6. the question — volatile
 *
 * Position 3 is what lets the coach caveat honestly instead of refusing. The
 * voice rules forbid calling a trend from a thin stream, and this is where the
 * model is told which streams are thin — measured here, in one query, rather
 * than inferred by counting JSON entries.
 */

/** The window the coverage counts are taken over, for both contexts. */
export const COVERAGE_WINDOW_DAYS = 14;

/**
 * The earliest date inside the coverage window, inclusive.
 *
 * `today` is day one of fourteen, so the span is `today - 13 … today`. Taking
 * `shiftDate(today, -COVERAGE_WINDOW_DAYS)` instead — which is what the
 * underlying queries do, because 14 days of history is the right thing for THEM
 * to fetch — spans fifteen dates, and a block that printed "15 weigh-ins ... of
 * the last 14 days" would be a number the coach then repeats to the owner. An
 * off-by-one in a figure that exists to make the caveat honest is worse than no
 * figure, so every stream is narrowed to this one date here.
 */
export const coverageSince = (today: string): string =>
  shiftDate(today, -(COVERAGE_WINDOW_DAYS - 1));

export async function buildSessionContext(userId: string, workoutId: string, today: string) {
  const [profile, todaySets, volume, liftDayRows] = await Promise.all([
    getProfile(userId),
    getWorkoutSets(workoutId),
    getMuscleVolume(userId, today),
    getDailyHardSets(userId, today, COVERAGE_WINDOW_DAYS),
  ]);

  const liftDays = liftDayRows
    .filter((r) => r.hardSets > 0 && r.localDate >= coverageSince(today)).length;

  const exerciseIds = [...new Set(todaySets.map((s) => s.exerciseId))];
  const histories = await Promise.all(
    exerciseIds.map(async (id) => {
      const h = await getExerciseHistory(userId, id, 4);
      const name = todaySets.find((s) => s.exerciseId === id)?.exerciseName ?? "";
      return { exercise: name, sessions: h.map((s) => ({
        date: s.date,
        sets: s.sets.filter((x) => !x.isWarmup).map((x) => ({
          reps: x.reps, lb: displayLb(x.weightKg), rpe: x.rpe, to_failure: x.toFailure, felt: x.felt,
        })),
      })) };
    }),
  );

  const activities = await getRecentActivities(userId, today, 5);

  // --- stable prefix ---------------------------------------------------
  const prefix = [
    goalsBlock(profile?.goalsText ?? ""),
    COACH_VOICE,
    // Lifting only: mid-set is the wrong moment to be handed a weigh-in count,
    // and a question asked between sets is never about the scale.
    coverageBlock({ windowDays: COVERAGE_WINDOW_DAYS, liftDays }),
    `RECENT HISTORY FOR TODAY'S LIFTS:\n${stableJson(histories)}`,
    `WEEKLY HARD SETS PER MUSCLE (rolling 7 days):\n${stableJson(
      volume.ranked.map((r) => ({ muscle: r.label, sets: Math.round(r.setsLast7d * 10) / 10, days_since: r.daysSinceTrained })),
    )}`,
    `RECENT CARDIO:\n${stableJson(
      activities.map((a) => ({ date: a.localDate, type: a.type, minutes: Math.round(a.durationS / 60), km: a.distanceM ? Math.round(a.distanceM / 100) / 10 : null })),
    )}`,
  ].join("\n\n");

  // --- volatile tail ---------------------------------------------------
  const tail = `TODAY'S SESSION SO FAR:\n${stableJson(
    todaySets.map((s) => ({
      exercise: s.exerciseName, reps: s.reps, lb: displayLb(s.weightKg),
      rpe: s.rpe, to_failure: s.toFailure, warmup: s.isWarmup, felt: s.felt,
      rest_s: s.restS, note: s.note,
    })),
  )}`;

  return { prefix, tail };
}

export async function sessionMessagesFor(
  userId: string,
  workoutId: string,
  today: string,
  question: string,
): Promise<Message[]> {
  const { prefix, tail } = await buildSessionContext(userId, workoutId, today);

  const history = await db.select().from(sessionMessages)
    .where(eq(sessionMessages.workoutId, workoutId))
    .orderBy(sessionMessages.createdAt);

  return [
    { role: "system", content: prefix },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: `${tail}\n\nQUESTION: ${question}` },
  ];
}

/** Fourteen days of everything, for the standalone coach chat. */
export async function buildCoachContext(userId: string, today: string) {
  const profile = await getProfile(userId);
  const since = coverageSince(today);

  const days: unknown[] = [];
  for (let i = 0; i < COVERAGE_WINDOW_DAYS; i++) {
    const date = shiftDate(today, -i);
    const meals = await getDayMeals(userId, date);
    if (meals.length === 0) continue;
    const t = sumMacros(meals);
    days.push({
      date,
      kcal: Math.round(t.kcal),
      protein_g: Math.round(t.proteinG),
      carbs_g: Math.round(t.carbsG),
      fat_g: Math.round(t.fatG),
    });
  }

  const [volume, tdee, target, activities, liftDayRows, weighIns] = await Promise.all([
    getMuscleVolume(userId, today),
    getTdee(userId, today),
    getActiveTarget(userId, today),
    getRecentActivities(userId, today, COVERAGE_WINDOW_DAYS),
    getDailyHardSets(userId, today, COVERAGE_WINDOW_DAYS),
    getWeighIns(userId, today),
  ]);

  const coverage: DataCoverage = {
    windowDays: COVERAGE_WINDOW_DAYS,
    intakeDays: days.length,
    liftDays: liftDayRows.filter((r) => r.hardSets > 0 && r.localDate >= since).length,
    /*
     * `getWeighIns` is capped at its own 28-day window rather than 14 — it is
     * the input to `estimateTdee` and widening or narrowing it would move the
     * measured-maintenance figure. Narrowed here instead, so the number next to
     * "weigh-ins" is counted over the same window as the other two streams and
     * the model is not comparing days against a different calendar.
     */
    weighIns: weighIns.filter((w) => w.localDate >= since).length,
  };

  const prefix = [
    goalsBlock(profile?.goalsText ?? ""),
    COACH_VOICE,
    coverageBlock(coverage),
    `CURRENT TARGETS:\n${stableJson(target ?? { mode: "calibrating", note: "still calibrating — no calorie target set yet" })}`,
    `MEASURED MAINTENANCE:\n${stableJson(tdee)}`,
    `DAILY INTAKE, LAST ${COVERAGE_WINDOW_DAYS} DAYS:\n${stableJson(days)}`,
    `WEEKLY HARD SETS PER MUSCLE:\n${stableJson(
      volume.ranked.map((r) => ({ muscle: r.label, sets: Math.round(r.setsLast7d * 10) / 10, days_since: r.daysSinceTrained })),
    )}`,
    `CARDIO, LAST ${COVERAGE_WINDOW_DAYS} DAYS:\n${stableJson(
      activities.map((a) => ({ date: a.localDate, type: a.type, minutes: Math.round(a.durationS / 60), km: a.distanceM ? Math.round(a.distanceM / 100) / 10 : null })),
    )}`,
    `TODAY IS ${today}. Days with no meals logged are missing from the intake list — that means unlogged, not zero calories.`,
  ].join("\n\n");

  return { prefix, loggedDays: days.length, coverage };
}

/**
 * The same thin/not-thin judgement the prompt is given, for the UI.
 *
 * The coach screen used to promise "the coach will say when the data is too
 * thin to call rather than guessing", which is no longer what it does and was
 * the written form of the bug. The screen now has to describe the real
 * behaviour, and the only way that stays true is if it reads the threshold from
 * the same constant the prompt interpolates.
 */
export function coachCoverageNote(coverage: DataCoverage): string | null {
  const thin = [coverage.intakeDays, coverage.liftDays, coverage.weighIns]
    .some((n) => n != null && n < THIN_SAMPLE_DAYS);
  if (!thin) return null;

  return `Under ${THIN_SAMPLE_DAYS} logged days in a stream, the coach still answers — it states the `
    + "sample size next to the number and won't call a trend off it. Questions about your goals, "
    + "your split or how to train a lift don't need any history.";
}
