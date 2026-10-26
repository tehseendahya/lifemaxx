import { describe, it, expect } from "vitest";
import {
  SESSION_IDLE_MS,
  impliedEndedAt,
  lastAliveAt,
  sessionEndedBy,
} from "./session";

/**
 * The guard for the owner's report: two days of lifting written into one
 * workout, filed under the earlier day's date.
 *
 * The scenario is reproduced literally in the first test, because the rule is
 * only worth having if it answers that. The rest fence the two ways a lifetime
 * rule normally goes wrong — cutting a long session in half, and splitting one
 * that crosses midnight.
 */

const H = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe("a session that nobody stopped", () => {
  it("has ended by the next day's workout — the reported bug", () => {
    // Chest and biceps, 1pm, last set at 2:15pm, STOP never pressed.
    const yesterday = { startedAt: at("2026-10-24T17:00:00Z"), lastSetAt: at("2026-10-24T18:15:00Z") };

    // Triceps and back, noon the next day. Before this rule, `getActiveWorkout`
    // handed this set yesterday's workout and `localDate` followed it there.
    expect(sessionEndedBy(yesterday, at("2026-10-25T16:00:00Z"))).toBe(true);
  });

  it("has ended by a second session the same afternoon", () => {
    // The owner's other question — a 7am session and a 6pm one are not one
    // workout just because they share a date. No new concept needed: eleven
    // hours is eleven hours.
    const morning = { startedAt: at("2026-10-25T11:00:00Z"), lastSetAt: at("2026-10-25T12:10:00Z") };
    expect(sessionEndedBy(morning, at("2026-10-25T22:00:00Z"))).toBe(true);
  });

  it("is still live for a set logged four hours after the last one", () => {
    // Left mid-workout and came back. Generous on purpose: merging two
    // workouts corrupts a date, splitting one is visible and fixable.
    const session = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: at("2026-10-25T15:00:00Z") };
    expect(sessionEndedBy(session, at("2026-10-25T19:00:00Z"))).toBe(false);
  });
});

describe("what the rule deliberately does NOT do", () => {
  it("never cuts a long session short while sets keep arriving", () => {
    // An ELAPSED-time cap would end this at the six-hour mark. Someone warming
    // up at 10am and still working at 4pm is having one workout.
    let activity = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: at("2026-10-25T14:00:00Z") };
    for (let hour = 1; hour <= 6; hour++) {
      const now = new Date(activity.startedAt.getTime() + hour * H);
      expect(sessionEndedBy(activity, now), `hour ${hour}`).toBe(false);
      activity = { ...activity, lastSetAt: now };
    }
    // Six hours of continuous work and it is still one session.
    expect(sessionEndedBy(activity, at("2026-10-25T20:00:00Z"))).toBe(false);
  });

  it("never splits a session that crosses local midnight", () => {
    // A CALENDAR rule would file the last twenty minutes under the next day,
    // which is the same class of error as the one being fixed.
    const lateNight = { startedAt: at("2026-10-25T03:40:00Z"), lastSetAt: at("2026-10-25T03:55:00Z") };
    expect(sessionEndedBy(lateNight, at("2026-10-25T04:20:00Z"))).toBe(false);
  });

  it("splits a morning session from the previous late night", () => {
    // The flip side of the midnight case, and it still comes out right: 11:40pm
    // to 2pm is fourteen hours, not a long rest.
    const lateNight = { startedAt: at("2026-10-25T03:40:00Z"), lastSetAt: at("2026-10-25T04:20:00Z") };
    expect(sessionEndedBy(lateNight, at("2026-10-25T18:00:00Z"))).toBe(true);
  });
});

describe("the boundary", () => {
  const activity = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: at("2026-10-25T15:00:00Z") };
  const last = activity.lastSetAt.getTime();

  it("is exactly the idle threshold, and is inclusive of it", () => {
    expect(sessionEndedBy(activity, new Date(last + SESSION_IDLE_MS - 1))).toBe(false);
    expect(sessionEndedBy(activity, new Date(last + SESSION_IDLE_MS))).toBe(false);
    expect(sessionEndedBy(activity, new Date(last + SESSION_IDLE_MS + 1))).toBe(true);
  });

  it("sits clear of both bands it has to separate", () => {
    // The number does not need defending to the minute, but it does need to be
    // above any gap inside one session and below the gap between two in a day.
    expect(SESSION_IDLE_MS).toBeGreaterThan(2 * H);
    expect(SESSION_IDLE_MS).toBeLessThan(8 * H);
  });
});

describe("a session nothing was logged in", () => {
  const empty = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: null };

  it("stays live from its start, not from nothing", () => {
    // Otherwise the session ends during the walk from the door to the rack.
    expect(lastAliveAt(empty)).toEqual(empty.startedAt);
    expect(sessionEndedBy(empty, at("2026-10-25T16:00:00Z"))).toBe(false);
  });

  it("still ends, with nobody having logged anything at all", () => {
    expect(sessionEndedBy(empty, at("2026-10-26T14:00:00Z"))).toBe(true);
  });
});

describe("the end time written on a session nobody stopped", () => {
  it("is the last set, not the moment it was noticed", () => {
    // Stamping "now" would record a 23-hour workout and feed that figure to
    // every duration the app shows for it afterwards.
    const activity = { startedAt: at("2026-10-24T17:00:00Z"), lastSetAt: at("2026-10-24T18:15:00Z") };
    expect(impliedEndedAt(activity)).toEqual(at("2026-10-24T18:15:00Z"));

    const durationMin =
      (impliedEndedAt(activity).getTime() - activity.startedAt.getTime()) / 60_000;
    expect(durationMin).toBe(75);
  });

  it("falls back to the start for a session with no sets", () => {
    const empty = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: null };
    expect(impliedEndedAt(empty)).toEqual(empty.startedAt);
  });

  it("never lands before the session started", () => {
    // A corrected set can carry a `loggedAt` earlier than the start. The clamp
    // in POST /api/sets is the only thing preventing it, and a negative
    // duration should not depend on that clamp holding.
    const odd = { startedAt: at("2026-10-25T14:00:00Z"), lastSetAt: at("2026-10-25T13:00:00Z") };
    expect(impliedEndedAt(odd)).toEqual(odd.startedAt);
    expect(impliedEndedAt(odd).getTime()).toBeGreaterThanOrEqual(odd.startedAt.getTime());
  });
});
