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
 * sheet, the number pad and the exercise picker all have to agree about which
 * row is being edited, and threading that through a parent is how two of them
 * end up disagreeing.
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

export type { LogRow, PadField, RowPatch } from "./model";
