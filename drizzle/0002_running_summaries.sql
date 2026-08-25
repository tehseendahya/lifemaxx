-- Running is a first-class goal ("half marathon in the fall"), but the Strava
-- pull only ever fed raw rows to the coach as context. Nothing surfaced them.
-- Two additions: a verdict per run, and a stored weekly rollup.

ALTER TABLE activities ADD COLUMN IF NOT EXISTS verdict text;--> statement-breakpoint
ALTER TABLE activities ADD COLUMN IF NOT EXISTS verdict_generated_at timestamp with time zone;--> statement-breakpoint

-- Idempotency for the nightly pull, rescoped by user.
--
-- The old index was unique on (provider, external_id) alone. Strava activity
-- ids are globally unique, so it deduplicated correctly for one account — but
-- if the same athlete were ever connected from two profiles, the second one's
-- rows would collide with the first's and be dropped on the floor, leaving that
-- user with an empty, permanently "successful" sync.
DROP INDEX IF EXISTS activities_provider_external_idx;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS activities_user_provider_external_idx
  ON activities (user_id, provider, external_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS weekly_running_summaries (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "stats" jsonb NOT NULL,
  "summary" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS weekly_running_user_week_idx
  ON weekly_running_summaries (user_id, week_start);--> statement-breakpoint

-- New table, so it needs the same treatment as everything in 0001.
ALTER TABLE weekly_running_summaries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY own_weekly_running_summaries ON weekly_running_summaries FOR ALL
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE weekly_running_summaries TO lifemaxx_app;--> statement-breakpoint
REVOKE ALL ON TABLE weekly_running_summaries FROM anon;
