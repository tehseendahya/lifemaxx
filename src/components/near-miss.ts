/**
 * Which near misses the web logger has to ask about, and what answering means.
 *
 * `POST /api/sets/parse` creates an exercise it cannot find, and returns a
 * `nearMiss` beside it when something close already exists. The owner's
 * decision was "create automatically **but flag near-misses**". The phone's
 * confirmation sheet implements both halves; the web implemented only the
 * create half and ignored `nearMiss` entirely, so "bnch pres" silently minted
 * a second bench press and split the history with nothing shown.
 *
 * The web has no confirmation sheet — sets go straight to the outbox — so the
 * question has to be asked before anything is enqueued. That is a `confirm()`,
 * which is the idiom this component already uses for "Couldn't match". Crude,
 * but it asks the question at the only moment the answer is still cheap.
 *
 * The decision is here rather than in the component so it can be tested
 * without a browser: there is no DOM in this environment, and a rule about
 * when to interrupt somebody mid-workout is worth more than a rendering test.
 */

export interface WireExercise {
  id: string;
  name: string;
  /** "exact" | "fuzzy" | "new" — "new" means this request created the row. */
  confidence?: string | null;
}

export interface WireEntry {
  query?: string;
  exercise: WireExercise | null;
  nearMiss?: { id: string; name: string } | null;
  sets: unknown[];
}

export interface NearMissQuestion {
  /** Index into the entries array, so the caller can re-file that entry. */
  index: number;
  /** What the user typed. */
  query: string;
  /** Where the sets are currently filed. */
  filedAs: WireExercise;
  /** The older row this might have been. */
  suggestion: { id: string; name: string };
  /**
   * The exercise to delete if the user accepts the suggestion — set only when
   * this request created it. Null when the parse merely matched fuzzily, since
   * deleting a catalogue row or a pre-existing one would be destructive.
   */
  createdId: string | null;
  /** The sentence to put in front of the user. */
  prompt: string;
}

export function nearMissQuestions(entries: WireEntry[]): NearMissQuestion[] {
  const out: NearMissQuestion[] = [];

  entries.forEach((entry, index) => {
    const { exercise, nearMiss } = entry;
    if (!exercise || !nearMiss) return;

    /*
     * A fuzzy match carries its OWN row as the near miss, so asking "did you
     * mean Barbell Bench Press?" about Barbell Bench Press is a question with
     * a no-op answer. The phone words that case differently; here it is simply
     * not worth an interruption, because accepting it changes nothing.
     */
    if (nearMiss.id === exercise.id) return;

    const created = exercise.confidence === "new";
    out.push({
      index,
      query: entry.query ?? exercise.name,
      filedAs: exercise,
      suggestion: nearMiss,
      createdId: created ? exercise.id : null,
      prompt: created
        ? `"${entry.query ?? exercise.name}" was added as a new exercise, but `
          + `${nearMiss.name} already exists.\n\nFile these sets under `
          + `${nearMiss.name} instead?`
        : `"${entry.query ?? exercise.name}" was matched to ${exercise.name}, `
          + `but ${nearMiss.name} is close too.\n\nFile these sets under `
          + `${nearMiss.name} instead?`,
    });
  });

  return out;
}
