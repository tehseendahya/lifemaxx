import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `POST /api/mobile/meal` — the refusals, and what an accepted edit writes.
 *
 * The database is stubbed. That the four statements share one transaction is
 * `route()`'s doing (its default scope is `withUser`, one Postgres
 * transaction) and is not re-proved here; what is under test is the route's
 * own decisions: whose meal it will touch, what it refuses, the order it
 * writes in, and that the totals and confidence are the server's, not the
 * client's.
 */

const USER = "user-1";
const MEAL = "33333333-3333-4333-8333-333333333333";

let currentUser: string | null = USER;
/** What the ownership read finds. Empty is "not yours, or not there". */
let ownedRows: { id: string }[] = [];

type Call = { op: string; table?: unknown; values?: unknown; set?: unknown };
const calls: Call[] = [];

const STORED = {
  id: MEAL, slot: "dinner", note: "", source: "photo", confidence: null,
  localDate: "2026-10-24", kcal: 0, proteinG: 0, carbsG: 0, fatG: 0,
};

vi.mock("@/lib/supabase/server", () => ({ currentUserId: async () => currentUser }));

vi.mock("@/db", () => {
  /*
   * One chainable stub per statement kind. Each statement records itself when
   * it starts, and its terminal call (`limit`, `where`, `returning`) resolves
   * with whatever that kind of statement would return.
   */
  let pending: Call | null = null;
  const chain: Record<string, unknown> = {
    select: () => { pending = { op: "select" }; calls.push(pending); return chain; },
    from: () => chain,
    limit: async () => ownedRows,
    delete: (table: unknown) => {
      pending = { op: "delete", table }; calls.push(pending);
      // `delete().where()` is awaited directly, so `where` must be thenable
      // here while staying chainable for select and update.
      return { where: async () => undefined };
    },
    insert: (table: unknown) => { pending = { op: "insert", table }; calls.push(pending); return chain; },
    values: (values: unknown) => { if (pending) pending.values = values; return chain; },
    update: (table: unknown) => { pending = { op: "update", table }; calls.push(pending); return chain; },
    set: (set: unknown) => { if (pending) pending.set = set; return chain; },
    where: () => chain,
    returning: async () => {
      if (pending?.op === "insert") {
        return (pending.values as Record<string, unknown>[]).map((v, i) => ({ id: `item-${i}`, ...v }));
      }
      if (pending?.op === "update") return [{ ...STORED, ...(pending.set as object) }];
      return [];
    },
  };
  return { db: chain, withUser: <T>(_u: string, fn: () => Promise<T>): Promise<T> => fn() };
});

vi.mock("@/lib/queries", () => ({
  getProfile: async () => ({ tz: "Australia/Sydney" }),
  localDate: () => "2026-10-26",
}));

const { POST } = await import("./route");

const CHICKEN = { name: "Chicken thigh", qty: 300, unit: "g", kcal: 615.4, protein_g: 69, carbs_g: 0, fat_g: 36 };
const RICE = { name: "White rice", qty: 1.5, unit: "cup", kcal: 308, protein_g: 6.4, carbs_g: 67.5, fat_g: 0.6 };

const post = (body: unknown) =>
  POST(new Request("http://t/api/mobile/meal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

const writes = () => calls.filter((c) => c.op !== "select");

beforeEach(() => {
  currentUser = USER;
  ownedRows = [{ id: MEAL }];
  calls.length = 0;
});

describe("editing a meal", () => {
  it("replaces the items and recomputes the totals, in that order", async () => {
    const res = await post({ id: MEAL, slot: "lunch", note: " about 2 cups ", items: [CHICKEN, RICE] });
    expect(res.status).toBe(200);

    expect(calls.map((c) => c.op)).toEqual(["select", "delete", "insert", "update"]);

    const inserted = calls[2].values as { mealId: string; kcal: number }[];
    expect(inserted).toHaveLength(2);
    expect(inserted.every((i) => i.mealId === MEAL)).toBe(true);
    // Item kcal is an integer column, rounded the same way `POST /api/meals` rounds it.
    expect(inserted[0].kcal).toBe(615);

    const set = calls[3].set as Record<string, unknown>;
    expect(set.slot).toBe("lunch");
    expect(set.note).toBe("about 2 cups");
    expect(set.kcal).toBe(923);
    expect(set.proteinG).toBeCloseTo(75.4);
    expect(set.carbsG).toBeCloseTo(67.5);
    expect(set.fatG).toBeCloseTo(36.6);
  });

  it("marks the meal human-edited and leaves its source and date alone", async () => {
    await post({ id: MEAL, slot: "dinner", note: "", items: [CHICKEN] });
    const set = calls.find((c) => c.op === "update")!.set as Record<string, unknown>;
    expect(set.confidence).toBeNull();
    // An edited photo estimate is still a photo estimate, and fixing
    // yesterday's dinner must not move it to today.
    expect("source" in set).toBe(false);
    expect("localDate" in set).toBe(false);
  });

  it("answers with the edited meal in the food-day shape", async () => {
    const res = await post({ id: MEAL, slot: "dinner", note: "", items: [CHICKEN] });
    const { meal } = await res.json();
    expect(meal.id).toBe(MEAL);
    expect(meal.source).toBe("photo");
    expect(meal.localDate).toBe("2026-10-24");
    expect(meal.confidence).toBeNull();
    expect(meal.items).toEqual([
      { name: "Chicken thigh", qty: 300, unit: "g", kcal: 615, proteinG: 69, carbsG: 0, fatG: 36 },
    ]);
  });

  it("answers 404 for a meal that is not yours or does not exist, and writes nothing", async () => {
    ownedRows = [];
    const res = await post({ id: MEAL, slot: "dinner", note: "", items: [CHICKEN] });
    expect(res.status).toBe(404);
    expect(writes()).toHaveLength(0);
  });

  it("refuses an empty item list before reading or writing anything", async () => {
    // Deleting every item is a delete, and the phone offers that instead.
    const res = await post({ id: MEAL, slot: "dinner", note: "", items: [] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("at least one item");
    expect(calls).toHaveLength(0);
  });

  it("refuses items that are not in the analysis shape", async () => {
    expect((await post({ id: MEAL, slot: "dinner", items: [{ name: "x", kcal: "lots" }] })).status).toBe(400);
    expect((await post({ id: MEAL, slot: "dinner" })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing id or an unknown slot", async () => {
    expect((await post({ slot: "dinner", items: [CHICKEN] })).status).toBe(400);
    expect((await post({ id: "not-a-uuid", slot: "dinner", items: [CHICKEN] })).status).toBe(400);
    expect((await post({ id: MEAL, slot: "brunch", items: [CHICKEN] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("does not accept an image, even if one is sent", async () => {
    // Meal photos are never persisted. The route has no field for one, and a
    // client that sent one anyway must not see it written anywhere.
    await post({ id: MEAL, slot: "dinner", note: "", items: [CHICKEN], imageDataUrl: "data:image/jpeg;base64,AAAA" });
    expect(JSON.stringify(calls.map(({ values, set }) => ({ values, set })))).not.toContain("data:image");
  });

  it("401s when nobody is signed in", async () => {
    currentUser = null;
    expect((await post({ id: MEAL, slot: "dinner", items: [CHICKEN] })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
