import { describe, it, expect } from "vitest";
import {
  COUNTDOWN_MS,
  MAX_RECORD_MS,
  aliasToLearn,
  blankRow,
  blockedReason,
  canConfirm,
  confirmLabel,
  countdownLabel,
  deleteRow,
  duplicateRow,
  elapsedLabel,
  exerciseChip,
  fieldToPad,
  fmtWeight,
  heardLine,
  meterLevel,
  padToPatch,
  patchRow,
  payloadsFor,
  refileEntry,
  rowsFromParse,
  unmatchedQueries,
  type LogRow,
} from "./model";
import type { ParseResponse } from "../../lib/types";

/**
 * The free-text logging flow's rules.
 *
 * The user asked for one thing by name — that typed updates land in the correct
 * fields — so these tests are about fields: which number goes where, what
 * happens to a set whose exercise did not resolve, and what reaches the outbox.
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
      expect(row.confidence).toBe("fuzzy");
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
    expect(rows[0].confidence).toBeNull();
    expect(rows[0].weightLb).toBe(95);
  });

  it("produces no rows when the model found nothing set-shaped", () => {
    expect(rowsFromParse({ entries: [] })).toEqual([]);
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
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("re-filing a mis-resolved exercise", () => {
  it("moves every row of the entry, not just the one that was tapped", () => {
    const rows = rowsFromParse(SPEC_RESPONSE);
    const next = refileEntry(rows, rows[0].entryKey, { id: BENCH.id, name: BENCH.name });

    expect(next).toHaveLength(3);
    expect(next.every((r) => r.exerciseId === BENCH.id)).toBe(true);
    expect(next.every((r) => r.confidence === "exact")).toBe(true);
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
    expect(blockedReason(rows)).toBe("Every set needs a rep count.");
  });

  it("allows a zero-weight set — bodyweight dips are 0 lb, not missing", () => {
    const rows = [{ ...blankRow({ id: BENCH.id, name: BENCH.name }), reps: 12, weightLb: 0 }];
    expect(canConfirm(rows)).toBe(true);
  });

  it("singularises the label for one set", () => {
    expect(confirmLabel([blankRow()])).toBe("LOG 1 SET");
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
        sets: [{ reps: 12, weight_lb: 40.5, rpe: 9, to_failure: true, is_warmup: true }],
      }],
    ));

    expect(payloadsFor(rows, "curls 40.5x12 @9 to failure", () => "cid")[0]).toEqual({
      clientId: "cid",
      exerciseId: BENCH.id,
      reps: 12,
      weightLb: 40.5,
      rpe: 9,
      toFailure: true,
      isWarmup: true,
      felt: null,
      note: "",
      rawText: "curls 40.5x12 @9 to failure",
    });
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

describe("number entry", () => {
  const row = rowsFromParse(SPEC_RESPONSE)[0];

  it("shows the current value on the pad", () => {
    expect(fieldToPad(row, "weight")).toBe("45");
    expect(fieldToPad(row, "reps")).toBe("6");
  });

  it("shows an unset rpe as untouched rather than as zero", () => {
    expect(fieldToPad(row, "rpe")).toBe("");
  });

  it("rounds a weight to one decimal and never below zero", () => {
    expect(padToPatch("weight", "227.55")).toEqual({ weightLb: 227.6 });
    expect(padToPatch("weight", "")).toEqual({ weightLb: 0 });
  });

  it("keeps reps a whole number", () => {
    expect(padToPatch("reps", "8")).toEqual({ reps: 8 });
    expect(padToPatch("reps", "8.6")).toEqual({ reps: 9 });
  });

  it("clamps rpe into the 1–10 the schema and the column allow", () => {
    expect(padToPatch("rpe", "8")).toEqual({ rpe: 8 });
    expect(padToPatch("rpe", "8.5")).toEqual({ rpe: 8.5 });
    expect(padToPatch("rpe", "99")).toEqual({ rpe: 10 });
    expect(padToPatch("rpe", "0")).toEqual({ rpe: 1 });
  });

  it("clears rpe when the pad is emptied", () => {
    expect(padToPatch("rpe", "")).toEqual({ rpe: null });
  });

  it("round-trips a value through the pad unchanged", () => {
    const edited = patchRow([row], row.key, padToPatch("weight", fieldToPad(row, "weight")));
    expect(edited[0].weightLb).toBe(45);
  });
});

describe("what the row shows", () => {
  it("prints a weight without a decimal tail", () => {
    expect(fmtWeight(185)).toBe("185");
    expect(fmtWeight(227.5)).toBe("227.5");
    expect(fmtWeight(0)).toBe("0");
  });

  it("marks a fuzzy match with ~ and prints what was heard under it", () => {
    const [row] = rowsFromParse(SPEC_RESPONSE);
    expect(exerciseChip(row)).toEqual({ text: "~ Weighted Pull-up", tone: "fuzzy" });
    expect(heardLine(row)).toBe("heard: “weighted pull ups”");
  });

  it("shows an exact match plainly, with nothing to second-guess", () => {
    const [row] = rowsFromParse(response(false, [], [{ query: "bench", exercise: BENCH, sets: [{ reps: 5, weight_lb: 185, rpe: null, to_failure: false, is_warmup: false }] }],
    ));

    expect(exerciseChip(row)).toEqual({ text: "Barbell Bench Press", tone: "ok" });
    expect(heardLine(row)).toBeNull();
  });

  it("shows an unmatched row as UNMATCHED with the wording that failed", () => {
    const [row] = rowsFromParse(response(true, ["zercher thrusters"], [{ query: "zercher thrusters", exercise: null, sets: [{ reps: 8, weight_lb: 95, rpe: null, to_failure: false, is_warmup: false }] }],
    ));

    expect(exerciseChip(row)).toEqual({ text: "UNMATCHED: “zercher thrusters”", tone: "bad" });
  });

  it("drops the heard line when a fuzzy match is only a case difference", () => {
    const row = { ...blankRow(), query: "barbell bench press", exerciseId: BENCH.id, exerciseName: BENCH.name, confidence: "fuzzy" as const };
    expect(heardLine(row)).toBeNull();
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
