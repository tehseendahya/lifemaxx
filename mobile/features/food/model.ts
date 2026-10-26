/*
 * Every piece of meal logging that is arithmetic rather than interface.
 *
 * Nothing in this file imports `react-native`, and that is a hard rule rather
 * than a preference: `mobile/vitest.config.ts` runs in a plain node
 * environment, so whatever lives here is testable in this container and
 * whatever does not is only verifiable on a device. The numbers that end up in
 * the database — the macro arithmetic, the camelCase/snake_case mapping across
 * the API boundary, the slot the meal is filed under — therefore all live here,
 * and the camera, the haptics and the gestures live elsewhere.
 *
 * The imports are relative rather than `@/lib/...` because that vitest config
 * has no path aliases configured. `features/today/model.ts` does the same for
 * the same reason.
 */
import type { MacroTotals, MealDto, MealItemDto } from "../../lib/types";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Display order, which is also chronological order. Used for the slot chips. */
export const MEAL_SLOTS: readonly MealSlot[] = ["breakfast", "lunch", "dinner", "snack"] as const;

/** `manual` exists in the database but nothing in this client produces it. */
export type MealSource = "photo" | "text" | "repeat";

// --------------------------------------------------------------- the boundary

/**
 * One item in the shape `POST /api/meals/analyze` returns and `POST /api/meals`
 * accepts.
 *
 * The snake_case is the model's JSON schema (`mealAnalysisSchema` in
 * src/lib/llm/schemas.ts) and it is not ours to change — the web client posts
 * these keys too, and renaming them server-side would mean a translation layer
 * on both sides of a contract that already works. So the rename happens here,
 * once, in two functions that are unit-tested in both directions.
 */
export interface AnalyzedItem {
  name: string;
  qty: number | null;
  unit: string | null;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** The body of `POST /api/meals/analyze`. */
export interface AnalyzeResponse {
  items: AnalyzedItem[];
  confidence: number;
  note: string;
  totals: MacroTotals;
}

/**
 * One item as the review card holds it while the user corrects it.
 *
 * `key` is why this is a separate type rather than `AnalyzedItem` with a React
 * key bolted on. Item names are editable and routinely collide ("Olive oil"
 * twice), the array is spliced from the middle by the `×` control, and an index
 * key would make the row below a deletion inherit the deleted row's text input
 * state. The key is minted once per row and never changes.
 */
export interface DraftItem {
  key: string;
  name: string;
  qty: number | null;
  unit: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** The four macro fields the NumberPad can edit, and how the pad labels them. */
export type MacroField = "kcal" | "proteinG" | "carbsG" | "fatG";

export const MACRO_FIELDS: Record<MacroField, { label: string; unit: string }> = {
  kcal: { label: "calories", unit: "kcal" },
  proteinG: { label: "protein", unit: "g" },
  carbsG: { label: "carbs", unit: "g" },
  fatG: { label: "fat", unit: "g" },
};

let keySeq = 0;

/** Monotonic within a session, which is all a React key has to be. */
export function newDraftKey(): string {
  keySeq += 1;
  return `item-${keySeq}`;
}

export function toDraft(items: readonly AnalyzedItem[]): DraftItem[] {
  return items.map((i) => ({
    key: newDraftKey(),
    name: i.name,
    qty: i.qty,
    unit: i.unit,
    kcal: i.kcal,
    proteinG: i.protein_g,
    carbsG: i.carbs_g,
    fatG: i.fat_g,
  }));
}

/**
 * The reverse, for the save.
 *
 * The name is trimmed and an empty one becomes "Item": `POST /api/meals` does
 * not validate names, so a row the user blanked out and forgot about would be
 * written as an empty string and then render in the day list as a meal that
 * apparently contains nothing. Macros are passed through unrounded — the server
 * rounds `kcal` itself and stores the gram figures as numerics, and rounding
 * twice would lose a tenth of a gram on every item for no reason.
 */
export function toAnalyzed(items: readonly DraftItem[]): AnalyzedItem[] {
  return items.map((i) => ({
    name: i.name.trim() === "" ? "Item" : i.name.trim(),
    qty: i.qty,
    unit: i.unit,
    kcal: i.kcal,
    protein_g: i.proteinG,
    carbs_g: i.carbsG,
    fat_g: i.fatG,
  }));
}

/**
 * `GET /api/mobile/food` already returns items in camelCase, so a repeat has to
 * cross the boundary the other way before it can be posted back.
 */
export function analyzedFromMealItems(items: readonly MealItemDto[]): AnalyzedItem[] {
  return items.map((i) => ({
    name: i.name,
    qty: i.qty,
    unit: i.unit,
    kcal: i.kcal,
    protein_g: i.proteinG,
    carbs_g: i.carbsG,
    fat_g: i.fatG,
  }));
}

export function emptyDraftItem(): DraftItem {
  return { key: newDraftKey(), name: "", qty: null, unit: null, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

export function patchItem(
  items: readonly DraftItem[],
  key: string,
  patch: Partial<Omit<DraftItem, "key">>,
): DraftItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

export function removeItem(items: readonly DraftItem[], key: string): DraftItem[] {
  return items.filter((i) => i.key !== key);
}

// ----------------------------------------------------------------- arithmetic

/**
 * The live total under the review card.
 *
 * This is the same reduction `POST /api/meals` runs server-side, which is the
 * point: the figure the user reads before pressing SAVE MEAL has to be the
 * figure that gets written, or the review step is theatre.
 */
export function draftTotals(items: readonly DraftItem[]): MacroTotals {
  return items.reduce<MacroTotals>(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      proteinG: a.proteinG + i.proteinG,
      carbsG: a.carbsG + i.carbsG,
      fatG: a.fatG + i.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** "640 kcal · 42p 61c 19f" — the one-line macro summary, used in three places. */
export function formatMacroLine(t: MacroTotals): string {
  return `${Math.round(t.kcal)} kcal · ${Math.round(t.proteinG)}p ${Math.round(t.carbsG)}c ${Math.round(t.fatG)}f`;
}

export function mealTotals(meal: MealDto): MacroTotals {
  return { kcal: meal.kcal, proteinG: meal.proteinG, carbsG: meal.carbsG, fatG: meal.fatG };
}

/**
 * What a meal says it is, in one line.
 *
 * Item names first because that is what someone recognises at a glance; the
 * note is the fallback because a text-only meal with one item called "Item"
 * reads worse than the sentence the user typed.
 */
export function mealSummaryLine(meal: MealDto): string {
  const names = meal.items.map((i) => i.name).filter((n) => n.trim() !== "");
  if (names.length > 0) return names.join(", ");
  if (meal.note.trim() !== "") return meal.note.trim();
  return "Meal";
}

/**
 * How many item names a row shows before it starts counting instead.
 *
 * Four fits two lines at 14pt on the narrowest phone with room for the tail —
 * provided the four are short, which is what `MEAL_NAMES_CHARS` is for.
 */
export const MEAL_NAMES_SHOWN = 4;

/**
 * The same budget again, in characters, because a count of four is only a
 * two-line budget if the four names are short.
 *
 * 64 is derived rather than picked: an iPhone SE is 320pt wide, the screen and
 * the card take 16pt of padding each side (64pt in total), and the system face
 * at 14pt averages a shade under 7pt per character — so a line holds about 36
 * characters and two hold about 72. The four names in the eleven-item test case
 * are exactly 60 characters joined, which is why that case still shows four and
 * is still bounded by the count rather than by this; what this catches is the
 * case the count cannot, which is three names of thirty characters each. The
 * tail is left out of the budget on purpose — "+8 more" only exists when at
 * least one name has been dropped, which has already freed more room than the
 * tail takes.
 */
export const MEAL_NAMES_CHARS = 64;

/**
 * The same line, but bounded — "Eggs, Toast, Coffee, Rice +7 more".
 *
 * One save is one row, always: `POST /api/meals` inserts a single `meals` row
 * per request and nothing anywhere groups or splits them. So a user who
 * describes a whole day in one sentence gets one row holding a whole day, and
 * the owner hit exactly that: a single DINNER row with the day's food in it.
 *
 * That part is the data and not this list's doing. What WAS this list's doing
 * is that `mealSummaryLine` joined every name and the row clipped the result at
 * two lines, so an eleven-item meal looked like a three-item meal that had been
 * cut off — no count, no hint that the rest existed, nothing to explain why the
 * macros underneath were a day's worth. Counting the overflow instead of
 * clipping it is what makes the row legible without touching the wire format.
 *
 * `mealSummaryLine` is deliberately left alone: the action sheet's title wants
 * the unbounded line (it truncates to a character budget of its own), and its
 * behaviour is pinned by existing tests.
 */
export function mealNamesLine(
  meal: MealDto,
  max: number = MEAL_NAMES_SHOWN,
  chars: number = MEAL_NAMES_CHARS,
): string {
  const names = meal.items.map((i) => i.name.trim()).filter((n) => n !== "");
  if (names.length === 0) return mealSummaryLine(meal);

  /*
   * Two budgets, and the first name is exempt from both.
   *
   * "Grilled chicken breast, skin removed" is one item, and a meal whose only
   * description is a single long name must render that name — "+0 more" is not
   * a thing, and dropping it would leave the row describing nothing. So the
   * loop always takes one, and only then starts counting.
   */
  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    const cost = shown.length === 0 ? name.length : name.length + 2;
    if (shown.length > 0 && (shown.length >= max || used + cost > chars)) break;
    shown.push(name);
    used += cost;
  }

  if (shown.length === names.length) return shown.join(", ");
  return `${shown.join(", ")} +${names.length - shown.length} more`;
}

/**
 * The slot line: "DINNER" on its own, or "DINNER · 11 ITEMS".
 *
 * The count is what distinguishes one dinner from a day filed as dinner, and
 * it is the one fact the row was missing. Suppressed at a single item, where
 * the name below it already is the count and "1 ITEM" is just noise.
 */
export function mealSlotLine(meal: MealDto): string {
  const n = meal.items.length;
  return n > 1 ? `${meal.slot} · ${n} items` : meal.slot;
}

// -------------------------------------------------------------- the breakdown

/**
 * One item as the detail sheet draws it.
 *
 * `macros` is nullable and that is the one-item case, not an oversight: see
 * `mealDetail`.
 */
export interface MealItemRow {
  key: string;
  name: string;
  /** "3 large", "200 g", "1" — the portion the estimate was made against. */
  portion: string | null;
  /** The same line the meal total uses, so the two read as one column. */
  macros: string | null;
}

/**
 * Everything the meal detail sheet draws, with no decisions left in the view.
 *
 * The owner's complaint was that a row saying "+2 more" had no way to show the
 * two: `MealDto.items` has carried every name, portion and macro since the
 * route was written, and nothing rendered them. This is that view, as data.
 */
export interface MealDetail {
  /** "Dinner · 6 items" — the sheet's own title. */
  title: string;
  /** The meal's stored totals. The headline figure, and the authority. */
  total: string;
  /** Where these numbers came from, or null for a source we have no words for. */
  source: string | null;
  items: MealItemRow[];
  /** Said only when the column does not add up to the headline. */
  footnote: string | null;
  /** The sentence the user typed, or the note a photo was given. */
  note: string | null;
  /** Non-null instead of `items` when the meal saved no breakdown at all. */
  empty: string | null;
}

export function itemTotals(item: MealItemDto): MacroTotals {
  return { kcal: item.kcal, proteinG: item.proteinG, carbsG: item.carbsG, fatG: item.fatG };
}

/**
 * "3 large", "200 g", "1".
 *
 * Null rather than an empty string when there is no quantity: the row omits the
 * line entirely rather than reserving a blank one, and a caller cannot
 * accidentally render `" "` as a portion.
 */
export function mealItemPortion(item: MealItemDto): string | null {
  if (item.qty === null || !Number.isFinite(item.qty)) return null;
  // The model emits fractional quantities ("1.5 cups"); 0.5 must not round to
  // "1" and 3 must not render as "3.0".
  const qty = Math.round(item.qty * 100) / 100;
  const unit = item.unit !== null && item.unit.trim() !== "" ? ` ${item.unit.trim()}` : "";
  return `${qty}${unit}`;
}

/**
 * The sheet's title. Sentence case, unlike `mealSlotLine`, which feeds a
 * `<Label>` and is uppercased by the type style rather than by the string.
 *
 * The item count is on the title and NOT a truncated name list, which is what
 * this title used to be: the names are now in full twenty points below it, and
 * a clipped copy of them above would be the same information twice with the
 * worse version on top.
 */
export function mealDetailTitle(meal: MealDto): string {
  const slot = meal.slot.trim();
  const name = slot === "" ? "Meal" : slot[0].toUpperCase() + slot.slice(1);
  const n = meal.items.length;
  return n > 1 ? `${name} · ${plural(n, "item")}` : name;
}

/**
 * Where a meal's numbers came from, which is the context that makes them worth
 * arguing with.
 *
 * The confidence is the model's own, shown as a percentage because it is the
 * model's claim about itself and rounding it into "high"/"low" would be us
 * restating someone else's uncertainty. It is dropped for a repeat: those
 * figures were corrected by a person once, and `FoodScreen.repeat` deliberately
 * posts `confidence: null` for exactly that reason.
 */
export function mealSourceLine(meal: MealDto): string | null {
  const base =
    meal.source === "photo" ? "Photo estimate"
      : meal.source === "text" ? "From what you typed"
        : meal.source === "repeat" ? "Repeated from an earlier meal"
          : meal.source === "manual" ? "Entered by hand"
            : null;
  if (base === null) return null;
  if (meal.confidence === null || !Number.isFinite(meal.confidence)) return base;
  return `${base} · ${Math.round(meal.confidence * 100)}% confident`;
}

/**
 * The column against the headline.
 *
 * `POST /api/meals` rounds the meal's `kcal` and stores each item's as a
 * numeric, so a six-item meal of x.4s can display a column that sums a few
 * short of the figure above it. That is a small discrepancy and a large trust
 * problem — this view exists so the owner can check a number, and a column that
 * does not add up reads as the app being wrong about both. So it is said out
 * loud, in the same place, whenever it is more than a rounding tick.
 *
 * Sums the ROUNDED item figures, not the raw ones: the claim being checked is
 * the one the user can make with the digits on screen.
 */
export function itemsFootnote(meal: MealDto): string | null {
  if (meal.items.length === 0) return null;
  const sum = meal.items.reduce((a, i) => a + Math.round(i.kcal), 0);
  const total = Math.round(meal.kcal);
  if (Math.abs(sum - total) <= 1) return null;
  return `These items add to ${sum} kcal; the meal was saved as ${total}.`;
}

export function mealDetail(meal: MealDto): MealDetail {
  const footnote = itemsFootnote(meal);

  /*
   * A one-item meal's item line IS the meal total, and drawing the same
   * "1683 kcal · 112p 164c 61f" twice forty points apart reads as a bug rather
   * than as a breakdown. So the item keeps its name and portion and loses its
   * macros — but only while the two genuinely agree. If `itemsFootnote` has
   * something to say they do not agree, and then both figures have to be
   * visible or the footnote is talking about a number that is not on screen.
   */
  const foldSingle = meal.items.length === 1 && footnote === null;

  return {
    title: mealDetailTitle(meal),
    total: formatMacroLine(mealTotals(meal)),
    source: mealSourceLine(meal),
    items: meal.items.map((item, i) => ({
      // Index, not name: item names collide routinely ("Olive oil" twice) and
      // this list is read-only, so the index is stable for as long as it exists.
      key: `item-${i}`,
      // The same fallback `toAnalyzed` writes on save, so a blank name reads
      // the same whichever side of the boundary it was blanked on.
      name: item.name.trim() === "" ? "Item" : item.name.trim(),
      portion: mealItemPortion(item),
      macros: foldSingle ? null : formatMacroLine(itemTotals(item)),
    })),
    footnote,
    note: meal.note.trim() === "" ? null : meal.note.trim(),
    empty: meal.items.length === 0
      ? "No item breakdown was saved for this meal — only its totals."
      : null,
  };
}

/** "1 item" / "6 items". */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Which `resize` action gets the longest edge down to `maxEdge`.
 *
 * A phone photo is portrait about as often as it is landscape, and
 * `resize: { width: 1024 }` on a 3024×4032 portrait shot produces a
 * 1024×1365 image — 40% more pixels than intended, on cell data. Returning
 * `null` when the photo is already small enough matters too: `resize` with a
 * single dimension scales to it in both directions, so an unconditional resize
 * would *upscale* a small image and make the upload bigger than the original.
 */
export function resizeForLongestEdge(
  width: number,
  height: number,
  maxEdge: number,
): { width: number } | { height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    // The picker reported nothing usable. Resizing blind is worse than sending
    // the photo as it came: a wrong dimension is a wrongly stretched meal.
    return null;
  }
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

// ----------------------------------------------------------------- the clock

/**
 * The slot a meal defaults to, by the hour, exactly as `MealCapture.tsx` does
 * it on the web. Ported rather than improved: the two clients disagreeing about
 * whether 14:30 is lunch would be a visible inconsistency for no gain.
 */
export function slotForHour(hour: number): MealSlot {
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

export function defaultSlot(now: Date = new Date()): MealSlot {
  return slotForHour(now.getHours());
}

/**
 * `MealDto.slot` is typed as a plain `string` because that is what the route
 * returns, and a repeat has to post a slot back. Narrowing with a fallback
 * rather than a cast means an unrecognised value — a slot added to the database
 * after this build shipped — lands somewhere sane instead of being rejected by
 * the route's own union.
 */
export function asMealSlot(value: string, fallback: MealSlot = "snack"): MealSlot {
  return (MEAL_SLOTS as readonly string[]).includes(value) ? (value as MealSlot) : fallback;
}

// ------------------------------------------------------------------ the dates

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Date arithmetic on the `YYYY-MM-DD` strings the API speaks, done in UTC.
 *
 * Deliberately never constructs a local `Date` from the string. A local
 * midnight that does not exist (the spring-forward hour) or happens twice
 * (autumn) makes `+1 day` land on the same calendar day, and these dates are
 * calendar labels in the user's profile timezone — not instants — so UTC
 * arithmetic on the parts is the only thing that is always right.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Whole days from `todayIso` to `iso`. Negative is in the past. */
export function dayDelta(iso: string, todayIso: string): number {
  const [y1, m1, d1] = iso.split("-").map(Number);
  const [y2, m2, d2] = todayIso.split("-").map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000);
}

/** The stepper's middle word: "today", "yesterday", "4d ago". */
export function relativeDayLabel(iso: string, todayIso: string): string {
  const delta = dayDelta(iso, todayIso);
  if (delta === 0) return "today";
  if (delta === -1) return "yesterday";
  if (delta < 0) return `${-delta}d ago`;
  // Not reachable through the UI — the forward arrow is disabled on today —
  // but a label is cheaper than an invariant nobody can see.
  return delta === 1 ? "tomorrow" : `in ${delta}d`;
}

/** "Sat 25 Oct" — the subtitle. Parsed as UTC, so the label cannot drift a day. */
export function formatIsoDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}
