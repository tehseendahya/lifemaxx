import { route } from "@/lib/api";
import { preflight } from "@/lib/auth/cors";
import { getActiveWorkout, getWorkoutSets } from "@/lib/queries";
import { displayLb } from "@/lib/domain/units";

/**
 * The live session, re-read.
 *
 * Exactly what `src/app/lift/page.tsx` already hands `LiftClient`, plus the
 * three fields the native screen needs and the web one does not: `setIndex` so
 * the order is the server's rather than the arrival order, `restS` so a rest
 * timer resumes instead of restarting from zero, and `loggedAt` so a session
 * recovered after a dead battery shows the real timeline.
 *
 * Re-read when the Lift tab regains focus, which is also what reconciles the
 * outbox: anything the phone queued and delivered while the screen was away
 * comes back here with a server id on it.
 */
export const GET = route(async ({ userId, today }) => {
  const active = await getActiveWorkout(userId);
  const rows = active ? await getWorkoutSets(active.id) : [];

  return {
    today,
    activeWorkout: active ? { id: active.id, startedAt: active.startedAt.toISOString() } : null,
    sets: rows.map((s) => ({
      id: s.id,
      clientId: s.clientId,
      exerciseId: s.exerciseId,
      exerciseName: s.exerciseName,
      setIndex: s.setIndex,
      reps: s.reps,
      weightLb: displayLb(s.weightKg),
      rpe: s.rpe,
      toFailure: s.toFailure,
      isWarmup: s.isWarmup,
      felt: s.felt,
      restS: s.restS,
      loggedAt: s.loggedAt.toISOString(),
    })),
  };
});

export const OPTIONS = preflight;
