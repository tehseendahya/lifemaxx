/*
 * Wire types for the food feature's write routes.
 *
 * Here rather than in `lib/types.ts` because that file has a single owner and
 * these shapes are only ever built and read inside this folder. No
 * `react-native` import, so `compose.ts` and `model.ts` can depend on them and
 * stay testable in node.
 */
import type { MealItemDto } from "../../lib/types";
import type { AnalyzedItem, MealSlot, MealSource } from "./model";

/**
 * The body of `POST /api/meals`.
 *
 * There is no image field, and that is a rule rather than an omission: a meal
 * photo is analysed in memory and dropped, and the save carries only what the
 * analysis concluded. `compose.ts`'s `savePayload` builds this from named
 * fields so nothing the composer holds can ride along by spread.
 */
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

/** The body of `POST /api/mobile/meal`: the whole edited meal, items replaced wholesale. */
export interface UpdateMealInput {
  id: string;
  slot: MealSlot;
  note: string;
  items: AnalyzedItem[];
}

/** What `POST /api/mobile/meal` answers: the meal in the `GET /api/mobile/food` shape. */
export interface UpdateMealResponse {
  meal: {
    id: string;
    slot: string;
    note: string;
    source: string;
    confidence: number | null;
    localDate: string;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    items: MealItemDto[];
  };
}
