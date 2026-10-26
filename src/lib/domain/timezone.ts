/**
 * Validating an IANA timezone before it is stored.
 *
 * `profiles.tz` is the input to `localDate()`, which decides what "today"
 * means everywhere in this app: which day a set is filed under, which meals
 * the dashboard adds up, when the 9pm verdict fires. A bad string there does
 * not degrade anything — `Intl.DateTimeFormat` THROWS on an unknown zone, and
 * it is constructed inside `route()` on the way into every single handler. So
 * one unvalidated write would turn every authenticated request into a 500
 * until someone fixed the row by hand.
 *
 * That is why this is checked at the edge rather than trusted. The phone is
 * the thing sending it, and the phone is not an attacker, but it is also not a
 * guarantee: `Intl.DateTimeFormat().resolvedOptions().timeZone` can come back
 * as the deprecated-alias spelling of a zone, or in principle as something
 * this server's ICU build does not carry.
 */

/**
 * Whether this runtime can actually format a date in that zone.
 *
 * Asking `Intl` itself rather than matching a pattern or carrying a list: the
 * question is not "does this look like a zone" but "will the call that every
 * request makes succeed", and only the runtime can answer that. A list would
 * also go stale — zones are added and renamed.
 */
export function isUsableTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone to store, or `null` to keep whatever is already there.
 *
 * `null` rather than a throw, and rather than a fallback to UTC. A phone
 * reporting a zone this server cannot use is not a reason to fail the request
 * it rode in on — and silently rewriting it to UTC would be the same bug this
 * is here to fix, with a different wrong answer.
 */
export function normaliseTimezone(tz: unknown): string | null {
  // Trim BEFORE the check, not after. `Intl` does not tolerate surrounding
  // whitespace — ` Europe/London ` throws exactly as `Mars/Olympus_Mons` does
  // — so validating the raw string would reject a zone that is merely untidy.
  const trimmed = typeof tz === "string" ? tz.trim() : tz;
  return isUsableTimezone(trimmed) ? trimmed : null;
}
