import {
  pgTable, uuid, text, integer, real, boolean, timestamp, date,
  jsonb, index, uniqueIndex, primaryKey, pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------- enums

export const mealSlot = pgEnum("meal_slot", ["breakfast", "lunch", "dinner", "snack"]);
export const mealSource = pgEnum("meal_source", ["photo", "text", "repeat", "manual"]);
export const goalMode = pgEnum("goal_mode", ["calibrating", "cut", "maintain", "bulk"]);
export const workoutStatus = pgEnum("workout_status", ["active", "completed", "abandoned"]);
export const feltState = pgEnum("felt_state", ["weak", "normal", "strong"]);
export const activityProvider = pgEnum("activity_provider", ["strava", "manual", "healthkit"]);
export const chatRole = pgEnum("chat_role", ["user", "assistant"]);

/**
 * Muscles are a fixed vocabulary. Adding one is a migration, deliberately —
 * free-text muscles would fragment the volume maths the same way free-text
 * exercise names fragment the trend charts.
 */
export const MUSCLES = [
  "chest", "front_delt", "side_delt", "rear_delt", "lat", "upper_back",
  "trap", "bicep", "tricep", "forearm", "quad", "hamstring",
  "glute", "calf", "abs", "lower_back", "adductor", "abductor",
] as const;
export type Muscle = (typeof MUSCLES)[number];
export const muscle = pgEnum("muscle", MUSCLES);

// ---------------------------------------------------------------- profile

export const profiles = pgTable("profiles", {
  // Mirrors auth.users.id from Supabase.
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  tz: text("tz").notNull().default("America/New_York"),
  /** Free text, written by the user, injected into every model call. */
  goalsText: text("goals_text").notNull().default(""),
  heightCm: real("height_cm"),
  birthYear: integer("birth_year"),
  /** lb | kg — display only; storage is always metric. */
  unitPref: text("unit_pref").notNull().default("lb"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Versioned so you can see what you were chasing six months ago. */
export const goalHistory = pgTable("goal_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  goalsText: text("goals_text").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
});

/** Versioned by date rather than overwritten, for the same reason. */
export const targets = pgTable("targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  mode: goalMode("mode").notNull().default("calibrating"),
  kcal: integer("kcal"),
  proteinG: integer("protein_g").notNull(),
  carbsG: integer("carbs_g"),
  fatG: integer("fat_g"),
  /** Measured maintenance at the time this target was set, for the record. */
  tdeeEstimate: integer("tdee_estimate"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("targets_user_date_idx").on(t.userId, t.effectiveFrom)]);

// ---------------------------------------------------------------- meals

export const meals = pgTable("meals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  eatenAt: timestamp("eaten_at", { withTimezone: true }).notNull().defaultNow(),
  /** Denormalised local date so day rollups don't fight timezones in SQL. */
  localDate: date("local_date").notNull(),
  slot: mealSlot("slot").notNull(),
  note: text("note").notNull().default(""),
  kcal: integer("kcal").notNull(),
  proteinG: real("protein_g").notNull(),
  carbsG: real("carbs_g").notNull(),
  fatG: real("fat_g").notNull(),
  source: mealSource("source").notNull(),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("meals_user_date_idx").on(t.userId, t.localDate)]);

export const mealItems = pgTable("meal_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  mealId: uuid("meal_id").notNull().references(() => meals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  qty: real("qty"),
  unit: text("unit"),
  kcal: integer("kcal").notNull(),
  proteinG: real("protein_g").notNull(),
  carbsG: real("carbs_g").notNull(),
  fatG: real("fat_g").notNull(),
}, (t) => [index("meal_items_meal_idx").on(t.mealId)]);

// ---------------------------------------------------------------- training

export const gyms = pgTable("gyms", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  /** Fed to the coach so it never suggests a machine that isn't there. */
  equipmentNotes: text("equipment_notes").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
});

export const exercises = pgTable("exercises", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = built-in catalogue row, shared by everyone. */
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  equipment: text("equipment").notNull().default("barbell"),
  isUnilateral: boolean("is_unilateral").notNull().default(false),
  /** Smallest sane jump on this lift, kg. Dumbbells step coarser than barbells. */
  incrementKg: real("increment_kg").notNull().default(2.5),
}, (t) => [uniqueIndex("exercises_slug_user_idx").on(t.slug, t.userId)]);

export const exerciseAliases = pgTable("exercise_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
  /** Always stored lowercased and trimmed. */
  alias: text("alias").notNull(),
  userId: uuid("user_id").references(() => profiles.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("exercise_aliases_alias_user_idx").on(t.alias, t.userId)]);

/** contribution: 1.0 primary, 0.5 secondary. Sums into hard-sets-per-muscle. */
export const exerciseMuscles = pgTable("exercise_muscles", {
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
  muscle: muscle("muscle").notNull(),
  contribution: real("contribution").notNull(),
}, (t) => [primaryKey({ columns: [t.exerciseId, t.muscle] })]);

export const workouts = pgTable("workouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id, { onDelete: "set null" }),
  status: workoutStatus("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  localDate: date("local_date").notNull(),
  /** Auto-derived from muscles hit; user edits are respected and remembered. */
  name: text("name").notNull().default("Workout"),
  nameIsCustom: boolean("name_is_custom").notNull().default(false),
  bodyweightKg: real("bodyweight_kg"),
  note: text("note").notNull().default(""),
}, (t) => [
  index("workouts_user_date_idx").on(t.userId, t.localDate),
  index("workouts_user_status_idx").on(t.userId, t.status),
]);

export const sets = pgTable("sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "restrict" }),
  setIndex: integer("set_index").notNull(),
  reps: integer("reps").notNull(),
  weightKg: real("weight_kg").notNull(),
  rpe: real("rpe"),
  toFailure: boolean("to_failure").notNull().default(false),
  isWarmup: boolean("is_warmup").notNull().default(false),
  /** Measured from the gap since the previous save. Free data. */
  restS: integer("rest_s"),
  note: text("note").notNull().default(""),
  felt: feltState("felt"),
  /** Epley. Generated so it can't drift from the inputs. */
  e1rmKg: real("e1rm_kg").generatedAlwaysAs(
    (): any => sql`${sets.weightKg} * (1 + ${sets.reps}::real / 30)`,
  ),
  /** Exactly what was typed, so a bad parse is recoverable. */
  rawText: text("raw_text").notNull().default(""),
  needsParse: boolean("needs_parse").notNull().default(false),
  loggedAt: timestamp("logged_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sets_workout_idx").on(t.workoutId),
  index("sets_exercise_idx").on(t.exerciseId, t.loggedAt),
]);

/** The in-session chat, kept as both context and history. */
export const sessionMessages = pgTable("session_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  role: chatRole("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("session_messages_workout_idx").on(t.workoutId, t.createdAt)]);

// ---------------------------------------------------------------- cardio & body

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  provider: activityProvider("provider").notNull(),
  externalId: text("external_id"),
  type: text("type").notNull(),
  name: text("name").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  localDate: date("local_date").notNull(),
  durationS: integer("duration_s").notNull(),
  distanceM: real("distance_m"),
  elevationM: real("elevation_m"),
  avgHr: real("avg_hr"),
  kcal: integer("kcal"),
  /** Strava's own "was this hard" signal, when present. */
  sufferScore: real("suffer_score"),
  /** One-line verdict on this run. Null until the summariser has seen it. */
  verdict: text("verdict"),
  verdictGeneratedAt: timestamp("verdict_generated_at", { withTimezone: true }),
}, (t) => [
  index("activities_user_date_idx").on(t.userId, t.localDate),
  /**
   * What makes the nightly pull idempotent. Scoped by user as well as by
   * provider: Strava ids are unique per activity, but two accounts syncing the
   * same connected athlete would otherwise have the first one silently swallow
   * the second's rows.
   */
  uniqueIndex("activities_user_provider_external_idx").on(t.userId, t.provider, t.externalId),
]);

export const bodyMetrics = pgTable("body_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  localDate: date("local_date").notNull(),
  weightKg: real("weight_kg"),
  bodyFatPct: real("body_fat_pct"),
  steps: integer("steps"),
  sleepMin: integer("sleep_min"),
  restingHr: real("resting_hr"),
  source: text("source").notNull().default("manual"),
}, (t) => [uniqueIndex("body_metrics_user_date_idx").on(t.userId, t.localDate)]);

// ---------------------------------------------------------------- coach & integrations

export const dailySummaries = pgTable("daily_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  localDate: date("local_date").notNull(),
  totals: jsonb("totals").notNull(),
  verdict: text("verdict").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("daily_summaries_user_date_idx").on(t.userId, t.localDate)]);

export const coachMessages = pgTable("coach_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  role: chatRole("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("coach_messages_user_idx").on(t.userId, t.createdAt)]);

/**
 * The Sunday running rollup: mileage, pace trend and how the running load sat
 * against the lifting load. Stored rather than recomputed so the week's verdict
 * doesn't drift every time the page is opened.
 */
export const weeklyRunningSummaries = pgTable("weekly_running_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  /** Monday of the week being summarised. */
  weekStart: date("week_start").notNull(),
  stats: jsonb("stats").notNull(),
  summary: text("summary").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("weekly_running_user_week_idx").on(t.userId, t.weekStart)]);

export const stravaAccounts = pgTable("strava_accounts", {
  userId: uuid("user_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  athleteId: text("athlete_id").notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
