import { describe, expect, it } from "vitest";

import {
  analyzedFromMealItems,
  asMealSlot,
  dayDelta,
  defaultSlot,
  draftTotals,
  emptyDraftItem,
  formatIsoDateLabel,
  formatMacroLine,
  itemsFootnote,
  mealDetail,
  mealItemPortion,
  mealNamesLine,
  mealSlotLine,
  mealSourceLine,
  mealSummaryLine,
  newDraftKey,
  patchItem,
  relativeDayLabel,
  removeItem,
  resizeForLongestEdge,
  shiftIsoDate,
  slotForHour,
  toAnalyzed,
  toDraft,
  EMPTY_MEAL_HINT,
  appendItems,
  canSaveEdit,
  draftFromMeal,
  editorHeadline,
  formatQty,
  isDirty,
  isScratchUri,
  sameItems,
  saveBlockedReason,
  scaleItem,
  updatePayload,
  type AnalyzedItem,
  type DraftItem,
  type MealDraft,
} from "./model";
import type { MealDto } from "../../lib/types";

/** The shape the analysis endpoint actually returns, two items, one fractional. */
const analyzed: AnalyzedItem[] = [
  { name: "Scrambled eggs", qty: 3, unit: "large", kcal: 215, protein_g: 19, carbs_g: 2, fat_g: 15 },
  { name: "Sourdough toast", qty: 2, unit: "slices", kcal: 180.4, protein_g: 6.2, carbs_g: 34, fat_g: 2 },
];

describe("the API boundary", () => {
  it("maps snake_case to camelCase without losing a field", () => {
    const [eggs, toast] = toDraft(analyzed);

    expect(eggs).toMatchObject({
      name: "Scrambled eggs", qty: 3, unit: "large",
      kcal: 215, proteinG: 19, carbsG: 2, fatG: 15,
    });
    expect(toast).toMatchObject({ proteinG: 6.2, carbsG: 34, fatG: 2, kcal: 180.4 });
  });

  it("maps camelCase back to snake_case for the save", () => {
    expect(toAnalyzed(toDraft(analyzed))).toEqual(analyzed);
  });

  it("does not round macros on the way out", () => {
    // The server rounds kcal itself and stores grams as numerics. Rounding here
    // too would shave a tenth of a gram off every item on every save.
    const [, toast] = toAnalyzed(toDraft(analyzed));
    expect(toast.kcal).toBe(180.4);
    expect(toast.protein_g).toBe(6.2);
  });

  it("gives a blanked-out name something to render as", () => {
    const [item] = toAnalyzed([{ ...emptyDraftItem(), name: "   " }]);
    expect(item.name).toBe("Item");
  });

  it("trims a name the user typed with a trailing space", () => {
    const [item] = toAnalyzed([{ ...emptyDraftItem(), name: "  Olive oil " }]);
    expect(item.name).toBe("Olive oil");
  });

  it("maps a logged meal's camelCase items back for a repeat", () => {
    expect(analyzedFromMealItems([
      { name: "Chicken thigh", qty: 200, unit: "g", kcal: 430, proteinG: 38, carbsG: 0, fatG: 30 },
    ])).toEqual([
      { name: "Chicken thigh", qty: 200, unit: "g", kcal: 430, protein_g: 38, carbs_g: 0, fat_g: 30 },
    ]);
  });

  it("mints a distinct key per row, so two items with the same name are separable", () => {
    const items = toDraft([analyzed[0], analyzed[0]]);
    expect(items[0].key).not.toBe(items[1].key);
    expect(newDraftKey()).not.toBe(newDraftKey());
  });
});

describe("the live total", () => {
  it("sums every macro across the items", () => {
    expect(draftTotals(toDraft(analyzed))).toEqual({
      kcal: 395.4, proteinG: 25.2, carbsG: 36, fatG: 17,
    });
  });

  it("is zero for an empty card", () => {
    expect(draftTotals([])).toEqual({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  it("recomputes after an edit, which is the whole point of the review step", () => {
    const items = toDraft(analyzed);
    // The user decides the toast was buttered: 180 kcal becomes 280, fat 2 → 13.
    const edited = patchItem(items, items[1].key, { kcal: 280, fatG: 13 });

    expect(formatMacroLine(draftTotals(items))).toBe("395 kcal · 25p 36c 17f");
    expect(formatMacroLine(draftTotals(edited))).toBe("495 kcal · 25p 36c 28f");
  });

  it("recomputes after a removal", () => {
    const items = toDraft(analyzed);
    expect(formatMacroLine(draftTotals(removeItem(items, items[0].key))))
      .toBe("180 kcal · 6p 34c 2f");
  });

  it("counts an appended empty item as zero rather than as NaN", () => {
    const items = [...toDraft(analyzed), emptyDraftItem()];
    expect(draftTotals(items).kcal).toBe(395.4);
  });

  it("leaves rows other than the patched one untouched", () => {
    const items = toDraft(analyzed);
    const edited = patchItem(items, items[0].key, { kcal: 1 });
    expect(edited[1]).toEqual(items[1]);
  });
});

describe("the default slot, by the hour", () => {
  // The five boundaries the web app's thresholds create. These are the cases
  // where an off-by-one files breakfast as lunch.
  it.each([
    ["09:59", 9, 59, "breakfast"],
    ["10:00", 10, 0, "lunch"],
    ["14:59", 14, 59, "lunch"],
    ["20:59", 20, 59, "dinner"],
    ["21:00", 21, 0, "snack"],
  ] as const)("%s is %s", (_label, hour, minute, slot) => {
    expect(defaultSlot(new Date(2026, 9, 25, hour, minute))).toBe(slot);
  });

  it("files the small hours as breakfast, as the web does", () => {
    expect(slotForHour(0)).toBe("breakfast");
    expect(slotForHour(23)).toBe("snack");
  });

  it("narrows a logged meal's slot string for a repeat, with a fallback", () => {
    // `MealDto.slot` is a plain string. A repeat has to post a member of the
    // route's union back, and an unrecognised value has to land somewhere
    // rather than be rejected.
    expect(asMealSlot("dinner")).toBe("dinner");
    expect(asMealSlot("brunch")).toBe("snack");
    expect(asMealSlot("")).toBe("snack");
    expect(asMealSlot("Dinner")).toBe("snack");
  });
});

describe("resizing to the longest edge", () => {
  it("constrains the width of a landscape photo", () => {
    expect(resizeForLongestEdge(4032, 3024, 1024)).toEqual({ width: 1024 });
  });

  it("constrains the height of a portrait photo", () => {
    // The bug this exists to prevent: resize({width:1024}) here yields
    // 1024×1365, which is 40% more pixels than asked for.
    expect(resizeForLongestEdge(3024, 4032, 1024)).toEqual({ height: 1024 });
  });

  it("does nothing to a photo that is already small enough", () => {
    expect(resizeForLongestEdge(800, 600, 1024)).toBeNull();
    expect(resizeForLongestEdge(1024, 1024, 1024)).toBeNull();
  });

  it("does nothing when the picker reported no usable dimensions", () => {
    expect(resizeForLongestEdge(0, 0, 1024)).toBeNull();
    expect(resizeForLongestEdge(Number.NaN, 1200, 1024)).toBeNull();
  });

  it("picks width for an exact square over the limit", () => {
    expect(resizeForLongestEdge(2000, 2000, 1024)).toEqual({ width: 1024 });
  });
});

describe("the date stepper", () => {
  it("steps back and forward a day", () => {
    expect(shiftIsoDate("2026-10-25", -1)).toBe("2026-10-24");
    expect(shiftIsoDate("2026-10-24", 1)).toBe("2026-10-25");
  });

  it("crosses a month and a year boundary", () => {
    expect(shiftIsoDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftIsoDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("crosses a leap day", () => {
    expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftIsoDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("steps across a DST transition without losing the day", () => {
    // 2026-11-01 is the US fall-back. Local-midnight arithmetic lands on the
    // same calendar day here; UTC arithmetic does not.
    expect(shiftIsoDate("2026-11-01", -1)).toBe("2026-10-31");
    expect(shiftIsoDate("2026-03-08", -1)).toBe("2026-03-07");
  });

  it("counts whole days between two dates", () => {
    expect(dayDelta("2026-10-25", "2026-10-25")).toBe(0);
    expect(dayDelta("2026-10-24", "2026-10-25")).toBe(-1);
    expect(dayDelta("2026-10-18", "2026-10-25")).toBe(-7);
    expect(dayDelta("2026-10-26", "2026-10-25")).toBe(1);
  });

  it("names the day the way the stepper reads it", () => {
    expect(relativeDayLabel("2026-10-25", "2026-10-25")).toBe("today");
    expect(relativeDayLabel("2026-10-24", "2026-10-25")).toBe("yesterday");
    expect(relativeDayLabel("2026-10-21", "2026-10-25")).toBe("4d ago");
  });

  it("formats the subtitle from UTC parts, so the label cannot drift a day", () => {
    expect(formatIsoDateLabel("2026-10-25")).toBe("Sun 25 Oct");
    expect(formatIsoDateLabel("2026-01-01")).toBe("Thu 1 Jan");
  });
});

describe("the day list's one-line summary", () => {
  const meal = (over: Partial<MealDto>): MealDto => ({
    id: "m1", slot: "lunch", note: "", source: "photo", confidence: 0.8,
    kcal: 520, proteinG: 38, carbsG: 44, fatG: 18, items: [], ...over,
  });

  it("prefers the item names", () => {
    expect(mealSummaryLine(meal({
      note: "a sentence nobody needs to read",
      items: [
        { name: "Rice", qty: 1, unit: "cup", kcal: 200, proteinG: 4, carbsG: 44, fatG: 1 },
        { name: "Chicken", qty: 200, unit: "g", kcal: 320, proteinG: 34, carbsG: 0, fatG: 17 },
      ],
    }))).toBe("Rice, Chicken");
  });

  it("falls back to the note when the items are nameless", () => {
    expect(mealSummaryLine(meal({
      note: "two slices of pizza",
      items: [{ name: " ", qty: null, unit: null, kcal: 520, proteinG: 38, carbsG: 44, fatG: 18 }],
    }))).toBe("two slices of pizza");
  });

  it("always has something to render", () => {
    expect(mealSummaryLine(meal({}))).toBe("Meal");
  });

  it("formats a logged meal's macros with the same line as the review card", () => {
    expect(formatMacroLine({ kcal: 520, proteinG: 38, carbsG: 44, fatG: 18 }))
      .toBe("520 kcal · 38p 44c 18f");
  });
});

describe("a row that holds more than one sitting", () => {
  const item = (name: string) => ({
    name, qty: null, unit: null, kcal: 100, proteinG: 8, carbsG: 10, fatG: 3,
  });

  const meal = (over: Partial<MealDto>): MealDto => ({
    id: "m1", slot: "dinner", note: "", source: "text", confidence: null,
    kcal: 2840, proteinG: 165, carbsG: 290, fatG: 95, items: [], ...over,
  });

  /** What the owner actually saw: a day described in one sentence, saved once. */
  const wholeDay = meal({
    note: "eggs and toast, chicken and rice, a shake, salmon and potato, yoghurt",
    items: [
      "Scrambled eggs", "Sourdough toast", "Black coffee", "Chicken thigh",
      "White rice", "Whey shake", "Salmon fillet", "Sweet potato",
      "Mixed salad", "Greek yoghurt", "Olive oil",
    ].map(item),
  });

  it("counts the items on the slot label", () => {
    // Without this a day filed as dinner and an actual dinner are the same row.
    expect(mealSlotLine(wholeDay)).toBe("dinner · 11 items");
  });

  it("says nothing about a count of one", () => {
    expect(mealSlotLine(meal({ items: [item("Pizza")] }))).toBe("dinner");
  });

  it("counts the overflow instead of letting the row clip it", () => {
    expect(mealNamesLine(wholeDay))
      .toBe("Scrambled eggs, Sourdough toast, Black coffee, Chicken thigh +7 more");
  });

  it("adds no tail when everything fits", () => {
    const three = meal({ items: ["Rice", "Chicken", "Broccoli"].map(item) });
    expect(mealNamesLine(three)).toBe("Rice, Chicken, Broccoli");
    expect(mealNamesLine(meal({ items: ["A", "B", "C", "D"].map(item) }))).toBe("A, B, C, D");
  });

  it("falls back the same way the unbounded line does", () => {
    expect(mealNamesLine(meal({ note: "two slices of pizza" }))).toBe("two slices of pizza");
    expect(mealNamesLine(meal({}))).toBe("Meal");
    expect(mealNamesLine(meal({ items: [item("  ")], note: "late snack" }))).toBe("late snack");
  });

  it("leaves the unbounded line alone for the screen reader", () => {
    // `MealRow`'s accessibilityLabel reads every name — a screen reader has no
    // two-line budget to run out of, and "+7 more" is useless read aloud. Only
    // the visible line is bounded.
    expect(mealSummaryLine(wholeDay)).toContain("Olive oil");
  });

  /*
   * The count alone was only ever a two-line budget if the names were short,
   * and four long ones clip at two lines with no tail — the same illegible row
   * the count was added to fix, one layer along.
   */
  it("counts the overflow when the names are long rather than many", () => {
    const long = meal({
      items: [
        "Grilled chicken breast, skin removed",
        "Steamed jasmine rice",
        "Olive oil",
        "Mixed green salad",
      ].map(item),
    });
    expect(mealNamesLine(long))
      .toBe("Grilled chicken breast, skin removed, Steamed jasmine rice +2 more");
  });

  it("renders a single long name whole rather than dropping it", () => {
    // There is nothing else to show and "+0 more" is not a thing, so the first
    // name is exempt from both budgets and the row clips it at two lines.
    const name = "Slow-roasted pork shoulder with crackling, apple sauce and buttered greens";
    expect(mealNamesLine(meal({ items: [item(name)] }))).toBe(name);
    expect(mealNamesLine(meal({ items: [item(name), item("Olive oil")] })))
      .toBe(`${name} +1 more`);
  });
});

/*
 * The owner's complaint, in their words: "it says '+2 more' but I'm never able
 * to see what I actually ate, even if I try to click into it."
 *
 * `MealDto.items` has carried every name, portion and macro since the route was
 * written. Nothing rendered them. This is the view that does, as data.
 */
describe("the breakdown behind the row", () => {
  const dinner: MealDto = {
    id: "m2",
    slot: "dinner",
    note: "ground turkey bowl with yogurt, eggs and a big tortilla",
    source: "photo",
    confidence: 0.72,
    kcal: 1683,
    proteinG: 143,
    carbsG: 64,
    fatG: 94,
    items: [
      { name: "Ground turkey", qty: 350, unit: "g", kcal: 740, proteinG: 84, carbsG: 0, fatG: 42 },
      { name: "Greek yogurt", qty: 1, unit: "cup", kcal: 150, proteinG: 25, carbsG: 9, fatG: 4 },
      { name: "Whole eggs", qty: 3, unit: null, kcal: 234, proteinG: 19, carbsG: 2, fatG: 16 },
      { name: "XL flour tortilla", qty: 1, unit: null, kcal: 320, proteinG: 8, carbsG: 52, fatG: 8 },
      { name: "Olive oil", qty: 1, unit: "tbsp", kcal: 119, proteinG: 0, carbsG: 0, fatG: 14 },
      { name: "Shredded cheddar", qty: 30, unit: "g", kcal: 120, proteinG: 7, carbsG: 1, fatG: 10 },
    ],
  };

  const one = (over: Partial<MealDto>): MealDto => ({
    ...dinner, id: "m3", items: [dinner.items[0]], kcal: 740, proteinG: 84, carbsG: 0, fatG: 42, ...over,
  });

  it("is the row the owner photographed", () => {
    // Pins the fixture to the screenshot. If this line changes, the complaint
    // this describe block answers is no longer the one being tested.
    expect(mealNamesLine(dinner))
      .toBe("Ground turkey, Greek yogurt, Whole eggs, XL flour tortilla +2 more");
  });

  it("names the count on the title instead of clipping the names", () => {
    expect(mealDetail(dinner).title).toBe("Dinner · 6 items");
  });

  it("shows every item, with its own macros", () => {
    const d = mealDetail(dinner);

    expect(d.items).toHaveLength(6);
    expect(d.items[0]).toMatchObject({
      name: "Ground turkey", portion: "350 g", macros: "740 kcal · 84p 0c 42f",
    });
    // The two the row could not fit are the whole point of the view.
    expect(d.items[4]).toMatchObject({ name: "Olive oil", portion: "1 tbsp" });
    expect(d.items[5]).toMatchObject({ name: "Shredded cheddar", portion: "30 g" });
    expect(d.items.map((i) => i.name)).toContain("XL flour tortilla");
  });

  it("keeps the meal's own totals as the headline", () => {
    const d = mealDetail(dinner);
    expect(d.total).toBe("1683 kcal · 143p 64c 94f");
    // These six add to exactly 1683, so there is nothing to explain.
    expect(d.footnote).toBeNull();
    expect(d.empty).toBeNull();
  });

  it("keeps the sentence the meal was logged from", () => {
    expect(mealDetail(dinner).note)
      .toBe("ground turkey bowl with yogurt, eggs and a big tortilla");
    expect(mealDetail({ ...dinner, note: "   " }).note).toBeNull();
  });

  it("says where the numbers came from", () => {
    expect(mealSourceLine(dinner)).toBe("Photo estimate · 72% confident");
    expect(mealSourceLine({ ...dinner, source: "text", confidence: null }))
      .toBe("From what you typed");
    // A repeat posts `confidence: null` on purpose: those figures were accepted
    // by a person, so there is no model claim left to report.
    expect(mealSourceLine({ ...dinner, source: "repeat", confidence: null }))
      .toBe("Repeated from an earlier meal");
    expect(mealSourceLine({ ...dinner, source: "something new" })).toBeNull();
  });

  it("does not print a one-item meal's macros twice", () => {
    const d = mealDetail(one({}));
    expect(d.title).toBe("Dinner");
    expect(d.total).toBe("740 kcal · 84p 0c 42f");
    // Same figure, forty points apart, reads as a bug rather than a breakdown.
    expect(d.items[0]).toMatchObject({ name: "Ground turkey", portion: "350 g", macros: null });
  });

  it("un-folds the one-item case when the two figures disagree", () => {
    // The footnote would otherwise be talking about a number not on screen.
    const d = mealDetail(one({ kcal: 900 }));
    expect(d.footnote).toBe("These items add to 740 kcal; the meal was saved as 900.");
    expect(d.items[0].macros).toBe("740 kcal · 84p 0c 42f");
  });

  it("explains a column that does not add up, and tolerates a rounding tick", () => {
    const frac = (kcal: number) => ({
      name: "Rice", qty: null, unit: null, kcal, proteinG: 4, carbsG: 44, fatG: 1,
    });
    // Three items rounding to 100 each: the digits on screen add to 300.
    const items = [frac(100.4), frac(100.4), frac(100.4)];
    expect(itemsFootnote({ ...dinner, items, kcal: 301 })).toBeNull();
    expect(itemsFootnote({ ...dinner, items, kcal: 299 })).toBeNull();
    expect(itemsFootnote({ ...dinner, items, kcal: 340 }))
      .toBe("These items add to 300 kcal; the meal was saved as 340.");
    expect(itemsFootnote({ ...dinner, items: [] })).toBeNull();
  });

  it("says so rather than drawing an empty list", () => {
    const d = mealDetail({ ...dinner, items: [] });
    expect(d.items).toEqual([]);
    expect(d.empty).toBe("No item breakdown was saved for this meal — only its totals.");
    // The headline survives: a meal with no breakdown still has totals.
    expect(d.total).toBe("1683 kcal · 143p 64c 94f");
  });

  it("formats a portion without inventing or losing precision", () => {
    const at = (qty: number | null, unit: string | null) =>
      mealItemPortion({ name: "x", qty, unit, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });

    expect(at(3, "large")).toBe("3 large");
    // The model emits fractional quantities; 1.5 must not round to 2.
    expect(at(1.5, "cups")).toBe("1.5 cups");
    // And a whole number must not grow a decimal.
    expect(at(3, null)).toBe("3");
    expect(at(null, "g")).toBeNull();
    expect(at(2, "  ")).toBe("2");
  });

  it("names a blank item the same way the save does", () => {
    const blank = { name: "  ", qty: null, unit: null, kcal: 10, proteinG: 0, carbsG: 0, fatG: 1 };
    expect(mealDetail({ ...dinner, items: [...dinner.items, blank] }).items[6].name).toBe("Item");
  });
});

// ------------------------------------------------------------ item editing

const chicken = (): DraftItem => ({
  key: "k1", name: "Chicken thigh", qty: 200, unit: "g",
  kcal: 410, proteinG: 46, carbsG: 0, fatG: 24,
});

describe("scaleItem", () => {
  it("rescales all four macros proportionally: 200 g → 300 g is ×1.5", () => {
    const scaled = scaleItem(chicken(), 300);
    expect(scaled.qty).toBe(300);
    expect(scaled.kcal).toBe(615);
    expect(scaled.proteinG).toBe(69);
    expect(scaled.carbsG).toBe(0);
    expect(scaled.fatG).toBe(36);
    expect(scaled.key).toBe("k1");
    expect(scaled.name).toBe("Chicken thigh");
  });

  it("rounds kcal to an integer and grams to a tenth", () => {
    const rice: DraftItem = { key: "r", name: "Rice", qty: 1.5, unit: "cup", kcal: 307, proteinG: 6.4, carbsG: 67.3, fatG: 0.6 };
    const scaled = scaleItem(rice, 1);
    expect(scaled.kcal).toBe(205); // 204.67
    expect(Number.isInteger(scaled.kcal)).toBe(true);
    expect(scaled.proteinG).toBe(4.3); // 4.2667
    expect(scaled.carbsG).toBe(44.9); // 44.867
    expect(scaled.fatG).toBe(0.4);
  });

  it("records a first quantity without scaling when there was none", () => {
    const typed: DraftItem = { ...chicken(), qty: null };
    const set = scaleItem(typed, 150);
    expect(set.qty).toBe(150);
    expect(set.kcal).toBe(410);
    expect(set.proteinG).toBe(46);
    expect(set.fatG).toBe(24);
  });

  it("refuses a zero or non-finite quantity rather than erasing the macros", () => {
    expect(scaleItem(chicken(), 0)).toEqual(chicken());
    expect(scaleItem(chicken(), Number.NaN)).toEqual(chicken());
  });

  it("does not mutate the item it was given", () => {
    const original = chicken();
    scaleItem(original, 400);
    expect(original).toEqual(chicken());
  });
});

describe("formatQty", () => {
  it("shows the portion, or a dash when there is none", () => {
    expect(formatQty({ qty: 200, unit: "g" })).toBe("200 g");
    expect(formatQty({ qty: 1.5, unit: "cup" })).toBe("1.5 cup");
    expect(formatQty({ qty: 2, unit: null })).toBe("2");
    expect(formatQty({ qty: null, unit: "g" })).toBe("—");
  });
});

const loggedMeal: MealDto = {
  id: "m1", slot: "lunch", note: "about 2 cups of rice", source: "photo", confidence: 0.7,
  kcal: 718, proteinG: 52.4, carbsG: 67.3, fatG: 24.6,
  items: [
    { name: "Chicken thigh", qty: 200, unit: "g", kcal: 410, proteinG: 46, carbsG: 0, fatG: 24 },
    { name: "White rice", qty: 1.5, unit: "cup", kcal: 308, proteinG: 6.4, carbsG: 67.3, fatG: 0.6 },
  ],
};

describe("dirty detection", () => {
  it("an untouched draft is clean, even with fresh React keys", () => {
    const a = draftFromMeal(loggedMeal);
    const b = draftFromMeal(loggedMeal);
    expect(a.items[0].key).not.toBe(b.items[0].key);
    expect(isDirty(a, b)).toBe(false);
    expect(canSaveEdit(a, b)).toBe(false);
  });

  it("notices a slot, a note, a quantity, a macro, a name, a delete and an add", () => {
    const o = draftFromMeal(loggedMeal);
    const edits: MealDraft[] = [
      { ...o, slot: "dinner" },
      { ...o, note: "3 cups" },
      { ...o, items: o.items.map((i, n) => (n === 0 ? scaleItem(i, 300) : i)) },
      { ...o, items: o.items.map((i, n) => (n === 1 ? { ...i, carbsG: 70 } : i)) },
      { ...o, items: o.items.map((i, n) => (n === 0 ? { ...i, name: "Chicken breast" } : i)) },
      { ...o, items: o.items.slice(1) },
      { ...o, items: appendItems(o.items, [{ name: "Coke Zero", qty: 1, unit: "can", kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }]) },
    ];
    for (const d of edits) expect(isDirty(o, d)).toBe(true);
    for (const d of edits.slice(0, -2)) expect(canSaveEdit(o, d)).toBe(true);
  });

  it("ignores whitespace that would be trimmed on save anyway", () => {
    const o = draftFromMeal(loggedMeal);
    const d = { ...o, note: `${o.note}  `, items: o.items.map((i) => ({ ...i, name: ` ${i.name} ` })) };
    expect(isDirty(o, d)).toBe(false);
  });

  it("sameItems compares content, not keys", () => {
    const o = draftFromMeal(loggedMeal);
    expect(sameItems(o.items, o.items.map((i) => ({ ...i, key: "other" })))).toBe(true);
    expect(sameItems(o.items, o.items.slice(0, 1))).toBe(false);
  });
});

describe("saving an edited meal", () => {
  it("blocks an empty meal with words that point at Delete", () => {
    const o = draftFromMeal(loggedMeal);
    const empty = { ...o, items: [] };
    expect(saveBlockedReason(empty)).toBe(EMPTY_MEAL_HINT);
    expect(isDirty(o, empty)).toBe(true);
    expect(canSaveEdit(o, empty)).toBe(false);
    expect(saveBlockedReason(o)).toBeNull();
  });

  it("builds the POST /api/mobile/meal body in snake_case, with no image", () => {
    const o = draftFromMeal(loggedMeal);
    const d = { ...o, slot: "dinner" as const, note: " 3 cups ", items: [scaleItem(o.items[0], 300)] };
    const body = updatePayload("m1", d);
    expect(body).toEqual({
      id: "m1",
      slot: "dinner",
      note: "3 cups",
      items: [{ name: "Chicken thigh", qty: 300, unit: "g", kcal: 615, protein_g: 69, carbs_g: 0, fat_g: 36 }],
    });
    expect(JSON.stringify(body)).not.toMatch(/image|data:/i);
  });

  it("draftFromMeal narrows an unknown slot instead of passing it through", () => {
    expect(draftFromMeal({ ...loggedMeal, slot: "brunch" }).slot).toBe("snack");
  });
});

describe("editorHeadline", () => {
  it("is the live total of the draft, not the stored one", () => {
    const o = draftFromMeal(loggedMeal);
    expect(editorHeadline("lunch", o.items)).toBe("Lunch · 718 kcal · 52 P · 67 C · 25 F");
    expect(editorHeadline("lunch", [scaleItem(o.items[0], 300)])).toBe("Lunch · 615 kcal · 69 P · 0 C · 36 F");
  });
});

describe("isScratchUri", () => {
  const cache = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/";
  it("allows files inside the app cache only", () => {
    expect(isScratchUri(`${cache}ImagePicker/abc.jpg`, cache)).toBe(true);
    expect(isScratchUri(`${cache}ImagePicker/abc.jpg`, cache.slice(0, -1))).toBe(true);
    expect(isScratchUri("file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.JPG", cache)).toBe(false);
    expect(isScratchUri(`${cache}../Documents/x.jpg`, cache)).toBe(false);
    expect(isScratchUri("ph://ABC-123", cache)).toBe(false);
    expect(isScratchUri(`${cache}a.jpg`, "")).toBe(false);
  });
});
