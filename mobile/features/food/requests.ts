import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import type { FoodDay } from "@/lib/types";

import type { AnalyzedItem, AnalyzeResponse, MealSlot, MealSource } from "./model";

/**
 * The four server contracts this feature talks to, in one place.
 *
 * None of them are new and none of them change: the web client posts the same
 * bodies to the same routes, and `POST /api/meals/analyze` and `POST /api/meals`
 * are shared with `src/components/MealCapture.tsx`. The only reason this file
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

export interface SaveMealInput {
  slot: MealSlot;
  note: string;
  source: MealSource;
  confidence: number | null;
  /** Omitted for today, so the server's notion of the date wins. */
  localDate?: string;
  /** snake_case macros — the model's schema, which is also what the route reads. */
  items: AnalyzedItem[];
}

export function saveMeal(input: SaveMealInput): Promise<{ meal: { id: string } }> {
  return apiPost<{ meal: { id: string } }>("/api/meals", input);
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
