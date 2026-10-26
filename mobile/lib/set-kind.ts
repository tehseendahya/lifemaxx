/**
 * Warmup, working or to failure — one question with three answers.
 *
 * ── WHY THIS IS A MODULE AND NOT TWO BOOLEANS ──────────────────────────────
 *
 * A set carries `is_warmup` and `to_failure`, which is two independent flags in
 * the database and four representable states. Only three of them mean anything:
 * `isWarmup && toFailure` is a warmup taken to failure, which is not a thing
 * anyone does and not a thing any screen can draw. Left to themselves the two
 * flags drift, and they did: the confirmation sheet fixed this months ago by
 * asking one question with three answers, and the live session card kept two
 * separate pill toggles — so the owner turned both on at once, which is exactly
 * what their screenshot shows and exactly what they asked be made impossible:
 *
 *     "You shouldn't be able to click both warmup and failure, should be one
 *      or the other."
 *
 * So the rule lives here, once, in `lib/` rather than beside either screen. The
 * confirmation sheet and the session card now read the same `setKindOf` and
 * write the same `kindFlags`, which is the only way two controls over the same
 * pair of flags can be guaranteed to agree.
 *
 * `kindFlags` always returns BOTH flags. That is the whole point: a patch that
 * set only the one being turned on is how the pair came apart in the first
 * place.
 */

export type SetKind = "warmup" | "working" | "failure";

/** The two columns, as every caller already has them. */
export interface SetFlags {
  isWarmup: boolean;
  toFailure: boolean;
}

/**
 * The kind a set currently is.
 *
 * `isWarmup && toFailure` is unreachable through either control now, but it is
 * still reachable: a parse can produce it ("warmup set to failure"), and rows
 * written before this rule existed may hold it. It resolves to `failure` —
 * the louder of the two, and the one that matters to progression — and
 * `kindFlags` clears the stale warmup flag the next time the user touches it.
 */
export function setKindOf(flags: SetFlags): SetKind {
  if (flags.toFailure) return "failure";
  if (flags.isWarmup) return "warmup";
  return "working";
}

/** The two flags for a kind. Always both, so the pair cannot drift apart. */
export function kindFlags(kind: SetKind): SetFlags {
  return {
    isWarmup: kind === "warmup",
    toFailure: kind === "failure",
  };
}

/** Every answer, in the order a control should offer them. */
export const SET_KINDS: readonly SetKind[] = ["warmup", "working", "failure"];

/**
 * The label on a segment, in the app's micro-label voice.
 *
 * Not `TO FAILURE`: the three sit side by side in a 44pt-tall track on a 375pt
 * screen, and the word that distinguishes them is the last one.
 */
export const KIND_LABEL: Record<SetKind, string> = {
  warmup: "WARMUP",
  working: "WORKING",
  failure: "FAILURE",
};
