/**
 * Estimated one-rep max, Epley. Mirrors the generated column in the DB so the
 * client and the database never disagree about what a set was worth.
 *
 * Epley is only meaningful in the 1-12 rep range; past that it drifts high and
 * the number stops meaning anything, so callers should treat high-rep sets as
 * volume rather than strength.
 */
export const epley = (weightKg: number, reps: number): number =>
  weightKg * (1 + reps / 30);

export const E1RM_RELIABLE_MAX_REPS = 12;

export const isReliableForStrength = (reps: number): boolean =>
  reps >= 1 && reps <= E1RM_RELIABLE_MAX_REPS;

export interface SetLike {
  reps: number;
  weightKg: number;
  isWarmup?: boolean;
}

/** Best working set of a session, by estimated 1RM. */
export function bestE1rm(sets: SetLike[]): number | null {
  const working = sets.filter((s) => !s.isWarmup && isReliableForStrength(s.reps));
  if (working.length === 0) return null;
  return Math.max(...working.map((s) => epley(s.weightKg, s.reps)));
}

/** Tonnage: the other half of the story, and the one that tracks hypertrophy. */
export function totalVolumeKg(sets: SetLike[]): number {
  return sets
    .filter((s) => !s.isWarmup)
    .reduce((sum, s) => sum + s.weightKg * s.reps, 0);
}
