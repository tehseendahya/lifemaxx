import { describe, expect, it } from "vitest";

import {
  NAV_ITEMS, WIDE_MIN_WIDTH, activeNav, isWideLayout, navMove, type NavKey,
} from "./layout-rules";

const item = (key: NavKey) => NAV_ITEMS.find((i) => i.key === key)!;

describe("isWideLayout", () => {
  it("is wide for a laptop browser window", () => {
    expect(isWideLayout("web", 1440)).toBe(true);
    expect(isWideLayout("web", WIDE_MIN_WIDTH)).toBe(true);
  });

  it("is narrow for a browser window below the breakpoint, so a phone browser looks like the app", () => {
    expect(isWideLayout("web", WIDE_MIN_WIDTH - 1)).toBe(false);
    expect(isWideLayout("web", 390)).toBe(false);
  });

  it("is never wide on the native app, however wide the screen", () => {
    // An iPad in landscape is over 900pt and is still the touch app.
    expect(isWideLayout("ios", 1366)).toBe(false);
    expect(isWideLayout("android", 1200)).toBe(false);
  });

  it("is narrow while the window size is unknown", () => {
    expect(isWideLayout("web", 0)).toBe(false);
    expect(isWideLayout("web", Number.NaN)).toBe(false);
  });
});

describe("the sidebar", () => {
  it("has the six places, in the web nav's order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Today", "Lift", "Food", "Runs", "Coach", "You"]);
  });

  it("lights the place for each route", () => {
    expect(activeNav("/")).toBe("today");
    expect(activeNav("")).toBe("today");
    expect(activeNav("/lift")).toBe("lift");
    expect(activeNav("/food")).toBe("food");
    expect(activeNav("/runs")).toBe("runs");
    expect(activeNav("/coach")).toBe("coach");
    expect(activeNav("/you")).toBe("you");
    expect(activeNav("/you?strava=connected")).toBe("you");
    expect(activeNav("/food/")).toBe("food");
  });

  it("lights Lift for the screens opened from it", () => {
    expect(activeNav("/exercise")).toBe("lift");
    expect(activeNav("/workout")).toBe("lift");
  });

  it("lights nothing for a route that is no place", () => {
    expect(activeNav("/sign-in")).toBeNull();
    expect(activeNav("/shared-smoke")).toBeNull();
  });

  it("does nothing when the place is already open", () => {
    expect(navMove("/food", item("food"))).toBe("none");
    expect(navMove("/", item("today"))).toBe("none");
  });

  it("goes to Lift from an exercise opened under it", () => {
    expect(navMove("/exercise", item("lift"))).toBe("navigate");
  });

  it("replaces rather than stacks between two pushed screens", () => {
    expect(navMove("/runs", item("coach"))).toBe("replace");
    expect(navMove("/workout", item("runs"))).toBe("replace");
  });

  it("navigates between tabs, and from a pushed screen back to one", () => {
    expect(navMove("/", item("food"))).toBe("navigate");
    expect(navMove("/runs", item("you"))).toBe("navigate");
    expect(navMove("/lift", item("runs"))).toBe("navigate");
  });
});
