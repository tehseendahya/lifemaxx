/**
 * Every route's model in one place.
 *
 * Policy: Luna where it works, Terra where it doesn't, Sol nowhere by default.
 * Most of these calls are extraction, not reasoning. Bumping a single route up
 * a tier is a one-line change here — upgrade on evidence, not on anxiety.
 */
export const MODELS = {
  /** Vision + portion estimation: the one genuinely hard call. */
  mealAnalyze: "gpt-5.6-terra",
  /** Text to structured sets. Narrow extraction. */
  setsParse: "gpt-5.6-luna",
  /** Mid-set questions — the one route where reasoning quality is the product. */
  sessionAsk: "gpt-5.6-terra",
  /** Bounded by the mechanical baseline; writes one sentence, not the numbers. */
  sessionSuggest: "gpt-5.6-luna",
  /** Two weeks of context and an open question. */
  coachChat: "gpt-5.6-terra",
  /** Small rollup in, three sentences out. */
  digest: "gpt-5.6-luna",
} as const;

export type ModelRoute = keyof typeof MODELS;
