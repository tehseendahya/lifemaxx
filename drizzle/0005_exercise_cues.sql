-- Per-exercise coaching cues.
--
-- The owner's complaint was "there is no place to add notes per exercise if I
-- want to have them". `sets.note` already exists and is NOT that: it is one
-- line about one set, in one session, and it disappears behind you. What was
-- asked for is the opposite — "elbows tucked, pause on chest", written once,
-- shown every single time that lift is logged, forever.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A TABLE AND NOT A COLUMN ON `exercises`.
--
-- A cue belongs to (user, exercise), not to the exercise. The catalogue rows
-- have `user_id IS NULL` and are shared by every account: 146 of the 147
-- exercises the owner can see are catalogue rows, including Barbell Bench
-- Press, which is exactly the lift a cue is wanted on. `write_own_exercises`
-- and `update_own_exercises` in drizzle/0001 both have
-- `WITH CHECK (user_id = app.current_user_id())`, so a request cannot write a
-- catalogue row at all — a `cue` column there would be unwritable for the
-- common case and, if it somehow were written, would put one user's cue on
-- everybody else's bench press. So the cue needs its own user-owned row.
--
-- ---------------------------------------------------------------------------
-- WHY (user_id, exercise_id) IS THE PRIMARY KEY.
--
-- One cue per lift, by construction rather than by convention. A surrogate id
-- plus a unique index would be the same guarantee with an extra column, and
-- the composite key doubles as the only index this table needs: every read is
-- "all of my cues" or "my cue for this lift", and both are a prefix of it.
--
-- Writes are an upsert ON CONFLICT (user_id, exercise_id), so the same cue
-- saved twice — a retried request, a double-tapped save — is last-write-wins
-- rather than a duplicate or a 409.
--
-- ---------------------------------------------------------------------------
-- WHY THE CHECK CONSTRAINT.
--
-- An empty cue is not a cue, it is the absence of one, and the absence of one
-- is no row. Allowing `''` would mean two representations of "no cue" and a
-- client rendering an empty grey box for the second. Clearing a cue deletes
-- the row; the constraint makes the other spelling impossible.
--
-- The 240-character ceiling is a measurement, not a preference. The cue is
-- read in the confirmation sheet with a number pad on screen: at phone width
-- that content column fits roughly 40 characters a line, so 240 is six lines
-- — about as much as can sit above the pad without pushing it off the screen.
-- Past that it is a training log entry, not a cue, and nothing reads it
-- between sets.
--
-- `cue = btrim(...)` is in the same constraint on purpose. `setCue()` in
-- src/lib/cues.ts normalises before writing, and this is what makes that
-- normalisation an invariant of the data instead of a habit of one call site:
-- a future caller that writes "  " gets an error rather than a row that
-- renders as an empty cue.

CREATE TABLE IF NOT EXISTS exercise_cues (
  "user_id" uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  "exercise_id" uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  "cue" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Named the way drizzle-kit names a composite primary key, so the SQL here
  -- and the `primaryKey()` in schema.ts describe the same constraint and a
  -- future `db:generate` sees no drift.
  CONSTRAINT "exercise_cues_user_id_exercise_id_pk" PRIMARY KEY ("user_id", "exercise_id"),
  CONSTRAINT exercise_cues_cue_shape CHECK (
    cue = btrim(cue, E' \t\r\n') AND char_length(cue) BETWEEN 1 AND 240
  )
);--> statement-breakpoint

-- New table, so it needs the same treatment as everything in 0001.
ALTER TABLE exercise_cues ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- USING and WITH CHECK differ, and the difference is the point.
--
-- Reading is "my rows", full stop. Writing additionally requires that the
-- exercise be one this user can actually SEE — which, under
-- `read_catalogue_and_own_exercises`, means the catalogue or their own lifts.
-- Without that clause the predicate is `user_id = me` alone, and a guessed
-- uuid would let someone pin a cue to another user's custom exercise: a write
-- they can never read back, against a row they are not allowed to know exists.
-- The subquery is itself subject to the exercises policy, which is what makes
-- one predicate enough — the same shape `own_meal_items` and
-- `write_own_exercise_muscles` already use.
--
-- The clause is deliberately NOT in USING: an exercise only stops being
-- visible by being deleted, and the foreign key cascades, so a cue can never
-- be stranded behind a row it can no longer prove.
CREATE POLICY own_exercise_cues ON exercise_cues FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND EXISTS (SELECT 1 FROM exercises e WHERE e.id = exercise_cues.exercise_id)
  );--> statement-breakpoint

-- 0001's grant was `ON ALL TABLES IN SCHEMA public`, which is a one-shot over
-- the tables that existed then. A table added later gets nothing from it.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE exercise_cues TO lifemaxx_app;--> statement-breakpoint

-- Guarded for the same reason as the revokes in 0001: `anon` exists on
-- Supabase and nowhere else, and naming a role that does not exist aborts the
-- whole migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE exercise_cues FROM anon';
  END IF;
END $$;
