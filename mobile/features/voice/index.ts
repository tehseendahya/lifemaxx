/**
 * Logging a set in words.
 *
 * Two doors, one confirmation sheet, one write path:
 *
 *   TYPE IT  →  POST /api/sets/parse        ─┐
 *                                            ├→ one row per set, editable
 *   ◉ (mic)  →  POST /api/voice/transcribe  ─┘   → outbox → POST /api/sets
 *
 * `QuickLog` is the whole flow and the thing to drop into a screen. It is one
 * component rather than a button plus a separately-managed sheet because the
 * sheet, the number pad, the exercise picker, the group's bulk actions and the
 * note editor all have to agree about which row or which entry is being
 * edited, and threading that through a parent is how two of them end up
 * disagreeing.
 *
 * Inside the sheet the STATE is one row per set and the VIEW is one group per
 * exercise — see `model.ts`. The owner's five-line paste is fifteen sets, and
 * fifteen identical cards is not something anyone can check before tapping
 * confirm.
 *
 * One thing in the sheet is NOT a set and does not go through that queue: the
 * per-exercise CUE. It is pinned to the lift on the server
 * (`POST /api/mobile/exercise/cue`), read from `bootstrap.cues`, shown above
 * that lift's sets every time it is logged, and saved the moment it is typed —
 * so it is not gated on the confirm button and DISCARD does not take it back.
 * It goes through the same outbox the sets do when there is no signal to save
 * it directly, so a cue written in a basement is as durable as the sets around
 * it. See `ConfirmSheet` and the `cues` section of `model.ts`.
 *
 * The typed path is the primary one and depends on nothing new: `/api/sets/parse`
 * has been in production since before this project. The mic is additive — with
 * no `OPENAI_TRANSCRIBE_MODEL` configured, no microphone permission or no
 * signal it reports one inline line and the typed path is unaffected. Pass
 * `showVoice={false}` to leave it out entirely.
 *
 * Nothing in this feature writes a set directly. Confirmed rows go through
 * `@/lib/outbox`, the same queue manual logging uses, so a set confirmed in a
 * basement is durable before the sheet closes.
 */
export { QuickLog } from "./QuickLog";
export { VoiceButton } from "./VoiceButton";
export { ConfirmSheet } from "./ConfirmSheet";
export { TextEntry } from "./TextEntry";

export type { LogRow, MatchState, PadField, RowPatch, SetGroup, SetKind } from "./model";
