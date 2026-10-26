/**
 * Telling the server where the phone is.
 *
 * ── WHY THIS HAD TO EXIST ──────────────────────────────────────────────────
 *
 * `profiles.tz` is what `localDate()` uses to decide what "today" means — the
 * date a set is filed under, the meals the dashboard adds up, the day the lift
 * grid draws a mark on. The column has always been there, and `POST
 * /api/profile` has always accepted a `tz`, but NOTHING EVER SENT ONE. Not the
 * web app, not the phone, not sign-up. So it sat on its `America/New_York`
 * column default for every account, and every date in the app was a New York
 * date regardless of where the owner actually was.
 *
 * Three time zones west of it that is not subtle: an evening session logged at
 * 9:30pm is already tomorrow in New York, so it lands on the wrong day of the
 * lift grid, counts toward the wrong week's volume, and is invisible to a
 * dashboard asking about today.
 *
 * The owner asked for exactly this, in the same breath as the session bug:
 * *"It should look at the time zone of the phone to actually figure out what a
 * day is."*
 *
 * ── WHY IT IS REPORTED RATHER THAN SENT WITH EVERY REQUEST ─────────────────
 *
 * A header on every call would need no storage and never go stale, and it was
 * rejected anyway: the 9pm verdict runs from a cron with no phone in the loop,
 * and so does every rollup it reads. Those need a zone ON THE PROFILE. Given
 * it has to be stored, storing it from one request is simpler than storing it
 * from all of them.
 *
 * Travel is handled by the same path: the comparison runs against whatever the
 * server currently holds, so landing in another country corrects the profile
 * on the first bootstrap after the phone changes its own clock.
 */

/**
 * The phone's IANA zone, or `null` if the platform will not say.
 *
 * `resolvedOptions().timeZone` is required to be an IANA name on any runtime
 * with a real ICU, which Hermes on iOS has. The guard is for the case where it
 * answers `undefined` or the empty string rather than throwing — reporting
 * `""` would be worse than reporting nothing, because the server would have to
 * decide what an empty zone means.
 */
export function deviceTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.trim() !== "" ? tz.trim() : null;
  } catch {
    return null;
  }
}

/**
 * The zone worth reporting, or `null` when there is nothing to say.
 *
 * Returning `null` for an unchanged zone is what keeps this from being a write
 * on every launch: the overwhelmingly common case is that the server already
 * agrees, and a `POST /api/profile` to restate that would cost a round trip
 * for nothing and write a `goal_history` row's worth of churn against the
 * profile every time the app opened.
 */
export function timezoneToReport(device: string | null, server: string | undefined): string | null {
  if (device === null) return null;
  if (typeof server === "string" && server.trim() === device) return null;
  return device;
}
