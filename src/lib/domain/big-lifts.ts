/**
 * The lifts an estimated one-rep max is drawn for, and no others.
 *
 * An e1RM is a claim about how much one rep of THIS movement would move. It is
 * a meaningful number on a barbell squat, bench, deadlift or overhead press and
 * their close barbell variants, where people actually test singles and where
 * the load is the thing being trained. On a preacher curl or a cable fly it is
 * a figure nobody will ever lift and nobody is chasing, and plotting it beside
 * the real ones made "Big lifts" a list of whichever exercises were logged
 * most — curls included. So the list is closed and explicit: a slug is on it
 * because someone decided it should be, never because a heuristic over the
 * name or the equipment column guessed.
 *
 * Dumbbell, machine and smith variants are deliberately absent. Their loads are
 * not comparable to the barbell lift's (two 80 lb dumbbells are not a 160 lb
 * bench), and a trend that mixes them is a trend that lies.
 *
 * Every slug here exists in the seed catalogue (`src/db/catalogue.ts`). Slugs
 * rather than ids because ids differ per database and slugs are the
 * catalogue's stable key.
 */

export type BigLiftFamily = "bench" | "squat" | "deadlift" | "ohp";

/**
 * slug → the main lift it belongs to.
 *
 * The family is for ordering and grouping on the client (bench before squat
 * before deadlift before press, a variant beside its parent). It is not a
 * claim that the variants' numbers are interchangeable — each slug is still
 * its own series.
 */
export const BIG_LIFT_FAMILY: Readonly<Record<string, BigLiftFamily>> = Object.freeze({
  "barbell-bench-press": "bench",
  "incline-barbell-press": "bench",
  "close-grip-bench-press": "bench",
  "decline-barbell-press": "bench",

  "back-squat": "squat",
  "front-squat": "squat",
  "box-squat": "squat",
  "safety-bar-squat": "squat",

  "deadlift": "deadlift",
  "sumo-deadlift": "deadlift",
  "trap-bar-deadlift": "deadlift",
  "romanian-deadlift": "deadlift",
  "stiff-leg-deadlift": "deadlift",

  "overhead-press": "ohp",
  "seated-overhead-press": "ohp",
  "push-press": "ohp",
});

/** The same list, as an array, for an `IN (...)` filter. */
export const E1RM_SLUGS: readonly string[] = Object.freeze(Object.keys(BIG_LIFT_FAMILY));

/**
 * Whether this lift gets an e1RM trend.
 *
 * `hasOwnProperty` rather than `slug in BIG_LIFT_FAMILY`: `in` walks the
 * prototype, so a slug of "constructor" or "toString" would answer true.
 */
export const isE1rmLift = (slug: string): boolean =>
  Object.prototype.hasOwnProperty.call(BIG_LIFT_FAMILY, slug);
