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
  /**
   * Speech to text, for a set spoken mid-workout.
   *
   * The only entry here that is not pinned, and deliberately so. Every other id
   * in this file is a name this repo has committed to; an audio model id is not
   * something to guess, because a wrong one is a 400 in production that reads
   * like a bug in the upload path rather than a bad string. So there is no
   * default: unset, `POST /api/voice/transcribe` answers 503 "Transcription is
   * not configured" and the mic says "speaking isn't set up yet — type it
   * instead". Typed entry does not go anywhere near this.
   *
   * `npm run llm:preflight` is the only thing that can prove a value for it
   * actually exists.
   */
  transcribe: process.env.OPENAI_TRANSCRIBE_MODEL ?? null,
} as const;

export type ModelRoute = keyof typeof MODELS;
