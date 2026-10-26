import { describe, it, expect } from "vitest";
import {
  COUNTDOWN_MS,
  MAX_CUE_LENGTH,
  MAX_PLAUSIBLE_LB,
  MAX_PLAUSIBLE_REPS,
  MAX_RECORD_MS,
  RPE_CHOICES,
  aliasToLearn,
  blankRow,
  blockedReason,
  canConfirm,
  confirmLabel,
  countdownLabel,
  createdExerciseIds,
  cueError,
  cueFor,
  cueQueueId,
  deleteGroup,
  deleteRow,
  duplicateRow,
  elapsedLabel,
  fieldToPad,
  fmtWeight,
  groupRows,
  groupSummary,
  implausible,
  kindPatch,
  leadingWarmups,
  markFirstWarmups,
  meterLevel,
  normaliseCue,
  offendingField,
  padToPatch,
  parseHint,
  patchGroup,
  patchRow,
  payloadsFor,
  refileEntry,
  rowsFromParse,
  shouldQueueCue,
  rpeChoices,
  rpeSummary,
  setKind,
  sourceDoorLabel,
  unmatchedQueries,
  type LogRow,
} from "./model";
import { classifyStatus } from "../../lib/shared/outbox";
import type { ParseResponse } from "../../lib/types";

/**
 * The free-text logging flow's rules.
 *
 * The user asked for one thing by name — that typed updates land in the correct
 * fields — so these tests are about fields: which number goes where, what
 * happens to a set whose exercise did not resolve, what the sheet refuses to
 * log, and what reaches the outbox.
 *
 * Nothing here renders. The sheet is React Native; this is the part that
 * decides what the sheet shows and what it writes, which is the part that can
 * be wrong silently.
 */

const PULLUP = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Weighted Pull-up",
  slug: "weighted-pull-up",
  incrementKg: 2.2679617,
  equipment: "bodyweight",
  confidence: "fuzzy" as const,
};

const BENCH = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Barbell Bench Press",
  slug: "barbell-bench-press",
  incrementKg: 2.2679617,
  equipment: "barbell",
  confidence: "exact" as const,
};

/**
 * A `/api/sets/parse` body, assembled rather than written inline.
 *
 * `rowsFromParse` only reads `entries`, but the cases below carry the real
 * `usedModel` and `unresolved` values too, because a case that says
 * `unresolved: ["zercher thrusters"]` documents which server response it is
 * standing in for. A bare object literal with those extra keys would trip
 * TypeScript's excess-property check, so they go through here.
 */
const response = (
  usedModel: boolean,
  unresolved: string[],
  entries: ParseResponse["entries"],
): ParseResponse => ({ usedModel, unresolved, entries });

/**
 * A response carrying the three fields `lib/types.ts` deliberately does not
 * declare: `confidence: "new"`, an entry-level `nearMiss`, and the parser's
 * `dropped`. They are additive and optional on the wire, and the reader is
 * written to tolerate all three being absent — so a fixture that exercises
 * them has to go around the declared type, which is the point.
 */
const wire = (entries: unknown[]): Pick<ParseResponse, "entries"> =>
  ({ entries } as Pick<ParseResponse, "entries">);

/** The spec's target phrase, as `/api/sets/parse` returns it. */
const SPEC_RESPONSE: ParseResponse = {
  usedModel: true,
  entries: [{
    query: "weighted pull ups",
    exercise: PULLUP,
    sets: Array.from({ length: 3 }, () => ({
      reps: 6, weight_lb: 45, rpe: null, to_failure: false, is_warmup: false,
    })),
  }],
  unresolved: [],
};

describe("rowsFromParse", () => {
  it("turns the spec's phrase into three rows against the pull-up, 45 lb, 6 reps", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.exerciseId).toBe(PULLUP.id);
      expect(row.weightLb).toBe(45);
      expect(row.reps).toBe(6);
      expect(row.match).toBe("fuzzy");
      expect(row.query).toBe("weighted pull ups");
    }
  });

  it("gives every row a unique key and groups rows of one entry under one entryKey", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
    expect(new Set(rows.map((r) => r.entryKey)).size).toBe(1);
  });

  it("separates entries so two exercises never share an entryKey", () => {
    const rows = rowsFromParse(response(false, [], [
        { query: "bench", exercise: BENCH, sets: [{ reps: 5, weight_lb: 185, rpe: 8, to_failure: false, is_warmup: false }] },
        { query: "pull ups", exercise: PULLUP, sets: [{ reps: 6, weight_lb: 45, rpe: null, to_failure: false, is_warmup: false }] },
      ],
    ));

    expect(rows.map((r) => r.entryKey)).toEqual(["e0", "e1"]);
    expect(rows.map((r) => r.exerciseId)).toEqual([BENCH.id, PULLUP.id]);
  });

  it("carries rpe, to_failure and is_warmup through without reinterpreting them", () => {
    const [row] = rowsFromParse(response(false, [], [{
        query: "curls",
        exercise: BENCH,
        sets: [{ reps: 12, weight_lb: 40, rpe: 9.5, to_failure: true, is_warmup: true }],
      }],
    ));

    expect(row).toMatchObject({ rpe: 9.5, toFailure: true, isWarmup: true });
  });

  it("keeps the sets of an unresolved entry rather than dropping them", () => {
    const rows = rowsFromParse(response(true, ["zercher thrusters"], [{
        query: "zercher thrusters",
        exercise: null,
        sets: [{ reps: 8, weight_lb: 95, rpe: null, to_failure: false, is_warmup: false }],
      }],
    ));

    expect(rows).toHaveLength(1);
    expect(rows[0].exerciseId).toBeNull();
    expect(rows[0].match).toBe("none");
    expect(rows[0].weightLb).toBe(95);
  });

  it("produces no rows when the model found nothing set-shaped", () => {
    expect(rowsFromParse({ entries: [] })).toEqual([]);
  });

  /**
   * The kg bug, as the owner saw it: "pec deck 2 sets 20kg for 8" rendered as
   * "44.1 lb". Rounding on the way IN rather than only at render time is what
   * makes the figure they confirm the figure that gets stored.
   */
  it("rounds a converted kg weight to whole pounds on the way in", () => {
    const rows = rowsFromParse(response(false, [], [{
        query: "preacher curls",
        exercise: BENCH,
        sets: [
          { reps: 8, weight_lb: 66.1386, rpe: null, to_failure: false, is_warmup: false },
          { reps: 8, weight_lb: 44.0924, rpe: null, to_failure: false, is_warmup: false },
        ],
      }],
    ));

    expect(rows.map((r) => r.weightLb)).toEqual([66, 44]);
  });

  it("reads confidence 'new' as its own state and keeps the near miss with it", () => {
    const rows = rowsFromParse(wire([{
      query: "preacher curls",
      exercise: { id: "aaa", name: "Preacher Curl", equipment: "machine", confidence: "new" },
      nearMiss: { id: "bbb", name: "Barbell Curl" },
      sets: [{ reps: 8, weight_lb: 66, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].match).toBe("new");
    expect(rows[0].equipment).toBe("machine");
    expect(rows[0].nearMiss).toEqual({ id: "bbb", name: "Barbell Curl" });
  });

  it("drops a near miss on an exact match, where it is a question nobody asked", () => {
    const rows = rowsFromParse(wire([{
      query: "bench",
      exercise: { ...BENCH, confidence: "exact" },
      nearMiss: { id: "bbb", name: "Smith Machine Bench Press" },
      sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].nearMiss).toBeNull();
  });

  it("keeps a near miss on a fuzzy match, which is the likeliest wrong answer", () => {
    const rows = rowsFromParse(wire([{
      query: "incline smith press",
      exercise: { id: "ccc", name: "Incline Barbell Press", equipment: "barbell", confidence: "fuzzy" },
      nearMiss: { id: "ddd", name: "Smith Machine Incline Press" },
      sets: [{ reps: 7, weight_lb: 155, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].match).toBe("fuzzy");
    expect(rows[0].nearMiss?.name).toBe("Smith Machine Incline Press");
  });

  it("carries the parser's dropped chunks so the loss is visible rather than silent", () => {
    const rows = rowsFromParse(wire([{
      query: "bench",
      exercise: { ...BENCH, confidence: "exact" },
      dropped: ["165"],
      sets: [{ reps: 5, weight_lb: 165, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].dropped).toEqual(["165"]);
  });

  it("treats an unknown confidence as exact rather than as something louder", () => {
    // A future `confidence: "alias"` must not make every row in the sheet look
    // suspect. The loud states are the ones that cost the user a decision.
    const rows = rowsFromParse(wire([{
      query: "bench",
      exercise: { ...BENCH, confidence: "alias" },
      sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].match).toBe("exact");
  });

  it("renders no equipment rather than an empty micro-label", () => {
    const rows = rowsFromParse(wire([{
      query: "pec deck",
      exercise: { id: "aaa", name: "Pec Deck", equipment: "", confidence: "new" },
      sets: [{ reps: 8, weight_lb: 44, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(rows[0].equipment).toBeNull();
  });
});

describe("grouping", () => {
  const twoLines = response(false, [], [
    { query: "bench 165x5", exercise: BENCH, sets: [
      { reps: 5, weight_lb: 165, rpe: null, to_failure: false, is_warmup: false },
      { reps: 3, weight_lb: 175, rpe: null, to_failure: false, is_warmup: false },
    ] },
    { query: "pull ups", exercise: PULLUP, sets: [
      { reps: 6, weight_lb: 45, rpe: null, to_failure: false, is_warmup: false },
    ] },
  ]);

  it("makes one group per entry, in the order they were typed", () => {
    const groups = groupRows(rowsFromParse(twoLines));

    expect(groups.map((g) => g.entryKey)).toEqual(["e0", "e1"]);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1]);
    expect(groups[0].exerciseName).toBe(BENCH.name);
    expect(groups[0].equipment).toBe("barbell");
  });

  /**
   * The case that looks like a bug until you hit it. Each line carries its own
   * raw wording, and the wording is the evidence a fuzzy match needs — merged,
   * one `heard:` line would be wrong for half the sets under it.
   */
  it("keeps two entries that resolve to the same exercise as two groups", () => {
    const groups = groupRows(rowsFromParse(response(false, [], [
      { query: "bench", exercise: BENCH, sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }] },
      { query: "bench press burnout", exercise: BENCH, sets: [{ reps: 15, weight_lb: 95, rpe: null, to_failure: true, is_warmup: false }] },
    ])));

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.query)).toEqual(["bench", "bench press burnout"]);
    expect(new Set(groups.map((g) => g.exerciseId)).size).toBe(1);
  });

  it("drops a group whose every set has been deleted", () => {
    const rows = rowsFromParse(twoLines);
    const left = rows.filter((row) => row.entryKey !== "e0");

    expect(groupRows(left).map((g) => g.entryKey)).toEqual(["e1"]);
    expect(groupRows([])).toEqual([]);
  });

  it("deleteGroup removes exactly one entry's sets", () => {
    const rows = rowsFromParse(twoLines);
    expect(deleteGroup(rows, "e0").map((r) => r.entryKey)).toEqual(["e1"]);
    expect(deleteGroup(rows, "nope")).toHaveLength(3);
  });

  it("summarises set count and RPE, and says MIXED rather than picking one", () => {
    const [bench] = groupRows(rowsFromParse(twoLines));
    expect(groupSummary(bench)).toBe("2 SETS · RPE —");

    const all8 = groupRows(patchGroup(rowsFromParse(twoLines), "e0", { rpe: 8 }))[0];
    expect(groupSummary(all8)).toBe("2 SETS · RPE 8");

    const mixed = groupRows(patchRow(all8.rows, all8.rows[1].key, { rpe: 9 }));
    expect(groupSummary(mixed[0])).toBe("2 SETS · RPE MIXED");
  });

  it("singularises one set, and survives an empty row list", () => {
    const [pull] = groupRows(rowsFromParse(twoLines)).slice(1);
    expect(groupSummary(pull)).toBe("1 SET · RPE —");
    expect(rpeSummary([])).toBe("—");
  });

  it("lists the exercises this parse created, once each, so a discard can undo them", () => {
    const rows = rowsFromParse(wire([
      {
        query: "pec deck",
        exercise: { id: "new-1", name: "Pec Deck", equipment: "machine", confidence: "new" },
        sets: [
          { reps: 8, weight_lb: 44, rpe: null, to_failure: false, is_warmup: false },
          { reps: 8, weight_lb: 44, rpe: null, to_failure: false, is_warmup: false },
        ],
      },
      {
        query: "bench",
        exercise: { ...BENCH, confidence: "exact" },
        sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }],
      },
    ]));

    expect(createdExerciseIds(rows)).toEqual(["new-1"]);
    // Re-filed onto something real, there is nothing left to hand back.
    expect(createdExerciseIds(refileEntry(rows, "e0", { id: "real", name: "Pec Deck" }))).toEqual([]);
  });
});

describe("editing rows", () => {
  const rows = rowsFromParse(SPEC_RESPONSE);

  it("duplicating a row inserts the copy immediately after it, with a new key", () => {
    const next = duplicateRow(rows, rows[0].key);

    expect(next).toHaveLength(4);
    expect(next[1]).toMatchObject({ reps: 6, weightLb: 45, exerciseId: PULLUP.id });
    expect(next[1].key).not.toBe(next[0].key);
    expect(new Set(next.map((r) => r.key)).size).toBe(4);
  });

  it("duplicating twice does not collide on the generated key", () => {
    const once = duplicateRow(rows, rows[0].key);
    const twice = duplicateRow(once, rows[0].key);
    expect(new Set(twice.map((r) => r.key)).size).toBe(5);
  });

  it("deleting removes exactly one row", () => {
    const next = deleteRow(rows, rows[1].key);
    expect(next.map((r) => r.key)).toEqual([rows[0].key, rows[2].key]);
  });

  it("patching one row leaves its siblings alone — fixing set 2 is not fixing all three", () => {
    const next = patchRow(rows, rows[1].key, { weightLb: 50, reps: 5 });

    expect(next[1]).toMatchObject({ weightLb: 50, reps: 5 });
    expect(next[0]).toMatchObject({ weightLb: 45, reps: 6 });
    expect(next[2]).toMatchObject({ weightLb: 45, reps: 6 });
  });

  it("does not mutate the array it was given", () => {
    const before = JSON.stringify(rows);
    patchRow(rows, rows[0].key, { reps: 1 });
    duplicateRow(rows, rows[0].key);
    deleteRow(rows, rows[0].key);
    patchGroup(rows, "e0", { rpe: 9 });
    markFirstWarmups(rows, "e0", 2);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("bulk actions on a group", () => {
  const three = rowsFromParse(SPEC_RESPONSE);

  it("applies one patch to every row of the entry and nothing else", () => {
    const mixed = [...three, { ...blankRow({ id: BENCH.id, name: BENCH.name }), entryKey: "e1", key: "other", reps: 5 }];
    const next = patchGroup(mixed, "e0", { rpe: 8 });

    expect(next.filter((r) => r.entryKey === "e0").every((r) => r.rpe === 8)).toBe(true);
    expect(next.find((r) => r.key === "other")?.rpe).toBeNull();
  });

  it("notes every set at once", () => {
    const next = patchGroup(three, "e0", { note: "all felt heavy" });
    expect(next.every((r) => r.note === "all felt heavy")).toBe(true);
  });

  it("marks the first k as warmups and the rest as working sets", () => {
    const next = markFirstWarmups(three, "e0", 2);
    expect(next.map((r) => r.isWarmup)).toEqual([true, true, false]);
    expect(leadingWarmups(next)).toBe(2);
  });

  /**
   * The stepper derives its position from the rows, so this round trip is the
   * whole contract: tapping `+` three times from nothing has to land on three.
   */
  it("round-trips through leadingWarmups at every position", () => {
    for (let k = 0; k <= 3; k += 1) {
      expect(leadingWarmups(markFirstWarmups(three, "e0", k))).toBe(k);
    }
  });

  it("clamps k rather than letting the stepper run off either end", () => {
    expect(leadingWarmups(markFirstWarmups(three, "e0", -5))).toBe(0);
    expect(leadingWarmups(markFirstWarmups(three, "e0", 99))).toBe(3);
  });

  it("clears a stale to-failure flag on the sets it has just called working", () => {
    // The control's claim is "the first k are warmups and the others are not".
    // Leaving an `F` on a row it just called a working set would contradict the
    // thing the user pressed.
    const failed = patchGroup(three, "e0", { toFailure: true });
    const next = markFirstWarmups(failed, "e0", 1);

    expect(next.map((r) => setKind(r))).toEqual(["warmup", "working", "working"]);
  });

  it("does not count a warmup in the middle of an exercise as a leading one", () => {
    const odd = patchRow(three, three[2].key, { isWarmup: true });
    expect(leadingWarmups(odd)).toBe(0);
  });
});

describe("set kind", () => {
  const row = rowsFromParse(SPEC_RESPONSE)[0];

  it("is working by default, and warmup or failure when flagged", () => {
    expect(setKind(row)).toBe("working");
    expect(setKind({ ...row, isWarmup: true })).toBe("warmup");
    expect(setKind({ ...row, toFailure: true })).toBe("failure");
  });

  it("resolves a parse that produced both flags to failure", () => {
    // "warmup set to failure" is not a thing, and failure is the one that
    // matters to progression.
    expect(setKind({ ...row, isWarmup: true, toFailure: true })).toBe("failure");
  });

  it("always writes both flags, so the pair cannot drift apart", () => {
    expect(kindPatch("warmup")).toEqual({ isWarmup: true, toFailure: false });
    expect(kindPatch("working")).toEqual({ isWarmup: false, toFailure: false });
    expect(kindPatch("failure")).toEqual({ isWarmup: false, toFailure: true });
  });

  it("cannot reach warmup-and-failure through the control", () => {
    const both = { ...row, isWarmup: true, toFailure: true };
    const next = { ...both, ...kindPatch(setKind(both)) };
    expect(next).toMatchObject({ isWarmup: false, toFailure: true });
  });
});

describe("the RPE control", () => {
  it("offers no-RPE first and the six legal answers", () => {
    expect(rpeChoices(null)).toEqual([null, 6, 7, 8, 9, 10]);
    expect(rpeChoices(8)).toEqual([...RPE_CHOICES]);
  });

  /**
   * `sets.rpe` is a `real` column and the parser can produce 7.5 from "@7.5".
   * A control that offered only six integers would silently round a value the
   * database was perfectly happy with.
   */
  it("grows a seventh segment for a half step the parser produced, and loses it again", () => {
    expect(rpeChoices(7.5)).toEqual([null, 6, 7, 8, 9, 10, 7.5]);
    expect(rpeChoices(8)).not.toContain(7.5);
  });

  it("survives a round trip through the control unchanged", () => {
    const row = { ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 5, rpe: 7.5 };
    const choices = rpeChoices(row.rpe);
    expect(choices).toContain(7.5);

    const reselected = patchRow([row], row.key, { rpe: 7.5 });
    expect(reselected[0].rpe).toBe(7.5);
    expect(implausible(reselected[0])).toBeNull();
  });
});

describe("the confirm gate", () => {
  it("allows a fully resolved list", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    expect(canConfirm(rows)).toBe(true);
    expect(blockedReason(rows)).toBeNull();
    expect(confirmLabel(rows)).toBe("LOG 3 SETS");
  });

  it("blocks while any row has no exercise, and says which wording is the problem", () => {
    const rows = rowsFromParse(response(true, ["zercher thrusters"], [
        { query: "bench", exercise: BENCH, sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }] },
        { query: "zercher thrusters", exercise: null, sets: [{ reps: 8, weight_lb: 95, rpe: null, to_failure: false, is_warmup: false }] },
      ],
    ));

    expect(canConfirm(rows)).toBe(false);
    expect(blockedReason(rows)).toContain("zercher thrusters");
    expect(unmatchedQueries(rows)).toEqual(["zercher thrusters"]);
  });

  it("does not block a newly created exercise — zero taps for a genuinely new lift", () => {
    const rows = rowsFromParse(wire([{
      query: "pec deck",
      exercise: { id: "new-1", name: "Pec Deck", equipment: "machine", confidence: "new" },
      nearMiss: { id: "bbb", name: "Chest Press" },
      sets: [{ reps: 8, weight_lb: 44, rpe: null, to_failure: false, is_warmup: false }],
    }]));

    expect(canConfirm(rows)).toBe(true);
    expect(blockedReason(rows)).toBeNull();
  });

  it("unblocks once the unmatched entry is re-filed", () => {
    const rows = [{ ...blankRow(), entryKey: "e0", query: "zercher thrusters", reps: 8, weightLb: 95 }];
    expect(canConfirm(rows)).toBe(false);

    const next = refileEntry(rows, "e0", { id: BENCH.id, name: BENCH.name });
    expect(canConfirm(next)).toBe(true);
  });

  it("blocks an empty list and labels the button honestly", () => {
    expect(canConfirm([])).toBe(false);
    expect(confirmLabel([])).toBe("NOTHING TO LOG");
    // Nothing to explain: the sheet is already showing "couldn't parse that".
    expect(blockedReason([])).toBeNull();
  });

  it("blocks a row with no rep count, which is the by-hand starting state", () => {
    const rows = [{ ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 0 }];
    expect(canConfirm(rows)).toBe(false);
    // Its own sentence rather than "fix it or delete it": deleting the one row
    // the user just asked for is not the advice they need.
    expect(blockedReason(rows)).toBe("Every set needs a rep count.");
    expect(confirmLabel(rows)).toBe("NOTHING TO LOG");
  });

  /**
   * The by-hand row opened from a screen that did not know which exercise was
   * under the thumb: no exercise and no wording to quote it with. It used to
   * leave the button disabled with nothing said, because `unmatchedQueries`
   * skips an empty query rather than printing `“”`.
   */
  it("explains an unmatched row that has no wording to name it with", () => {
    const rows = [{ ...blankRow(), reps: 5, weightLb: 95 }];
    expect(unmatchedQueries(rows)).toEqual([]);
    expect(canConfirm(rows)).toBe(false);
    expect(blockedReason(rows)).toBe("Pick an exercise for this set.");
  });

  it("allows a zero-weight set — bodyweight dips are 0 lb, not missing", () => {
    const rows = [{ ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 12, weightLb: 0 }];
    expect(canConfirm(rows)).toBe(true);
    expect(confirmLabel(rows)).toBe("LOG 1 SET");
  });

  it("lists two distinct unmatched wordings once each", () => {
    const rows: LogRow[] = [
      { ...blankRow(), key: "a", entryKey: "e0", query: "thrusters", reps: 5 },
      { ...blankRow(), key: "b", entryKey: "e0", query: "thrusters", reps: 5 },
      { ...blankRow(), key: "c", entryKey: "e1", query: "jefferson curl", reps: 5 },
    ];
    expect(unmatchedQueries(rows)).toEqual(["thrusters", "jefferson curl"]);
  });
});

describe("figures a set cannot have", () => {
  const good = { ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 5, weightLb: 185 };

  /**
   * The owner's `165,5` typo became a set of 165 reps at 165 lb and nothing
   * rejected it. The real repair is in the parser; this is the last place
   * anything can be caught before it is stored forever.
   */
  it("refuses a 165-rep set and blocks the confirm button", () => {
    const row = { ...good, reps: 165, weightLb: 165 };

    expect(implausible(row)).toBe("165 reps isn’t a set.");
    expect(offendingField(row)).toBe("reps");
    expect(canConfirm([row])).toBe(false);
    expect(blockedReason([row])).toBe(
      "One set can’t be logged — 165 reps isn’t a set. Fix it or delete it.",
    );
  });

  it("refuses a weight no one lifts, and an RPE off the scale", () => {
    expect(implausible({ ...good, weightLb: 1800 })).toBe("1800 lb isn’t a lift.");
    expect(offendingField({ ...good, weightLb: 1800 })).toBe("weight");
    expect(implausible({ ...good, rpe: 11 })).toBe("RPE 11 isn’t on the scale.");
    expect(offendingField({ ...good, rpe: 11 })).toBe("rpe");
    expect(implausible({ ...good, rpe: 0 })).not.toBeNull();
  });

  /**
   * Looser than the parser's ceilings on purpose: the parser is deciding
   * whether to believe text, this is deciding whether to refuse something the
   * user can see on screen and has had the chance to edit.
   */
  it("allows the heaviest and highest real sets", () => {
    expect(implausible({ ...good, reps: MAX_PLAUSIBLE_REPS })).toBeNull();
    expect(implausible({ ...good, weightLb: MAX_PLAUSIBLE_LB })).toBeNull();
    expect(implausible({ ...good, rpe: 10 })).toBeNull();
    expect(implausible({ ...good, rpe: 7.5 })).toBeNull();
    // A hack squat at 1,000 lb and 40 reps of band pull-aparts are both real.
    expect(implausible({ ...good, weightLb: 1000, reps: 40 })).toBeNull();
  });

  it("counts only the loggable sets on the button, so the number is the one you get", () => {
    const rows = [good, { ...good, key: "bogus", reps: 165 }, { ...good, key: "third" }];
    expect(confirmLabel(rows)).toBe("LOG 2 SETS");
    expect(canConfirm(deleteRow(rows, "bogus"))).toBe(true);
  });
});

describe("payloadsFor", () => {
  it("writes one item per row, each with its own client id", () => {
    let n = 0;
    const rows = rowsFromParse(SPEC_RESPONSE);
    const payloads = payloadsFor(rows, "did 3 sets weighted pull ups 45lbs for 6 reps", () => `id-${n++}`);

    expect(payloads).toHaveLength(3);
    expect(payloads.map((p) => p.clientId)).toEqual(["id-0", "id-1", "id-2"]);
    expect(new Set(payloads.map((p) => p.clientId)).size).toBe(3);
  });

  it("maps every field to the name POST /api/sets expects", () => {
    const rows = rowsFromParse(response(false, [], [{
        query: "curls",
        exercise: BENCH,
        sets: [{ reps: 12, weight_lb: 40, rpe: 9, to_failure: true, is_warmup: true }],
      }],
    ));

    expect(payloadsFor(rows, "curls 40x12 @9 to failure", () => "cid")[0]).toEqual({
      clientId: "cid",
      exerciseId: BENCH.id,
      reps: 12,
      weightLb: 40,
      rpe: 9,
      toFailure: true,
      isWarmup: true,
      felt: null,
      note: "",
      rawText: "curls 40x12 @9 to failure",
    });
  });

  it("carries a per-set note through to the write", () => {
    const rows = patchRow(rowsFromParse(SPEC_RESPONSE), "e0-s1", { note: "left elbow" });
    const notes = payloadsFor(rows, "x", () => "cid").map((p) => p.note);
    expect(notes).toEqual(["", "left elbow", ""]);
  });

  it("puts the whole original input on every row's rawText", () => {
    const text = "did 3 sets weighted pull ups 45lbs for 6 reps";
    const payloads = payloadsFor(rowsFromParse(SPEC_RESPONSE), text, () => "cid");
    expect(payloads.every((p) => p.rawText === text)).toBe(true);
  });

  it("mints real uuids by default, because sets.client_id is a uuid column", () => {
    const [payload] = payloadsFor([{ ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 5 }], "x");
    expect(payload.clientId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe("re-filing a mis-resolved exercise", () => {
  it("moves every row of the entry, not just the one that was tapped", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    const next = refileEntry(rows, rows[0].entryKey, { id: BENCH.id, name: BENCH.name });

    expect(next).toHaveLength(3);
    expect(next.every((r) => r.exerciseId === BENCH.id)).toBe(true);
    expect(next.every((r) => r.match === "exact")).toBe(true);
    // The question has been answered; neither the `~` nor the near miss has
    // anything left to ask.
    expect(next.every((r) => r.nearMiss === null)).toBe(true);
  });

  it("leaves other entries untouched", () => {
    const rows = rowsFromParse(response(false, [], [
        { query: "bench", exercise: BENCH, sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }] },
        { query: "pull ups", exercise: null, sets: [{ reps: 6, weight_lb: 45, rpe: null, to_failure: false, is_warmup: false }] },
      ],
    ));

    const next = refileEntry(rows, "e1", { id: PULLUP.id, name: PULLUP.name });
    expect(next[0].exerciseId).toBe(BENCH.id);
    expect(next[1].exerciseId).toBe(PULLUP.id);
  });

  it("takes the chosen exercise's equipment, which is what the header is for", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    const next = refileEntry(rows, "e0", { id: "smith", name: "Smith Machine Incline Press", equipment: "machine" });
    expect(next[0].equipment).toBe("machine");
  });

  it("keeps the raw query so the alias can be learned and the evidence survives", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    const next = refileEntry(rows, "e0", { id: BENCH.id, name: BENCH.name });
    expect(next[0].query).toBe("weighted pull ups");
  });

  it("offers the raw wording as an alias to learn", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    expect(aliasToLearn(rows, "e0", { id: BENCH.id, name: BENCH.name }))
      .toEqual({ exerciseId: BENCH.id, alias: "weighted pull ups" });
  });

  it("learns nothing when the wording is already the canonical name", () => {
    const rows = rowsFromParse(response(false, [], [{
        query: "Barbell Bench Press",
        exercise: null,
        sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }],
      }],
    ));

    expect(aliasToLearn(rows, "e0", { id: BENCH.id, name: BENCH.name })).toBeNull();
  });

  it("learns nothing for a by-hand row, which has no wording", () => {
    expect(aliasToLearn([blankRow()], "manual", { id: BENCH.id, name: BENCH.name })).toBeNull();
  });

  it("refuses an alias the server would reject at 80 characters", () => {
    const rows = [{ ...blankRow(), entryKey: "e0", query: "x".repeat(81) }];
    expect(aliasToLearn(rows, "e0", { id: BENCH.id, name: BENCH.name })).toBeNull();
  });
});

describe("number entry", () => {
  const row = rowsFromParse(SPEC_RESPONSE)[0];

  it("shows the current value on the pad", () => {
    expect(fieldToPad(row, "weight")).toBe("45");
    expect(fieldToPad(row, "reps")).toBe("6");
  });

  /**
   * Whole pounds, in and out. The half-pound is a deliberate loss: display is
   * always lb and always whole, and a figure with a phantom `.1` tail reads as
   * a bug on every row forever. Storage stays kg.
   */
  it("rounds a weight to a whole pound and never below zero", () => {
    expect(padToPatch("weight", "227.5")).toEqual({ weightLb: 228 });
    expect(padToPatch("weight", "66.1")).toEqual({ weightLb: 66 });
    expect(padToPatch("weight", "")).toEqual({ weightLb: 0 });
  });

  it("keeps reps a whole number", () => {
    expect(padToPatch("reps", "8")).toEqual({ reps: 8 });
    expect(padToPatch("reps", "8.6")).toEqual({ reps: 9 });
  });

  it("ignores a value that is not a number at all", () => {
    expect(padToPatch("weight", "..")).toEqual({});
  });

  it("round-trips a value through the pad unchanged", () => {
    const edited = patchRow([row], row.key, padToPatch("weight", fieldToPad(row, "weight")));
    expect(edited[0].weightLb).toBe(45);
  });
});

describe("what a figure looks like", () => {
  it("prints whole pounds, with no decimal tail to read as a bug", () => {
    expect(fmtWeight(185)).toBe("185");
    expect(fmtWeight(227.5)).toBe("228");
    expect(fmtWeight(66.1386)).toBe("66");
    expect(fmtWeight(44.0924)).toBe("44");
    expect(fmtWeight(0)).toBe("0");
  });
});

/**
 * The owner's exact paste, as the server returns it.
 *
 *     today did bench 165x5, 165,5, 175x3, 155x7
 *     incline smith press 3 sets 155x7
 *     pec deck 2 sets 20kg for 8
 *
 *     preacher curls 3 sets 30kgx8
 *     cable rope hammer curls 3 sets 20kgx8
 *
 * Fifteen sets across five exercises — the layout this sheet is designed for,
 * and the one that produced fifteen identical cards. The bench line carries the
 * 165-rep set the old parser invented from the `165,5` typo: the parser now
 * drops that chunk, and this fixture deliberately keeps a server that does not,
 * because the sheet has to be the thing that refuses to store it.
 */
const OWNERS_PASTE = wire([
  {
    query: "bench",
    exercise: { ...BENCH, confidence: "exact" },
    sets: [
      { reps: 5, weight_lb: 165, rpe: null, to_failure: false, is_warmup: false },
      { reps: 165, weight_lb: 165, rpe: null, to_failure: false, is_warmup: false },
      { reps: 3, weight_lb: 175, rpe: null, to_failure: false, is_warmup: false },
      { reps: 7, weight_lb: 155, rpe: null, to_failure: false, is_warmup: false },
    ],
  },
  {
    query: "incline smith press",
    exercise: { id: "e-incline-bb", name: "Incline Barbell Press", equipment: "barbell", confidence: "fuzzy" },
    nearMiss: { id: "e-incline-smith", name: "Smith Machine Incline Press" },
    sets: Array.from({ length: 3 }, () => ({
      reps: 7, weight_lb: 155, rpe: null, to_failure: false, is_warmup: false,
    })),
  },
  {
    query: "pec deck",
    exercise: { id: "e-pec-deck", name: "Pec Deck", equipment: "machine", confidence: "new" },
    sets: Array.from({ length: 2 }, () => ({
      reps: 8, weight_lb: 44.0924, rpe: null, to_failure: false, is_warmup: false,
    })),
  },
  {
    query: "preacher curls",
    exercise: { id: "e-preacher", name: "Preacher Curl", equipment: "machine", confidence: "new" },
    sets: Array.from({ length: 3 }, () => ({
      reps: 8, weight_lb: 66.1386, rpe: null, to_failure: false, is_warmup: false,
    })),
  },
  {
    query: "cable rope hammer curls",
    exercise: { id: "e-cable-hammer", name: "Cable Hammer Curl", equipment: "cable", confidence: "new" },
    sets: Array.from({ length: 3 }, () => ({
      reps: 8, weight_lb: 44.0924, rpe: null, to_failure: false, is_warmup: false,
    })),
  },
]);

describe("the owner's five-line paste", () => {
  const rows = rowsFromParse(OWNERS_PASTE);

  it("is fifteen sets in five groups, one of which cannot be logged", () => {
    expect(rows).toHaveLength(15);

    const groups = groupRows(rows);
    expect(groups).toHaveLength(5);
    expect(rows.filter((r) => implausible(r) === null)).toHaveLength(14);
    expect(rows.filter((r) => implausible(r) !== null)).toHaveLength(1);
  });

  /** The shape of the whole sheet, in one assertion. */
  it("groups exactly as the sheet draws them", () => {
    expect(
      groupRows(rows).map((g) => ({
        query: g.query,
        name: g.exerciseName,
        equipment: g.equipment,
        match: g.match,
        nearMiss: g.nearMiss?.name ?? null,
        sets: g.rows.length,
        blocked: g.rows.filter((r) => implausible(r) !== null).length,
      })),
    ).toEqual([
      {
        query: "bench",
        name: "Barbell Bench Press",
        equipment: "barbell",
        match: "exact",
        nearMiss: null,
        sets: 4,
        blocked: 1,
      },
      {
        query: "incline smith press",
        name: "Incline Barbell Press",
        equipment: "barbell",
        match: "fuzzy",
        nearMiss: "Smith Machine Incline Press",
        sets: 3,
        blocked: 0,
      },
      {
        query: "pec deck",
        name: "Pec Deck",
        equipment: "machine",
        match: "new",
        nearMiss: null,
        sets: 2,
        blocked: 0,
      },
      {
        query: "preacher curls",
        name: "Preacher Curl",
        equipment: "machine",
        match: "new",
        nearMiss: null,
        sets: 3,
        blocked: 0,
      },
      {
        query: "cable rope hammer curls",
        name: "Cable Hammer Curl",
        equipment: "cable",
        match: "new",
        nearMiss: null,
        sets: 3,
        blocked: 0,
      },
    ]);
  });

  it("shows the kg sets as whole pounds, not 66.1 and 44.1", () => {
    const weights = new Set(rows.slice(7).map((r) => r.weightLb));
    expect([...weights].sort((a, b) => a - b)).toEqual([44, 66]);
  });

  it("blocks the confirm button and names the one set in the way", () => {
    expect(canConfirm(rows)).toBe(false);
    expect(blockedReason(rows)).toContain("165 reps isn’t a set.");
    expect(confirmLabel(rows)).toBe("LOG 14 SETS");
  });

  it("confirms once the bogus set is deleted, which is one tap", () => {
    const bogus = rows.find((r) => r.reps === 165) as LogRow;
    const next = deleteRow(rows, bogus.key);

    expect(canConfirm(next)).toBe(true);
    expect(confirmLabel(next)).toBe("LOG 14 SETS");
    expect(groupRows(next)).toHaveLength(5);
    expect(groupSummary(groupRows(next)[0])).toBe("3 SETS · RPE —");
  });

  it("loses a whole group when its sets all go, and keeps the rest in order", () => {
    const left = deleteGroup(rows, "e0");
    expect(groupRows(left).map((g) => g.query)).toEqual([
      "incline smith press",
      "pec deck",
      "preacher curls",
      "cable rope hammer curls",
    ]);
  });

  it("offers the three created exercises back if the sheet is discarded", () => {
    expect(createdExerciseIds(rows)).toEqual(["e-pec-deck", "e-preacher", "e-cable-hammer"]);
  });

  it("takes RPE 8 across one exercise in one action", () => {
    const next = patchGroup(rows, "e3", { rpe: 8 });
    expect(groupSummary(groupRows(next)[3])).toBe("3 SETS · RPE 8");
    expect(groupSummary(groupRows(next)[4])).toBe("3 SETS · RPE —");
  });
});

describe("the recording readout", () => {
  it("counts up in m:ss", () => {
    expect(elapsedLabel(0)).toBe("0:00");
    expect(elapsedLabel(4_300)).toBe("0:04");
    expect(elapsedLabel(65_000)).toBe("1:05");
  });

  it("shows no countdown until the last five seconds", () => {
    expect(countdownLabel(0)).toBeNull();
    expect(countdownLabel(MAX_RECORD_MS - COUNTDOWN_MS - 1)).toBeNull();
  });

  it("counts down over the last five seconds and never goes negative", () => {
    expect(countdownLabel(MAX_RECORD_MS - 5_000)).toBe("5s");
    expect(countdownLabel(MAX_RECORD_MS - 1_200)).toBe("2s");
    expect(countdownLabel(MAX_RECORD_MS)).toBe("0s");
    expect(countdownLabel(MAX_RECORD_MS + 4_000)).toBe("0s");
  });

  it("lights no bars before the first metering reading, rather than guessing", () => {
    expect(meterLevel(undefined, 5)).toBe(0);
    expect(meterLevel(Number.NaN, 5)).toBe(0);
  });

  it("lights nothing for a quiet room and everything for a voice at the mic", () => {
    expect(meterLevel(-160, 5)).toBe(0);
    expect(meterLevel(-45, 5)).toBe(0);
    expect(meterLevel(-5, 5)).toBe(5);
    expect(meterLevel(0, 5)).toBe(5);
  });

  it("rises monotonically through the speaking range", () => {
    const levels = [-45, -35, -25, -15, -5].map((db) => meterLevel(db, 5));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBeGreaterThan(2);
  });
});

describe("what read this", () => {
  it("names the door, and the whole line is the tap target", () => {
    expect(sourceDoorLabel("typed")).toBe("TYPED · TAP TO FIX");
    expect(sourceDoorLabel("heard")).toBe("HEARD · TAP TO FIX");
  });

  /**
   * The owner's complaint, as a test.
   *
   * `usedModel` is one boolean for the whole paste and it is true when the
   * deterministic parser left ANY line over. The old copy said "READ BY THE
   * MODEL", which claims every row came from the model — so a five-line paste
   * whose four set lines parsed character for character got stamped as
   * modelled because of the fifth. The replacement claims only what the flag
   * supports: the model read the lines the parser could not. That sentence is
   * true for one line of five and still true when the parser managed none of
   * them, which is the property that makes it safe to print off a boolean.
   */
  it("never claims a model read more than the lines the parser could not", () => {
    expect(parseHint("typed", true)).toBe("A MODEL READ THE LINES THE PARSER COULDN’T");
    expect(parseHint("typed", true)).not.toMatch(/READ BY THE MODEL/);
  });

  it("says no model was involved, not that the network was not", () => {
    // The parse is POST /api/sets/parse either way, so "READ WITHOUT THE
    // NETWORK" was false on every paste it was ever printed on.
    const hint = parseHint("typed", false);
    expect(hint).toBe("NO MODEL · THE PARSER READ EVERY LINE");
    expect(hint).not.toMatch(/NETWORK/);
  });

  it("owns up to the transcription on the mic path, which is always a model", () => {
    // The old copy could print "READ WITHOUT THE NETWORK" under a transcript a
    // model had just produced from audio that was uploaded to it.
    expect(parseHint("heard", false)).toBe("A MODEL HEARD IT · THE PARSER READ EVERY SET");
    expect(parseHint("heard", true)).toBe(
      "A MODEL HEARD IT AND READ THE LINES THE PARSER COULDN’T",
    );
  });

  it("mentions a model in every case where one touched the payload", () => {
    for (const usedModel of [true, false]) {
      expect(parseHint("heard", usedModel)).toMatch(/MODEL/);
    }
    expect(parseHint("typed", true)).toMatch(/A MODEL READ/);
  });
});

describe("the carry-forward cue", () => {
  const BENCH_ID = BENCH.id;

  it("finds the cue for a resolved lift and nothing for one with none", () => {
    expect(cueFor(BENCH_ID, { [BENCH_ID]: "Elbows tucked" })).toBe("Elbows tucked");
    expect(cueFor(BENCH_ID, {})).toBeNull();
  });

  it("reads a server that predates the field as no cues rather than crashing", () => {
    expect(cueFor(BENCH_ID, undefined)).toBeNull();
  });

  it("has nothing to look up for an unresolved or by-hand group", () => {
    expect(cueFor(null, { [BENCH_ID]: "Elbows tucked" })).toBeNull();
  });

  /*
   * These four mirror `normaliseCue` in `src/lib/cues.ts`. They exist on the
   * phone only so the length check measures the string the SERVER will
   * measure; if the two implementations ever drift, these are what catches it.
   */
  it("keeps the line breaks that separate two cues on one lift", () => {
    expect(normaliseCue("Elbows tucked\nPause on chest")).toBe("Elbows tucked\nPause on chest");
  });

  it("trims the ends, normalises CRLF and strips trailing spaces per line", () => {
    expect(normaliseCue("  Elbows tucked  \r\nPause on chest   \r\n  ")).toBe(
      "Elbows tucked\nPause on chest",
    );
  });

  it("collapses a run of blank lines to one blank line", () => {
    expect(normaliseCue("Elbows tucked\n\n\n\nPause")).toBe("Elbows tucked\n\nPause");
  });

  it("reports an all-whitespace cue as empty, which is the request to clear it", () => {
    expect(normaliseCue("   \n\n  \t ")).toBe("");
  });

  it("accepts a cue at exactly the ceiling and refuses the next character", () => {
    expect(cueError("x".repeat(MAX_CUE_LENGTH))).toBeNull();
    expect(cueError("x".repeat(MAX_CUE_LENGTH + 1))).toMatch(/241 characters/);
    expect(cueError("x".repeat(MAX_CUE_LENGTH + 1))).toMatch(/240 or fewer/);
  });

  /**
   * The reason this check normalises before counting rather than measuring the
   * raw draft. A 240-character cue with a trailing newline is 241 raw and 240
   * stored, so a raw check would refuse something the server stores happily —
   * and the mirror image, a draft that normalises LONGER, cannot happen.
   */
  it("measures the cue the server will store, not the draft as typed", () => {
    expect(cueError(`${"x".repeat(MAX_CUE_LENGTH)}\n\n   `)).toBeNull();
  });

  it("raises nothing for an empty cue, which is a legal clear rather than an error", () => {
    expect(cueError("")).toBeNull();
    expect(cueError("   ")).toBeNull();
  });

  /**
   * Queueing a cue that the network, not the cue, is the problem with.
   *
   * The rule being pinned is not "queue on failure" — it is that the phone and
   * the outbox classify a failure the SAME way. A cue accepted on screen and
   * then dropped in the background by `flush()` would be the one outcome worse
   * than refusing it outright, because the owner would have been told it saved.
   */
  describe("deciding whether a failed cue is worth queueing", () => {
    it("queues a dead connection, which is the basement this exists for", () => {
      // `ApiError` uses status 0 for a network failure and a timeout.
      expect(shouldQueueCue(0)).toBe(true);
    });

    it("queues a server fault, which says nothing about the words", () => {
      expect(shouldQueueCue(500)).toBe(true);
      expect(shouldQueueCue(503)).toBe(true);
    });

    it("queues an expired session, because the cue is valid and will deliver", () => {
      expect(shouldQueueCue(401)).toBe(true);
    });

    it("does NOT queue a cue the server refused on its merits", () => {
      // Past the ceiling, and a lift this account cannot see. Both will be
      // just as invalid in ten minutes, so the editor stays open instead.
      expect(shouldQueueCue(400)).toBe(false);
      expect(shouldQueueCue(404)).toBe(false);
    });

    it("agrees with the outbox about every status, which is the actual contract", () => {
      for (const status of [0, 200, 400, 401, 403, 404, 408, 429, 500, 503]) {
        expect(shouldQueueCue(status)).toBe(classifyStatus(status) === "retry");
      }
    });
  });

  describe("the queued cue's identity", () => {
    it("is derived from the lift, so a second edit replaces the queued one", () => {
      // `enqueue` keys the queue on this and the store's put is an upsert, so
      // three edits in a basement leave ONE queued write carrying the last of
      // them — not three deliveries of a cue that was wrong twice.
      expect(cueQueueId(BENCH_ID)).toBe(cueQueueId(BENCH_ID));
      expect(cueQueueId(BENCH_ID)).not.toBe(cueQueueId("other-id"));
    });

    it("cannot collide with a set, whose outbox id is its uuid client id", () => {
      expect(cueQueueId(BENCH_ID)).toContain(BENCH_ID);
      expect(cueQueueId(BENCH_ID).startsWith("cue-")).toBe(true);
    });
  });
});
