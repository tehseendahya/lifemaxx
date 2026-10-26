/**
 * When a workout is over.
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * There was no answer to that question at all. `workouts.status` went to
 * `'completed'` when — and only when — someone pressed STOP, `getActiveWorkout`
 * had no time bound of any kind, and nothing anywhere closed a session that was
 * simply walked away from. So an active workout lived forever.
 *
 * The owner lifted chest and biceps at 1pm one day, did not press STOP, and
 * lifted triceps and back at noon the next. `POST /api/session/start` found the
 * open workout, answered `resumed: true`, and every set of the second day was
 * written into the first day's row — which carries its own `localDate`. Two
 * sessions on two calendar days became one record filed under the earlier date:
 *
 *   "it for some reason combined all my stuff into one lift as it thinks today
 *    is all one day"
 *
 * Their reading was that the app was treating any 24-hour window as a day. It
 * was not: `localDate()` has always been a real calendar date in a real
 * timezone (`Intl.DateTimeFormat` over the profile's zone). The date was wrong
 * because the SESSION was wrong — the sets inherited a workout that should have
 * ended twenty-three hours earlier.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * A session ends when you stop it, or when it has gone `SESSION_IDLE_MS`
 * without a set — whichever comes first.
 *
 * Idle time, not elapsed time, and not the calendar. Each is wrong in a way
 * this is not:
 *
 *  · ELAPSED would cut a long session in half. Someone who warms up at 10am and
 *    is still working at 4pm is having one workout, and a cap on total length
 *    says otherwise.
 *  · THE CALENDAR would split a session that crosses local midnight. Starting
 *    at 11:40pm and finishing at 12:20am is one workout by any reading, and
 *    filing half of it under the next date is the same class of error as the
 *    one being fixed here.
 *
 * An idle gap has neither failure. It also answers the owner's second question
 * — *"when another exercise is recorded on the same day, it shouldn't
 * automatically assume it's the same workout"* — without a new concept and
 * without asking them anything: a 7am session and a 6pm session are eleven
 * hours apart and separate for exactly the reason a person would say they are
 * separate, while two exercises nine minutes apart are not.
 *
 * ── WHY SIX HOURS ──────────────────────────────────────────────────────────
 *
 * It has to be longer than any gap that can occur INSIDE one session and
 * shorter than the gap between two sessions in a day.
 *
 * The longest honest intra-session gap is someone leaving mid-workout and
 * coming back — lunch, a phone call, a crowded squat rack. Two hours is
 * generous for that; six is beyond argument. At the other end, a genuine
 * two-a-day is a morning and an evening session, which is eight to twelve
 * hours apart, so six splits them. Nothing lands between those two bands,
 * which is why the exact number does not need to be defended to the minute.
 *
 * Being wrong in each direction costs differently, and that is the other
 * reason to sit well clear of the intra-session end. Splitting one workout in
 * two is visible, and now fixable — both halves keep every set. Merging two
 * workouts is what the owner just reported, and it corrupts the date on one of
 * them.
 */

/** Six hours. See above; this is the whole rule. */
export const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;

export interface SessionActivity {
  startedAt: Date;
  /** The last set written to it, or `null` for a session nothing was logged in. */
  lastSetAt: Date | null;
}

/**
 * The moment a session was last alive.
 *
 * The last set, or the start for a session nothing was logged in — a start with
 * no sets is still a real claim that someone was lifting at that minute, and
 * treating it as dead on arrival would end a session during the walk from the
 * door to the rack.
 *
 * `Math.max` rather than `lastSetAt ?? startedAt`: a corrected set can carry a
 * `loggedAt` earlier than the start (the clamp in `POST /api/sets` is the only
 * thing preventing it, and this does not depend on that clamp holding).
 */
export function lastAliveAt(activity: SessionActivity): Date {
  const last = activity.lastSetAt?.getTime() ?? 0;
  return new Date(Math.max(activity.startedAt.getTime(), last));
}

/**
 * Whether this session had already ended by `at`.
 *
 * `at` is a parameter and not `Date.now()` for a reason that is easy to miss
 * and expensive to get wrong: a set logged in a basement is delivered whenever
 * the phone next has signal, which can be hours later. It belongs to the
 * session that was alive when it was LOGGED, not to whatever is alive when it
 * arrives. `POST /api/sets` passes the set's own `loggedAt` here, so a morning
 * session that uploads at six in the evening still lands in the morning.
 */
export function sessionEndedBy(activity: SessionActivity, at: Date): boolean {
  return at.getTime() - lastAliveAt(activity).getTime() > SESSION_IDLE_MS;
}

/**
 * What `ended_at` should say for a session nobody stopped.
 *
 * The last set, NOT the moment the staleness was noticed. Stamping "now" on a
 * session abandoned yesterday would record a twenty-three-hour workout and put
 * that figure into every duration the app ever shows for it. The work ended
 * when the work ended; all that was missing was the tap.
 */
export function impliedEndedAt(activity: SessionActivity): Date {
  return lastAliveAt(activity);
}
