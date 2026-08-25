-- Required by the fuzzy exercise matcher in src/lib/exercises.ts.
-- Without it, resolveExercise() falls through to the model on every typo.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "public"."activity_provider" AS ENUM('strava', 'manual', 'healthkit');--> statement-breakpoint
CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."felt_state" AS ENUM('weak', 'normal', 'strong');--> statement-breakpoint
CREATE TYPE "public"."goal_mode" AS ENUM('calibrating', 'cut', 'maintain', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner', 'snack');--> statement-breakpoint
CREATE TYPE "public"."meal_source" AS ENUM('photo', 'text', 'repeat', 'manual');--> statement-breakpoint
CREATE TYPE "public"."muscle" AS ENUM('chest', 'front_delt', 'side_delt', 'rear_delt', 'lat', 'upper_back', 'trap', 'bicep', 'tricep', 'forearm', 'quad', 'hamstring', 'glute', 'calf', 'abs', 'lower_back', 'adductor', 'abductor');--> statement-breakpoint
CREATE TYPE "public"."workout_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "activity_provider" NOT NULL,
	"external_id" text,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"duration_s" integer NOT NULL,
	"distance_m" real,
	"elevation_m" real,
	"avg_hr" real,
	"kcal" integer,
	"suffer_score" real
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "body_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"weight_kg" real,
	"body_fat_pct" real,
	"steps" integer,
	"sleep_min" integer,
	"resting_hr" real,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"totals" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercise_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exercise_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"user_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercise_muscles" (
	"exercise_id" uuid NOT NULL,
	"muscle" "muscle" NOT NULL,
	"contribution" real NOT NULL,
	CONSTRAINT "exercise_muscles_exercise_id_muscle_pk" PRIMARY KEY("exercise_id","muscle")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"equipment" text DEFAULT 'barbell' NOT NULL,
	"is_unilateral" boolean DEFAULT false NOT NULL,
	"increment_kg" real DEFAULT 2.5 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goal_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goals_text" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gyms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lat" real,
	"lng" real,
	"equipment_notes" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" real,
	"unit" text,
	"kcal" integer NOT NULL,
	"protein_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"fat_g" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"eaten_at" timestamp with time zone DEFAULT now() NOT NULL,
	"local_date" date NOT NULL,
	"slot" "meal_slot" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"kcal" integer NOT NULL,
	"protein_g" real NOT NULL,
	"carbs_g" real NOT NULL,
	"fat_g" real NOT NULL,
	"source" "meal_source" NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"tz" text DEFAULT 'America/New_York' NOT NULL,
	"goals_text" text DEFAULT '' NOT NULL,
	"height_cm" real,
	"birth_year" integer,
	"unit_pref" text DEFAULT 'lb' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"reps" integer NOT NULL,
	"weight_kg" real NOT NULL,
	"rpe" real,
	"to_failure" boolean DEFAULT false NOT NULL,
	"is_warmup" boolean DEFAULT false NOT NULL,
	"rest_s" integer,
	"note" text DEFAULT '' NOT NULL,
	"felt" "felt_state",
	"e1rm_kg" real GENERATED ALWAYS AS ("sets"."weight_kg" * (1 + "sets"."reps"::real / 30)) STORED,
	"raw_text" text DEFAULT '' NOT NULL,
	"needs_parse" boolean DEFAULT false NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strava_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"athlete_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"mode" "goal_mode" DEFAULT 'calibrating' NOT NULL,
	"kcal" integer,
	"protein_g" integer NOT NULL,
	"carbs_g" integer,
	"fat_g" integer,
	"tdee_estimate" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gym_id" uuid,
	"status" "workout_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"local_date" date NOT NULL,
	"name" text DEFAULT 'Workout' NOT NULL,
	"name_is_custom" boolean DEFAULT false NOT NULL,
	"bodyweight_kg" real,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "body_metrics" ADD CONSTRAINT "body_metrics_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "coach_messages" ADD CONSTRAINT "coach_messages_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_aliases" ADD CONSTRAINT "exercise_aliases_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercise_muscles" ADD CONSTRAINT "exercise_muscles_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exercises" ADD CONSTRAINT "exercises_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_history" ADD CONSTRAINT "goal_history_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gyms" ADD CONSTRAINT "gyms_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_meals_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_messages" ADD CONSTRAINT "session_messages_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sets" ADD CONSTRAINT "sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sets" ADD CONSTRAINT "sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strava_accounts" ADD CONSTRAINT "strava_accounts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workouts" ADD CONSTRAINT "workouts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workouts" ADD CONSTRAINT "workouts_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_user_date_idx" ON "activities" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "activities_provider_external_idx" ON "activities" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "body_metrics_user_date_idx" ON "body_metrics" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "coach_messages_user_idx" ON "coach_messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_summaries_user_date_idx" ON "daily_summaries" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exercise_aliases_alias_user_idx" ON "exercise_aliases" USING btree ("alias","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exercises_slug_user_idx" ON "exercises" USING btree ("slug","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meal_items_meal_idx" ON "meal_items" USING btree ("meal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "meals_user_date_idx" ON "meals" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_messages_workout_idx" ON "session_messages" USING btree ("workout_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sets_workout_idx" ON "sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sets_exercise_idx" ON "sets" USING btree ("exercise_id","logged_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "targets_user_date_idx" ON "targets" USING btree ("user_id","effective_from");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workouts_user_date_idx" ON "workouts" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workouts_user_status_idx" ON "workouts" USING btree ("user_id","status");