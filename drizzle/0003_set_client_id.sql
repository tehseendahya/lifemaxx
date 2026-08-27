-- Offline set logging needs a client-generated id.
--
-- Without one, a set logged in a gym basement is at the mercy of whether the
-- response made it back. The request succeeds, the reply is lost on a dying
-- bar of signal, the outbox retries — and the same set is written twice. No
-- amount of care on the client fixes that; the server has to be able to
-- recognise the retry, which means the id has to be minted before the first
-- attempt rather than by the database on arrival.
--
-- Unique per workout rather than globally: the id comes from a phone, and the
-- guarantee we actually need is "this set, in this session, once".

ALTER TABLE sets ADD COLUMN IF NOT EXISTS client_id uuid;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS sets_workout_client_idx
  ON sets (workout_id, client_id);
