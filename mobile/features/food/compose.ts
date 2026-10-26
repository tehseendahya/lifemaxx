/*
 * The meal composer's decisions: a caption and an optional photo, composed
 * first and parsed once.
 *
 * The owner's complaint was that attaching a photo "immediately goes into the
 * log add phase and you can't type more". So attaching no longer analyses
 * anything. The photo and the caption are two halves of one message, and the
 * model is called once, on LOG MEAL, with both — which is also what lets a
 * caption name things the photo cannot show ("plus a protein shake").
 *
 * No `react-native` import: everything here is unit-tested in node.
 *
 * ── THE PHOTO ───────────────────────────────────────────────────────────────
 *
 * `ComposePhoto` holds a base64 data URL in React state and nowhere else. It is
 * set to null on save, on cancel and when the composer unmounts; it is never
 * put in React Query, AsyncStorage, SecureStore, the outbox or the file system,
 * and `capture.ts` deletes every scratch file the camera and the resizer wrote.
 * The one function here that builds something to be stored — `savePayload` —
 * names every field it copies, so the photo cannot reach the database by a
 * stray spread. `compose.test.ts` holds it to that.
 */
import type { AnalyzedItem, MealSlot, MealSource } from "./model";
import type { SaveMealInput } from "./types";

export interface ComposePhoto {
  /** `data:image/jpeg;base64,…`, in memory only. */
  dataUrl: string;
}

export interface ComposeState {
  caption: string;
  photo: ComposePhoto | null;
}

export const PLACEHOLDER_EMPTY = "What did you eat? A photo, a sentence, or both.";
export const PLACEHOLDER_WITH_PHOTO =
  "Add what the photo can't show: portion, oil, sauce, the shake you had with it.";

/**
 * Once there is a photo, the caption's job changes from "describe the meal" to
 * "say what the picture cannot", and the placeholder says so — that sentence
 * is the single most useful thing a user can add to a photo estimate.
 */
export function placeholderFor(hasPhoto: boolean): string {
  return hasPhoto ? PLACEHOLDER_WITH_PHOTO : PLACEHOLDER_EMPTY;
}

/** A photo alone, a caption alone, or both. Whitespace is not a caption. */
export function canLog(state: ComposeState): boolean {
  return state.photo !== null || state.caption.trim() !== "";
}

/**
 * The body of `POST /api/meals/analyze`.
 *
 * Keys are omitted rather than sent empty: the route treats a present-but-blank
 * note as no note, but an `imageDataUrl: undefined` survives as a key in some
 * serialisers and an empty string would be sent to the model as an image.
 */
export function analyzeInput(state: ComposeState): { imageDataUrl?: string; note?: string } {
  const out: { imageDataUrl?: string; note?: string } = {};
  if (state.photo !== null) out.imageDataUrl = state.photo.dataUrl;
  const note = state.caption.trim();
  if (note !== "") out.note = note;
  return out;
}

/** A photo with a caption is still a photo estimate; the caption only corrects it. */
export function sourceFor(photo: ComposePhoto | null): Extract<MealSource, "photo" | "text"> {
  return photo !== null ? "photo" : "text";
}

/**
 * The body of `POST /api/meals`, and the only path from the composer to
 * storage.
 *
 * Every field is copied by name. Do NOT rewrite this as `{ ...input, … }`: the
 * caller's object may be the composer state, which holds the photo, and a
 * spread is exactly how a data URL would end up in a database row.
 */
export function savePayload(input: {
  slot: MealSlot;
  caption: string;
  source: MealSource;
  confidence: number | null;
  /** `null` for today, so the route's own notion of the date wins. */
  localDate: string | null;
  items: AnalyzedItem[];
}): SaveMealInput {
  const payload: SaveMealInput = {
    slot: input.slot,
    note: input.caption.trim(),
    source: input.source,
    confidence: input.confidence,
    items: input.items.map((i) => ({
      name: i.name,
      qty: i.qty,
      unit: i.unit,
      kcal: i.kcal,
      protein_g: i.protein_g,
      carbs_g: i.carbs_g,
      fat_g: i.fat_g,
    })),
  };
  if (input.localDate !== null) payload.localDate = input.localDate;
  return payload;
}

/** The hero button, which also carries the busy state so it cannot be pressed twice. */
export function logButtonLabel(busy: boolean): string {
  return busy ? "Reading…" : "Log meal";
}

/**
 * Re-estimating replaces the item list. When the user has corrected it by hand,
 * that is their work being thrown away, so it is said before it happens.
 */
export const REESTIMATE_WARNING = "Replaces your edits.";
