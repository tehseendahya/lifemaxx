-- The catalogue grew from 35 exercises to 147. Two things in the alias table
-- have to move with it.
--
-- ---------------------------------------------------------------------------
-- 1. "hammer curl" changes owner.
--
-- It was an alias of Dumbbell Curl, because there was no hammer curl in the
-- catalogue to point it at. That is not a harmless approximation: a hammer
-- curl is a neutral-grip movement with a different forearm contribution and a
-- different working weight, and averaging it into the dumbbell curl trend line
-- makes both lifts' history wrong. It is also how "cable rope hammer curls"
-- resolved — confidently — to Dumbbell Curl.
--
-- The catalogue now has Hammer Curl and Cable Hammer Curl. But the seed only
-- ever INSERTs aliases, ON CONFLICT DO NOTHING, so on an existing database the
-- old row wins forever and the reassignment is silently a no-op. The stale row
-- has to be deleted before the seed runs.
--
-- Scoped to user_id IS NULL on both sides: a built-in alias on a built-in
-- exercise. A user's own learned alias is their deliberate choice and is left
-- alone, as is anything pointing at an exercise they created themselves.
--
-- Nothing in `sets` moves. Aliases are a lookup table, not identity — no slug
-- changed, so no set is re-pointed and no history is rewritten. Sets already
-- logged as Dumbbell Curl stay Dumbbell Curl; only future typing of "hammer
-- curl" lands on the right row.
--
-- This is the pattern for any future alias that changes owner: delete the stale
-- (alias, exercise) pair here, then let the seed write the new one.

DELETE FROM exercise_aliases a
USING exercises e
WHERE a.exercise_id = e.id
  AND a.user_id IS NULL
  AND e.user_id IS NULL
  AND e.slug = 'dumbbell-curl'
  AND a.alias = 'hammer curl';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. The seed was never idempotent for built-in aliases, and at 820 of them
--    that stopped being survivable.
--
-- `exercise_aliases_alias_user_idx` is unique on (alias, user_id), and a
-- built-in alias has user_id NULL. Postgres unique indexes are NULLS DISTINCT
-- by default, so two rows identical except for a NULL user_id do not conflict
-- — both are allowed. The exercises table never noticed, because the seed looks
-- a row up by slug before writing it; aliases go in blind with ON CONFLICT DO
-- NOTHING, and nothing ever conflicted. Every `npm run db:seed` therefore wrote
-- the entire global alias set again: 143 extra rows a run at 35 exercises, 820
-- a run now.
--
-- Resolution still returned the right answer — tier 1 is an exact match with
-- LIMIT 1 — which is why this stayed invisible. What it cost was the trigram
-- scan, where every unresolved name is scored against every alias row, and the
-- premise that an alias identifies one exercise.
--
-- De-duplicate first, then add the index that should always have been there.
-- Keeping the lowest id is arbitrary but deterministic, and safe because the
-- duplicates are exact copies: the remap above has already removed the only
-- pair where one alias pointed at two different exercises.
--
-- The index is partial and additive rather than a redefinition of
-- `exercise_aliases_alias_user_idx`: the per-user half of that index is still
-- correct and still wanted, and a user-scoped alias is allowed to shadow a
-- global one — that is what `learnAlias` is for. Only the global half needed a
-- constraint that sees NULLs as equal. It lives in SQL rather than schema.ts
-- for the same reason pg_trgm, the RLS policies and the alias trigram index do:
-- drizzle-kit cannot express it, and migrate.ts applies this folder verbatim.

DELETE FROM exercise_aliases
WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() OVER (PARTITION BY alias ORDER BY id) AS rn
    FROM exercise_aliases
    WHERE user_id IS NULL
  ) dupes
  WHERE dupes.rn > 1
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "exercise_aliases_global_alias_idx"
  ON "exercise_aliases" ("alias") WHERE "user_id" IS NULL;
