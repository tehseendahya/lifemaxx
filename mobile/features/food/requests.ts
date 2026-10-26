import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import type { FoodDay } from "@/lib/types";

import type { AnalyzeResponse } from "./model";
import type { SaveMealInput, UpdateMealInput, UpdateMealResponse } from "./types";

/**
 * The server contracts this feature talks to, in one place.
 *
 * The first four are shared with the web client, which posts the same bodies to
 * the same routes: `POST /api/meals/analyze` and `POST /api/meals` are also
 * what `src/components/MealCapture.tsx` uses. `POST /api/mobile/meal` (the
 * meal editor's save) is the phone's own. The only reason this file
 * exists is so that the components below never build a URL or decide what a
 * failure means.
 */

/**
 * `null` means "today", and deliberately sends no `date` parameter at all
 * rather than a date computed on the phone.
 *
 * The user's day boundary is their profile timezone, which lives on the server;
 * the phone's clock may be in a different one. Letting the route decide what
 * today is means the day list and the save path agree about it even when the
 * user is travelling.
 */
export function fetchFoodDay(date: string | null): Promise<FoodDay> {
  return apiGet<FoodDay>(
    date === null ? "/api/mobile/food" : `/api/mobile/food?date=${encodeURIComponent(date)}`,
  );
}

/**
 * At least one of the two is required by the route; the caller enforces that.
 *
 * 30s rather than the client's 15s default: this is a vision-model call, and on
 * a cold serverless start over cell data it can plausibly take longer than 15.
 * Timing out a request the server was going to answer is the worst of both —
 * the user is told it failed and the model is paid for anyway.
 */
const ANALYZE_TIMEOUT_MS = 30_000;

export function analyzeMeal(input: { imageDataUrl?: string; note?: string }): Promise<AnalyzeResponse> {
  return apiPost<AnalyzeResponse>("/api/meals/analyze", input, ANALYZE_TIMEOUT_MS);
}

export type { SaveMealInput } from "./types";

/** Build the body with `savePayload` (compose.ts) so no image can ride along. */
export function saveMeal(input: SaveMealInput): Promise<{ meal: { id: string } }> {
  return apiPost<{ meal: { id: string } }>("/api/meals", input);
}

/**
 * Save an edited meal: its items are replaced wholesale and its totals
 * recomputed server-side. Build the body with `updatePayload` (model.ts).
 *
 * A direct call, not the outbox. The outbox is the live session's pipe, and an
 * edit to a meal is something the user is watching happen in a sheet — if it
 * fails, the sheet stays open with the error and the edits intact.
 */
export function updateMeal(input: UpdateMealInput): Promise<UpdateMealResponse> {
  return apiPost<UpdateMealResponse>("/api/mobile/meal", input);
}

export function deleteMeal(id: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>("/api/meals", { id });
}

/**
 * What to put on screen when one of the above fails.
 *
 * `ApiError.status === 0` is how `lib/api` reports a network failure or a
 * timeout, and it is the case worth wording carefully: meal analysis has no
 * on-device fallback, so the honest thing is to say the server is needed and to
 * promise that the note survives — which it does, because nothing on the
 * failure path clears it.
 */
export function describeFailure(err: unknown, offline: string): string {
  if (err instanceof ApiError && err.status === 0) return offline;
  if (err instanceof Error && err.message !== "") return err.message;
  return "Something went wrong.";
}

export const OFFLINE_ANALYSIS = "No signal. Meal analysis needs the server; the note is kept.";
export const OFFLINE_SAVE = "No signal. The meal is still here — try again when you have one.";
export const OFFLINE_EDIT = "No signal. Your changes are still here — try again when you have one.";
