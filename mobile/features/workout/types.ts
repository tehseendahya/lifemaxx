import type { Felt } from "@/lib/types";

/**
 * The wire shapes of the past-workout routes.
 *
 * Here rather than in `lib/types.ts` because that file has one owner this
 * round and these shapes have one consumer. They mirror `WorkoutDetail` in
 * `src/lib/workout-edit.ts`; weights are lb, timestamps ISO strings, exactly
 * as every other `/api/mobile` route sends them.
 */

/** One set as `GET /api/mobile/workout?id=` sends it. */
export interface WorkoutDetailSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: Felt;
  note: string;
  loggedAt: string;
}

/** `GET /api/mobile/workout?id=`. */
export interface WorkoutDetail {
  id: string;
  name: string;
  nameIsCustom: boolean;
  localDate: string;
  startedAt: string;
  endedAt: string | null;
  /** Null for a workout that never recorded an end. */
  durationMin: number | null;
  status: string;
  /** The session running right now — shown, never edited, from here. */
  live: boolean;
  /** Every set, warmups included, in logged order. */
  sets: WorkoutDetailSet[];
}

/** `POST /api/mobile/workout/set`. With `id` it fixes that set; without, it adds one. */
export interface WorkoutSetWrite {
  workoutId: string;
  id?: string;
  exerciseId: string;
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
}

export interface WorkoutSetWriteResult {
  set: {
    id: string;
    exerciseId: string;
    setIndex: number;
    reps: number;
    weightLb: number;
    rpe: number | null;
    toFailure: boolean;
    isWarmup: boolean;
    loggedAt: string;
  };
  workoutName: string;
}

/** `DELETE /api/mobile/workout/set`. */
export interface WorkoutSetDeleteResult {
  ok: boolean;
  /** True when that was the workout's last set and the workout went with it. */
  workoutDeleted: boolean;
}
