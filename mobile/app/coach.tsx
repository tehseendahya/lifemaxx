/**
 * A modal, opened from the ◆ in the Today header. Chat is a task, not a place.
 *
 * The in-session ASK control is deliberately a different thing: it posts to
 * /api/session/ask, which carries session context and a cached prefix. It
 * shares the streaming hook, not this screen.
 */
export { default } from "@/features/coach";
