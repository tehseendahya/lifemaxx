/**
 * A one-line notice handed from the workout screen back to the Lift tab.
 *
 * Removing a workout's last set deletes the workout, and the screen then
 * `router.back()`s to Lift — which should say what happened ("Workout
 * deleted.") rather than leave the owner wondering where the row went. A back
 * navigation cannot carry params, and `LiftScreen` owns its notice state in a
 * file this feature does not edit, so the hand-off is this: the workout screen
 * posts, the start screen reads it once and clears it.
 *
 * In memory only. A notice that survived a relaunch would be describing
 * something from another day.
 */

type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function postLiftNotice(message: string): void {
  current = message;
  for (const l of listeners) l();
}

export function clearLiftNotice(): void {
  if (current === null) return;
  current = null;
  for (const l of listeners) l();
}

/** `useSyncExternalStore`'s two halves. */
export const liftNotice = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): string | null {
    return current;
  },
};
