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
