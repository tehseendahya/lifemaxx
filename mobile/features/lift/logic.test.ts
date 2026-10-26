import { describe, expect, it } from "vitest";

import {
  buildSetPayload,
  canLog,
  deriveSessionState,
  draftAfterSave,
  elapsedMin,
  emptyDraft,
  filterCatalogue,
  findQueuedStart,
  heroLabel,
  lastLine,
  lastSetInSession,
  localSetFrom,
  mergeSets,
  numberToPad,
  owedMuscles,
  padToNumber,
  partitionByOwed,
  pillParts,
  pruneLocal,
  queuedSetCount,
  queuedSetFromItem,
  relativeDay,
  resolveEntry,
  restLabel,
  sessionExercises,
  setsForExercise,
  stepReps,
  stepWeight,
  type Draft,
  type LocalSet,
  EDIT_MAX_REPS,
  EDIT_MAX_WEIGHT_LB,
  applyEdits,
  editBlockedReason,
  editChanged,
  editFromSet,
  editSetPayload,
  pruneEdits,
  type DisplaySet,
  type SetEdits,
} from "./logic";
/*
 * The real `SANITY` and the real bound the route applies, imported RELATIVELY
 * and only ever in node. `src/lib/llm/shorthand.ts` has no imports of its own,
 * so this costs nothing here and never reaches Metro — which is what lets the
 * phone keep its own copy of two numbers without them being able to drift.
 */
import { SANITY, setWithinSanity } from "../../../src/lib/llm/shorthand";
import type { CatalogueExercise, LastSet, RankedMuscle, SessionSet } from "@/lib/types";
import type { OutboxItem } from "@/lib/shared/outbox";

// ------------------------------------------------------------------ fixtures

const BENCH = "4b5514ef-9b80-4947-9a9b-d743b3c0924c";
const SQUAT = "0a57be83-a428-4bb3-a014-0139c7d0f956";

function serverSet(over: Partial<SessionSet> & { clientId: string | null; id: string }): SessionSet {
  return {
    exerciseId: BENCH,
    exerciseName: "Barbell Bench Press",
    setIndex: 1,
    reps: 5,
    weightLb: 185,
    rpe: null,
    toFailure: false,
    isWarmup: false,
    felt: null,
    restS: null,
    loggedAt: "2026-10-25T18:00:00.000Z",
    ...over,
  };
}

function local(over: Partial<LocalSet> & { clientId: string }): LocalSet {
  return {
    exerciseId: BENCH,
    reps: 5,
    weightLb: 185,
    rpe: null,
    toFailure: false,
    isWarmup: false,
    felt: null,
    loggedAt: "2026-10-25T18:00:00.000Z",
    ...over,
  };
}

function item(over: Partial<OutboxItem> & { id: string }): OutboxItem {
  return {
    kind: "set",
    url: "/api/sets",
    payload: {
      clientId: over.id,
      exerciseId: BENCH,
      reps: 5,
      weightLb: 185,
      loggedAt: "2026-10-25T18:00:00.000Z",
    },
    createdAt: 1_000,
    attempts: 0,
    nextAttemptAt: 0,
    ...over,
  };
}

const catalogue: CatalogueExercise[] = [
  {
    id: BENCH,
    name: "Barbell Bench Press",
    slug: "barbell-bench-press",
    incrementLb: 5,
    equipment: "barbell",
    muscles: [
      { muscle: "chest", contribution: 1 },
      { muscle: "tricep", contribution: 0.5 },
      { muscle: "front_delt", contribution: 0.5 },
    ],
  },
  {
    id: SQUAT,
    name: "Back Squat",
    slug: "back-squat",
    incrementLb: 10,
    equipment: "barbell",
    muscles: [
      { muscle: "quad", contribution: 1 },
      { muscle: "forearm", contribution: 0.25 },
    ],
  },
  {
    id: "face-pull-id",
    name: "Cable Face Pull",
    slug: "cable-face-pull",
    incrementLb: 5,
    equipment: "cable",
    muscles: [
      { muscle: "rear_delt", contribution: 1 },
      { muscle: "trap", contribution: 0.5 },
    ],
  },
];

const ranked: RankedMuscle[] = [
  { muscle: "rear_delt", label: "Rear Delts", setsLast7d: 0, daysSinceTrained: 9, score: 1 },
  { muscle: "trap", label: "Traps", setsLast7d: 0, daysSinceTrained: null, score: 1 },
  { muscle: "forearm", label: "Forearms", setsLast7d: 0, daysSinceTrained: null, score: 0.8 },
  { muscle: "chest", label: "Chest", setsLast7d: 8, daysSinceTrained: 2, score: 0.2 },
  { muscle: "quad", label: "Quads", setsLast7d: 14, daysSinceTrained: 1, score: 0 },
];

// ------------------------------------------------------------- reading rows

describe("queuedSetFromItem", () => {
  it("reads a well-formed queued set", () => {
    expect(queuedSetFromItem(item({ id: "a" }))).toEqual({
      clientId: "a",
      exerciseId: BENCH,
      reps: 5,
      weightLb: 185,
      rpe: null,
      toFailure: false,
      isWarmup: false,
      felt: null,
      loggedAt: "2026-10-25T18:00:00.000Z",
    });
  });

  it("ignores a session-start row", () => {
    expect(queuedSetFromItem(item({ id: "s", kind: "session-start", payload: {} }))).toBeNull();
  });

  it("drops a payload it cannot read rather than drawing NaN", () => {
    const bad = item({ id: "b", payload: { clientId: "b", exerciseId: BENCH, reps: "five" } });
    expect(queuedSetFromItem(bad)).toBeNull();
  });

  it("falls back to the row's own id and createdAt when the payload omits them", () => {
    const partial = item({
      id: "c",
      createdAt: Date.parse("2026-10-25T17:30:00.000Z"),
      payload: { exerciseId: BENCH, reps: 3, weightLb: 45 },
    });
    expect(queuedSetFromItem(partial)).toMatchObject({
      clientId: "c",
      loggedAt: "2026-10-25T17:30:00.000Z",
    });
  });

  it("reads the optional annotations when they are present", () => {
    const full = item({
      id: "d",
      payload: {
        clientId: "d",
        exerciseId: BENCH,
        reps: 6,
        weightLb: 45,
        rpe: 8,
        toFailure: true,
        isWarmup: true,
        felt: "strong",
        loggedAt: "2026-10-25T18:05:00.000Z",
      },
    });
    expect(queuedSetFromItem(full)).toMatchObject({
      rpe: 8,
      toFailure: true,
      isWarmup: true,
      felt: "strong",
    });
  });

  it("rejects a felt value that is not one of the three", () => {
    const odd = item({
      id: "e",
      payload: { clientId: "e", exerciseId: BENCH, reps: 5, weightLb: 185, felt: "amazing" },
    });
    expect(queuedSetFromItem(odd)?.felt).toBeNull();
  });
});

describe("findQueuedStart / queuedSetCount", () => {
  const start = item({ id: "s1", kind: "session-start", url: "/api/session/start", payload: {} });

  it("finds the queued start among sets", () => {
    expect(findQueuedStart([item({ id: "a" }), start])?.id).toBe("s1");
  });

  it("returns null when there is none", () => {
    expect(findQueuedStart([item({ id: "a" })])).toBeNull();
  });

  it("counts only sets, never the start", () => {
    expect(queuedSetCount([item({ id: "a" }), item({ id: "b" }), start])).toBe(2);
  });
});

// ------------------------------------------------------------ reconciliation

describe("mergeSets", () => {
  it("keeps a queued set visible until the server reports it", () => {
    const merged = mergeSets([], [local({ clientId: "q1" })], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ queued: true, id: null, key: "q1" });
  });

  it("does not duplicate a set that is both delivered and still in the queue", () => {
    // The exact mid-flight window: the POST succeeded, `/api/mobile/session`
    // was refetched, but the queue has not published its new length yet.
    const merged = mergeSets(
      [serverSet({ id: "row1", clientId: "q1" })],
      [local({ clientId: "q1" })],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ queued: false, id: "row1" });
  });

  it("keeps the same React key across the queued → delivered transition", () => {
    const queuedOnly = mergeSets([], [local({ clientId: "q1" })], []);
    const delivered = mergeSets([serverSet({ id: "row1", clientId: "q1" })], [], []);
    expect(queuedOnly[0].key).toBe(delivered[0].key);
  });

  it("drops a local optimistic row once the queue has it", () => {
    const merged = mergeSets([], [local({ clientId: "q1" })], [local({ clientId: "q1" })]);
    expect(merged).toHaveLength(1);
  });

  it("deduplicates a clientId the server returns twice", () => {
    const merged = mergeSets(
      [serverSet({ id: "row1", clientId: "q1" }), serverSet({ id: "row2", clientId: "q1" })],
      [],
      [],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("row1");
  });

  it("keeps server rows that have no clientId, keyed by row id", () => {
    const merged = mergeSets([serverSet({ id: "web1", clientId: null })], [], []);
    expect(merged[0].key).toBe("srv:web1");
    expect(merged[0].queued).toBe(false);
  });

  it("does not collide two clientId-less server rows with each other", () => {
    const merged = mergeSets(
      [serverSet({ id: "web1", clientId: null }), serverSet({ id: "web2", clientId: null })],
      [],
      [],
    );
    expect(merged).toHaveLength(2);
  });

  it("orders by when the set was logged, not by which source it came from", () => {
    // An out-of-order refetch: the server knows about the newest set but not
    // the one before it, which is still queued. The queued one must slot in
    // where it happened rather than being appended to the end.
    const merged = mergeSets(
      [serverSet({ id: "row3", clientId: "c3", loggedAt: "2026-10-25T18:06:00.000Z" })],
      [local({ clientId: "c2", loggedAt: "2026-10-25T18:03:00.000Z" })],
      [local({ clientId: "c1", loggedAt: "2026-10-25T18:00:00.000Z" })],
    );
    expect(merged.map((s) => s.clientId)).toEqual(["c1", "c2", "c3"]);
  });

  it("is stable for two sets logged in the same millisecond", () => {
    const a = mergeSets([], [local({ clientId: "aaa" }), local({ clientId: "bbb" })], []);
    const b = mergeSets([], [local({ clientId: "bbb" }), local({ clientId: "aaa" })], []);
    expect(a.map((s) => s.key)).toEqual(b.map((s) => s.key));
  });

  it("returns nothing when there is nothing", () => {
    expect(mergeSets([], [], [])).toEqual([]);
  });
});

describe("pruneLocal", () => {
  it("forgets a local row the queue has taken responsibility for", () => {
    expect(pruneLocal([local({ clientId: "q1" })], [], [local({ clientId: "q1" })])).toEqual([]);
  });

  it("forgets a local row the server has", () => {
    expect(
      pruneLocal([local({ clientId: "q1" })], [serverSet({ id: "r", clientId: "q1" })], []),
    ).toEqual([]);
  });

  it("keeps a local row that nothing else knows about yet", () => {
    expect(pruneLocal([local({ clientId: "q1" })], [], [])).toHaveLength(1);
  });

  it("is not confused by a server row with no clientId", () => {
    expect(
      pruneLocal([local({ clientId: "q1" })], [serverSet({ id: "web", clientId: null })], []),
    ).toHaveLength(1);
  });
});

describe("setsForExercise / lastSetInSession", () => {
  const sets = mergeSets(
    [],
    [
      local({ clientId: "a", loggedAt: "2026-10-25T18:00:00.000Z", weightLb: 185 }),
      local({ clientId: "b", loggedAt: "2026-10-25T18:04:00.000Z", weightLb: 190 }),
      local({ clientId: "c", exerciseId: SQUAT, loggedAt: "2026-10-25T18:08:00.000Z" }),
    ],
    [],
  );

  it("filters to one exercise", () => {
    expect(setsForExercise(sets, BENCH).map((s) => s.clientId)).toEqual(["a", "b"]);
  });

  it("takes the latest set for that exercise, not the latest overall", () => {
    expect(lastSetInSession(sets, BENCH)?.weightLb).toBe(190);
  });

  it("returns null for an exercise with no sets", () => {
    expect(lastSetInSession(sets, "nope")).toBeNull();
  });
});

// ------------------------------------------------------------------- pager

describe("sessionExercises", () => {
  it("orders by first performed, not by most recent", () => {
    const sets = mergeSets(
      [],
      [
        local({ clientId: "a", exerciseId: BENCH, loggedAt: "2026-10-25T18:00:00.000Z" }),
        local({ clientId: "b", exerciseId: SQUAT, loggedAt: "2026-10-25T18:10:00.000Z" }),
        local({ clientId: "c", exerciseId: BENCH, loggedAt: "2026-10-25T18:20:00.000Z" }),
      ],
      [],
    );
    expect(sessionExercises(sets, [], catalogue).map((e) => e.id)).toEqual([BENCH, SQUAT]);
  });

  it("appends added-but-empty exercises after the performed ones", () => {
    const sets = mergeSets([], [local({ clientId: "a" })], []);
    expect(sessionExercises(sets, ["face-pull-id"], catalogue).map((e) => e.name)).toEqual([
      "Barbell Bench Press",
      "Cable Face Pull",
    ]);
  });

  it("does not duplicate an added exercise that has since been logged", () => {
    const sets = mergeSets([], [local({ clientId: "a" })], []);
    expect(sessionExercises(sets, [BENCH], catalogue)).toHaveLength(1);
  });

  it("carries the exercise's own increment", () => {
    const sets = mergeSets([], [local({ clientId: "a", exerciseId: SQUAT })], []);
    expect(sessionExercises(sets, [], catalogue)[0].incrementLb).toBe(10);
  });

  it("survives a set for an exercise the cached catalogue does not have", () => {
    const sets = mergeSets([], [local({ clientId: "a", exerciseId: "unknown-id" })], []);
    expect(sessionExercises(sets, [], catalogue)[0]).toMatchObject({
      name: "Exercise",
      incrementLb: 5,
    });
  });
});

// ------------------------------------------------------------------ prefill

const history: LastSet = {
  localDate: "2026-10-20",
  weightLb: 185,
  reps: 5,
  rpe: 8,
  sets: 3,
  bestE1rmLb: 215.8,
};

const suggest = {
  baseline: { action: "add", weightLb: 190, sets: 3, reps: 5, reason: "RPE 8 last time" },
  suggestion: { weightLb: 195, sets: 3, reps: 5, reason: "Felt strong on all three" },
  clamped: false,
};

describe("resolveEntry", () => {
  it("prefers the last set logged in this session", () => {
    expect(resolveEntry(undefined, { weightLb: 200, reps: 3 }, history, suggest)).toEqual({
      weightLb: 200,
      reps: 3,
      source: "session",
    });
  });

  it("falls back to the last completed session", () => {
    expect(resolveEntry(undefined, null, history, suggest)).toEqual({
      weightLb: 185,
      reps: 5,
      source: "history",
    });
  });

  it("falls back to the suggestion when there is no history at all", () => {
    expect(resolveEntry(undefined, null, undefined, suggest)).toEqual({
      weightLb: 195,
      reps: 5,
      source: "suggest",
    });
  });

  it("uses the mechanical baseline when the model declined", () => {
    const noModel = { ...suggest, suggestion: null };
    expect(resolveEntry(undefined, null, undefined, noModel).weightLb).toBe(190);
  });

  it("gives up rather than guessing when nothing is known", () => {
    expect(resolveEntry(undefined, null, undefined, null)).toEqual({
      weightLb: null,
      reps: null,
      source: "none",
    });
  });

  it("never lets a late suggestion overwrite what the user typed", () => {
    const draft: Draft = { ...emptyDraft(), weightLb: 225, reps: 2 };
    expect(resolveEntry(draft, { weightLb: 200, reps: 3 }, history, suggest)).toEqual({
      weightLb: 225,
      reps: 2,
      source: "draft",
    });
  });

  it("lets a half-filled draft override only its own field", () => {
    const draft: Draft = { ...emptyDraft(), weightLb: 225 };
    expect(resolveEntry(draft, null, history, null)).toEqual({
      weightLb: 225,
      reps: 5,
      source: "draft",
    });
  });
});

describe("canLog / heroLabel", () => {
  it("names the exact set it will write", () => {
    expect(heroLabel({ weightLb: 185, reps: 5, source: "history" }, false)).toBe("LOG 185 × 5");
  });

  it("says so out loud when the set it will write is a warmup", () => {
    expect(heroLabel({ weightLb: 135, reps: 5, source: "session" }, true)).toBe(
      "LOG 135 × 5 · WARMUP",
    );
  });

  it("asks for a weight instead of logging nothing", () => {
    expect(heroLabel({ weightLb: null, reps: null, source: "none" }, false)).toBe("SET WEIGHT");
  });

  it("logs a bodyweight movement at zero pounds", () => {
    expect(canLog({ weightLb: 0, reps: 12, source: "draft" })).toBe(true);
    expect(heroLabel({ weightLb: 0, reps: 12, source: "draft" }, false)).toBe("LOG 0 × 12");
  });

  it("refuses a zero-rep set", () => {
    expect(canLog({ weightLb: 185, reps: 0, source: "draft" })).toBe(false);
  });

  it("drops a trailing .0 but keeps a real fraction", () => {
    expect(heroLabel({ weightLb: 47.5, reps: 8, source: "draft" }, false)).toBe("LOG 47.5 × 8");
  });
});

// ------------------------------------------------------------------ steppers

describe("stepWeight / stepReps / pad conversion", () => {
  it("steps by the exercise's own increment", () => {
    expect(stepWeight(250, 10, 1)).toBe(260);
    expect(stepWeight(185, 5, -1)).toBe(180);
  });

  it("never goes below zero", () => {
    expect(stepWeight(2.5, 5, -1)).toBe(0);
    expect(stepWeight(0, 5, -1)).toBe(0);
  });

  it("treats a missing increment as the 5lb plate quantum", () => {
    expect(stepWeight(100, 0, 1)).toBe(105);
  });

  it("starts from zero when there is no weight yet", () => {
    expect(stepWeight(null, 5, 1)).toBe(5);
  });

  it("does not accumulate float dust", () => {
    expect(stepWeight(47.5, 2.5, 1)).toBe(50);
  });

  it("keeps reps at one or more", () => {
    expect(stepReps(1, -1)).toBe(1);
    expect(stepReps(null, 1)).toBe(2);
    expect(stepReps(5, 1)).toBe(6);
  });

  it("maps an untouched pad to null, not to zero", () => {
    expect(padToNumber("")).toBeNull();
    expect(padToNumber(".")).toBeNull();
    expect(padToNumber("0")).toBe(0);
    expect(padToNumber("47.5")).toBe(47.5);
  });

  it("round-trips through the pad's string form", () => {
    expect(numberToPad(185)).toBe("185");
    expect(numberToPad(47.5)).toBe("47.5");
    expect(numberToPad(null)).toBe("");
  });
});

// ------------------------------------------------------------------ payload

describe("buildSetPayload", () => {
  const draft: Draft = {
    weightLb: 185,
    reps: 5,
    rpe: 8,
    toFailure: true,
    isWarmup: false,
    felt: "strong",
    note: "  left shoulder pinched  ",
  };

  it("builds exactly the body POST /api/sets expects", () => {
    expect(
      buildSetPayload({
        clientId: "cid",
        exerciseId: BENCH,
        entry: { weightLb: 185, reps: 5, source: "draft" },
        draft,
      }),
    ).toEqual({
      clientId: "cid",
      exerciseId: BENCH,
      reps: 5,
      weightLb: 185,
      rpe: 8,
      toFailure: true,
      isWarmup: false,
      felt: "strong",
      note: "left shoulder pinched",
      rawText: "",
    });
  });

  it("refuses to build a set it cannot fill in", () => {
    expect(
      buildSetPayload({
        clientId: "cid",
        exerciseId: BENCH,
        entry: { weightLb: null, reps: null, source: "none" },
        draft: emptyDraft(),
      }),
    ).toBeNull();
  });

  it("takes the numbers from the resolved entry, not from the draft", () => {
    // The entry is what the hero button said it would log; the draft may hold
    // nothing at all when the numbers came from history.
    const payload = buildSetPayload({
      clientId: "cid",
      exerciseId: BENCH,
      entry: { weightLb: 225, reps: 3, source: "history" },
      draft: emptyDraft(),
    });
    expect(payload).toMatchObject({ weightLb: 225, reps: 3 });
  });
});

describe("draftAfterSave", () => {
  it("keeps weight and reps so the next set is one tap", () => {
    const after = draftAfterSave(
      { ...emptyDraft(), rpe: 9, toFailure: true, felt: "weak", note: "ugly" },
      { weightLb: 185, reps: 5, source: "session" },
    );
    expect(after.weightLb).toBe(185);
    expect(after.reps).toBe(5);
  });

  it("clears the four annotations that described one specific set", () => {
    const after = draftAfterSave(
      { ...emptyDraft(), rpe: 9, toFailure: true, felt: "weak", note: "ugly" },
      { weightLb: 185, reps: 5, source: "session" },
    );
    expect(after).toMatchObject({ rpe: null, toFailure: false, felt: null, note: "" });
  });

  it("keeps warmup on, because warmups come in threes", () => {
    const after = draftAfterSave(
      { ...emptyDraft(), isWarmup: true },
      { weightLb: 135, reps: 5, source: "session" },
    );
    expect(after.isWarmup).toBe(true);
  });
});

describe("localSetFrom", () => {
  it("fills the annotations the payload left off", () => {
    expect(
      localSetFrom(
        { clientId: "cid", exerciseId: BENCH, reps: 5, weightLb: 185 },
        "2026-10-25T18:00:00.000Z",
      ),
    ).toEqual({
      clientId: "cid",
      exerciseId: BENCH,
      reps: 5,
      weightLb: 185,
      rpe: null,
      toFailure: false,
      isWarmup: false,
      felt: null,
      loggedAt: "2026-10-25T18:00:00.000Z",
    });
  });
});

// -------------------------------------------------------------- session gate

describe("deriveSessionState", () => {
  it("runs the clock from the server's start time once it is confirmed", () => {
    expect(
      deriveSessionState({
        activeStartedAt: "2026-10-25T18:00:00.000Z",
        localStartedAt: 123,
        queuedStartAt: 456,
      }),
    ).toEqual({
      active: true,
      pending: false,
      startedAtMs: Date.parse("2026-10-25T18:00:00.000Z"),
    });
  });

  it("enters a pending session from the queued start alone, after a relaunch", () => {
    expect(
      deriveSessionState({ activeStartedAt: null, localStartedAt: null, queuedStartAt: 1_000 }),
    ).toEqual({ active: true, pending: true, startedAtMs: 1_000 });
  });

  it("stays in the session in the window where neither source knows about it", () => {
    // The start was just delivered, so the queued row is gone; the session
    // query has not refetched, so there is no activeWorkout either. Without
    // the local mark this is the bug that throws the user out mid-set.
    expect(
      deriveSessionState({ activeStartedAt: null, localStartedAt: 2_000, queuedStartAt: null }),
    ).toEqual({ active: true, pending: true, startedAtMs: 2_000 });
  });

  it("has no session when nothing claims one", () => {
    expect(
      deriveSessionState({ activeStartedAt: null, localStartedAt: null, queuedStartAt: null }),
    ).toEqual({ active: false, pending: false, startedAtMs: null });
  });

  it("keeps the session when the server timestamp is unparseable", () => {
    const s = deriveSessionState({
      activeStartedAt: "not a date",
      localStartedAt: 3_000,
      queuedStartAt: null,
    });
    expect(s).toEqual({ active: true, pending: false, startedAtMs: 3_000 });
  });
});

describe("elapsedMin", () => {
  const start = Date.parse("2026-10-25T18:00:00.000Z");

  it("rounds to the nearest minute", () => {
    expect(elapsedMin(start, start + 90_000)).toBe(2);
    expect(elapsedMin(start, start + 29_000)).toBe(0);
  });

  it("never shows a negative clock on a skewed phone", () => {
    expect(elapsedMin(start, start - 600_000)).toBe(0);
  });

  it("is zero with no session", () => {
    expect(elapsedMin(null, start)).toBe(0);
  });
});

// ------------------------------------------------------------------- labels

describe("restLabel", () => {
  it("formats as m:ss", () => {
    expect(restLabel(87)).toBe("1:27");
    expect(restLabel(120)).toBe("2:00");
    expect(restLabel(9)).toBe("0:09");
    expect(restLabel(0)).toBe("0:00");
  });

  it("clamps a late tick at zero", () => {
    expect(restLabel(-3)).toBe("0:00");
  });
});

describe("lastLine", () => {
  it("renders the whole line from the last completed session", () => {
    expect(lastLine(history, "2026-10-25")).toBe("LAST: 185 × 5 × 3 @8 · 5d ago");
  });

  it("omits the RPE when there was none", () => {
    expect(lastLine({ ...history, rpe: null }, "2026-10-25")).toBe("LAST: 185 × 5 × 3 · 5d ago");
  });

  it("says FIRST TIME rather than inventing a history", () => {
    expect(lastLine(undefined, "2026-10-25")).toBe("FIRST TIME");
  });
});

describe("relativeDay", () => {
  it("names the near days", () => {
    expect(relativeDay("2026-10-25", "2026-10-25")).toBe("today");
    expect(relativeDay("2026-10-24", "2026-10-25")).toBe("yesterday");
    expect(relativeDay("2026-10-21", "2026-10-25")).toBe("4d ago");
  });

  it("crosses a month boundary", () => {
    expect(relativeDay("2026-09-28", "2026-10-02")).toBe("4d ago");
  });

  it("does not shift a day for a device west of UTC", () => {
    // Both strings are already local calendar dates. Parsing them in the
    // device's zone is how "yesterday" silently becomes "today" in New York.
    expect(relativeDay("2026-10-24", "2026-10-25")).toBe("yesterday");
  });

  it("treats a future date as today rather than as negative days", () => {
    expect(relativeDay("2026-10-26", "2026-10-25")).toBe("today");
  });

  it("falls back to the raw date when it cannot be parsed", () => {
    expect(relativeDay("whenever", "2026-10-25")).toBe("whenever");
  });
});

describe("pillParts", () => {
  const [set] = mergeSets(
    [],
    [local({ clientId: "a", weightLb: 185, reps: 5, rpe: 7, toFailure: true })],
    [],
  );

  it("splits the figure from its annotations so each can be styled", () => {
    expect(pillParts(set)).toEqual({ main: "185 × 5", rpe: " @7", failure: true });
  });

  it("omits the RPE fragment when there is none", () => {
    const [plain] = mergeSets([], [local({ clientId: "b" })], []);
    expect(pillParts(plain)).toEqual({ main: "185 × 5", rpe: null, failure: false });
  });
});

// -------------------------------------------------------------------- owed

/**
 * These three were written against `owedLine`, which joined the top labels into
 * a string for the old start screen. That card now lives in
 * `features/lift/next.ts` and shows a figure per muscle, so `owedLine` has no
 * caller and has been deleted — but the 0.2 cutoff it was exercising is
 * `owedMuscles`', and `partitionByOwed` still depends on it to decide what goes
 * under "Owed this week" in the picker. So the assertions move down one layer
 * rather than leaving with the function they happened to be written against.
 */
describe("owedMuscles", () => {
  it("keeps what is owed, highest debt first", () => {
    expect(owedMuscles(ranked).map((m) => m.label)).toEqual([
      "Rear Delts", "Traps", "Forearms",
    ]);
  });

  it("excludes anything at or below the 0.2 cutoff", () => {
    // The whole ranked fixture goes in; only three come out, so the cutoff is
    // doing the work rather than a slice.
    expect(owedMuscles(ranked)).toHaveLength(3);
    expect(owedMuscles(ranked).every((m) => m.score > 0.2)).toBe(true);
  });

  it("is empty when nothing is owed", () => {
    expect(owedMuscles([{ ...ranked[4] }])).toEqual([]);
  });
});

// ------------------------------------------------------------------ picker

describe("filterCatalogue", () => {
  it("returns everything for an empty query", () => {
    expect(filterCatalogue(catalogue, "")).toHaveLength(3);
  });

  it("matches a substring in the middle of the name", () => {
    expect(filterCatalogue(catalogue, "bench").map((e) => e.slug)).toEqual([
      "barbell-bench-press",
    ]);
  });

  it("ignores case and collapses whitespace", () => {
    expect(filterCatalogue(catalogue, "  BACK   SQUAT ").map((e) => e.slug)).toEqual(["back-squat"]);
  });

  it("matches a hyphenated slug from a spaced query", () => {
    expect(filterCatalogue(catalogue, "face pull").map((e) => e.slug)).toEqual(["cable-face-pull"]);
  });

  it("finds nothing rather than guessing", () => {
    expect(filterCatalogue(catalogue, "zercher")).toEqual([]);
  });
});

describe("partitionByOwed", () => {
  it("pins the exercises that train what is owed, worst debt first", () => {
    const { owed, rest } = partitionByOwed(catalogue, ranked);
    expect(owed.map((e) => e.name)).toEqual(["Cable Face Pull"]);
    expect(rest.map((e) => e.name)).toEqual(["Barbell Bench Press", "Back Squat"]);
  });

  it("ignores an incidental contribution", () => {
    // Back Squat has a 0.25 forearm contribution and forearms are owed at
    // 0.8 — pinning squats under "owed: forearms" would make the block noise.
    const { owed } = partitionByOwed(catalogue, ranked);
    expect(owed.map((e) => e.id)).not.toContain(SQUAT);
  });

  it("pins nothing when nothing is owed", () => {
    const { owed, rest } = partitionByOwed(catalogue, []);
    expect(owed).toEqual([]);
    expect(rest).toHaveLength(3);
  });

  it("partitions the filtered list, not the whole catalogue", () => {
    const { owed, rest } = partitionByOwed(filterCatalogue(catalogue, "squat"), ranked);
    expect(owed).toEqual([]);
    expect(rest.map((e) => e.name)).toEqual(["Back Squat"]);
  });

  it("never lists the same exercise in both halves", () => {
    const { owed, rest } = partitionByOwed(catalogue, ranked);
    const ids = new Set(rest.map((e) => e.id));
    expect(owed.some((e) => ids.has(e.id))).toBe(false);
  });
});

// ------------------------------------------------------------ fixing a set

/**
 * The guard for the owner's second ask: *"should be able to click into a set
 * below and edit smtg if you typed it in wrong"*.
 *
 * Three things here are load-bearing and none is obvious from reading the
 * functions:
 *
 *  - the correction keeps the set's `loggedAt`, because the server derives
 *    every rest gap in a session from the interval between consecutive ones;
 *  - it omits `note` and `rawText` for a DELIVERED set and carries them for a
 *    QUEUED one, because an undelivered original is dropped and is the only
 *    place those two exist;
 *  - the overlay prunes on the displayed precision, because storage is kg and
 *    a pound figure does not survive the round trip bit-for-bit.
 */

function displaySet(over: Partial<DisplaySet> & { clientId: string }): DisplaySet {
  return {
    key: over.clientId,
    id: null,
    queued: true,
    exerciseId: BENCH,
    reps: 10,
    weightLb: 155,
    rpe: null,
    toFailure: false,
    isWarmup: false,
    felt: null,
    loggedAt: "2026-10-25T18:00:00.000Z",
    ...over,
  };
}

describe("the ceilings a correction is held to", () => {
  it("matches the ones POST /api/sets actually enforces", () => {
    // The whole reason these are duplicated rather than imported: pulling
    // `SANITY` into the phone's bundle means pulling the entire deterministic
    // parser in with it, for two numbers. This import is the price of the
    // duplicate — it is relative and only runs in node, so the parser never
    // reaches Metro, and the numbers cannot drift without this failing.
    expect(EDIT_MAX_REPS).toBe(SANITY.maxReps);
    expect(EDIT_MAX_WEIGHT_LB).toBe(SANITY.maxWeightLb);
  });

  it("refuses exactly what the server refuses, at the boundary", () => {
    const base = { weightLb: 185, reps: 5, rpe: null, kind: "working" as const };

    for (const reps of [1, 5, EDIT_MAX_REPS]) {
      expect(editBlockedReason({ ...base, reps })).toBeNull();
      expect(setWithinSanity(reps, base.weightLb)).toBe(true);
    }
    for (const reps of [0, -1, EDIT_MAX_REPS + 1]) {
      expect(editBlockedReason({ ...base, reps })).not.toBeNull();
      expect(setWithinSanity(reps, base.weightLb)).toBe(false);
    }
    for (const weightLb of [0, 185, EDIT_MAX_WEIGHT_LB]) {
      expect(editBlockedReason({ ...base, weightLb })).toBeNull();
    }
    for (const weightLb of [-1, EDIT_MAX_WEIGHT_LB + 1]) {
      expect(editBlockedReason({ ...base, weightLb })).not.toBeNull();
    }
  });

  it("catches the owner's 165-rep typo before it is queued", () => {
    // The `165,5` paste became a set of 165 reps at 165 lb. The parser drops it
    // and the route rejects it; this is the third place it cannot get through,
    // and the only one that tells the owner before a write is attempted.
    expect(editBlockedReason({ weightLb: 165, reps: 165, rpe: null, kind: "working" }))
      .toBe("165 reps isn’t a set.");
  });

  it("refuses a rep count that is not whole, and an RPE off the scale", () => {
    expect(editBlockedReason({ weightLb: 185, reps: 5.5, rpe: null, kind: "working" }))
      .toBe("A set needs at least one rep.");
    expect(editBlockedReason({ weightLb: 185, reps: 5, rpe: 11, kind: "working" }))
      .toBe("RPE 11 isn’t on the scale.");
    expect(editBlockedReason({ weightLb: 185, reps: 5, rpe: 7.5, kind: "working" }))
      .toBeNull();
  });
});

describe("what the sheet opens with", () => {
  it("shows exactly what the chip shows", () => {
    const set = displaySet({ clientId: "c1", weightLb: 155, reps: 10, rpe: 7, isWarmup: true });
    expect(editFromSet(set)).toEqual({ weightLb: 155, reps: 10, rpe: 7, kind: "warmup" });
  });

  it("reads the impossible both-flags state as failure", () => {
    const set = displaySet({ clientId: "c1", isWarmup: true, toFailure: true });
    expect(editFromSet(set).kind).toBe("failure");
  });

  it("is not dirty before anything is touched", () => {
    const set = displaySet({ clientId: "c1", rpe: 8, toFailure: true });
    expect(editChanged(set, editFromSet(set))).toBe(false);
  });

  it("is dirty on each of the four things it can change", () => {
    const set = displaySet({ clientId: "c1", weightLb: 155, reps: 10, rpe: null });
    const base = editFromSet(set);
    expect(editChanged(set, { ...base, weightLb: 165 })).toBe(true);
    expect(editChanged(set, { ...base, reps: 9 })).toBe(true);
    expect(editChanged(set, { ...base, rpe: 8 })).toBe(true);
    expect(editChanged(set, { ...base, kind: "warmup" })).toBe(true);
  });

  it("ignores a weight difference nobody can see", () => {
    // 20 kg is 44.0924… lb and comes back from the server as whatever
    // `kgToLb(lbToKg(x))` produces. Both render as `44.1`, so treating them as
    // a change would leave the correction looking permanently undelivered.
    const set = displaySet({ clientId: "c1", weightLb: 44.09245243697551 });
    expect(editChanged(set, { ...editFromSet(set), weightLb: 44.0924 })).toBe(false);
    // One display step apart IS a change.
    expect(editChanged(set, { ...editFromSet(set), weightLb: 44.2 })).toBe(true);
  });
});

describe("the write a correction makes", () => {
  const set = displaySet({
    clientId: "c1",
    id: "row-1",
    queued: false,
    weightLb: 155,
    reps: 10,
    felt: "strong",
    loggedAt: "2026-10-25T18:04:00.000Z",
  });
  const edit = { weightLb: 165, reps: 10, rpe: 8, kind: "failure" as const };

  it("lands on the row it is correcting, at the time it was logged", () => {
    const payload = editSetPayload(set, edit, null);
    // Same clientId is the entire mechanism: the route upserts on
    // `(workout_id, client_id)`, so this is an UPDATE and not a second set.
    expect(payload.clientId).toBe("c1");
    // Re-stamping this would record the gap since the ORIGINAL set as the rest
    // before it, putting every later set's rest in the wrong place.
    expect(payload.loggedAt).toBe("2026-10-25T18:04:00.000Z");
    expect(payload.exerciseId).toBe(BENCH);
  });

  it("carries the corrected figures and both kind flags", () => {
    const payload = editSetPayload(set, edit, null);
    expect(payload.weightLb).toBe(165);
    expect(payload.reps).toBe(10);
    expect(payload.rpe).toBe(8);
    // BOTH, always. A patch that set only the flag being turned on is how the
    // card ended up able to show WARMUP and TO FAILURE at the same time.
    expect(payload.toFailure).toBe(true);
    expect(payload.isWarmup).toBe(false);
    expect(payload.felt).toBe("strong");
  });

  it("omits the note and the raw text for a set the server already has", () => {
    // Not an oversight: the row exists, this is an update of it, and the phone
    // does not know what the note says. `POST /api/sets` leaves a field the
    // body omits exactly as it was, so a fix to the weight cannot wipe the
    // sentence the owner dictated. `JSON.stringify` drops undefined, so an
    // absent key really is absent on the wire.
    const payload = editSetPayload(set, edit, null);
    expect("note" in payload).toBe(false);
    expect("rawText" in payload).toBe(false);
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty("note");
  });

  it("carries them forward for a set that is still queued", () => {
    // Here the original write is DROPPED, so this payload is the only one the
    // row will ever be built from. Omitting these would store an empty note
    // and lose what was spoken — silently, and only for sets corrected in a
    // basement.
    const queuedPayload = {
      clientId: "c1",
      exerciseId: BENCH,
      reps: 10,
      weightLb: 155,
      note: "left shoulder pinched",
      rawText: "chest supported row 155 for 10",
    };
    const payload = editSetPayload(set, edit, queuedPayload);
    expect(payload.note).toBe("left shoulder pinched");
    expect(payload.rawText).toBe("chest supported row 155 for 10");
    // The figures are still the corrected ones, not the queued ones.
    expect(payload.weightLb).toBe(165);
  });

  it("does not invent a note from a payload that has none", () => {
    const payload = editSetPayload(set, edit, { clientId: "c1", exerciseId: BENCH });
    expect("note" in payload).toBe(false);
  });
});

describe("the correction overlay", () => {
  const a = displaySet({ clientId: "a", id: "row-a", queued: false, weightLb: 155, reps: 10 });
  const b = displaySet({ clientId: "b", id: "row-b", queued: false, weightLb: 185, reps: 5 });

  it("paints a pending correction over the merged list", () => {
    // This is the only thing standing between a save and a chip that still
    // reads 155 until the queue drains and the session is refetched.
    const edits: SetEdits = { a: { weightLb: 165, reps: 9, rpe: 8, kind: "failure" } };
    const [first, second] = applyEdits([a, b], edits);

    expect(first.weightLb).toBe(165);
    expect(first.reps).toBe(9);
    expect(first.rpe).toBe(8);
    expect(first.toFailure).toBe(true);
    expect(first.isWarmup).toBe(false);
    // Untouched, and the same object — nothing else on the screen re-renders.
    expect(second).toBe(b);
  });

  it("leaves the list alone when there is nothing pending", () => {
    const sets = [a, b];
    expect(applyEdits(sets, {})).toBe(sets);
  });

  it("drops a correction the moment the truth agrees with it", () => {
    const delivered = displaySet({ clientId: "a", id: "row-a", queued: false, weightLb: 165, reps: 9, rpe: 8, toFailure: true });
    const edits: SetEdits = { a: { weightLb: 165, reps: 9, rpe: 8, kind: "failure" } };
    expect(pruneEdits(edits, [delivered, b])).toEqual({});
  });

  it("drops a correction for a set that has been removed", () => {
    const edits: SetEdits = { a: { weightLb: 165, reps: 9, rpe: null, kind: "working" } };
    expect(pruneEdits(edits, [b])).toEqual({});
  });

  it("holds a correction the server has not caught up with", () => {
    // The in-flight case, which is most of the time this exists for.
    const edits: SetEdits = { a: { weightLb: 165, reps: 10, rpe: null, kind: "working" } };
    expect(pruneEdits(edits, [a, b])).toEqual(edits);
  });

  it("returns the same object when nothing was pruned", () => {
    // The screen prunes inside an effect that depends on the merged list, so a
    // new object every time would be a render loop.
    const edits: SetEdits = { a: { weightLb: 165, reps: 10, rpe: null, kind: "working" } };
    expect(pruneEdits(edits, [a, b])).toBe(edits);
    expect(pruneEdits({}, [a, b])).toEqual({});
  });

  it("never pins a lost correction on screen forever", () => {
    // `pruneEdits` drops on evidence and never on a timer, so a write the
    // outbox gives up on ends with the chip back on the figures the server
    // actually holds — the set vanishes from the queue, the refetch brings the
    // old row, and the entry stays only while a correction is genuinely in
    // flight. The one thing it must not do is drop an entry whose set still
    // disagrees, which is the assertion above; the one thing it must do is
    // drop it as soon as the row is gone, which is this.
    const edits: SetEdits = { a: { weightLb: 165, reps: 10, rpe: null, kind: "working" } };
    expect(pruneEdits(edits, [])).toEqual({});
  });
});
