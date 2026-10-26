/**
 * Does this reply refuse instead of answering?
 *
 * One function, used by `npm run llm:preflight` against the live API. It is the
 * only automated check that can catch complaint 5 coming back, because the bug
 * was never in the code path — every request succeeded, the stream arrived, the
 * row was written. The defect was the CONTENT: asked for thoughts on their
 * goals and plan with one logged day, the coach said "1 logged day is too thin
 * to evaluate your eating or lifting plan", and when pushed, "1 logged day is
 * too thin to call."
 *
 * Lives here rather than in the script so it can be tested against those two
 * exact strings. A detector that does not fire on the replies that caused the
 * complaint is worse than none: it reports green forever.
 *
 * What it must NOT flag: an answer that states its sample size and then
 * answers. That is now the required shape, so admitting thinness cannot itself
 * be the trigger — the trigger is admitting it and then stopping.
 */

/** Phrases that admit the sample is thin. Legitimate inside an answer. */
const ADMISSION = /too thin|too little data|not enough data|insufficient data|can(?:'|no)?t (?:say|call|tell|evaluate)|hard to say/i;

/**
 * Below this, an admission is the whole reply rather than a clause in it.
 *
 * The two shipped non-answers ran 13 and 8 words. A real answer to "what do you
 * think of my goals and my plan" that leads with a caveat and then commits to
 * one recommendation does not fit in 25 — the shortest acceptable shape is a
 * confidence clause plus a recommendation plus its reason.
 */
export const MIN_ANSWER_WORDS = 25;

/** A reply this short is not an answer to anything, caveat or not. */
export const MIN_REPLY_WORDS = 10;

const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const sentences = (text: string): number =>
  text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;

/**
 * `null` when the reply is an answer; otherwise why it is not.
 *
 * The reason is returned rather than thrown so a caller can put it in a message
 * alongside the reply itself — a bare "non-answer" tells whoever reads the
 * preflight output nothing about which rule the model broke.
 */
export function nonAnswerReason(reply: string): string | null {
  const text = reply.trim();
  if (text.length === 0) return "empty reply";

  if (words(text) < MIN_REPLY_WORDS) {
    return `only ${words(text)} words — too short to be an answer`;
  }

  if (ADMISSION.test(text) && (sentences(text) < 2 || words(text) < MIN_ANSWER_WORDS)) {
    return "admits the data is thin and stops, instead of answering anyway";
  }

  return null;
}
