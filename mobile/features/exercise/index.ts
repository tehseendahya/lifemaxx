/**
 * `app/exercise.tsx` renders this — a stack push from the live session's
 * `HISTORY →` line, and from the strength rows on Today and Lift.
 */
export { default } from "./ExerciseScreen";
export {
  buildExerciseView, firstSessionLine, formatDay, formatShort, goalTargetLb, metricFor,
  prSessions, progressSeries, topSetOf,
} from "./model";
export type { ExerciseView, Metric, ProgressPoint, ProgressView, SessionView, TopSet } from "./model";
