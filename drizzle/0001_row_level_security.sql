-- Row-level security.
--
-- The gap this closes is not the app's own route handlers — it is PostgREST.
-- Supabase exposes every table in `public` at https://<ref>.supabase.co/rest/v1
-- and the key that reaches it, NEXT_PUBLIC_SUPABASE_ANON_KEY, ships to every
-- browser that opens the app. Without policies, anyone who reads the page
-- source can GET /rest/v1/meals and read — or DELETE — the whole database.
--
-- Two enforcement paths, one predicate:
--   * PostgREST  runs as `anon` / `authenticated`, identified by the JWT.
--   * The app    runs as `lifemaxx_app`, identified by a per-transaction GUC
--                (see withUser() in src/db/index.ts).
--
-- `postgres` deliberately still bypasses RLS: migrations, the exercise-catalogue
-- seed and the cron jobs that iterate every user all need cross-user access, and
-- they are server-side scripts holding the service credentials already. That is
-- why the policies are NOT declared FORCE.

CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint

-- The identity predicate. Deliberately does not call auth.uid(): it reads the
-- same JWT claim auth.uid() reads, so the policies work on stock Postgres too
-- (which is what makes them testable outside Supabase), and it checks the app's
-- GUC first so the server-side path never depends on a JWT it does not have.
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    nullif(current_setting('app.user_id', true), '')::uuid,
    nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
  )
$$;--> statement-breakpoint

-- Unset GUC and no JWT means NULL, and `user_id = NULL` is NULL, so every
-- policy below filters the row out. Unscoped access fails closed.
GRANT USAGE ON SCHEMA app TO PUBLIC;--> statement-breakpoint

DO $$ BEGIN
  CREATE ROLE lifemaxx_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- The app connects as `postgres` (Supabase's pooler URI) and drops to this role
-- for the duration of each request's transaction. Entering the role needs
-- membership; CREATEROLE grants it implicitly on PG16 but say it out loud.
DO $$ BEGIN
  EXECUTE format('GRANT lifemaxx_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL; END $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO lifemaxx_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lifemaxx_app;--> statement-breakpoint

-- anon is pre-authentication. It has no business reading any of this.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;--> statement-breakpoint
-- Supabase's default privileges re-grant to anon for every table created
-- afterwards, so revoke the default too or the next migration reopens this.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;--> statement-breakpoint

-- OAuth refresh tokens and push credentials are server-only secrets. RLS would
-- scope them to their owner, but their owner has no reason to read them from a
-- browser either, so they are not granted to the PostgREST roles at all.
REVOKE ALL ON TABLE strava_accounts, push_subscriptions FROM authenticated;--> statement-breakpoint

ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE goal_history       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE targets            ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meals              ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meal_items         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE gyms               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE exercises          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE exercise_aliases   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE exercise_muscles   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE workouts           ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sets               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE session_messages   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE activities         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE body_metrics       ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE daily_summaries    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE coach_messages     ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE strava_accounts    ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- profiles is keyed by the auth user id itself rather than a user_id column.
CREATE POLICY own_profile ON profiles FOR ALL
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_goal_history ON goal_history FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_targets ON targets FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_meals ON meals FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_gyms ON gyms FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_workouts ON workouts FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_activities ON activities FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_body_metrics ON body_metrics FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_daily_summaries ON daily_summaries FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_coach_messages ON coach_messages FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_strava_account ON strava_accounts FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY own_push_subscriptions ON push_subscriptions FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

-- Children reached through their parent. The subquery is itself subject to the
-- parent's policy, which is the point: one predicate, enforced once.
CREATE POLICY own_meal_items ON meal_items FOR ALL
  USING (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_items.meal_id))
  WITH CHECK (EXISTS (SELECT 1 FROM meals m WHERE m.id = meal_items.meal_id));--> statement-breakpoint

CREATE POLICY own_sets ON sets FOR ALL
  USING (EXISTS (SELECT 1 FROM workouts w WHERE w.id = sets.workout_id))
  WITH CHECK (EXISTS (SELECT 1 FROM workouts w WHERE w.id = sets.workout_id));--> statement-breakpoint

CREATE POLICY own_session_messages ON session_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM workouts w WHERE w.id = session_messages.workout_id))
  WITH CHECK (EXISTS (SELECT 1 FROM workouts w WHERE w.id = session_messages.workout_id));--> statement-breakpoint

-- The exercise catalogue is shared: user_id IS NULL rows are readable by
-- everyone and writable by no one, so a custom exercise can never overwrite
-- "Barbell Bench Press" for the next user.
CREATE POLICY read_catalogue_and_own_exercises ON exercises FOR SELECT
  USING (user_id IS NULL OR user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY write_own_exercises ON exercises FOR INSERT
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY update_own_exercises ON exercises FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY delete_own_exercises ON exercises FOR DELETE
  USING (user_id = app.current_user_id());--> statement-breakpoint

CREATE POLICY read_catalogue_and_own_aliases ON exercise_aliases FOR SELECT
  USING (user_id IS NULL OR user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY write_own_aliases ON exercise_aliases FOR INSERT
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY update_own_aliases ON exercise_aliases FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint
CREATE POLICY delete_own_aliases ON exercise_aliases FOR DELETE
  USING (user_id = app.current_user_id());--> statement-breakpoint

-- Muscle mappings inherit their exercise's visibility.
CREATE POLICY read_visible_exercise_muscles ON exercise_muscles FOR SELECT
  USING (EXISTS (SELECT 1 FROM exercises e WHERE e.id = exercise_muscles.exercise_id));--> statement-breakpoint
CREATE POLICY write_own_exercise_muscles ON exercise_muscles FOR ALL
  USING (EXISTS (
    SELECT 1 FROM exercises e
    WHERE e.id = exercise_muscles.exercise_id AND e.user_id = app.current_user_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM exercises e
    WHERE e.id = exercise_muscles.exercise_id AND e.user_id = app.current_user_id()));--> statement-breakpoint

-- Trigram index for the fuzzy tier of resolveExercise(). The `%` operator is
-- what can use it; the tighter similarity() threshold still does the deciding.
CREATE INDEX IF NOT EXISTS exercise_aliases_alias_trgm_idx
  ON exercise_aliases USING gin (alias gin_trgm_ops);
