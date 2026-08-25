import { db } from "@/db";
import { sessionMessages, gyms } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COACH_VOICE, goalsBlock, stableJson } from "./prompts";
import type { Message } from "./provider";
import { displayLb } from "@/lib/domain/units";
import {
  getProfile, getExerciseHistory, getWorkoutSets, getMuscleVolume,
  getTdee, getDayMeals, sumMacros, getActiveTarget, getRecentActivities, shiftDate,
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
 *   3. history      — stable for the whole session
 *   4. today so far — grows as you lift
 *   5. the question — volatile
 */

export async function buildSessionContext(userId: string, workoutId: string, today: string) {
  const [profile, todaySets, volume] = await Promise.all([
    getProfile(userId),
    getWorkoutSets(workoutId),
    getMuscleVolume(userId, today),
  ]);

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
  const since = shiftDate(today, -14);

  const days: unknown[] = [];
  for (let i = 0; i < 14; i++) {
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

  const [volume, tdee, target, activities] = await Promise.all([
    getMuscleVolume(userId, today),
    getTdee(userId, today),
    getActiveTarget(userId, today),
    getRecentActivities(userId, today, 14),
  ]);

  const prefix = [
    goalsBlock(profile?.goalsText ?? ""),
    COACH_VOICE,
    `CURRENT TARGETS:\n${stableJson(target ?? { mode: "calibrating", note: "still calibrating — no calorie target set yet" })}`,
    `MEASURED MAINTENANCE:\n${stableJson(tdee)}`,
    `DAILY INTAKE, LAST 14 DAYS:\n${stableJson(days)}`,
    `WEEKLY HARD SETS PER MUSCLE:\n${stableJson(
      volume.ranked.map((r) => ({ muscle: r.label, sets: Math.round(r.setsLast7d * 10) / 10, days_since: r.daysSinceTrained })),
    )}`,
    `CARDIO, LAST 14 DAYS:\n${stableJson(
      activities.map((a) => ({ date: a.localDate, type: a.type, minutes: Math.round(a.durationS / 60), km: a.distanceM ? Math.round(a.distanceM / 100) / 10 : null })),
    )}`,
    `TODAY IS ${today}. Days with no meals logged are missing from the intake list — that means unlogged, not zero calories.`,
  ].join("\n\n");

  return { prefix, loggedDays: days.length };
}
