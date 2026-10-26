import { apiDelete, apiGet, apiPost } from "@/lib/api";

import type {
  WorkoutDetail, WorkoutSetDeleteResult, WorkoutSetWrite, WorkoutSetWriteResult,
} from "./types";

/**
 * The four past-workout calls.
 *
 * Direct requests, never the outbox: the outbox is the live session's pipe, and
 * its retry-until-delivered contract is wrong for an edit to last week, which
 * should fail in its sheet with the reason and leave nothing pending.
 */

export const fetchWorkout = (id: string) =>
  apiGet<WorkoutDetail>(`/api/mobile/workout?id=${encodeURIComponent(id)}`);

/** Fixes a set when `body.id` is present, adds one when it is not. */
export const saveWorkoutSet = (body: WorkoutSetWrite) =>
  apiPost<WorkoutSetWriteResult>("/api/mobile/workout/set", body);

export const removeWorkoutSet = (workoutId: string, id: string) =>
  apiDelete<WorkoutSetDeleteResult>("/api/mobile/workout/set", { workoutId, id });

export const deleteWorkout = (id: string) =>
  apiDelete<{ ok: boolean; id: string }>(`/api/mobile/workout?id=${encodeURIComponent(id)}`);
