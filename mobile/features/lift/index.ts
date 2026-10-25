/**
 * The Lift feature — logging a set mid-workout.
 *
 * `app/(tabs)/lift.tsx` renders the default export and nothing else. With a
 * session running it is the live session; without one it is a single button.
 *
 * `ExercisePicker` is exported because the voice-logging flow opens the same
 * component when a transcript cannot be resolved to an exercise: one search
 * surface, one owed-this-week ordering, one offline guarantee, rather than two
 * that drift.
 */
export { default } from "./LiftScreen";
export { default as LiftScreen } from "./LiftScreen";
export { ExercisePicker } from "./ExercisePicker";

export type { CatalogueExercise } from "@/lib/types";
