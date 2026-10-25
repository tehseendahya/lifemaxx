import * as Haptics from "expo-haptics";

/**
 * The haptic vocabulary, in four words.
 *
 * "No haptics" was a named complaint, and the fix is not simply adding some —
 * it is adding the *same* ones everywhere. Eight people reaching for
 * `impactAsync` directly produces a UI where a set save feels heavier than a
 * session finish on one screen and lighter on the next, which reads as
 * sloppiness even when nobody can say why. So features call these and never
 * import `expo-haptics`.
 *
 * All four are deliberately fire-and-forget and swallow their errors. A haptic
 * is feedback about something that already happened; an unhandled rejection
 * from the vibration motor must never be able to fail a save. On the web target
 * these are no-ops.
 */

function fire(run: () => Promise<void>): void {
  void run().catch(() => {});
}

/** Moving between things: picking an exercise, changing a tab, a number pad key. */
export function tapSelect(): void {
  fire(() => Haptics.selectionAsync());
}

/** Something was committed: a set queued, a meal saved, a weight logged. */
export function tapSave(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A whole flow finished: session ended, voice entry confirmed. */
export function tapDone(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** It did not work, and the screen is about to say so. */
export function tapError(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
