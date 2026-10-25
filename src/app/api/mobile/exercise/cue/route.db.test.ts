import "../../../../../../load-env";
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

/**
 * `POST /api/mobile/exercise/cue`, end to end, against a real Postgres — and
 * the one thing neither side's own tests can see: whether the phone and the
 * server still agree about what a cue *is*.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The cue feature was built as two halves by two people. `src/lib/cues.ts` has
 * thorough database tests (`src/lib/cues.db.test.ts`) and the phone's helpers
 * have thorough unit tests (`mobile/features/voice/model.test.ts`). Both were
 * green while the SEAM between them was never once exercised: nothing ran the
 * route, so nothing checked that the JSON the client's `saveCue` posts is the
 * JSON the handler reads, that the handler's return value has the field names
 * `CueResponse` declares, or that a cue written through the route is the cue
 * `bootstrap` later hands back. A contract verified only at its two ends is
 * not verified.
 *
 * So the four things under test here are all crossings, not units:
 *
 *  1. the REQUEST shape — `CueWrite` in `mobile/lib/types.ts` posted as-is,
 *     reaching the handler's `Body`;
 *  2. the RESPONSE shape — exactly `{ exerciseId, cue }`, because the phone
 *     renders `response.cue` rather than its own draft, so a renamed or
 *     missing field silently blanks the cue it just saved;
 *  3. the READ-BACK — the same string arriving through `getCues()` (which is
 *     what `bootstrap` sends as `cues`) and through `GET exercise?id=`, which
 *     are the only two ways the cue ever reaches the device;
 *  4. the MIRROR — `normaliseCue` is duplicated on the phone on purpose, and
 *     the duplicate is load-bearing: the length ceiling is applied AFTER
 *     normalisation, so if the two drift the inline character counter and the
 *     server's 400 start disagreeing about the same draft.
 *
 * The real database rather than a mock, because the CHECK constraint in
 * drizzle/0005 is a third party to this agreement and has its own opinion
 * about what may be stored. Only `currentUserId` is stubbed; `withUser`, RLS
 * and the constraint are all live.
 *
 * Skipped, not failed, without a DATABASE_URL.
 */

const A = "aaaaaaaa-0000-4000-8000-00000000c0e1";
const B = "bbbbbbbb-0000-4000-8000-00000000c0e2";

let currentUser: string | null = A;

vi.mock("@/lib/supabase/server", () => ({
  currentUserId: async () => currentUser,
}));

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("the cue route, end to end", () => {
  let POST: (req: Request) => Promise<Response>;
  let exerciseGET: (req: Request) => Promise<Response>;
  let cues: typeof import("@/lib/cues");
  let exerciseLib: typeof import("@/lib/exercises");
  let dbm: typeof import("@/db");
  let schema: typeof import("@/db/schema");
  let orm: typeof import("drizzle-orm");

  /** A catalogue lift, and a lift belonging to the other account. */
  let bench: string;
  let theirs: string;

  beforeAll(async () => {
    ({ POST } = await import("./route"));
    ({ GET: exerciseGET } = await import("../route"));
    cues = await import("@/lib/cues");
    exerciseLib = await import("@/lib/exercises");
    dbm = await import("@/db");
    schema = await import("@/db/schema");
    orm = await import("drizzle-orm");

    await cleanup();
    await dbm.adminDb.insert(schema.profiles).values([
      { id: A, email: "a@cue-route.test" },
      { id: B, email: "b@cue-route.test" },
    ]);

    const [row] = await dbm.adminDb.select({ id: schema.exercises.id })
      .from(schema.exercises)
      .where(orm.and(
        orm.isNull(schema.exercises.userId),
        orm.eq(schema.exercises.slug, "barbell-bench-press"),
      ));
    expect(row?.id).toBeTruthy();
    bench = row.id;

    theirs = (await dbm.withUser(B, () => exerciseLib.createUserExercise("snorgle row", B))).id;
  });

  afterAll(async () => {
    await cleanup().catch(() => {});
  });

  beforeEach(async () => {
    currentUser = A;
    await dbm.adminDb.delete(schema.exerciseCues)
      .where(orm.inArray(schema.exerciseCues.userId, [A, B]));
  });

  async function cleanup() {
    if (!dbm) return;
    await dbm.adminDb.delete(schema.profiles)
      .where(orm.inArray(schema.profiles.id, [A, B]));
  }

  /** Exactly what `saveCue` in `mobile/features/voice/requests.ts` sends. */
  function post(body: unknown): Promise<Response> {
    return POST(new Request("http://t/api/mobile/exercise/cue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  // ------------------------------------------------------- the happy crossing

  it("returns the two fields `CueResponse` declares, and nothing else", async () => {
    const res = await post({ exerciseId: bench, cue: "Elbows tucked, pause on chest" });
    expect(res.status).toBe(200);

    const json = await res.json();
    // The phone renders `response.cue`, so the field NAMES are the contract —
    // a rename here blanks the cue the owner just typed, with no error.
    expect(json).toEqual({ exerciseId: bench, cue: "Elbows tucked, pause on chest" });
    expect(Object.keys(json).sort()).toEqual(["cue", "exerciseId"]);
  });

  it("hands the same string back through the map bootstrap sends", async () => {
    await post({ exerciseId: bench, cue: "Elbows tucked, pause on chest" });

    // `getCues` is what `GET /api/mobile/bootstrap` puts in `cues`, and
    // `cueFor()` on the phone indexes it by exercise id.
    const map = await dbm.withUser(A, () => cues.getCues(A));
    expect(map[bench]).toBe("Elbows tucked, pause on chest");
  });

  it("hands the same string back on the exercise detail read", async () => {
    await post({ exerciseId: bench, cue: "Elbows tucked, pause on chest" });

    const res = await exerciseGET(new Request(`http://t/api/mobile/exercise?id=${bench}`));
    expect(res.status).toBe(200);
    const json = await res.json() as { cue: string | null };
    expect(json.cue).toBe("Elbows tucked, pause on chest");
  });

  it("echoes the cue AS STORED, not the text that was sent", async () => {
    // Trailing blank lines and trailing spaces are normalised away on the way
    // in. A client that rendered its own draft would now be showing a cue that
    // differs from the one the next bootstrap will deliver.
    const res = await post({ exerciseId: bench, cue: "  elbows tucked   \n\n\n\npause on chest  \n\n" });
    const json = await res.json() as { cue: string | null };

    expect(json.cue).toBe("elbows tucked\n\npause on chest");
    const map = await dbm.withUser(A, () => cues.getCues(A));
    expect(map[bench]).toBe(json.cue);
  });

  it("keeps the line breaks the owner typed, because two cues sit on one lift", async () => {
    const res = await post({ exerciseId: bench, cue: "elbows tucked\npause on chest" });
    const json = await res.json() as { cue: string | null };
    expect(json.cue).toBe("elbows tucked\npause on chest");
  });

  // ------------------------------------------------------------- the clear

  it("clears with an empty cue, and the lift goes ABSENT from the map", async () => {
    await post({ exerciseId: bench, cue: "elbows tucked" });

    const res = await post({ exerciseId: bench, cue: "" });
    expect(res.status).toBe(200);
    // Null, not "". The phone's `cueFor` collapses undefined and null to one
    // case precisely because this is the only representation of "no cue".
    expect(await res.json()).toEqual({ exerciseId: bench, cue: null });

    const map = await dbm.withUser(A, () => cues.getCues(A));
    expect(bench in map).toBe(false);
  });

  it("treats a whitespace-only cue as a clear rather than storing it", async () => {
    await post({ exerciseId: bench, cue: "elbows tucked" });

    const res = await post({ exerciseId: bench, cue: "   \n\n  " });
    expect((await res.json() as { cue: string | null }).cue).toBeNull();
  });

  it("is safe to send twice — the retry lands on one row", async () => {
    await post({ exerciseId: bench, cue: "elbows tucked" });
    await post({ exerciseId: bench, cue: "elbows tucked" });

    // What makes the write enqueueable: a replayed outbox item cannot double.
    const rows = await dbm.adminDb.select({ cue: schema.exerciseCues.cue })
      .from(schema.exerciseCues)
      .where(orm.eq(schema.exerciseCues.userId, A));
    expect(rows).toHaveLength(1);
  });

  // ------------------------------------------------------------- refusals

  it("400s a cue past the ceiling, naming the limit", async () => {
    const res = await post({ exerciseId: bench, cue: "x".repeat(cues.MAX_CUE_LENGTH + 1) });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain(String(cues.MAX_CUE_LENGTH));
  });

  it("stores a cue of exactly the ceiling, so the client's counter is not off by one", async () => {
    // The phone's `cueError` refuses at > MAX_CUE_LENGTH, so the boundary value
    // must be acceptable here or the two disagree about the last character.
    const res = await post({ exerciseId: bench, cue: "x".repeat(cues.MAX_CUE_LENGTH) });
    expect(res.status).toBe(200);
  });

  it("400s an exerciseId that is not a uuid", async () => {
    const res = await post({ exerciseId: "barbell-bench-press", cue: "elbows tucked" });
    expect(res.status).toBe(400);
  });

  it("400s a cue that is not a string", async () => {
    const res = await post({ exerciseId: bench, cue: 7 });
    expect(res.status).toBe(400);
  });

  it("404s a lift this account cannot see, rather than 500ing on the policy", async () => {
    // B's custom lift. The WITH CHECK in drizzle/0005 would refuse this as a
    // policy violation, which reaches `route()` as a 500; the handler's lookup
    // is what turns it into an answer the phone can show.
    const res = await post({ exerciseId: theirs, cue: "elbows tucked" });
    expect(res.status).toBe(404);
  });

  it("401s when nobody is signed in", async () => {
    currentUser = null;
    const res = await post({ exerciseId: bench, cue: "elbows tucked" });
    expect(res.status).toBe(401);
  });

  it("writes one account's cue without touching the other's", async () => {
    await post({ exerciseId: bench, cue: "mine" });
    currentUser = B;
    await post({ exerciseId: bench, cue: "theirs" });

    const mine = await dbm.withUser(A, () => cues.getCues(A));
    const other = await dbm.withUser(B, () => cues.getCues(B));
    expect(mine[bench]).toBe("mine");
    expect(other[bench]).toBe("theirs");
  });
});

// ----------------------------------------------------------------- the mirror

/**
 * The phone's copy of `normaliseCue` against this one, as text.
 *
 * `mobile/features/voice/model.ts` carries a deliberate duplicate of
 * `normaliseCue`, and its docblock says "keep the two identical". That
 * instruction had nothing enforcing it. The duplicate is not a convenience: the
 * server applies the length ceiling to the NORMALISED string, so the phone has
 * to normalise identically to show a character count that predicts the server's
 * answer. If one side starts collapsing a character the other keeps, a draft
 * the counter calls 238 comes back a 400 and the owner cannot see why.
 *
 * Comparing source text rather than behaviour is the cheap version of this
 * check and it is the one that cannot be fooled: a behavioural test would need
 * to guess the inputs on which they diverge, which is exactly what nobody can
 * do in advance. Whitespace between tokens is normalised so a reformat of
 * either file does not fail this; anything else differing does.
 *
 * This runs with or without a database — it reads two files.
 */
describe("the phone's normaliseCue mirror", () => {
  function bodyOf(source: string, path: string): string {
    const start = source.indexOf("export function normaliseCue(raw: string): string {");
    expect(start, `normaliseCue not found in ${path}`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    expect(end, `normaliseCue has no close in ${path}`).toBeGreaterThan(start);
    return source.slice(start, end).replace(/\s+/g, " ").trim();
  }

  it("is still character-for-character the same function", () => {
    const server = "src/lib/cues.ts";
    const phone = "mobile/features/voice/model.ts";

    expect(bodyOf(readFileSync(phone, "utf8"), phone))
      .toBe(bodyOf(readFileSync(server, "utf8"), server));
  });

  it("agrees with the phone about the length ceiling", () => {
    const phone = readFileSync("mobile/features/voice/model.ts", "utf8");
    const match = /export const MAX_CUE_LENGTH = (\d+);/.exec(phone);
    expect(match?.[1]).toBe("240");
  });

  it("agrees with the CHECK constraint the database enforces", () => {
    // drizzle/0005 carries the same ceiling, so a caller that skips both
    // copies of the helper still cannot store a cue the UI cannot render.
    const sql = readFileSync("drizzle/0005_exercise_cues.sql", "utf8");
    expect(sql).toContain("char_length(cue) BETWEEN 1 AND 240");
  });
});
