import type { TdeeResult } from "./shared/tdee";
import type { Run } from "./shared/running";

/**
 * Every shape that crosses the wire, in one file.
 *
 * Eight features are coded against these sight-unseen, so they are declared
 * once here and imported — never redeclared locally. A second copy of
 * `Bootstrap` that is one field out of date is indistinguishable from a backend
 * bug until someone diffs two files.
 *
 * Three conventions hold across every `/api/mobile/*` response, and they come
 * from `src/app/api/mobile/shared.ts` rather than from this file:
 *
 *  - **Weights are lb.** Storage is kg and stays kg; the server converts at the
 *    edge with `displayLb`. No native code ever sees a kilogram, so no native
 *    code can convert one twice.
 *  - **Dates are `YYYY-MM-DD`** local strings. Timestamps are ISO 8601 UTC.
 *  - **Primitives only.** A `Date` does not survive JSON, so every timestamp is
 *    typed as the `string` it actually arrives as.
 */

// ------------------------------------------------------------------ shared

export interface MuscleContributionDto {
  muscle: string;
  contribution: number;
}

export interface MacroTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface TargetDto {
  kcal: number | null;
  /** Always present: protein is the one figure that is correct before calibration finishes. */
  proteinG: number;
  carbsG: number | null;
  fatG: number | null;
  /** `"calibrating"` while there is no target yet. */
  mode: string;
}

export interface ActiveWorkoutDto {
  id: string;
  startedAt: string;
}

export interface GymDto {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface CatalogueExercise {
  id: string;
  name: string;
  slug: string;
  incrementLb: number;
  equipment: string;
  muscles: MuscleContributionDto[];
}

/**
 * What you did last time, per exercise id.
 *
 * `weightLb`/`reps` are the session's modal set rather than its heaviest or its
 * last, which is what makes a one-tap repeat land on the work you actually did.
 */
export interface LastSet {
  localDate: string;
  weightLb: number;
  reps: number;
  rpe: number | null;
  sets: number;
  bestE1rmLb: number | null;
}

/**
 * Extends the domain's `Run` so `summarizeRunningWeek`, `weeklyRunStats` and
 * `classifyRun` take one of these directly. The domain type carries the fields
 * the maths needs; the two here are only for rendering.
 */
export interface RunDto extends Run {
  id: string;
  startedAt: string;
  verdict: string | null;
}

export interface RankedMuscle {
  muscle: string;
  label: string;
  setsLast7d: number;
  daysSinceTrained: number | null;
  score: number;
}

// --------------------------------------------------- GET /api/mobile/bootstrap

/**
 * One fat call, on purpose. The phone gets one chance at the network on the way
 * into a basement and has to run on what it holds after that.
 *
 * `runs` and `lowerBodyLiftDates` arrive raw so the native app can run the same
 * `summarizeRunningWeek()` the web page runs. Do not precompute them.
 */
export interface Bootstrap {
  today: string;
  tz: string;
  goalsText: string;
  target: TargetDto;
  totals: MacroTotals;
  mealCount: number;
  volume: { summary: string; ranked: RankedMuscle[] };
  tdee: TdeeResult;
  activeWorkout: ActiveWorkoutDto | null;
  runs: RunDto[];
  lowerBodyLiftDates: string[];
  gyms: GymDto[];
  catalogue: CatalogueExercise[];
  lastSets: Record<string, LastSet>;
}

// ---------------------------------------------------- GET /api/mobile/session

export type Felt = "weak" | "normal" | "strong" | null;

export interface SessionSet {
  id: string;
  /** Minted on the phone before the first delivery attempt — reconcile on this, never by counting. */
  clientId: string | null;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: Felt;
  /** Seconds since the previous set, derived server-side from `loggedAt`. */
  restS: number | null;
  loggedAt: string;
}

export interface SessionPayload {
  today: string;
  activeWorkout: ActiveWorkoutDto | null;
  sets: SessionSet[];
}

// --------------------------------------------------- GET /api/mobile/exercise

export interface HistorySet {
  reps: number;
  weightLb: number;
  rpe: number | null;
  toFailure: boolean;
  isWarmup: boolean;
  felt: Felt;
  note: string;
}

export interface ExerciseHistory {
  exercise: {
    id: string;
    name: string;
    slug: string;
    incrementLb: number;
    equipment: string;
  };
  history: { date: string; sets: HistorySet[] }[];
  /** Best across the returned window, not all time. */
  bestE1rmLb: number | null;
}

// ------------------------------------------------------- GET /api/mobile/food

export interface MealItemDto {
  name: string;
  qty: number | null;
  unit: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MealDto {
  id: string;
  slot: string;
  note: string;
  source: string;
  confidence: number | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  items: MealItemDto[];
}

export interface FoodDay {
  date: string;
  meals: MealDto[];
  totals: MacroTotals;
  target: TargetDto;
}

// ------------------------------------------------------ GET /api/mobile/coach

export interface CoachMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface CoachHistory {
  messages: CoachMessage[];
}

// ------------------------------- POST /api/sets/parse, /api/voice/transcribe

/**
 * One set as the parser produced it.
 *
 * `weight_lb` and the other snake_case keys are the model's JSON schema (see
 * `parsedSetsSchema` in src/lib/llm/schemas.ts) and are deliberately left
 * as-is. Renaming them here would mean a translation layer on both sides of a
 * contract that is already tested.
 */
export interface ParsedSet {
  reps: number;
  weight_lb: number;
  rpe: number | null;
  to_failure: boolean;
  is_warmup: boolean;
}

export interface ResolvedExerciseDto {
  id: string;
  name: string;
  slug: string;
  incrementLb: number;
  equipment: string;
  /**
   * `"fuzzy"` means a trigram match, not an alias the user has confirmed. A
   * wrong fuzzy match corrupts trend history silently, so the UI must always
   * show it and let the user re-file the row.
   */
  confidence: "exact" | "fuzzy";
}

export interface ParsedEntry {
  /** What the user actually said or typed, before resolution. Kept for the correction path. */
  query: string;
  exercise: ResolvedExerciseDto | null;
  sets: ParsedSet[];
}

export interface ParseResponse {
  /** False when the deterministic shorthand parser handled it and no model was called. */
  usedModel: boolean;
  entries: ParsedEntry[];
  /** Queries that resolved to nothing. Never guess one, and never silently drop its sets. */
  unresolved: string[];
}

/** The transcript plus the exact `/api/sets/parse` body, so one confirmation UI serves both. */
export interface TranscribeResponse extends ParseResponse {
  transcript: string;
}

// -------------------------------------------------------------------- writes

/** The body of `POST /api/sets`, which the outbox carries rather than sending directly. */
export interface SetWrite {
  clientId: string;
  exerciseId: string;
  reps: number;
  weightLb: number;
  rpe?: number | null;
  toFailure?: boolean;
  isWarmup?: boolean;
  felt?: Felt;
  note?: string;
  /** What was spoken or typed, kept verbatim in `sets.raw_text` so a mangled parse can be revisited. */
  rawText?: string;
}
